-- =============================================================================
-- Push delivery receipts — follow-up to Batch 7 (2026-09-27)
-- =============================================================================
-- Run once in the Supabase SQL editor (paste the WHOLE file, nothing highlighted),
-- BEFORE deploying the updated process-notification-queue function.
-- Rollback: scripts/notification_receipts_2026_09_rollback.sql
--
-- WHY: Expo only knows whether Apple/Google accepted a push a few seconds to
-- minutes after sending (the "receipt"). The worker waited 2 s, so late errors
-- (e.g. from Apple) were never recorded — a push could vanish without trace.
--
-- EFFECT (additive; nothing is deleted):
--  • notification_outbox.push_tickets — Expo ticket ids whose receipt wasn't ready
--    at send time: [{"id": "...", "token": "ExponentPushToken[...]"}]
--  • notification_outbox.receipt_error / receipts_checked_at — filled in by the
--    worker on a later run. The row stays "sent"; receipt_error explains why the
--    phone may not have shown it.
-- =============================================================================

BEGIN;

ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS push_tickets jsonb,
  ADD COLUMN IF NOT EXISTS receipts_checked_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS receipt_error text;

CREATE INDEX IF NOT EXISTS idx_notification_outbox_receipts_pending
  ON public.notification_outbox USING btree (sent_at)
  WHERE (push_tickets IS NOT NULL AND receipts_checked_at IS NULL);

COMMIT;
