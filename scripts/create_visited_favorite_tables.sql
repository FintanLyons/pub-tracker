-- ============================================================================
-- CREATE VISITED_PUBS AND FAVORITE_PUBS TABLES
-- ============================================================================
-- Run this in the Supabase Dashboard → SQL Editor → New query
-- This creates server-side tracking for pub visits and favorites,
-- replacing the local-only AsyncStorage approach.
-- ============================================================================

-- ============================================================================
-- STEP 1: visited_pubs table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.visited_pubs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pub_id     UUID        NOT NULL,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(user_id, pub_id)
);

ALTER TABLE public.visited_pubs ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all visits (needed so friends can see
-- which specific pubs you've been to).
CREATE POLICY "visited_pubs_select_authenticated"
  ON public.visited_pubs FOR SELECT
  TO authenticated
  USING (true);

-- Users can only record their own visits.
CREATE POLICY "visited_pubs_insert_own"
  ON public.visited_pubs FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- Users can only remove their own visits.
CREATE POLICY "visited_pubs_delete_own"
  ON public.visited_pubs FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE INDEX IF NOT EXISTS idx_visited_pubs_user_id
  ON public.visited_pubs(user_id);

CREATE INDEX IF NOT EXISTS idx_visited_pubs_pub_id
  ON public.visited_pubs(pub_id);

-- ============================================================================
-- STEP 2: favorite_pubs table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.favorite_pubs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pub_id       UUID        NOT NULL,
  favorited_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(user_id, pub_id)
);

ALTER TABLE public.favorite_pubs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "favorite_pubs_select_authenticated"
  ON public.favorite_pubs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "favorite_pubs_insert_own"
  ON public.favorite_pubs FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "favorite_pubs_delete_own"
  ON public.favorite_pubs FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE INDEX IF NOT EXISTS idx_favorite_pubs_user_id
  ON public.favorite_pubs(user_id);

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TABLES CREATED ===';
  RAISE NOTICE '';
END $$;

SELECT tablename, policyname, cmd AS operation, roles AS for_roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('visited_pubs', 'favorite_pubs')
ORDER BY tablename, cmd, policyname;
