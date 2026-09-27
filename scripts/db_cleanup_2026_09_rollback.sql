-- ROLLBACK for scripts/db_cleanup_2026_09.sql
-- Restores everything exactly as before (legacy tables back in public, functions,
-- duplicate indexes, old policies, old delete_my_account).

BEGIN;

ALTER TABLE archive.pubs SET SCHEMA public;
ALTER TABLE archive.pubs_all SET SCHEMA public;
ALTER TABLE archive.pub_spatial_assignments SET SCHEMA public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pubs, public.pubs_all, public.pub_spatial_assignments TO anon, authenticated;
DROP SCHEMA IF EXISTS archive;

CREATE OR REPLACE FUNCTION public.pubs_in_bounds(north_lat numeric, south_lat numeric, east_lon numeric, west_lon numeric)
 RETURNS TABLE(id uuid, name text, lat numeric, lon numeric, address text, phone text, description text, founded text, history text, area text, ownership text, photo_url text, points integer, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT p.*
  FROM pubs p
  WHERE p.lat BETWEEN south_lat AND north_lat
    AND p.lon BETWEEN west_lon AND east_lon;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.uk_postcode_from_address(p_address text)
 RETURNS TABLE(district text, area text)
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH s AS (
    SELECT CASE
      WHEN p_address IS NULL OR length(trim(p_address)) = 0 THEN NULL::text
      ELSE upper(regexp_replace(p_address, E'[\\n\\r\\t]+', ' ', 'g'))
    END AS txt
  ),
  lastm AS (
    SELECT (rm.arr)[1] AS pc
    FROM s
    CROSS JOIN LATERAL regexp_matches(
      s.txt,
      '([A-Z]{1,2}[0-9]{1,2}[A-Z]?\\s?[0-9][A-Z]{2})',
      'gi'
    ) WITH ORDINALITY AS rm(arr, ord)
    ORDER BY rm.ord DESC
    LIMIT 1
  ),
  compact AS (
    SELECT regexp_replace(lastm.pc, '\\s+', '', 'g') AS c
    FROM lastm
    WHERE lastm.pc IS NOT NULL
  ),
  split AS (
    SELECT
      left(c, length(c) - 3) AS outward,
      right(c, 3) AS inward3
    FROM compact
    WHERE length(c) >= 5
      AND right(c, 3) ~ '^[0-9][A-Z]{2}$'
  )
  SELECT
    split.outward AS district,
    (regexp_match(split.outward, '^([A-Z]+)'))[1] AS area
  FROM split;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_report(p_report_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.reports
     SET status = 'approved'::public.report_status,
         reviewed_at = COALESCE(reviewed_at, now())
   WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found: %', p_report_id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_report(p_report_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.reports
     SET status = 'rejected'::public.report_status,
         reviewed_at = COALESCE(reviewed_at, now())
   WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found: %', p_report_id;
  END IF;
END;
$function$
;

REVOKE ALL ON FUNCTION public.pubs_in_bounds(numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.uk_postcode_from_address(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_report(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_report(uuid) FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users USING btree (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users USING btree (username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_stats_user_id_unique ON public.user_stats USING btree (user_id);

DROP INDEX IF EXISTS public.idx_favorite_pubs_pub_id;
DROP INDEX IF EXISTS public.idx_pub_drinks_pub_id;
DROP INDEX IF EXISTS public.idx_pub_reviews_pub_id;
DROP INDEX IF EXISTS public.idx_notification_outbox_target_user_id;
DROP INDEX IF EXISTS public.idx_reports_reporter_id;
DROP INDEX IF EXISTS public.idx_reports_reviewed_by;

ALTER POLICY pub_drinks_select_own ON public.pub_drinks USING (auth.uid() = user_id);
ALTER POLICY pub_drinks_insert_own ON public.pub_drinks WITH CHECK (auth.uid() = user_id);
ALTER POLICY pub_drinks_update_own ON public.pub_drinks USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
ALTER POLICY pub_drinks_delete_own ON public.pub_drinks USING (auth.uid() = user_id);
ALTER POLICY pub_reviews_insert_own ON public.pub_reviews WITH CHECK (auth.uid() = user_id);
ALTER POLICY pub_reviews_update_own ON public.pub_reviews USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
ALTER POLICY pub_reviews_delete_own ON public.pub_reviews USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.delete_my_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  DELETE FROM public.pub_reviews WHERE user_id = uid;
  DELETE FROM public.pub_drinks WHERE user_id = uid;
  DELETE FROM public.visited_pubs WHERE user_id = uid;
  DELETE FROM public.favorite_pubs WHERE user_id = uid;
  DELETE FROM public.friendships WHERE user_id = uid OR friend_id = uid;

  DELETE FROM public.league_members
  WHERE league_id IN (SELECT id FROM public.leagues WHERE created_by = uid);

  DELETE FROM public.leagues WHERE created_by = uid;

  DELETE FROM public.league_members WHERE user_id = uid;

  DELETE FROM public.user_stats WHERE user_id = uid;

  DELETE FROM public.users WHERE id = uid;

  DELETE FROM auth.users WHERE id = uid;
END;
$function$;

COMMIT;
