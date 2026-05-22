-- ============================================================================
-- Report contribution points: only count accepted reports
-- ============================================================================
-- Run AFTER scripts/reports_apply_migration.sql (needs reports.status).
--
-- You already have tiered district scoring (+40/60/80/100, +1000 region).
-- This only updates compute_user_stats so report points require:
--   status IN ('approved', 'auto_applied')
--
-- Does NOT recalculate existing user_stats (no backfill).
-- New points apply on next report approve / visit / profile refresh.
--
-- If your live compute_user_stats matches scoring_postcode_district_tiered_bonus.sql
-- except for this WHERE clause, you can instead edit that function in the Dashboard
-- and add the one line marked *** below.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compute_user_stats(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pubs_visited              INT;
  v_pub_points                  INT;
  v_achievement_points          INT;
  v_district_completion_points  INT;
  v_completed_regions           INT;
  v_data_contribution_pts       INT;
  v_total_score                 INT;
  v_level                       INT;
  v_total_drinks                INT;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)
    INTO v_pubs_visited
    FROM public.visited_pubs
   WHERE user_id = p_user_id;

  SELECT COALESCE(COUNT(*) * 10, 0)::INT
    INTO v_pub_points
    FROM public.visited_pubs vp
    JOIN public."Pubs_List" pl ON pl.id = vp.pub_id
   WHERE vp.user_id = p_user_id;

  SELECT COALESCE(SUM(a.points), 0)::INT
    INTO v_achievement_points
    FROM public.pub_achievements a
    JOIN public.visited_pubs vp
      ON vp.pub_id = a.pub_id AND vp.user_id = p_user_id
   WHERE a.points > 0;

  WITH effective_pubs AS (
    SELECT
      pl.id,
      COALESCE(NULLIF(TRIM(pl.postcode_district), ''), 'Unknown') AS effective_district,
      COALESCE(NULLIF(TRIM(pl.postcode_area), ''), 'Unknown') AS effective_area
    FROM public."Pubs_List" pl
  ),
  district_counts AS (
    SELECT ep.effective_district AS district_name,
           COUNT(*)::INT AS total,
           COUNT(vp.pub_id)::INT AS visited
      FROM effective_pubs ep
      LEFT JOIN public.visited_pubs vp
        ON vp.pub_id = ep.id AND vp.user_id = p_user_id
     WHERE ep.effective_district IS NOT NULL
       AND TRIM(ep.effective_district) <> ''
       AND ep.effective_district <> 'Unknown'
     GROUP BY ep.effective_district
  )
  SELECT COALESCE(SUM(public.postcode_district_completion_bonus(total)), 0)::INT
    INTO v_district_completion_points
    FROM district_counts
   WHERE visited = total AND total > 0;

  WITH effective_pubs AS (
    SELECT
      pl.id,
      COALESCE(NULLIF(TRIM(pl.postcode_area), ''), 'Unknown') AS effective_area
    FROM public."Pubs_List" pl
  ),
  region_counts AS (
    SELECT ep.effective_area AS area_name,
           COUNT(*)::INT AS total,
           COUNT(vp.pub_id)::INT AS visited
      FROM effective_pubs ep
      LEFT JOIN public.visited_pubs vp
        ON vp.pub_id = ep.id AND vp.user_id = p_user_id
     WHERE ep.effective_area IS NOT NULL
       AND TRIM(ep.effective_area) <> ''
       AND ep.effective_area <> 'Unknown'
     GROUP BY ep.effective_area
  )
  SELECT COUNT(*)::INT
    INTO v_completed_regions
    FROM region_counts
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
   WHERE r.reporter_id = p_user_id
     AND r.status IN ('approved', 'auto_applied');  -- *** the only report-scoring change

  v_total_score := v_pub_points
                 + v_achievement_points
                 + v_total_drinks
                 + v_data_contribution_pts
                 + v_district_completion_points
                 + (v_completed_regions * 1000);
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

GRANT EXECUTE ON FUNCTION public.compute_user_stats(UUID) TO authenticated;
