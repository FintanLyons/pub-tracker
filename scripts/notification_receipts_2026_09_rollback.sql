-- ROLLBACK for scripts/notification_receipts_2026_09.sql
-- Redeploy the previous process-notification-queue first (it doesn't use these columns).

BEGIN;
DROP INDEX IF EXISTS public.idx_notification_outbox_receipts_pending;
ALTER TABLE public.notification_outbox
  DROP COLUMN IF EXISTS push_tickets,
  DROP COLUMN IF EXISTS receipts_checked_at,
  DROP COLUMN IF EXISTS receipt_error;
COMMIT;
