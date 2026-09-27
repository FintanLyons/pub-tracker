// @ts-nocheck — Deno Edge runtime
/**
 * Drains notification_outbox and sends via Expo Push API (logic: _shared/outbox-worker.ts).
 * Needs scripts/notification_queue_2026_09.sql (claim_notification_batch /
 * finish_notification_batch).
 *
 * Schedule: cron-job.org every 1–2 minutes, or invoke manually.
 * Headers: x-cron-secret: <NOTIFICATION_CRON_SECRET>
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EXPO_ACCESS_TOKEN, NOTIFICATION_CRON_SECRET
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { assertCronSecret } from "../_shared/cron-auth.ts";
import { fetchExpoReceipts, sendExpoPushMessages } from "../_shared/expo-push.ts";
import { drainOutbox } from "../_shared/outbox-worker.ts";

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const expoToken = Deno.env.get("EXPO_ACCESS_TOKEN") ?? "";
  if (!supabaseUrl || !serviceKey || !expoToken) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const result = await drainOutbox({
      claimBatch: async (limit, leaseSeconds) => {
        const { data, error } = await supabase.rpc("claim_notification_batch", {
          p_limit: limit,
          p_lease_seconds: leaseSeconds,
        });
        if (error) throw error;
        return data ?? [];
      },
      finishBatch: async (sent, failed) => {
        const { error } = await supabase.rpc("finish_notification_batch", {
          p_sent: sent,
          p_failed_ids: failed.map((f) => f.id),
          p_failed_errors: failed.map((f) => f.error),
        });
        // Not fatal: the lease expires and the rows are retried.
        if (error) console.error("finish_notification_batch", error);
      },
      fetchTokens: async (userIds) => {
        const map = new Map<string, string[]>();
        if (!userIds.length) return map;
        const { data, error } = await supabase
          .from("user_push_tokens")
          .select("user_id, expo_push_token")
          .in("user_id", userIds);
        if (error) throw error;
        for (const r of data ?? []) {
          if (!r.expo_push_token) continue;
          map.set(r.user_id, [...(map.get(r.user_id) ?? []), r.expo_push_token]);
        }
        return map;
      },
      fetchUsernames: async (userIds) => {
        const map = new Map<string, string>();
        if (!userIds.length) return map;
        const { data, error } = await supabase
          .from("users")
          .select("id, username")
          .in("id", userIds);
        if (error) throw error;
        for (const u of data ?? []) if (u.username) map.set(u.id, u.username);
        return map;
      },
      fetchLeagueNames: async (leagueIds) => {
        const map = new Map<string, string>();
        if (!leagueIds.length) return map;
        const { data, error } = await supabase
          .from("leagues")
          .select("id, name")
          .in("id", leagueIds);
        if (error) throw error;
        for (const l of data ?? []) if (l.name) map.set(l.id, l.name);
        return map;
      },
      deleteTokens: async (tokens) => {
        const { error } = await supabase
          .from("user_push_tokens")
          .delete()
          .in("expo_push_token", tokens);
        if (error) throw error;
      },
      send: (messages) => sendExpoPushMessages(expoToken, messages),
      receipts: (ids) => fetchExpoReceipts(expoToken, ids),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
    });
    return json(result, 200);
  } catch (e) {
    console.error("process-notification-queue", e);
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
