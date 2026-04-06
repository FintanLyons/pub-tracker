// @ts-nocheck — Deno Edge runtime
/**
 * Last calendar day of each month, 17:00 Europe/London: send friends leaderboard digest
 * (or prompt to add friends if none).
 *
 * Schedule: hourly cron `0 * * * *` — function exits immediately unless London is last day of month and hour is 17.
 * Headers: x-cron-secret: <NOTIFICATION_CRON_SECRET>
 *
 * Testing: set Edge secret MONTHLY_DIGEST_SKIP_SCHEDULE=true to bypass the London date/hour gate (still requires
 * x-cron-secret; still dedupes via notification_monthly_digest_log). Unset in production.
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EXPO_ACCESS_TOKEN, NOTIFICATION_CRON_SECRET
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { assertCronSecret } from "../_shared/cron-auth.ts";
import { sendExpoPushMulticast } from "../_shared/expo-push.ts";

const USER_PAGE = 400;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    assertCronSecret(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, msg === "Unauthorized" ? 401 : 500);
  }

  const now = new Date();
  const skipSchedule =
    (Deno.env.get("MONTHLY_DIGEST_SKIP_SCHEDULE") ?? "").toLowerCase() === "true";
  if (
    !skipSchedule &&
    (!isLastDayOfMonthLondon(now) || getLondonHour(now) !== 17)
  ) {
    return json({ skipped: true, reason: "not monthly send window (Europe/London)" }, 200);
  }

  const yearMonth = londonYearMonth(now);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const expoToken = Deno.env.get("EXPO_ACCESS_TOKEN") ?? "";
  if (!supabaseUrl || !serviceKey || !expoToken) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  let sent = 0;
  let skipped = 0;
  let from = 0;

  for (;;) {
    const { data: users, error: uErr } = await supabase
      .from("users")
      .select("id")
      .range(from, from + USER_PAGE - 1);

    if (uErr) {
      console.error(uErr);
      return json({ error: uErr.message, partial: { sent, skipped } }, 500);
    }

    if (!users?.length) break;

    for (const { id: userId } of users) {
      const { data: tokenRows, error: tokErr } = await supabase
        .from("user_push_tokens")
        .select("expo_push_token")
        .eq("user_id", userId);

      if (tokErr) {
        console.error(tokErr);
        continue;
      }

      const tokens = (tokenRows ?? []).map((r) => r.expo_push_token).filter(Boolean);
      if (tokens.length === 0) {
        skipped += 1;
        continue;
      }

      const { error: claimErr } = await supabase.from("notification_monthly_digest_log").insert({
        user_id: userId,
        year_month: yearMonth,
      });

      if (claimErr) {
        if (claimErr.code === "23505") {
          skipped += 1;
          continue;
        }
        console.error("digest claim", claimErr);
        continue;
      }

      try {
        const digest = await computeDigest(supabase, userId);
        const title = "Monthly leaderboard";
        const body = digest.body;
        const data = { kind: "monthly_digest", year_month: yearMonth, ...digest.data };

        const results = await sendExpoPushMulticast({
          expoAccessToken: expoToken,
          tokens,
          title,
          body,
          data,
        });
        const anyOk = results.some((r) => r.ok);
        for (const r of results) {
          if (!r.ok && r.error === "DeviceNotRegistered") {
            await supabase.from("user_push_tokens").delete().eq("expo_push_token", r.token);
          }
        }
        if (!anyOk) {
          await supabase
            .from("notification_monthly_digest_log")
            .delete()
            .eq("user_id", userId)
            .eq("year_month", yearMonth);
          continue;
        }
        sent += 1;
      } catch (e) {
        console.error("digest send", userId, e);
        await supabase
          .from("notification_monthly_digest_log")
          .delete()
          .eq("user_id", userId)
          .eq("year_month", yearMonth);
      }
    }

    from += users.length;
    if (users.length < USER_PAGE) break;
  }

  return json({ sent, skipped, yearMonth }, 200);
});

function londonYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function londonYearMonth(d: Date): string {
  return londonYmd(d).slice(0, 7);
}

function getLondonHour(d: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "numeric",
    hour12: false,
  }).format(d);
  return parseInt(h, 10);
}

function isLastDayOfMonthLondon(d: Date): boolean {
  const today = londonYmd(d);
  const tomorrow = londonYmd(new Date(d.getTime() + 24 * 60 * 60 * 1000));
  return today.slice(0, 7) !== tomorrow.slice(0, 7);
}

async function computeDigest(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ body: string; data: Record<string, unknown> }> {
  const { data: friendships, error: fErr } = await supabase
    .from("friendships")
    .select("user_id, friend_id")
    .eq("status", "accepted")
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`);

  if (fErr) throw fErr;

  const friendIds = new Set<string>();
  for (const f of friendships ?? []) {
    const other = f.user_id === userId ? f.friend_id : f.user_id;
    if (other !== userId) friendIds.add(other);
  }

  if (friendIds.size === 0) {
    return {
      body: "Add friends on the Leaderboard tab to compare your pub scores each month.",
      data: { rank: null, friend_count: 0 },
    };
  }

  const ids = [userId, ...[...friendIds]];
  const { data: statsRows, error: sErr } = await supabase
    .from("user_stats")
    .select("user_id, total_score")
    .in("user_id", ids);

  if (sErr) throw sErr;

  const scoreMap = new Map<string, number>();
  for (const row of statsRows ?? []) {
    scoreMap.set(row.user_id, row.total_score ?? 0);
  }

  const leaderboard = ids.map((id) => ({
    id,
    total_score: scoreMap.get(id) ?? 0,
  }));
  leaderboard.sort((a, b) => b.total_score - a.total_score);
  const rank = leaderboard.findIndex((r) => r.id === userId) + 1;
  const total = leaderboard.length;

  return {
    body: `You're #${rank} of ${total} on your friends leaderboard this month. Open Pub Tracker to see the full board.`,
    data: { rank, friend_count: friendIds.size, total_in_board: total },
  };
}

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
