-- ============================================================================
-- FIX RLS POLICIES
-- ============================================================================
-- Run this in the Supabase Dashboard -> SQL Editor -> New query
--
-- Fixes:
--   1. users_select_all: restrict to authenticated (prevents anon enumeration)
--   2. league_members_insert: allow users to add themselves (self-enrollment
--      via league code) in addition to league creators adding others
-- ============================================================================

-- ============================================================================
-- FIX 1: Restrict users table SELECT to authenticated users only
-- ============================================================================

DROP POLICY IF EXISTS "users_select_all" ON public.users;

CREATE POLICY "users_select_authenticated"
  ON public.users FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================================
-- FIX 2: Allow self-enrollment in leagues
-- ============================================================================
-- Old policy only allowed league creators to add members.
-- New policy also allows a user to insert a row where user_id = their own id
-- (i.e. joining a league via its code).
-- ============================================================================

DROP POLICY IF EXISTS "league_members_insert" ON public.league_members;

CREATE POLICY "league_members_insert"
  ON public.league_members FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    OR
    league_id IN (
      SELECT id FROM leagues WHERE created_by = (select auth.uid())
    )
  );

-- ============================================================================
-- FIX 3: Username login not used — do not add get_email_by_username.
-- If it exists from an older run, remove via security_high_severity_fixes.sql.
-- ============================================================================

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT tablename, policyname, cmd AS operation, roles AS for_roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('users', 'league_members')
ORDER BY tablename, cmd, policyname;
