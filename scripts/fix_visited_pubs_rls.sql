-- ============================================================================
-- FIX: Restrict visited_pubs SELECT to owner + accepted friends only
-- ============================================================================
-- Problem: The existing "visited_pubs_select_authenticated" policy allows
-- ANY authenticated user to read ANY other user's complete visit history.
--
-- Fix: Replace with a policy that only allows:
--   1. Reading your own rows
--   2. Reading a friend's rows (where an accepted friendship exists)
--
-- Note: All SECURITY DEFINER RPCs (get_borough_stats, get_achievements, etc.)
-- bypass RLS entirely and are unaffected by this change.
-- PubService.fetchServerIdSet already filters by user_id = userId — still fine.
-- ============================================================================

DROP POLICY IF EXISTS "visited_pubs_select_authenticated" ON public.visited_pubs;

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

-- Verify policies on visited_pubs
SELECT policyname, cmd AS operation, qual AS using_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'visited_pubs'
ORDER BY cmd, policyname;
