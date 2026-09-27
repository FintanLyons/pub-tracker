-- ROLLBACK for scripts/notification_queue_2026_09.sql
-- Redeploy the previous process-notification-queue and monthly-friends-digest
-- Edge Functions FIRST (git: before the Batch 7 commits) — the new ones call the
-- functions dropped here.
-- Rows the new worker gave up on (failed_at) are marked sent so the old worker
-- doesn't deliver them late. Queued 'monthly_digest' rows are left in place (the old worker would send them
-- with a generic message), so delete them if any are unsent.

BEGIN;
DROP FUNCTION IF EXISTS public.claim_notification_batch(integer, integer);
DROP FUNCTION IF EXISTS public.finish_notification_batch(bigint[], bigint[], text[]);
DROP FUNCTION IF EXISTS public.enqueue_monthly_digest(text);

DELETE FROM public.notification_outbox WHERE kind = 'monthly_digest' AND sent_at IS NULL;
UPDATE public.notification_outbox SET sent_at = coalesce(sent_at, failed_at) WHERE failed_at IS NOT NULL;

DROP INDEX IF EXISTS public.idx_notification_outbox_pending;
ALTER TABLE public.notification_outbox
  DROP COLUMN IF EXISTS attempts,
  DROP COLUMN IF EXISTS not_before,
  DROP COLUMN IF EXISTS failed_at;
CREATE INDEX idx_notification_outbox_pending ON public.notification_outbox
  USING btree (created_at) WHERE (sent_at IS NULL);
COMMIT;
