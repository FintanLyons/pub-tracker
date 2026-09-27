// @ts-nocheck — Deno Edge runtime
/**
 * Last calendar day of each month, from 17:00 Europe/London: queue the friends
 * leaderboard digest (or a prompt to add friends) for every user with a device.
 * process-notification-queue sends it within a minute or two.
 *
 * Needs scripts/notification_queue_2026_09.sql (enqueue_monthly_digest). Each user
 * is queued at most once a month, so the 18:00–20:00 runs only catch up on anything
 * the 17:00 run missed.
 *
 * Schedule: hourly cron `0 * * * *` — exits immediately outside the send window.
 * Headers: x-cron-secret: <NOTIFICATION_CRON_SECRET>
 *
 * Testing: set Edge secret MONTHLY_DIGEST_SKIP_SCHEDULE=true to bypass the London date/hour gate (still requires
 * x-cron-secret; still once per user per month). Unset in production.
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NOTIFICATION_CRON_SECRET
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { assertCronSecret } from "../_shared/cron-auth.ts";

/** London hours (inclusive) in which the digest may be queued on the last day. */
const FIRST_HOUR = 17;
const LAST_HOUR = 20;

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
  const hour = getLondonHour(now);
  if (
    !skipSchedule &&
    (!isLastDayOfMonthLondon(now) || hour < FIRST_HOUR || hour > LAST_HOUR)
  ) {
    return json({ skipped: true, reason: "not monthly send window (Europe/London)" }, 200);
  }

  const yearMonth = londonYearMonth(now);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: queued, error } = await supabase.rpc("enqueue_monthly_digest", {
    p_year_month: yearMonth,
  });
  if (error) {
    console.error("enqueue_monthly_digest", error);
    return json({ error: error.message }, 500);
  }

  return json({ queued, yearMonth }, 200);
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

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
