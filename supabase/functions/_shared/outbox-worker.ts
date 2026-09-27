/**
 * Drains notification_outbox in batches. Pure orchestration: all I/O is passed in
 * (see process-notification-queue/index.ts), so the logic can be tested outside Deno.
 *
 * Per batch: claim rows (server-side lease, so overlapping runs never share a row)
 * → look up tokens / names in bulk → one Expo send per 100 messages → one receipts
 * check → record sent / failed (server applies retry backoff and gives up after 5).
 */
import type { ExpoMessage, ExpoReceipts, ExpoTicket } from "./expo-push.ts";
import { buildPushMessage, referencedIds } from "./notification-messages.ts";
import type { OutboxPayload } from "./notification-messages.ts";

export type OutboxRow = {
  id: number;
  target_user_id: string;
  kind: string;
  payload: OutboxPayload | null;
  attempts: number;
};

export type WorkerDeps = {
  claimBatch: (limit: number, leaseSeconds: number) => Promise<OutboxRow[]>;
  finishBatch: (sent: number[], failed: { id: number; error: string }[]) => Promise<void>;
  /** user id → Expo push tokens */
  fetchTokens: (userIds: string[]) => Promise<Map<string, string[]>>;
  fetchUsernames: (userIds: string[]) => Promise<Map<string, string>>;
  fetchLeagueNames: (leagueIds: string[]) => Promise<Map<string, string>>;
  deleteTokens: (tokens: string[]) => Promise<void>;
  send: (messages: ExpoMessage[]) => Promise<ExpoTicket[]>;
  receipts: (ticketIds: string[]) => Promise<ExpoReceipts>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export const BATCH_SIZE = 100;
/** Rows stay claimed this long; must exceed one batch's worst case (2 × 15 s timeouts + wait). */
export const LEASE_SECONDS = 120;
/** Stop starting new batches after this long (cron-job.org waits ~30 s for a reply). */
export const TIME_BUDGET_MS = 20_000;
/** Expo receipts usually aren't ready immediately; a short wait catches most errors. */
export const RECEIPT_WAIT_MS = 2_000;
/** Errors after which the token is useless and should be removed. */
const DEAD_TOKEN_ERRORS = new Set(["DeviceNotRegistered"]);

export const NO_TOKENS_ERROR =
  "no_push_tokens: recipient has no row in user_push_tokens (open app after login, allow notifications)";

export type DrainResult = { batches: number; claimed: number; sent: number; failed: number };

export async function drainOutbox(deps: WorkerDeps): Promise<DrainResult> {
  const started = deps.now();
  const result: DrainResult = { batches: 0, claimed: 0, sent: 0, failed: 0 };

  while (deps.now() - started < TIME_BUDGET_MS) {
    const rows = await deps.claimBatch(BATCH_SIZE, LEASE_SECONDS);
    if (rows.length === 0) break;
    result.batches += 1;
    result.claimed += rows.length;

    const { sent, failed } = await processBatch(deps, rows);
    await deps.finishBatch(sent, failed);
    result.sent += sent.length;
    result.failed += failed.length;

    if (rows.length < BATCH_SIZE) break;
  }
  return result;
}

async function processBatch(deps: WorkerDeps, rows: OutboxRow[]) {
  const sent: number[] = [];
  const failed: { id: number; error: string }[] = [];

  const userIds = new Set<string>();
  const leagueIds = new Set<string>();
  for (const row of rows) {
    const ids = referencedIds(row.kind, row.payload);
    ids.userIds.forEach((id) => userIds.add(id));
    ids.leagueIds.forEach((id) => leagueIds.add(id));
  }

  let tokensByUser: Map<string, string[]>;
  let usernames: Map<string, string>;
  let leagueNames: Map<string, string>;
  try {
    [tokensByUser, usernames, leagueNames] = await Promise.all([
      deps.fetchTokens([...new Set(rows.map((r) => r.target_user_id))]),
      deps.fetchUsernames([...userIds]),
      deps.fetchLeagueNames([...leagueIds]),
    ]);
  } catch (e) {
    const error = `lookup failed: ${e instanceof Error ? e.message : String(e)}`;
    return { sent, failed: rows.map((r) => ({ id: r.id, error })) };
  }

  // One Expo message per (row, device).
  const messages: ExpoMessage[] = [];
  const owner: number[] = []; // messages[i] belongs to rows[owner[i]]
  rows.forEach((row, rowIndex) => {
    const tokens = tokensByUser.get(row.target_user_id) ?? [];
    if (tokens.length === 0) return;
    const msg = buildPushMessage(row.kind, row.payload, usernames, leagueNames);
    for (const to of tokens) {
      messages.push({ to, ...msg });
      owner.push(rowIndex);
    }
  });

  const tickets = messages.length ? await deps.send(messages) : [];
  const ticketIds = tickets.flatMap((t) => (t.ok && t.ticketId ? [t.ticketId] : []));
  let receipts: ExpoReceipts = new Map();
  if (ticketIds.length) {
    await deps.sleep(RECEIPT_WAIT_MS);
    receipts = await deps.receipts(ticketIds);
  }

  const okByRow = new Map<number, boolean>();
  const errorsByRow = new Map<number, string[]>();
  const deadTokens: string[] = [];
  tickets.forEach((ticket, i) => {
    const rowIndex = owner[i];
    let error: string | undefined;
    if (!ticket.ok) {
      error = ticket.error;
    } else if (ticket.ticketId) {
      const receipt = receipts.get(ticket.ticketId);
      if (receipt && !receipt.ok) error = receipt.error ?? "push_receipt_error";
    }
    if (error === undefined) {
      okByRow.set(rowIndex, true);
    } else {
      errorsByRow.set(rowIndex, [...(errorsByRow.get(rowIndex) ?? []), error]);
      if (DEAD_TOKEN_ERRORS.has(error)) deadTokens.push(messages[i].to);
    }
  });

  rows.forEach((row, rowIndex) => {
    if (okByRow.get(rowIndex)) {
      sent.push(row.id);
    } else if (!tokensByUser.get(row.target_user_id)?.length) {
      failed.push({ id: row.id, error: NO_TOKENS_ERROR });
    } else {
      const errs = [...new Set(errorsByRow.get(rowIndex) ?? ["all recipients failed"])];
      failed.push({ id: row.id, error: errs.join("; ") });
    }
  });

  if (deadTokens.length) {
    try {
      await deps.deleteTokens(deadTokens);
    } catch (e) {
      console.warn("delete dead tokens", e instanceof Error ? e.message : e);
    }
  }

  return { sent, failed };
}
