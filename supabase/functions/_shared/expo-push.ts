/** Expo Push API — https://docs.expo.dev/push-notifications/sending-notifications/ */

const SEND_URL = "https://exp.host/--/api/v2/push/send";
const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
/** Expo accepts at most 100 messages per send request and 1000 ids per receipts request. */
const SEND_CHUNK = 100;
const RECEIPT_CHUNK = 1000;
const REQUEST_TIMEOUT_MS = 15_000;

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/** Per message, in the same order as the input. */
export type ExpoTicket =
  | { ok: true; ticketId: string | null }
  | { ok: false; error: string };

/** Per ticket id; ids with no receipt yet are left out. */
export type ExpoReceipts = Map<string, { ok: boolean; error?: string }>;

function headers(expoAccessToken: string) {
  return {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
    Authorization: `Bearer ${expoAccessToken}`,
  };
}

/**
 * Sends in chunks of 100. A chunk whose request fails (network, timeout, HTTP error)
 * reports every message in it as failed; other chunks are unaffected.
 *
 * Do not set channelId on the message unless that channel already exists on the device.
 * Expo docs: if channelId is set but the app never created it, the notification is not shown.
 * Leaving it out lets Expo use / create the default channel.
 */
export async function sendExpoPushMessages(
  expoAccessToken: string,
  messages: ExpoMessage[],
): Promise<ExpoTicket[]> {
  const out: ExpoTicket[] = [];
  for (let i = 0; i < messages.length; i += SEND_CHUNK) {
    const chunk = messages.slice(i, i + SEND_CHUNK);
    try {
      const res = await fetch(SEND_URL, {
        method: "POST",
        headers: headers(expoAccessToken),
        body: JSON.stringify(
          chunk.map((m) => ({
            to: m.to,
            title: m.title,
            body: m.body,
            data: m.data ?? {},
            sound: "default",
            priority: "high",
          })),
        ),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(`Expo push HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
      }
      const rows = Array.isArray(json?.data) ? json.data : [];
      chunk.forEach((_, j) => {
        const row = rows[j];
        if (row?.status === "ok") {
          out.push({ ok: true, ticketId: typeof row.id === "string" ? row.id : null });
        } else {
          out.push({
            ok: false,
            error: row?.details?.error ?? row?.message ?? "no ticket returned",
          });
        }
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      chunk.forEach(() => out.push({ ok: false, error }));
    }
  }
  return out;
}

/** Best effort: a failed request just means no receipts (treated as delivered). */
export async function fetchExpoReceipts(
  expoAccessToken: string,
  ticketIds: string[],
): Promise<ExpoReceipts> {
  const receipts: ExpoReceipts = new Map();
  for (let i = 0; i < ticketIds.length; i += RECEIPT_CHUNK) {
    try {
      const res = await fetch(RECEIPTS_URL, {
        method: "POST",
        headers: headers(expoAccessToken),
        body: JSON.stringify({ ids: ticketIds.slice(i, i + RECEIPT_CHUNK) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const json = await res.json().catch(() => ({}));
      const data = (json?.data ?? {}) as Record<
        string,
        { status: string; message?: string; details?: { error?: string } }
      >;
      for (const [id, r] of Object.entries(data)) {
        receipts.set(
          id,
          r.status === "ok"
            ? { ok: true }
            : { ok: false, error: r.details?.error ?? r.message ?? "push_receipt_error" },
        );
      }
    } catch (e) {
      console.warn("Expo receipts", e instanceof Error ? e.message : e);
    }
  }
  return receipts;
}
