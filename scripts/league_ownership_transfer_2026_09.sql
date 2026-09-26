-- =============================================================================
-- League ownership hand-over — audit Batch 6c (2026-09-26)
-- =============================================================================
-- Run once in the Supabase SQL editor (paste the WHOLE file, nothing highlighted).
-- Rollback: scripts/league_ownership_transfer_2026_09_rollback.sql
--
-- WHY: when a league's creator left, leagues.created_by kept pointing at them, so
-- the league had no owner who could manage it (one league, "Premier", is already
-- in that state).
--
-- EFFECT
--  • New trigger: when the owner leaves and members remain, ownership passes to the
--    longest-standing member (earliest joined_at). When the last member leaves, the
--    existing tr_delete_league_if_empty trigger still deletes the league.
--  • One-off data fix: "Premier" gets its remaining member as owner. This is the
--    only data change; it touches leagues.created_by for leagues whose owner is no
--    longer a member.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.tr_transfer_league_ownership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_next_owner uuid;
BEGIN
  -- Only when the departing member owns the league (and the league still exists).
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues
     WHERE id = OLD.league_id AND created_by = OLD.user_id
  ) THEN
    RETURN OLD;
  END IF;

  SELECT m.user_id INTO v_next_owner
    FROM public.league_members m
   WHERE m.league_id = OLD.league_id
   ORDER BY m.joined_at NULLS LAST, m.user_id
   LIMIT 1;

  IF v_next_owner IS NOT NULL THEN
    UPDATE public.leagues
       SET created_by = v_next_owner
     WHERE id = OLD.league_id;
  END IF;

  RETURN OLD;
END;
$function$;

-- Trigger function: not callable by app users.
REVOKE ALL ON FUNCTION public.tr_transfer_league_ownership() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_transfer_league_ownership ON public.league_members;
CREATE TRIGGER tr_transfer_league_ownership
  AFTER DELETE ON public.league_members
  FOR EACH ROW EXECUTE FUNCTION public.tr_transfer_league_ownership();

-- One-off: leagues whose owner already left get their longest-standing member as owner.
UPDATE public.leagues l
   SET created_by = (
     SELECT m.user_id FROM public.league_members m
      WHERE m.league_id = l.id
      ORDER BY m.joined_at NULLS LAST, m.user_id
      LIMIT 1
   )
 WHERE NOT EXISTS (
         SELECT 1 FROM public.league_members m
          WHERE m.league_id = l.id AND m.user_id = l.created_by
       )
   AND EXISTS (SELECT 1 FROM public.league_members m WHERE m.league_id = l.id);

COMMIT;
