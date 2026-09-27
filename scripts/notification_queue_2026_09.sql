-- =============================================================================
-- Notification queue reliability — audit Batch 7a/7b (2026-09-27)
-- =============================================================================
-- Run once in the Supabase SQL editor (paste the WHOLE file, nothing highlighted).
-- Rollback: scripts/notification_queue_2026_09_rollback.sql
--
-- ORDER: run this BEFORE deploying the new process-notification-queue and
-- monthly-friends-digest Edge Functions. The currently deployed functions keep
-- working after this runs (they ignore the new columns).
--
-- WHY
--  • Rows that could never be sent (recipient has no device) stayed pending forever
--    and were retried every minute. 50 of them would block the whole queue.
--  • Old notifications could be delivered weeks late ("summoned to the pub").
--  • Overlapping worker runs could pick up the same rows and send them twice.
--  • The monthly digest sent to users one by one inside one function call and
--    could run out of time.
--
-- EFFECT
--  • notification_outbox gets: attempts, not_before (claim lease / retry backoff),
--    failed_at (gave up). Nothing is deleted.
--  • claim_notification_batch(): expires stale rows, then claims pending rows with
--    FOR UPDATE SKIP LOCKED so two runs never get the same row.
--      expiry: pub_summon 2 h, monthly_digest 12 h, everything else 7 days
--  • finish_notification_batch(): marks rows sent, or schedules a retry
--    (1 min, 5 min, 30 min, 2 h) and gives up after 5 attempts.
--  • enqueue_monthly_digest(): queues one 'monthly_digest' row per user with a
--    registered device (once per month, via notification_monthly_digest_log), with
--    their rank among friends worked out here.
--  • All three are server-only (service_role); the app cannot call them.
-- =============================================================================

BEGIN;

ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS not_before timestamp with time zone,
  ADD COLUMN IF NOT EXISTS failed_at timestamp with time zone;

DROP INDEX IF EXISTS public.idx_notification_outbox_pending;
CREATE INDEX idx_notification_outbox_pending ON public.notification_outbox
  USING btree (created_at) WHERE (sent_at IS NULL AND failed_at IS NULL);

-- --- Claim -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_notification_batch(
  p_limit integer DEFAULT 100,
  p_lease_seconds integer DEFAULT 120
)
 RETURNS TABLE (id bigint, target_user_id uuid, kind text, payload jsonb, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Too old to be useful: give up instead of delivering late.
  UPDATE public.notification_outbox o
     SET failed_at = now(),
         not_before = NULL,
         last_error = left('expired: ' || coalesce(o.last_error, 'not sent in time'), 500)
   WHERE o.sent_at IS NULL
     AND o.failed_at IS NULL
     AND o.created_at < now() - CASE o.kind
           WHEN 'pub_summon' THEN interval '2 hours'
           WHEN 'monthly_digest' THEN interval '12 hours'
           ELSE interval '7 days'
         END;

  RETURN QUERY
  WITH picked AS (
    SELECT o.id
      FROM public.notification_outbox o
     WHERE o.sent_at IS NULL
       AND o.failed_at IS NULL
       AND (o.not_before IS NULL OR o.not_before <= now())
     ORDER BY o.created_at, o.id
     LIMIT greatest(1, least(coalesce(p_limit, 100), 500))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_outbox o
     SET attempts = o.attempts + 1,
         -- Lease: another run won't pick this row until it expires.
         not_before = now() + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 120)))
    FROM picked
   WHERE o.id = picked.id
  RETURNING o.id, o.target_user_id, o.kind, o.payload, o.attempts;
END;
$function$;

-- --- Finish ------------------------------------------------------------------
-- p_sent: rows delivered to at least one device.
-- p_failed_ids / p_failed_errors: parallel arrays; retried with backoff, then failed.
CREATE OR REPLACE FUNCTION public.finish_notification_batch(
  p_sent bigint[],
  p_failed_ids bigint[],
  p_failed_errors text[]
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.notification_outbox o
     SET sent_at = now(),
         not_before = NULL,
         last_error = NULL
   WHERE o.id = ANY (coalesce(p_sent, '{}'))
     AND o.sent_at IS NULL;

  UPDATE public.notification_outbox o
     SET last_error = left(coalesce(f.err, 'unknown error'), 500),
         failed_at = CASE WHEN o.attempts >= 5 THEN now() END,
         not_before = CASE
           WHEN o.attempts >= 5 THEN NULL
           ELSE now() + (ARRAY[
             interval '1 minute', interval '5 minutes',
             interval '30 minutes', interval '2 hours'
           ])[greatest(1, o.attempts)]
         END
    FROM unnest(coalesce(p_failed_ids, '{}'), coalesce(p_failed_errors, '{}')) AS f(id, err)
   WHERE o.id = f.id
     AND o.sent_at IS NULL
     AND o.failed_at IS NULL;
END;
$function$;

-- --- Monthly digest ----------------------------------------------------------
-- Returns the number of rows queued. Safe to call repeatedly: each user is queued
-- at most once per p_year_month (notification_monthly_digest_log primary key).
CREATE OR REPLACE FUNCTION public.enqueue_monthly_digest(p_year_month text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_year_month IS NULL OR p_year_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'year_month must look like 2026-09' USING ERRCODE = '22023';
  END IF;

  WITH claimed AS (
    INSERT INTO public.notification_monthly_digest_log (user_id, year_month)
    SELECT DISTINCT t.user_id, p_year_month
      FROM public.user_push_tokens t
      JOIN public.users u ON u.id = t.user_id
    ON CONFLICT (user_id, year_month) DO NOTHING
    RETURNING user_id
  ),
  friends AS (
    SELECT c.user_id,
           CASE WHEN f.user_id = c.user_id THEN f.friend_id ELSE f.user_id END AS friend_id
      FROM claimed c
      JOIN public.friendships f
        ON f.status = 'accepted'
       AND (f.user_id = c.user_id OR f.friend_id = c.user_id)
  ),
  ranked AS (
    SELECT c.user_id,
           count(DISTINCT fr.friend_id) FILTER (WHERE fr.friend_id <> c.user_id)::integer AS friend_count,
           1 + count(DISTINCT fr.friend_id) FILTER (
                 WHERE fr.friend_id <> c.user_id
                   AND coalesce(fs.total_score, 0) > coalesce(ms.total_score, 0)
               )::integer AS rank
      FROM claimed c
      LEFT JOIN public.user_stats ms ON ms.user_id = c.user_id
      LEFT JOIN friends fr ON fr.user_id = c.user_id
      LEFT JOIN public.user_stats fs ON fs.user_id = fr.friend_id
     GROUP BY c.user_id, ms.total_score
  )
  INSERT INTO public.notification_outbox (target_user_id, kind, payload)
  SELECT r.user_id,
         'monthly_digest',
         jsonb_build_object(
           'year_month', p_year_month,
           'friend_count', r.friend_count,
           'rank', CASE WHEN r.friend_count > 0 THEN r.rank END,
           'total_in_board', r.friend_count + 1
         )
    FROM ranked r;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- Server-only: Edge Functions call these with the service_role key.
REVOKE ALL ON FUNCTION public.claim_notification_batch(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_notification_batch(bigint[], bigint[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_monthly_digest(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_batch(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_notification_batch(bigint[], bigint[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_monthly_digest(text) TO service_role;

COMMIT;
