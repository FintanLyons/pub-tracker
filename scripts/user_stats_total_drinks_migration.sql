-- ============================================================================
-- user_stats.total_drinks — denormalised SUM(pub_drinks.count)
-- ============================================================================
-- Prerequisites: public.pub_drinks exists (add_drinks_and_reviews.sql).
--
-- Run in Supabase SQL editor on databases that already shipped without this
-- column. Fresh installs: use current scripts/phase6_postcode_migration.sql
-- (includes the same compute_user_stats + trigger).
--
-- After deploy, the app reads total_drinks from user_stats; drop the old RPC:
--   DROP FUNCTION IF EXISTS public.get_user_drink_totals(UUID[]);
-- ============================================================================

ALTER TABLE public.user_stats
  ADD COLUMN IF NOT EXISTS total_drinks INTEGER NOT NULL DEFAULT 0;

UPDATE public.user_stats u
SET total_drinks = COALESCE((
  SELECT SUM(d.count)::integer FROM public.pub_drinks d WHERE d.user_id = u.user_id
), 0);

-- Keep in sync with scripts/phase6_postcode_migration.sql §3 (compute_user_stats)
CREATE OR REPLACE FUNCTION public.compute_user_stats(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pubs_visited         INT;
  v_pub_points           INT;
  v_completed_districts INT;
  v_completed_areas      INT;
  v_total_score          INT;
  v_level                INT;
  v_total_drinks         INT;
BEGIN
  SELECT COUNT(*)
    INTO v_pubs_visited
    FROM public.visited_pubs
   WHERE user_id = p_user_id;

  SELECT COALESCE(SUM(COALESCE(pa.points, 10)), 0)
    INTO v_pub_points
    FROM public.visited_pubs vp
    JOIN public.pubs_all pa ON pa.id = vp.pub_id
   WHERE vp.user_id = p_user_id;

  WITH effective_pubs AS (
    SELECT
      pa.id,
      COALESCE(NULLIF(TRIM(psa.postcode_district), ''), 'Unknown') AS effective_district,
      COALESCE(NULLIF(TRIM(psa.postcode_area), ''), 'Unknown') AS effective_area
    FROM public.pubs_all pa
    LEFT JOIN public.pub_spatial_assignments psa ON psa.pub_id = pa.id
  ),
  district_counts AS (
    SELECT ep.effective_district AS district_name,
           COUNT(*) AS total,
           COUNT(vp.pub_id) AS visited
      FROM effective_pubs ep
      LEFT JOIN public.visited_pubs vp
        ON vp.pub_id = ep.id AND vp.user_id = p_user_id
     WHERE ep.effective_district IS NOT NULL AND TRIM(ep.effective_district) <> '' AND ep.effective_district <> 'Unknown'
     GROUP BY ep.effective_district
  )
  SELECT COUNT(*)
    INTO v_completed_districts
    FROM district_counts
   WHERE visited = total AND total > 0;

  WITH effective_pubs AS (
    SELECT
      pa.id,
      COALESCE(NULLIF(TRIM(psa.postcode_area), ''), 'Unknown') AS effective_area
    FROM public.pubs_all pa
    LEFT JOIN public.pub_spatial_assignments psa ON psa.pub_id = pa.id
  ),
  area_counts AS (
    SELECT ep.effective_area AS area_name,
           COUNT(*) AS total,
           COUNT(vp.pub_id) AS visited
      FROM effective_pubs ep
      LEFT JOIN public.visited_pubs vp
        ON vp.pub_id = ep.id AND vp.user_id = p_user_id
     WHERE ep.effective_area IS NOT NULL AND TRIM(ep.effective_area) <> '' AND ep.effective_area <> 'Unknown'
     GROUP BY ep.effective_area
  )
  SELECT COUNT(*)
    INTO v_completed_areas
    FROM area_counts
   WHERE visited = total AND total > 0;

  SELECT COALESCE(SUM(count), 0)::INT
    INTO v_total_drinks
    FROM public.pub_drinks
   WHERE user_id = p_user_id;

  v_total_score := v_pub_points
                 + v_total_drinks
                 + (v_completed_districts * 50)
                 + (v_completed_areas * 1000);
  v_level := FLOOR(v_total_score / 50.0)::INT + 1;

  INSERT INTO public.user_stats (user_id, pubs_visited, total_score, level, total_drinks, last_synced_at)
  VALUES (p_user_id, v_pubs_visited, v_total_score, v_level, v_total_drinks, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    pubs_visited   = EXCLUDED.pubs_visited,
    total_score    = EXCLUDED.total_score,
    level          = EXCLUDED.level,
    total_drinks   = EXCLUDED.total_drinks,
    last_synced_at = EXCLUDED.last_synced_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_user_total_drinks(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.compute_user_stats(p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_pub_drinks_sync_total_drinks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_user_total_drinks(OLD.user_id);
    RETURN OLD;
  END IF;
  PERFORM public.sync_user_total_drinks(NEW.user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pub_drinks_sync_total_drinks ON public.pub_drinks;
CREATE TRIGGER trg_pub_drinks_sync_total_drinks
  AFTER INSERT OR UPDATE OF count OR DELETE ON public.pub_drinks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_pub_drinks_sync_total_drinks();

DROP FUNCTION IF EXISTS public.get_user_drink_totals(UUID[]);
