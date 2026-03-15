-- ============================================================================
-- FIX: Seed user_stats row when a new user is created
-- ============================================================================
-- Problem: trg_recompute_user_stats only fires on visited_pubs changes.
-- A brand-new user has no user_stats row until their first pub visit,
-- so they are invisible in leaderboard JOINs.
--
-- Fix: trigger on public.users INSERT to insert a zeroed user_stats row.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_user_stats_on_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.user_stats (user_id, pubs_visited, total_score, level, last_synced_at)
  VALUES (NEW.id, 0, 0, 1, NOW())
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_user_stats ON public.users;

CREATE TRIGGER trg_seed_user_stats
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_user_stats_on_create();

-- Backfill: seed rows for existing users who have no stats yet
INSERT INTO public.user_stats (user_id, pubs_visited, total_score, level, last_synced_at)
SELECT id, 0, 0, 1, NOW()
FROM public.users
WHERE id NOT IN (SELECT user_id FROM public.user_stats)
ON CONFLICT (user_id) DO NOTHING;

-- Verify
SELECT COUNT(*) AS users_without_stats
FROM public.users
WHERE id NOT IN (SELECT user_id FROM public.user_stats);
