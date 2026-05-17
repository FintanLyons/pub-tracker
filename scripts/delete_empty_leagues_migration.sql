-- ============================================================================
-- Delete leagues with zero members (run in Supabase SQL Editor)
--
-- When the last league_members row is removed, the parent leagues row is
-- deleted automatically. Uses SECURITY DEFINER so any member can leave even
-- when they are not the league creator (RLS only allows creators to DELETE
-- leagues directly).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tr_delete_league_if_empty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.league_members
    WHERE league_id = OLD.league_id
  ) THEN
    DELETE FROM public.leagues
    WHERE id = OLD.league_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_delete_league_if_empty ON public.league_members;
CREATE TRIGGER tr_delete_league_if_empty
  AFTER DELETE ON public.league_members
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_delete_league_if_empty();

-- Remove existing orphan leagues (no members)
DELETE FROM public.leagues AS l
WHERE NOT EXISTS (
  SELECT 1
  FROM public.league_members AS lm
  WHERE lm.league_id = l.id
);
