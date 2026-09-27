-- ROLLBACK for scripts/notification_scheduling_2026_09.sql
-- Re-enable the cron-job.org jobs first, or notifications stop being sent.
-- Leaves the pg_cron extension and the Vault secret in place (harmless); remove the
-- secret in Dashboard → Project Settings → Vault if you want.

BEGIN;
SELECT cron.unschedule(jobid) FROM cron.job
 WHERE jobname IN ('process-notification-queue', 'monthly-friends-digest');
DROP TRIGGER IF EXISTS tr_kick_notification_queue ON public.notification_outbox;
DROP FUNCTION IF EXISTS public.tr_kick_notification_queue();
DROP FUNCTION IF EXISTS public.invoke_notification_function(text);
COMMIT;
