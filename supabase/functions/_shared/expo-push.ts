/** Expo Push API — https://docs.expo.dev/push-notifications/sending-notifications/ */

export type ExpoPushRecipientResult = {
  token: string;
  ok: boolean;
  error?: string;
};

type TicketRow = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

/**
 * Do not set channelId on the message unless that channel already exists on the device.
 * Expo docs: if channelId is set but the app never created it, the notification is not shown.
 * Leaving it out lets Expo use / create the default channel.
 */
export async function sendExpoPushMulticast(params: {
  expoAccessToken: string;
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<ExpoPushRecipientResult[]> {
  const { expoAccessToken, tokens, title, body, data = {} } = params;
  if (tokens.length === 0) return [];

  const messages = tokens.map((to) => ({
    to,
    title,
    body,
    sound: "default" as const,
    priority: "high" as const,
    data,
  }));

  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
      Authorization: `Bearer ${expoAccessToken}`,
    },
    body: JSON.stringify(messages),
  });

  const json = (await res.json()) as {
    data?: TicketRow[];
    errors?: unknown;
  };

  if (!res.ok) {
    throw new Error(`Expo push HTTP ${res.status}: ${JSON.stringify(json)}`);
  }

  const rows = json.data ?? [];
  const base = tokens.map((token, i) => {
    const row = rows[i];
    if (!row || row.status === "error") {
      const code = row?.details?.error ?? row?.message ?? "unknown";
      return {
        token,
        ok: false as boolean,
        error: code,
        ticketId: undefined as string | undefined,
      };
    }
    return { token, ok: true as boolean, ticketId: row.id };
  });

  const ticketIds = base
    .map((b) => b.ticketId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (ticketIds.length === 0) {
    return base.map(({ token, ok, error }) => ({ token, ok, error }));
  }

  await new Promise((r) => setTimeout(r, 2000));

  const recRes = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${expoAccessToken}`,
    },
    body: JSON.stringify({ ids: ticketIds }),
  });

  const recJson = (await recRes.json()) as {
    data?: Record<string, { status: string; message?: string; details?: { error?: string } }>;
  };

  const receipts = recJson.data ?? {};

  return base.map((b) => {
    if (!b.ok || !b.ticketId) {
      return { token: b.token, ok: b.ok, error: b.error };
    }
    const receipt = receipts[b.ticketId];
    if (!receipt) {
      return {
        token: b.token,
        ok: true,
        error: undefined,
      };
    }
    if (receipt.status === "error") {
      const err =
        receipt.details?.error ?? receipt.message ?? "push_receipt_error";
      return { token: b.token, ok: false, error: err };
    }
    return { token: b.token, ok: true };
  });
}
