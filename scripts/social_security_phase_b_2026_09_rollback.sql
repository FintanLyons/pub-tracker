-- ROLLBACK for scripts/social_security_phase_b_2026_09.sql
-- Returns leagues / league_members to their Phase A state.

BEGIN;

DROP POLICY IF EXISTS leagues_select_member ON public.leagues;
CREATE POLICY leagues_select_all ON public.leagues
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS league_members_select_member ON public.league_members;
CREATE POLICY league_members_select_all ON public.league_members
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS league_members_insert ON public.league_members;
CREATE POLICY league_members_insert ON public.league_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR (
      league_id IN (SELECT l.id FROM public.leagues l WHERE l.created_by = (SELECT auth.uid()))
      AND EXISTS (
        SELECT 1 FROM public.friendships f
         WHERE f.status = 'accepted'
           AND (
             (f.user_id = (SELECT auth.uid()) AND f.friend_id = league_members.user_id)
             OR (f.friend_id = (SELECT auth.uid()) AND f.user_id = league_members.user_id)
           )
      )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leagues, public.league_members TO anon;

DROP FUNCTION IF EXISTS public.is_league_member(uuid);

COMMIT;
