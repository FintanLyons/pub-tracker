-- ============================================================================
-- Scoring: points for pub data contributions (reports)
-- ============================================================================
-- Run in Supabase SQL Editor after `reports` has reporter_id + report_type.
--
-- Rules (per report row = one submission):
--   • missing_pub      → +20
--   • pub_correction   → +5 (one submission fixes many fields; still one row)
--
-- Updates `compute_user_stats` (adds contribution sum) and installs an AFTER INSERT
-- trigger on `reports` so user_stats / leaderboard stay in sync.
--
-- Compatible with scripts/tier2_security_hardening.sql (auth.uid() guard +
-- SET search_path). If you never applied tier2, use the body from
-- scripts/phase6_postcode_migration.sql `compute_user_stats` instead, plus the
-- contribution block below.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compute_user_stats(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pubs_visited          INT;
  v_pub_points            INT;
  v_completed_districts   INT;
  v_completed_areas       INT;
  v_data_contribution_pts INT;
  v_total_score           INT;
  v_level                 INT;
  v_total_drinks          INT;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

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

  SELECT COALESCE(
           SUM(
             CASE
               WHEN r.report_type = 'missing_pub' THEN 20
               WHEN r.report_type = 'pub_correction' THEN 5
               ELSE 0
             END
           ),
           0
         )::INT
    INTO v_data_contribution_pts
    FROM public.reports r
   WHERE r.reporter_id = p_user_id;

  v_total_score := v_pub_points
                 + v_total_drinks
                 + v_data_contribution_pts
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

CREATE OR REPLACE FUNCTION public.trg_reports_recompute_user_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reporter_id IS NOT NULL THEN
    PERFORM public.compute_user_stats(NEW.reporter_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reports_recompute_user_stats ON public.reports;
CREATE TRIGGER trg_reports_recompute_user_stats
  AFTER INSERT ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_reports_recompute_user_stats();

-- Backfill scores for users who already submitted reports (run as postgres / service role)
DO $$
DECLARE
  uid UUID;
BEGIN
  FOR uid IN
    SELECT DISTINCT reporter_id
      FROM public.reports
     WHERE reporter_id IS NOT NULL
  LOOP
    PERFORM public.compute_user_stats(uid);
  END LOOP;
END $$;
