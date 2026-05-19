-- ============================================================================
-- Tighten social / sensitive RLS (Supabase SQL Editor)
-- ============================================================================
--
-- Addresses audit findings:
--   • favorite_pubs SELECT was open to all authenticated users
--   • friendships SELECT exposed every friendship row
--   • reports SELECT exposed all submitted reports
--   • public.users.email readable by any logged-in client
--   • get_area_stats / get_borough_stats may lack auth.uid() guard (pub_list path)
--
-- Idempotent — safe to run more than once.
--
-- PREREQUISITES (run first if never applied):
--   scripts/tier5_rls_hardening.sql  — enables RLS on core tables
--   scripts/fix_rls_policies.sql     — users SELECT authenticated-only (no username login)
--   scripts/security_high_severity_fixes.sql — drop get_email_by_username; stats RPC auth guards
--
-- PRODUCTION DATA SOURCE:
--   Sections 7–8 assume pub geography comes from public."Pubs_List"
--   (scripts/pub_list_migration.sql). If you still use pubs_all + pub_spatial_assignments,
--   skip section 7–8 and run tier2_security_hardening.sql sections 2–3 instead.
--
-- DOES NOT CHANGE (by design):
--   • Pub list / map reads (Pubs_List or pubs_all policies unchanged)
--   • user_stats SELECT for friend & league leaderboards
--   • leagues + league_members (join-by-code)
--   • pub_reviews public read
--   • SECURITY DEFINER RPCs still bypass table RLS for their internal reads
--
-- APP COMPATIBILITY:
--   Requires app build with explicit public.users column lists (not select('*')).
--   SecureAuthService exports PUBLIC_USER_PROFILE_COLUMNS; email comes from auth.users.
--   The mobile app also:
--   • filters visited/favorite rows by user_id in PubService
--   • filters friendships by user_id / friend_id in FriendsService
--   • only INSERTs reports (never SELECT)
--   • selects id, username, avatar_url for social UI (not email)
--   • uses session.user.email from Auth, not public.users.email, after login
--
-- AFTER RUNNING — smoke test in the app:
--   1. Sign in, toggle visit + favourite on a pub
--   2. Friends tab: list friends, send/accept request, leaderboard
--   3. Leagues: join by code, view league leaderboard
--   4. Profile: area / region stats and trophies modal
--   5. Submit a pub report (missing / correction)
--   6. Add Friend: username search still returns results
-- ============================================================================


-- ============================================================================
-- 1. Ensure RLS is enabled (no-op if already on)
-- ============================================================================

ALTER TABLE public.visited_pubs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorite_pubs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users          ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 2. visited_pubs — own rows + accepted friends only
-- ============================================================================

DROP POLICY IF EXISTS "visited_pubs_select_authenticated" ON public.visited_pubs;
DROP POLICY IF EXISTS "visited_pubs_select_own_or_friend" ON public.visited_pubs;

CREATE POLICY "visited_pubs_select_own_or_friend"
  ON public.visited_pubs FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.user_id = (SELECT auth.uid()) AND f.friend_id = visited_pubs.user_id)
          OR (f.friend_id = (SELECT auth.uid()) AND f.user_id = visited_pubs.user_id)
        )
    )
  );


-- ============================================================================
-- 3. favorite_pubs — same rule as visited_pubs (enables friends' favourites later)
-- ============================================================================

DROP POLICY IF EXISTS "favorite_pubs_select_authenticated" ON public.favorite_pubs;
DROP POLICY IF EXISTS "favorite_pubs_select_own_or_friend" ON public.favorite_pubs;

CREATE POLICY "favorite_pubs_select_own_or_friend"
  ON public.favorite_pubs FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.user_id = (SELECT auth.uid()) AND f.friend_id = favorite_pubs.user_id)
          OR (f.friend_id = (SELECT auth.uid()) AND f.user_id = favorite_pubs.user_id)
        )
    )
  );


-- ============================================================================
-- 4. friendships — only rows you participate in
-- ============================================================================

DROP POLICY IF EXISTS "friendships_select_all" ON public.friendships;
DROP POLICY IF EXISTS "friendships_select_own" ON public.friendships;

CREATE POLICY "friendships_select_own"
  ON public.friendships FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR friend_id = (SELECT auth.uid())
  );


-- ============================================================================
-- 5. reports — no global read via API (insert-only from app)
-- ============================================================================
-- Moderation / admin: use Supabase Dashboard or service_role, not the anon key.

DROP POLICY IF EXISTS "reports_select" ON public.reports;

DROP POLICY IF EXISTS "reports_select_own" ON public.reports;
CREATE POLICY "reports_select_own"
  ON public.reports FOR SELECT
  TO authenticated
  USING (reporter_id = (SELECT auth.uid()));


-- ============================================================================
-- 6. users — hide email from authenticated / anon API roles
-- ============================================================================
-- Username search, friend profiles, league leaderboards, and review embeds only
-- need id, username, avatar_url. Email remains in the row for triggers/backfill;
-- clients cannot SELECT it. Login email comes from auth.users / signInWithPassword.
--
-- Username login is not used. Run security_high_severity_fixes.sql to drop get_email_by_username.
--
-- Supabase defaults grant ALL on public tables to anon/authenticated. A column-only
-- REVOKE is often ignored while table-level SELECT remains. Fix: revoke table grants,
-- then grant explicit column lists (email only on INSERT for profile stub).

REVOKE ALL ON TABLE public.users FROM anon;
REVOKE ALL ON TABLE public.users FROM authenticated;

GRANT SELECT (id, username, avatar_url, created_at, updated_at)
  ON TABLE public.users TO authenticated;
GRANT INSERT (id, email, username, avatar_url, created_at, updated_at)
  ON TABLE public.users TO authenticated;
GRANT UPDATE (username, avatar_url, updated_at)
  ON TABLE public.users TO authenticated;

-- Keep broad row read for authenticated users (search + leaderboards).
-- fix_rls_policies.sql should already have replaced users_select_all; reinforce:

DROP POLICY IF EXISTS "users_select_all" ON public.users;

DROP POLICY IF EXISTS "users_select_authenticated" ON public.users;
CREATE POLICY "users_select_authenticated"
  ON public.users FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================================
-- 7. get_area_stats — Pubs_List + auth.uid() guard
-- (Also in security_high_severity_fixes.sql for incremental apply.)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_area_stats(p_user_id UUID)
RETURNS TABLE (
  district      TEXT,
  postcode_area TEXT,
  total         BIGINT,
  visited       BIGINT,
  percentage    INT,
  center_lat    DOUBLE PRECISION,
  center_lon    DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH visited_ids AS (
    SELECT pub_id FROM public.visited_pubs WHERE user_id = p_user_id
  ),
  effective_pubs AS (
    SELECT
      pl.id,
      pl.lat,
      pl.lon,
      COALESCE(NULLIF(TRIM(pl.postcode_district), ''), 'Unknown') AS effective_district,
      COALESCE(NULLIF(TRIM(pl.postcode_area), ''), 'Unknown') AS effective_area
    FROM public."Pubs_List" pl
  )
  SELECT
    ep.effective_district AS district,
    MAX(ep.effective_area) AS postcode_area,
    COUNT(*)::BIGINT AS total,
    COUNT(v.pub_id)::BIGINT AS visited,
    CASE WHEN COUNT(*) > 0
      THEN ROUND((COUNT(v.pub_id)::NUMERIC / COUNT(*)) * 100)::INT
      ELSE 0
    END AS percentage,
    AVG(ep.lat::DOUBLE PRECISION) AS center_lat,
    AVG(ep.lon::DOUBLE PRECISION) AS center_lon
  FROM effective_pubs ep
  LEFT JOIN visited_ids v ON v.pub_id = ep.id
  GROUP BY ep.effective_district
  ORDER BY ep.effective_district;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_area_stats(UUID) TO authenticated;


-- ============================================================================
-- 8. get_borough_stats — Pubs_List + auth.uid() guard
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_borough_stats(p_user_id UUID)
RETURNS TABLE (
  postcode_area       TEXT,
  total_pubs          BIGINT,
  visited_pubs        BIGINT,
  percentage          INT,
  total_districts     BIGINT,
  completed_districts BIGINT,
  center_lat          DOUBLE PRECISION,
  center_lon          DOUBLE PRECISION,
  min_lat             DOUBLE PRECISION,
  max_lat             DOUBLE PRECISION,
  min_lon             DOUBLE PRECISION,
  max_lon             DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH visited_ids AS (
    SELECT pub_id FROM public.visited_pubs WHERE user_id = p_user_id
  ),
  effective_pubs AS (
    SELECT
      pl.id,
      pl.lat,
      pl.lon,
      COALESCE(NULLIF(TRIM(pl.postcode_district), ''), 'Unknown') AS effective_district,
      COALESCE(NULLIF(TRIM(pl.postcode_area), ''), 'Unknown') AS effective_area
    FROM public."Pubs_List" pl
  ),
  district_completion AS (
    SELECT
      ep.effective_area AS area_name,
      ep.effective_district AS district_name,
      COUNT(*) AS district_total,
      COUNT(v.pub_id) AS district_visited
    FROM effective_pubs ep
    LEFT JOIN visited_ids v ON v.pub_id = ep.id
    WHERE ep.effective_district IS NOT NULL
      AND TRIM(ep.effective_district) <> ''
      AND ep.effective_district <> 'Unknown'
    GROUP BY 1, 2
  ),
  area_district_agg AS (
    SELECT
      area_name,
      COUNT(*)::BIGINT AS total_districts,
      COUNT(*) FILTER (
        WHERE district_visited = district_total AND district_total > 0
      )::BIGINT AS completed_districts
    FROM district_completion
    GROUP BY area_name
  )
  SELECT
    ep.effective_area AS postcode_area,
    COUNT(*)::BIGINT AS total_pubs,
    COUNT(v.pub_id)::BIGINT AS visited_pubs,
    CASE WHEN COUNT(*) > 0
      THEN ROUND((COUNT(v.pub_id)::NUMERIC / COUNT(*)) * 100)::INT
      ELSE 0
    END AS percentage,
    COALESCE(ada.total_districts, 0)::BIGINT AS total_districts,
    COALESCE(ada.completed_districts, 0)::BIGINT AS completed_districts,
    AVG(ep.lat::DOUBLE PRECISION) AS center_lat,
    AVG(ep.lon::DOUBLE PRECISION) AS center_lon,
    MIN(ep.lat::DOUBLE PRECISION) AS min_lat,
    MAX(ep.lat::DOUBLE PRECISION) AS max_lat,
    MIN(ep.lon::DOUBLE PRECISION) AS min_lon,
    MAX(ep.lon::DOUBLE PRECISION) AS max_lon
  FROM effective_pubs ep
  LEFT JOIN visited_ids v ON v.pub_id = ep.id
  LEFT JOIN area_district_agg ada ON ada.area_name = ep.effective_area
  WHERE ep.effective_area IS NOT NULL
    AND TRIM(ep.effective_area) <> ''
    AND ep.effective_area <> 'Unknown'
  GROUP BY ep.effective_area, ada.total_districts, ada.completed_districts
  ORDER BY ep.effective_area;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_borough_stats(UUID) TO authenticated;


-- ============================================================================
-- 9. get_achievements auth guard
-- ============================================================================
-- Run scripts/security_high_severity_fixes.sql §4 if not applied with this migration.


-- ============================================================================
-- 10. Verification
-- ============================================================================

SELECT tablename, policyname, cmd AS operation
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('visited_pubs', 'favorite_pubs', 'friendships', 'reports', 'users')
ORDER BY tablename, cmd, policyname;

-- Expect: NO rows for anon/authenticated with privilege_type = SELECT on email
SELECT grantee, privilege_type, column_name
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name = 'users'
  AND column_name = 'email'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;
