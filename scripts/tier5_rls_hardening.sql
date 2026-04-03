-- ============================================================================
-- TIER 5: RLS hardening (run in Supabase SQL Editor on your project)
-- ============================================================================
-- Fixes four security issues found in the schema audit:
--
-- 1. pub_spatial_assignments — RLS was never enabled; table fully open
-- 2. Seven tables (users, user_stats, friendships, leagues, league_members,
--    reports, pub_spatial_assignments) — policies exist in scripts but
--    ENABLE ROW LEVEL SECURITY was never called; policies silently ignored
-- 3. pub_drinks + pub_reviews — FOR ALL policies with no TO clause; should
--    explicitly target `authenticated` with a WITH CHECK guard
-- 4. visited_pubs SELECT — original permissive policy (any authenticated user
--    sees all visits) may still be active; ensure friend-only policy is in place
--
-- All statements are idempotent (safe to run multiple times).
-- No app rebuild required — SQL only.
-- ============================================================================


-- ============================================================================
-- SECTION 1: pub_spatial_assignments
-- ============================================================================
-- Static reference data mapping pubs to postcode districts/areas.
-- Behaviour wanted: anyone (including anon) can read; only service_role writes.
-- ============================================================================

ALTER TABLE public.pub_spatial_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pub_spatial_assignments_select_public" ON public.pub_spatial_assignments;
CREATE POLICY "pub_spatial_assignments_select_public"
  ON public.pub_spatial_assignments FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "pub_spatial_assignments_insert_service" ON public.pub_spatial_assignments;
CREATE POLICY "pub_spatial_assignments_insert_service"
  ON public.pub_spatial_assignments FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "pub_spatial_assignments_update_service" ON public.pub_spatial_assignments;
CREATE POLICY "pub_spatial_assignments_update_service"
  ON public.pub_spatial_assignments FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "pub_spatial_assignments_delete_service" ON public.pub_spatial_assignments;
CREATE POLICY "pub_spatial_assignments_delete_service"
  ON public.pub_spatial_assignments FOR DELETE
  TO service_role
  USING (true);


-- ============================================================================
-- SECTION 2: Ensure RLS is enabled on all tables that have policies
-- ============================================================================
-- MASTER_RLS_FIX.sql and other scripts created policies for these tables but
-- never called ENABLE ROW LEVEL SECURITY. Without it, policies are ignored
-- and tables are fully open to any request with the anon key.
--
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY is idempotent — safe if already on.
-- ============================================================================

ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_stats       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leagues          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports          ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- SECTION 3: Fix pub_drinks and pub_reviews policies
-- ============================================================================
-- Original policies used FOR ALL with no TO clause, which defaults to the
-- PUBLIC role (includes anon). auth.uid() = NULL for anon users, so the
-- USING check accidentally blocks anon writes — but only by luck, and
-- INSERT has no USING clause so the WITH CHECK gap is real.
--
-- Fix: explicit TO authenticated on every policy + WITH CHECK on write paths.
-- ============================================================================

-- pub_drinks
DROP POLICY IF EXISTS "Users manage own drinks" ON public.pub_drinks;

CREATE POLICY "pub_drinks_select_own"
  ON public.pub_drinks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "pub_drinks_insert_own"
  ON public.pub_drinks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pub_drinks_update_own"
  ON public.pub_drinks FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pub_drinks_delete_own"
  ON public.pub_drinks FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- pub_reviews
DROP POLICY IF EXISTS "Authors manage own review" ON public.pub_reviews;

CREATE POLICY "pub_reviews_insert_own"
  ON public.pub_reviews FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pub_reviews_update_own"
  ON public.pub_reviews FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pub_reviews_delete_own"
  ON public.pub_reviews FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Keep the public read policy as-is (intentional design: all reviews are readable)
-- "Reviews readable by all" on pub_reviews FOR SELECT USING (true) — no change needed


-- ============================================================================
-- SECTION 4: visited_pubs SELECT — enforce friend-only policy
-- ============================================================================
-- create_visited_favorite_tables.sql created a permissive policy that lets
-- any authenticated user read any other user's complete visit history.
-- fix_visited_pubs_rls.sql fixed this, but only if it was run after.
-- This section ensures the correct restrictive policy is in place.
-- ============================================================================

-- Drop the permissive policy if it still exists from the original script
DROP POLICY IF EXISTS "visited_pubs_select_authenticated" ON public.visited_pubs;

-- Recreate the friend-only policy (idempotent via DROP IF EXISTS + CREATE)
DROP POLICY IF EXISTS "visited_pubs_select_own_or_friend" ON public.visited_pubs;

CREATE POLICY "visited_pubs_select_own_or_friend"
  ON public.visited_pubs FOR SELECT
  TO authenticated
  USING (
    -- Own rows
    user_id = (SELECT auth.uid())
    OR
    -- Accepted friend's rows
    EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.user_id = (SELECT auth.uid()) AND f.friend_id = visited_pubs.user_id)
          OR
          (f.friend_id = (SELECT auth.uid()) AND f.user_id = visited_pubs.user_id)
        )
    )
  );


-- ============================================================================
-- SECTION 5: Verification
-- ============================================================================
-- Run this after applying the script to confirm everything is in place.
-- Expected: rls_enabled = true for every row; policies listed for each table.
-- ============================================================================

SELECT
  t.tablename,
  c.relrowsecurity AS rls_enabled,
  COUNT(p.policyname) AS policy_count
FROM pg_tables t
JOIN pg_class c
  ON c.relname = t.tablename
  AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = t.schemaname)
LEFT JOIN pg_policies p
  ON p.schemaname = t.schemaname AND p.tablename = t.tablename
WHERE t.schemaname = 'public'
  AND t.tablename IN (
    'pub_spatial_assignments',
    'users',
    'user_stats',
    'friendships',
    'leagues',
    'league_members',
    'reports',
    'pub_drinks',
    'pub_reviews',
    'visited_pubs',
    'favorite_pubs',
    'pubs_all'
  )
GROUP BY t.tablename, c.relrowsecurity
ORDER BY t.tablename;
