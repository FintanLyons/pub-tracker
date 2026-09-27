/**
 * Drains notification_outbox in batches. Pure orchestration: all I/O is passed in
 * (see process-notification-queue/index.ts), so the logic can be tested outside Deno.
 *
 * Per batch: claim rows (server-side lease, so overlapping runs never share a row)
 * → look up tokens / names in bulk → one Expo send per 100 messages → one receipts
 * check → record sent / failed (server applies retry backoff and gives up after 5).
 * Tickets whose receipt wasn't ready yet are saved and checked on a later run, so
 * late errors from Apple / Google end up in notification_outbox.receipt_error.
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

export type PendingTicket = { id: string; token: string };
export type UncheckedRow = { id: number; sent_at: string; push_tickets: PendingTicket[] };

export type WorkerDeps = {
  claimBatch: (limit: number, leaseSeconds: number) => Promise<OutboxRow[]>;
  finishBatch: (sent: number[], failed: { id: number; error: string }[]) => Promise<void>;
  /** user id → Expo push tokens */
  fetchTokens: (userIds: string[]) => Promise<Map<string, string[]>>;
  fetchUsernames: (userIds: string[]) => Promise<Map<string, string>>;
  fetchLeagueNames: (leagueIds: string[]) => Promise<Map<string, string>>;
  deleteTokens: (tokens: string[]) => Promise<void>;
  /** Store ticket ids still waiting for a receipt on their (sent) rows. */
  saveTickets: (rows: { id: number; tickets: PendingTicket[] }[]) => Promise<void>;
  /** Sent rows with saved tickets and no receipt check yet (oldest first). */
  loadUncheckedTickets: (limit: number) => Promise<UncheckedRow[]>;
  /** Record the receipt outcome; error null = delivered to Apple / Google. */
  markReceipts: (rows: { id: number; error: string | null }[]) => Promise<void>;
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
/** Receipts are normally ready within seconds to minutes; Expo keeps them ~24 h. */
export const RECEIPT_MIN_AGE_MS = 15_000;
export const RECEIPT_GIVE_UP_MS = 20 * 60 * 60 * 1000;
export const RECEIPT_CHECK_LIMIT = 300;
/** Errors after which the token is useless and should be removed. */
const DEAD_TOKEN_ERRORS = new Set(["DeviceNotRegistered"]);

export const NO_TOKENS_ERROR =
  "no_push_tokens: recipient has no row in user_push_tokens (open app after login, allow notifications)";

export type DrainResult = {
  batches: number;
  claimed: number;
  sent: number;
  failed: number;
  receiptsChecked: number;
  receiptErrors: number;
};

export async function drainOutbox(deps: WorkerDeps): Promise<DrainResult> {
  const started = deps.now();
  const result: DrainResult = {
    batches: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    receiptsChecked: 0,
    receiptErrors: 0,
  };

  try {
    const r = await checkDeferredReceipts(deps);
    result.receiptsChecked = r.checked;
    result.receiptErrors = r.errors;
  } catch (e) {
    // Never block sending on the receipt check.
    console.warn("deferred receipts", e instanceof Error ? e.message : e);
  }

  while (deps.now() - started < TIME_BUDGET_MS) {
    const rows = await deps.claimBatch(BATCH_SIZE, LEASE_SECONDS);
    if (rows.length === 0) break;
    result.batches += 1;
    result.claimed += rows.length;

    const { sent, failed, pending } = await processBatch(deps, rows);
    await deps.finishBatch(sent, failed);
    if (pending.length) {
      try {
        await deps.saveTickets(pending);
      } catch (e) {
        console.warn("save tickets", e instanceof Error ? e.message : e);
      }
    }
    result.sent += sent.length;
    result.failed += failed.length;

    if (rows.length < BATCH_SIZE) break;
  }
  return result;
}

async function processBatch(deps: WorkerDeps, rows: OutboxRow[]) {
  const sent: number[] = [];
  const failed: { id: number; error: string }[] = [];
  const pending: { id: number; tickets: PendingTicket[] }[] = [];

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
    return { sent, failed: rows.map((r) => ({ id: r.id, error })), pending };
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
  const pendingByRow = new Map<number, PendingTicket[]>();
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
      if (!receipt) {
        // Not ready yet — check again on a later run.
        pendingByRow.set(rowIndex, [
          ...(pendingByRow.get(rowIndex) ?? []),
          { id: ticket.ticketId, token: messages[i].to },
        ]);
      }
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
      const tickets = pendingByRow.get(rowIndex);
      if (tickets?.length) pending.push({ id: row.id, tickets });
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

  return { sent, failed, pending };
}

/** Receipts for tickets saved on earlier runs: record late errors, drop dead tokens. */
async function checkDeferredReceipts(deps: WorkerDeps) {
  const now = deps.now();
  const rows = (await deps.loadUncheckedTickets(RECEIPT_CHECK_LIMIT)).filter(
    (r) => now - Date.parse(r.sent_at) >= RECEIPT_MIN_AGE_MS,
  );
  if (!rows.length) return { checked: 0, errors: 0 };

  const ids = rows.flatMap((r) => (r.push_tickets ?? []).map((t) => t.id));
  const receipts = ids.length ? await deps.receipts(ids) : new Map();

  const marks: { id: number; error: string | null }[] = [];
  const deadTokens: string[] = [];
  for (const row of rows) {
    const tickets = row.push_tickets ?? [];
    const errors: string[] = [];
    let missing = false;
    for (const t of tickets) {
      const r = receipts.get(t.id);
      if (!r) {
        missing = true;
      } else if (!r.ok) {
        errors.push(r.error ?? "push_receipt_error");
        if (DEAD_TOKEN_ERRORS.has(r.error ?? "")) deadTokens.push(t.token);
      }
    }
    const tooOld = now - Date.parse(row.sent_at) > RECEIPT_GIVE_UP_MS;
    if (missing && !errors.length && !tooOld) continue; // try again next run
    marks.push({
      id: row.id,
      error: errors.length ? [...new Set(errors)].join("; ") : missing ? "receipt_unavailable" : null,
    });
  }

  if (marks.length) await deps.markReceipts(marks);
  if (deadTokens.length) {
    try {
      await deps.deleteTokens(deadTokens);
    } catch (e) {
      console.warn("delete dead tokens", e instanceof Error ? e.message : e);
    }
  }
  return { checked: marks.length, errors: marks.filter((m) => m.error && m.error !== "receipt_unavailable").length };
}
