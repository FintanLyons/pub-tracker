// @ts-nocheck — Deno Edge runtime
/**
 * Drains notification_outbox and sends via Expo Push API.
 *
 * Schedule: Supabase Dashboard → Edge Functions → cron every 1–2 minutes, or invoke manually.
 * Headers: x-cron-secret: <NOTIFICATION_CRON_SECRET>
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EXPO_ACCESS_TOKEN, NOTIFICATION_CRON_SECRET
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { assertCronSecret } from "../_shared/cron-auth.ts";
import { sendExpoPushMulticast } from "../_shared/expo-push.ts";

const BATCH = 50;

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

  const { data: rows, error: selErr } = await supabase
    .from("notification_outbox")
    .select("id, target_user_id, kind, payload")
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (selErr) {
    console.error(selErr);
    return json({ error: selErr.message }, 500);
  }

  if (!rows?.length) {
    return json({ processed: 0, message: "empty queue" }, 200);
  }

  let processed = 0;
  for (const row of rows) {
    const { id, target_user_id: targetUserId, kind, payload } = row;
    try {
      const { title, body, data } = await resolveMessage(supabase, kind, payload);

      const { data: tokenRows, error: tokErr } = await supabase
        .from("user_push_tokens")
        .select("expo_push_token")
        .eq("user_id", targetUserId);

      if (tokErr) throw tokErr;

      const tokens = (tokenRows ?? []).map((r) => r.expo_push_token).filter(Boolean);
      if (tokens.length === 0) {
        await supabase
          .from("notification_outbox")
          .update({
            last_error:
              "no_push_tokens: recipient has no row in user_push_tokens (open app after login, allow notifications)",
          })
          .eq("id", id);
        continue;
      }

      const results = await sendExpoPushMulticast({
        expoAccessToken: expoToken,
        tokens,
        title,
        body,
        data: { ...data, kind },
      });

      for (const r of results) {
        if (!r.ok && r.error === "DeviceNotRegistered") {
          await supabase
            .from("user_push_tokens")
            .delete()
            .eq("expo_push_token", r.token);
        }
      }

      const anyOk = results.some((r) => r.ok);
      const errs = results.filter((r) => !r.ok).map((r) => r.error).join("; ");
      if (!anyOk && tokens.length > 0) {
        await supabase
          .from("notification_outbox")
          .update({
            last_error: errs || "all recipients failed",
          })
          .eq("id", id);
      } else {
        await supabase
          .from("notification_outbox")
          .update({
            sent_at: new Date().toISOString(),
            last_error: anyOk ? null : errs,
          })
          .eq("id", id);
        processed += 1;
      }
    } catch (e) {
      console.error("outbox row", id, e);
      const msg = e instanceof Error ? e.message : String(e);
      await supabase
        .from("notification_outbox")
        .update({ last_error: msg })
        .eq("id", id);
    }
  }

  return json({ processed, batchSize: rows.length }, 200);
});

async function resolveMessage(
  supabase: ReturnType<typeof createClient>,
  kind: string,
  payload: Record<string, unknown> | null,
): Promise<{ title: string; body: string; data: Record<string, unknown> }> {
  const p = payload ?? {};

  if (kind === "friend_request") {
    const requesterId = p.requester_id as string | undefined;
    let name = "Someone";
    if (requesterId) {
      const { data: u } = await supabase
        .from("users")
        .select("username")
        .eq("id", requesterId)
        .maybeSingle();
      if (u?.username) name = u.username;
    }
    return {
      title: "Friend request",
      body: `${name} wants to be friends on Pub Tracker`,
      data: { friendship_id: p.friendship_id, requester_id: requesterId },
    };
  }

  if (kind === "league_added") {
    const leagueId = p.league_id as string | undefined;
    const addedBy = p.added_by_user_id as string | undefined;
    let leagueName = "a league";
    if (leagueId) {
      const { data: lg } = await supabase
        .from("leagues")
        .select("name")
        .eq("id", leagueId)
        .maybeSingle();
      if (lg?.name) leagueName = lg.name;
    }
    let who = "Someone";
    if (addedBy) {
      const { data: u } = await supabase
        .from("users")
        .select("username")
        .eq("id", addedBy)
        .maybeSingle();
      if (u?.username) who = u.username;
    }
    return {
      title: "League",
      body: `${who} added you to ${leagueName}`,
      data: { league_id: leagueId, added_by_user_id: addedBy },
    };
  }

  return {
    title: "Pub Tracker",
    body: "You have a new notification",
    data: {},
  };
}

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
