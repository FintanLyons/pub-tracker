-- =============================================================================
-- Notification scheduling inside Supabase — audit Batch 7e (2026-09-27)
-- =============================================================================
-- Run once in the Supabase SQL editor (paste the WHOLE file, nothing highlighted),
-- AFTER scripts/notification_queue_2026_09.sql and after deploying the Batch 7
-- Edge Functions.
-- Rollback: scripts/notification_scheduling_2026_09_rollback.sql
--
-- BEFORE running, store the cron secret in Vault (one-off, separate query — do NOT
-- put the value in this file or in git). Use the same value as the Edge secret
-- NOTIFICATION_CRON_SECRET (copy it from the x-cron-secret header of the
-- cron-job.org jobs):
--
--   select vault.create_secret('<the secret>', 'notification_cron_secret',
--                              'x-cron-secret for notification Edge Functions');
--
-- EFFECT
--  • invoke_notification_function(name): calls an Edge Function via pg_net with the
--    x-cron-secret header read from Vault. Server-only.
--  • Trigger on notification_outbox INSERT: calls process-notification-queue after
--    the inserting transaction commits, so pushes go out in seconds. One request per
--    transaction (a summon to 10 friends inserts 10 rows but sends one request).
--    If anything goes wrong it only logs a warning — inserts (friend requests,
--    summons…) never fail because of it.
--  • pg_cron (Supabase Cron, free tier) jobs replacing cron-job.org:
--      process-notification-queue  every minute (safety net + retries)
--      monthly-friends-digest      hourly at :00
--    Keep the cron-job.org jobs running until this is verified, then disable them.
--    Running both for a while is safe: rows are claimed, never sent twice.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

CREATE OR REPLACE FUNCTION public.invoke_notification_function(p_function text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_secret text;
  v_url text;
BEGIN
  IF p_function NOT IN ('process-notification-queue', 'monthly-friends-digest') THEN
    RAISE EXCEPTION 'unknown function %', p_function USING ERRCODE = '22023';
  END IF;

  SELECT ds.decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets ds
   WHERE ds.name = 'notification_cron_secret'
   LIMIT 1;
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE WARNING 'invoke_notification_function: vault secret notification_cron_secret is missing';
    RETURN NULL;
  END IF;

  v_url := 'https://ddfdwxrnouneqqzactus.supabase.co/functions/v1/' || p_function;

  RETURN net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    timeout_milliseconds := 30000
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.tr_kick_notification_queue()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- pg_net sends queued requests after commit; if one for the worker is already
  -- queued (e.g. earlier in this transaction), don't add another.
  IF NOT EXISTS (
    SELECT 1 FROM net.http_request_queue q
     WHERE q.url LIKE '%/functions/v1/process-notification-queue'
  ) THEN
    PERFORM public.invoke_notification_function('process-notification-queue');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Never block the insert; the every-minute cron job picks the row up.
  RAISE WARNING 'tr_kick_notification_queue: %', SQLERRM;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.invoke_notification_function(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tr_kick_notification_queue() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_kick_notification_queue ON public.notification_outbox;
CREATE TRIGGER tr_kick_notification_queue
  AFTER INSERT ON public.notification_outbox
  FOR EACH STATEMENT EXECUTE FUNCTION public.tr_kick_notification_queue();

-- cron.schedule with a job name replaces an existing job of that name.
SELECT cron.schedule(
  'process-notification-queue',
  '* * * * *',
  $$SELECT public.invoke_notification_function('process-notification-queue')$$
);
SELECT cron.schedule(
  'monthly-friends-digest',
  '0 * * * *',
  $$SELECT public.invoke_notification_function('monthly-friends-digest')$$
);

COMMIT;
