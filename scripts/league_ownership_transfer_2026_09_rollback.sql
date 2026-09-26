-- ROLLBACK for scripts/league_ownership_transfer_2026_09.sql
-- Removes the hand-over trigger. The one-off owner fix for "Premier" is not undone
-- (its previous owner is no longer a member, so there is nothing sensible to restore).

BEGIN;
DROP TRIGGER IF EXISTS tr_transfer_league_ownership ON public.league_members;
DROP FUNCTION IF EXISTS public.tr_transfer_league_ownership();
COMMIT;
