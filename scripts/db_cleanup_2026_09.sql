-- =============================================================================
-- Database tidy-up — audit Batch 8a (2026-09-27)
-- =============================================================================
-- Run once in the Supabase SQL editor (paste the WHOLE file, nothing highlighted).
-- Rollback: scripts/db_cleanup_2026_09_rollback.sql
--
-- Nothing the app uses changes behaviour. No rows are deleted.
--
--  1. Legacy tables pubs, pubs_all, pub_spatial_assignments (unused since the
--     Pubs_List migration) move to a new `archive` schema. The API only exposes
--     `public`, so they disappear from the app's reach; the data is kept and one
--     ALTER TABLE ... SET SCHEMA public brings each back.
--  2. Unused legacy functions dropped: pubs_in_bounds, uk_postcode_from_address,
--     approve_report, reject_report (bodies are in the rollback file).
--  3. Duplicate indexes dropped: idx_users_email (= users_email_key),
--     idx_users_username (= users_username_key), idx_user_stats_user_id_unique
--     (= user_stats_pkey).
--  4. Indexes added for 6 foreign keys, so deleting a pub or user doesn't scan
--     whole tables.
--  5. pub_drinks / pub_reviews policies: auth.uid() → (select auth.uid()), which
--     Postgres evaluates once per query instead of once per row (same rules).
--  6. delete_my_account():
--     • clears reporter_username on the user's reports (reporter_id is already set
--       to NULL when the auth user is deleted)
--     • CHANGE: an owner deleting their account no longer deletes their leagues
--       and everyone's membership; ownership passes to the longest-standing member,
--       as when an owner leaves (Batch 6c). Leagues left empty are still deleted.
-- =============================================================================

BEGIN;

-- 1. Archive legacy tables ------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS archive;
REVOKE ALL ON SCHEMA archive FROM PUBLIC, anon, authenticated;

ALTER TABLE public.pub_spatial_assignments SET SCHEMA archive;
ALTER TABLE public.pubs_all SET SCHEMA archive;
ALTER TABLE public.pubs SET SCHEMA archive;

REVOKE ALL ON ALL TABLES IN SCHEMA archive FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA archive FROM PUBLIC, anon, authenticated;

-- 2. Unused legacy functions -----------------------------------------------------
DROP FUNCTION IF EXISTS public.pubs_in_bounds(numeric, numeric, numeric, numeric);
DROP FUNCTION IF EXISTS public.uk_postcode_from_address(text);
DROP FUNCTION IF EXISTS public.approve_report(uuid);
DROP FUNCTION IF EXISTS public.reject_report(uuid);

-- 3. Duplicate indexes -------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_users_email;
DROP INDEX IF EXISTS public.idx_users_username;
DROP INDEX IF EXISTS public.idx_user_stats_user_id_unique;

-- 4. Foreign-key indexes -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_favorite_pubs_pub_id ON public.favorite_pubs USING btree (pub_id);
CREATE INDEX IF NOT EXISTS idx_pub_drinks_pub_id ON public.pub_drinks USING btree (pub_id);
CREATE INDEX IF NOT EXISTS idx_pub_reviews_pub_id ON public.pub_reviews USING btree (pub_id);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_target_user_id ON public.notification_outbox USING btree (target_user_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON public.reports USING btree (reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_reviewed_by ON public.reports USING btree (reviewed_by);

-- 5. RLS: evaluate auth.uid() once per query ------------------------------------
ALTER POLICY pub_drinks_select_own ON public.pub_drinks USING ((SELECT auth.uid()) = user_id);
ALTER POLICY pub_drinks_insert_own ON public.pub_drinks WITH CHECK ((SELECT auth.uid()) = user_id);
ALTER POLICY pub_drinks_update_own ON public.pub_drinks
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
ALTER POLICY pub_drinks_delete_own ON public.pub_drinks USING ((SELECT auth.uid()) = user_id);
ALTER POLICY pub_reviews_insert_own ON public.pub_reviews WITH CHECK ((SELECT auth.uid()) = user_id);
ALTER POLICY pub_reviews_update_own ON public.pub_reviews
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
ALTER POLICY pub_reviews_delete_own ON public.pub_reviews USING ((SELECT auth.uid()) = user_id);

-- 6. Account deletion also removes the username copy on reports ---------------------
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

  -- Leaving each league runs the league triggers: ownership passes to the
  -- longest-standing member, and a league left empty is deleted.
  DELETE FROM public.league_members WHERE user_id = uid;

  -- Leagues still owned by this user (owner had no membership row): hand over the
  -- same way, otherwise delete (leagues.created_by would cascade anyway).
  UPDATE public.leagues l
     SET created_by = (
       SELECT m.user_id FROM public.league_members m
        WHERE m.league_id = l.id
        ORDER BY m.joined_at NULLS LAST, m.user_id
        LIMIT 1
     )
   WHERE l.created_by = uid
     AND EXISTS (SELECT 1 FROM public.league_members m WHERE m.league_id = l.id);
  DELETE FROM public.leagues WHERE created_by = uid;

  DELETE FROM public.user_stats WHERE user_id = uid;

  -- Reports stay (pub data) but no longer name the reporter.
  UPDATE public.reports SET reporter_username = NULL WHERE reporter_id = uid;

  DELETE FROM public.users WHERE id = uid;

  DELETE FROM auth.users WHERE id = uid;
END;
$function$;

-- CREATE OR REPLACE keeps existing grants; restate them to be explicit.
REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

COMMIT;
