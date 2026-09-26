-- =============================================================================
-- Social security, PHASE B — audit Batch 4 (written 2026-09-26)
-- =============================================================================
-- ⚠️  DO NOT RUN until most users are on an app build that contains commit
--     "Join leagues by code on the server" (uses join_league_by_code()).
--     Older builds read the leagues table directly to look up a code; after this
--     runs, "Join league" fails on those builds (everything else keeps working).
--     Phase A (scripts/social_security_phase_a_2026_09.sql) must already be applied.
--
-- Rollback: scripts/social_security_phase_b_2026_09_rollback.sql
--
-- EFFECT
--  • leagues: visible only to their creator and members (codes no longer listable).
--  • league_members: visible only to members of the same league.
--  • league_members insert: no more self-join by league id — joining goes through
--    join_league_by_code(); the creator may add themselves and accepted friends.
-- =============================================================================

BEGIN;

-- Membership test used by the policies below. SECURITY DEFINER avoids RLS recursion
-- on league_members; it only answers "is the caller in this league?".
CREATE OR REPLACE FUNCTION public.is_league_member(p_league_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.league_members
     WHERE league_id = p_league_id AND user_id = auth.uid()
  );
$function$;

REVOKE ALL ON FUNCTION public.is_league_member(uuid) FROM PUBLIC, anon, authenticated;
-- Policies run as the caller, so the caller needs EXECUTE.
GRANT EXECUTE ON FUNCTION public.is_league_member(uuid) TO authenticated;

-- leagues: creator or member
DROP POLICY IF EXISTS leagues_select_all ON public.leagues;
CREATE POLICY leagues_select_member ON public.leagues
  FOR SELECT TO authenticated
  USING (created_by = (SELECT auth.uid()) OR public.is_league_member(id));

-- league_members: fellow members only
DROP POLICY IF EXISTS league_members_select_all ON public.league_members;
CREATE POLICY league_members_select_member ON public.league_members
  FOR SELECT TO authenticated
  USING (public.is_league_member(league_id));

-- league_members insert: creator adds self or accepted friends; everyone else joins by code
DROP POLICY IF EXISTS league_members_insert ON public.league_members;
CREATE POLICY league_members_insert ON public.league_members
  FOR INSERT TO authenticated
  WITH CHECK (
    league_id IN (SELECT l.id FROM public.leagues l WHERE l.created_by = (SELECT auth.uid()))
    AND (
      user_id = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.friendships f
         WHERE f.status = 'accepted'
           AND (
             (f.user_id = (SELECT auth.uid()) AND f.friend_id = league_members.user_id)
             OR (f.friend_id = (SELECT auth.uid()) AND f.user_id = league_members.user_id)
           )
      )
    )
  );

REVOKE ALL ON public.leagues, public.league_members FROM anon;

COMMIT;
