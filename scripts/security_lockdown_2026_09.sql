-- =============================================================================
-- Security lockdown — audit Batch 1 (2026-09-25)
-- =============================================================================
-- Run once in the Supabase SQL editor. Wrapped in a transaction: if any
-- statement fails, nothing is applied.
--
-- WHY: earlier migrations used `REVOKE ... FROM PUBLIC`, which is a no-op on
-- Supabase — the project's default ACLs grant EXECUTE on every new function
-- (and full table privileges) directly to `anon` and `authenticated`. As a
-- result every SECURITY DEFINER function was callable with the public anon key.
--
-- Fixes:
--   1. Report admin functions (approve/reject/apply) callable by anyone.
--   2. http_get_text / net_http_get_text / geocode_uk_address = open HTTP proxy.
--   3. Users could UPDATE their own user_stats.total_score.
--   4. Users could INSERT reports already marked approved (self-awarded points)
--      or with someone else's reporter_id.
--   5. Stats RPCs callable without logging in; compute_user_stats callable by
--      anon for any user.
--   6. 10 functions without a fixed search_path.
--
-- AFTER THIS: new functions are NOT callable by app users by default. Every
-- future function the app calls via supabase.rpc() needs an explicit
--   GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO authenticated;
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Functions: remove client access to everything, then re-grant only the
--    RPCs the app calls. (The app requires login for every screen, so `anon`
--    needs none.) Trigger functions do not need EXECUTE grants to fire.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- RPCs called from the app (services/*.js, contexts/UserStatsContext.js)
GRANT EXECUTE ON FUNCTION public.get_area_stats(uuid)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_borough_stats(uuid)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_achievements(uuid)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_pubs(text, integer)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_account()                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_pub_summon_notifications(text, uuid[], text) TO authenticated;

-- Stop future functions from being auto-granted to client roles.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 2. Tables: TRUNCATE ignores RLS. PostgREST cannot issue it, but clients have
--    no reason to hold it (nor REFERENCES / TRIGGER).
-- -----------------------------------------------------------------------------
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. user_stats is server-maintained (compute_user_stats via triggers;
--    seed_user_stats_on_create on users INSERT). Clients only read it.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS user_stats_insert_own ON public.user_stats;
DROP POLICY IF EXISTS user_stats_update_own ON public.user_stats;
DROP POLICY IF EXISTS user_stats_delete_own ON public.user_stats;
REVOKE INSERT, UPDATE, DELETE ON public.user_stats FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. reports: users may only file their own, pending, unreviewed reports.
--    Review/approval happens server-side (dashboard or service_role).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS reports_insert ON public.reports;
CREATE POLICY reports_insert_own_pending ON public.reports
  FOR INSERT TO authenticated
  WITH CHECK (
        reporter_id = (SELECT auth.uid())
    AND status = 'pending'::public.report_status
    AND reviewed_at IS NULL
    AND reviewed_by IS NULL
    AND applied_at  IS NULL
    AND apply_error IS NULL
  );
REVOKE UPDATE, DELETE ON public.reports FROM anon, authenticated;
REVOKE ALL ON public.reports FROM anon;

-- -----------------------------------------------------------------------------
-- 5. Pin search_path on functions that lacked one (two are SECURITY DEFINER).
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.recompute_user_stats()                     SET search_path = public, pg_temp;
ALTER FUNCTION public.seed_user_stats_on_create()                SET search_path = public, pg_temp;
ALTER FUNCTION public.notification_jwt_user_id()                 SET search_path = public, pg_temp;
ALTER FUNCTION public.normalize_uk_phone(text)                   SET search_path = public, pg_temp;
ALTER FUNCTION public.format_uk_phone_national(text)             SET search_path = public, pg_temp;
ALTER FUNCTION public.pub_phone_digits(text)                     SET search_path = public, pg_temp;
ALTER FUNCTION public.uri_component(text)                        SET search_path = public, pg_temp;
ALTER FUNCTION public.uk_postcode_from_address(text)             SET search_path = public, pg_temp;
ALTER FUNCTION public.report_feature_bool(jsonb, text)           SET search_path = public, pg_temp;
ALTER FUNCTION public.postcode_district_completion_bonus(integer) SET search_path = public, pg_temp;

COMMIT;

-- =============================================================================
-- Verification (optional — Claude re-checks via MCP after you run this)
-- =============================================================================
-- SELECT p.proname,
--        has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
--   FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1;
-- Expected: anon = false everywhere; auth = true only for the six RPCs above.
