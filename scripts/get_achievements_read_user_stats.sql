-- ============================================================================
-- get_achievements (Option A): headline stats from user_stats
-- ============================================================================
--
-- Replaces public.get_achievements so totalScore, level, and pubsVisited come
-- from public.user_stats (same source as leaderboard / friends), matching
-- compute_user_stats. Trophy JSON (district / postcode area / pub achievements)
-- is still computed live.
--
-- Prerequisites: phase6 (user_stats, compute_user_stats, visit + drink triggers).
--
-- If you use scripts/tier2_security_hardening.sql: this matches its auth.uid()
-- guard and SET search_path. Apply after scoring/tier2 bundles as needed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_achievements(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_score             INT;
  v_level                   INT;
  v_pubs_visited            INT;
  v_district_trophies       JSONB;
  v_postcode_area_trophies  JSONB;
  v_pub_achievements        JSONB;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT s.total_score, s.level, s.pubs_visited
    INTO v_total_score, v_level, v_pubs_visited
    FROM public.user_stats s
   WHERE s.user_id = p_user_id;

  IF NOT FOUND THEN
    PERFORM public.compute_user_stats(p_user_id);
    SELECT s.total_score, s.level, s.pubs_visited
      INTO v_total_score, v_level, v_pubs_visited
      FROM public.user_stats s
     WHERE s.user_id = p_user_id;
  END IF;

  v_total_score := COALESCE(v_total_score, 0);
  v_level := COALESCE(v_level, 1);
  v_pubs_visited := COALESCE(v_pubs_visited, 0);

  WITH effective_pubs AS (
    SELECT
      pa.id,
      COALESCE(NULLIF(TRIM(psa.postcode_district), ''), 'Unknown') AS effective_district
    FROM public.pubs_all pa
    LEFT JOIN public.pub_spatial_assignments psa ON psa.pub_id = pa.id
  ),
  district_counts AS (
    SELECT
      ep.effective_district AS district_name,
      COUNT(*) AS total,
      COUNT(vp.pub_id) AS visited
    FROM effective_pubs ep
    LEFT JOIN public.visited_pubs vp
      ON vp.pub_id = ep.id AND vp.user_id = p_user_id
    WHERE ep.effective_district IS NOT NULL AND TRIM(ep.effective_district) <> '' AND ep.effective_district <> 'Unknown'
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',          'district-' || district_name,
        'type',        'district',
        'title',       district_name || ' Complete',
        'description', ROUND((visited::NUMERIC / GREATEST(total, 1)) * 100)::TEXT || '%',
        'isAchieved',  (visited = total AND total > 0),
        'total',       total,
        'visited',     visited
      ) ORDER BY (visited = total AND total > 0) DESC, district_name
    ), '[]'::JSONB)
  INTO v_district_trophies
  FROM district_counts;

  WITH effective_pubs AS (
    SELECT
      pa.id,
      COALESCE(NULLIF(TRIM(psa.postcode_area), ''), 'Unknown') AS effective_area
    FROM public.pubs_all pa
    LEFT JOIN public.pub_spatial_assignments psa ON psa.pub_id = pa.id
  ),
  area_counts AS (
    SELECT
      ep.effective_area AS area_name,
      COUNT(*) AS total,
      COUNT(vp.pub_id) AS visited
    FROM effective_pubs ep
    LEFT JOIN public.visited_pubs vp
      ON vp.pub_id = ep.id AND vp.user_id = p_user_id
    WHERE ep.effective_area IS NOT NULL AND TRIM(ep.effective_area) <> '' AND ep.effective_area <> 'Unknown'
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',          'postcode-area-' || area_name,
        'type',        'postcode_area',
        'title',       area_name || ' Champion',
        'description', ROUND((visited::NUMERIC / GREATEST(total, 1)) * 100)::TEXT || '%',
        'isAchieved',  (visited = total AND total > 0),
        'total',       total,
        'visited',     visited
      ) ORDER BY (visited = total AND total > 0) DESC, area_name
    ), '[]'::JSONB)
  INTO v_postcode_area_trophies
  FROM area_counts;

  SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',          'achievement-' || pa.id,
        'type',        'achievement',
        'title',       pa.achievement,
        'description', pa.name,
        'isAchieved',  (vp.pub_id IS NOT NULL)
      ) ORDER BY (vp.pub_id IS NOT NULL) DESC, pa.name
    ), '[]'::JSONB)
  INTO v_pub_achievements
  FROM public.pubs_all pa
  LEFT JOIN public.visited_pubs vp
    ON vp.pub_id = pa.id AND vp.user_id = p_user_id
  WHERE pa.achievement IS NOT NULL AND TRIM(pa.achievement) <> '';

  RETURN jsonb_build_object(
    'totalScore',              v_total_score,
    'level',                   v_level,
    'pubsVisited',             v_pubs_visited,
    'districtTrophies',        v_district_trophies,
    'postcodeAreaTrophies',    v_postcode_area_trophies,
    'pubAchievements',         v_pub_achievements
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_achievements(UUID) TO authenticated;
