-- =============================================================================
-- ROLLBACK for scripts/security_lockdown_2026_09.sql
-- =============================================================================
-- Restores the grants and policies exactly as they were on 2026-09-25 (captured
-- from the live DB before the lockdown). Only run this if the lockdown breaks
-- something — it re-opens every security hole the lockdown closed.
-- =============================================================================

BEGIN;

-- 1. Functions: re-grant to client roles, restore auto-grant default.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;

-- 2. Table privileges
GRANT TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- 3. user_stats: previous client write access + policies
GRANT INSERT, UPDATE, DELETE ON public.user_stats TO anon, authenticated;
CREATE POLICY user_stats_insert_own ON public.user_stats
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY user_stats_update_own ON public.user_stats
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY user_stats_delete_own ON public.user_stats
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- 4. reports: previous permissive insert policy + privileges
DROP POLICY IF EXISTS reports_insert_own_pending ON public.reports;
CREATE POLICY reports_insert ON public.reports
  FOR INSERT TO authenticated WITH CHECK (true);
GRANT ALL ON public.reports TO anon, authenticated;

-- 5. search_path back to unset
ALTER FUNCTION public.recompute_user_stats()                      RESET search_path;
ALTER FUNCTION public.seed_user_stats_on_create()                 RESET search_path;
ALTER FUNCTION public.notification_jwt_user_id()                  RESET search_path;
ALTER FUNCTION public.normalize_uk_phone(text)                    RESET search_path;
ALTER FUNCTION public.format_uk_phone_national(text)              RESET search_path;
ALTER FUNCTION public.pub_phone_digits(text)                      RESET search_path;
ALTER FUNCTION public.uri_component(text)                         RESET search_path;
ALTER FUNCTION public.uk_postcode_from_address(text)              RESET search_path;
ALTER FUNCTION public.report_feature_bool(jsonb, text)            RESET search_path;
ALTER FUNCTION public.postcode_district_completion_bonus(integer) RESET search_path;

COMMIT;
