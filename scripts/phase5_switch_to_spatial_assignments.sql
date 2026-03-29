-- ============================================================================
-- PHASE 5: Switch stats and search to polygon-based ward / borough assignments
-- ============================================================================
-- Prerequisites:
--   1. public.pub_spatial_assignments exists and is loaded
--   2. Run this in Supabase SQL Editor after create/load_pub_spatial_assignments.sql
--
-- Effect:
--   - get_area_stats uses corrected ward names when available
--   - get_borough_stats uses corrected borough names when available
--   - get_achievements uses corrected area/borough completion groups
--   - compute_user_stats uses corrected area/borough completion groups
--   - search_pubs returns corrected labels when available
--
-- Non-destructive:
--   - public.pubs_all is not modified
--   - pubs outside supported polygons fall back to pubs_all.area / pubs_all.borough
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compute_user_stats(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pubs_visited   INT;
  v_pub_points     INT;
  v_completed_areas    INT;
  v_completed_boroughs INT;
  v_total_score    INT;
  v_level          INT;
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
      COALESCE(NULLIF(TRIM(psa.corrected_ward_name), ''), NULLIF(TRIM(pa.area), ''), 'Unknown') AS effective_area,
      COALESCE(NULLIF(TRIM(psa.corrected_borough_name), ''), NULLIF(TRIM(pa.borough), ''), 'Unknown') AS effective_borough
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
     WHERE ep.effective_area IS NOT NULL AND TRIM(ep.effective_area) <> ''
     GROUP BY ep.effective_area
  )
  SELECT COUNT(*)
    INTO v_completed_areas
    FROM area_counts
   WHERE visited = total AND total > 0;

  WITH effective_pubs AS (
    SELECT
      pa.id,
      COALESCE(NULLIF(TRIM(psa.corrected_borough_name), ''), NULLIF(TRIM(pa.borough), ''), 'Unknown') AS effective_borough
    FROM public.pubs_all pa
    LEFT JOIN public.pub_spatial_assignments psa ON psa.pub_id = pa.id
  ),
  borough_counts AS (
    SELECT ep.effective_borough AS borough_name,
           COUNT(*) AS total,
           COUNT(vp.pub_id) AS visited
      FROM effective_pubs ep
      LEFT JOIN public.visited_pubs vp
        ON vp.pub_id = ep.id AND vp.user_id = p_user_id
     WHERE ep.effective_borough IS NOT NULL AND TRIM(ep.effective_borough) <> ''
     GROUP BY ep.effective_borough
  )
  SELECT COUNT(*)
    INTO v_completed_boroughs
    FROM borough_counts
   WHERE visited = total AND total > 0;

  v_total_score := v_pub_points
                 + (v_completed_areas * 50)
                 + (v_completed_boroughs * 200);
  v_level := FLOOR(v_total_score / 50.0)::INT + 1;

  INSERT INTO public.user_stats (user_id, pubs_visited, total_score, level, last_synced_at)
  VALUES (p_user_id, v_pubs_visited, v_total_score, v_level, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    pubs_visited   = EXCLUDED.pubs_visited,
    total_score    = EXCLUDED.total_score,
    level          = EXCLUDED.level,
    last_synced_at = EXCLUDED.last_synced_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_area_stats(p_user_id UUID)
RETURNS TABLE (
  area        TEXT,
  borough     TEXT,
  total       BIGINT,
  visited     BIGINT,
  percentage  INT,
  center_lat  DOUBLE PRECISION,
  center_lon  DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH visited_ids AS (
    SELECT pub_id FROM public.visited_pubs WHERE user_id = p_user_id
  ),
  effective_pubs AS (
    SELECT
      pa.id,
      pa.lat,
      pa.lon,
      COALESCE(NULLIF(TRIM(psa.corrected_ward_name), ''), NULLIF(TRIM(pa.area), ''), 'Unknown') AS effective_area,
      COALESCE(NULLIF(TRIM(psa.corrected_borough_name), ''), NULLIF(TRIM(pa.borough), ''), 'Unknown') AS effective_borough
    FROM public.pubs_all pa
    LEFT JOIN public.pub_spatial_assignments psa ON psa.pub_id = pa.id
  )
  SELECT
    ep.effective_area AS area,
    MAX(ep.effective_borough) AS borough,
    COUNT(*)::BIGINT AS total,
    COUNT(v.pub_id)::BIGINT AS visited,
    CASE WHEN COUNT(*) > 0
      THEN ROUND((COUNT(v.pub_id)::NUMERIC / COUNT(*)) * 100)::INT
      ELSE 0
    END AS percentage,
    AVG(ep.lat::DOUBLE PRECISION) AS center_lat,
    AVG(ep.lon::DOUBLE PRECISION) AS center_lon
  FROM effective_pubs ep
  LEFT JOIN visited_ids v ON v.pub_id = ep.id
  GROUP BY ep.effective_area
  ORDER BY area;
$$;

GRANT EXECUTE ON FUNCTION public.get_area_stats(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_borough_stats(p_user_id UUID)
RETURNS TABLE (
  borough          TEXT,
  total_pubs       BIGINT,
  visited_pubs     BIGINT,
  percentage       INT,
  total_areas      BIGINT,
  completed_areas  BIGINT,
  center_lat       DOUBLE PRECISION,
  center_lon       DOUBLE PRECISION,
  min_lat          DOUBLE PRECISION,
  max_lat          DOUBLE PRECISION,
  min_lon          DOUBLE PRECISION,
  max_lon          DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH visited_ids AS (
    SELECT pub_id FROM public.visited_pubs WHERE user_id = p_user_id
  ),
  effective_pubs AS (
    SELECT
      pa.id,
      pa.lat,
      pa.lon,
      COALESCE(NULLIF(TRIM(psa.corrected_ward_name), ''), NULLIF(TRIM(pa.area), ''), 'Unknown') AS effective_area,
      COALESCE(NULLIF(TRIM(psa.corrected_borough_name), ''), NULLIF(TRIM(pa.borough), ''), 'Unknown') AS effective_borough
    FROM public.pubs_all pa
    LEFT JOIN public.pub_spatial_assignments psa ON psa.pub_id = pa.id
  ),
  area_completion AS (
    SELECT
      ep.effective_borough AS borough_name,
      ep.effective_area AS area_name,
      COUNT(*) AS area_total,
      COUNT(v.pub_id) AS area_visited
    FROM effective_pubs ep
    LEFT JOIN visited_ids v ON v.pub_id = ep.id
    WHERE ep.effective_area IS NOT NULL AND TRIM(ep.effective_area) <> ''
    GROUP BY 1, 2
  ),
  borough_area_agg AS (
    SELECT
      borough_name,
      COUNT(*)::BIGINT AS total_areas,
      COUNT(*) FILTER (
        WHERE area_visited = area_total AND area_total > 0
      )::BIGINT AS completed_areas
    FROM area_completion
    GROUP BY borough_name
  )
  SELECT
    ep.effective_borough AS borough,
    COUNT(*)::BIGINT AS total_pubs,
    COUNT(v.pub_id)::BIGINT AS visited_pubs,
    CASE WHEN COUNT(*) > 0
      THEN ROUND((COUNT(v.pub_id)::NUMERIC / COUNT(*)) * 100)::INT
      ELSE 0
    END AS percentage,
    COALESCE(baa.total_areas, 0)::BIGINT AS total_areas,
    COALESCE(baa.completed_areas, 0)::BIGINT AS completed_areas,
    AVG(ep.lat::DOUBLE PRECISION) AS center_lat,
    AVG(ep.lon::DOUBLE PRECISION) AS center_lon,
    MIN(ep.lat::DOUBLE PRECISION) AS min_lat,
    MAX(ep.lat::DOUBLE PRECISION) AS max_lat,
    MIN(ep.lon::DOUBLE PRECISION) AS min_lon,
    MAX(ep.lon::DOUBLE PRECISION) AS max_lon
  FROM effective_pubs ep
  LEFT JOIN visited_ids v ON v.pub_id = ep.id
  LEFT JOIN borough_area_agg baa ON baa.borough_name = ep.effective_borough
  WHERE ep.effective_borough IS NOT NULL AND TRIM(ep.effective_borough) <> ''
  GROUP BY ep.effective_borough, baa.total_areas, baa.completed_areas
  ORDER BY borough;
$$;

GRANT EXECUTE ON FUNCTION public.get_borough_stats(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_achievements(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_pub_points         INT;
  v_completed_areas    INT;
  v_completed_boroughs INT;
  v_total_score        INT;
  v_area_trophies      JSONB;
  v_borough_trophies   JSONB;
  v_pub_achievements   JSONB;
BEGIN
  SELECT COALESCE(SUM(COALESCE(pa.points, 10)), 0)
    INTO v_pub_points
    FROM public.visited_pubs vp
    JOIN public.pubs_all pa ON pa.id = vp.pub_id
   WHERE vp.user_id = p_user_id;

  WITH effective_pubs AS (
    SELECT
      pa.id,
      COALESCE(NULLIF(TRIM(psa.corrected_ward_name), ''), NULLIF(TRIM(pa.area), ''), 'Unknown') AS effective_area
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
    GROUP BY 1
  )
  SELECT
    COUNT(*) FILTER (WHERE visited = total AND total > 0),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',          'area-' || area_name,
        'type',        'area',
        'title',       area_name || ' Complete',
        'description', ROUND((visited::NUMERIC / GREATEST(total, 1)) * 100)::TEXT || '%',
        'isAchieved',  (visited = total AND total > 0),
        'total',       total,
        'visited',     visited
      ) ORDER BY (visited = total AND total > 0) DESC, area_name
    ), '[]'::JSONB)
  INTO v_completed_areas, v_area_trophies
  FROM area_counts;

  WITH effective_pubs AS (
    SELECT
      pa.id,
      COALESCE(NULLIF(TRIM(psa.corrected_borough_name), ''), NULLIF(TRIM(pa.borough), ''), 'Unknown') AS effective_borough
    FROM public.pubs_all pa
    LEFT JOIN public.pub_spatial_assignments psa ON psa.pub_id = pa.id
  ),
  borough_counts AS (
    SELECT
      ep.effective_borough AS borough_name,
      COUNT(*) AS total,
      COUNT(vp.pub_id) AS visited
    FROM effective_pubs ep
    LEFT JOIN public.visited_pubs vp
      ON vp.pub_id = ep.id AND vp.user_id = p_user_id
    WHERE ep.effective_borough IS NOT NULL AND TRIM(ep.effective_borough) <> ''
    GROUP BY 1
  )
  SELECT
    COUNT(*) FILTER (WHERE visited = total AND total > 0),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',          'borough-' || borough_name,
        'type',        'borough',
        'title',       borough_name || ' Champion',
        'description', ROUND((visited::NUMERIC / GREATEST(total, 1)) * 100)::TEXT || '%',
        'isAchieved',  (visited = total AND total > 0),
        'total',       total,
        'visited',     visited
      ) ORDER BY (visited = total AND total > 0) DESC, borough_name
    ), '[]'::JSONB)
  INTO v_completed_boroughs, v_borough_trophies
  FROM borough_counts;

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

  v_total_score := v_pub_points
                 + (v_completed_areas * 50)
                 + (v_completed_boroughs * 200);

  RETURN jsonb_build_object(
    'totalScore',       v_total_score,
    'level',            FLOOR(v_total_score / 50.0)::INT + 1,
    'pubsVisited',      (SELECT COUNT(*) FROM public.visited_pubs WHERE user_id = p_user_id),
    'areaTrophies',     v_area_trophies,
    'boroughTrophies',  v_borough_trophies,
    'pubAchievements',  v_pub_achievements
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_achievements(UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.search_pubs(TEXT, INT);

CREATE OR REPLACE FUNCTION public.search_pubs(
  p_query TEXT,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id                 UUID,
  name               TEXT,
  lat                DOUBLE PRECISION,
  lon                DOUBLE PRECISION,
  area               TEXT,
  borough            TEXT,
  corrected_area     TEXT,
  corrected_borough  TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    pa.id,
    pa.name,
    pa.lat::DOUBLE PRECISION,
    pa.lon::DOUBLE PRECISION,
    pa.area,
    pa.borough,
    psa.corrected_ward_name AS corrected_area,
    psa.corrected_borough_name AS corrected_borough
  FROM public.pubs_all pa
  LEFT JOIN public.pub_spatial_assignments psa ON psa.pub_id = pa.id
  WHERE pa.name ILIKE '%' || p_query || '%'
  ORDER BY
    CASE
      WHEN LOWER(pa.name) = LOWER(p_query)           THEN 0
      WHEN LOWER(pa.name) LIKE LOWER(p_query) || '%' THEN 1
      ELSE 2
    END,
    pa.name
  LIMIT LEAST(p_limit, 50);
$$;

GRANT EXECUTE ON FUNCTION public.search_pubs(TEXT, INT) TO authenticated;

DO $$
DECLARE
  uid UUID;
BEGIN
  FOR uid IN SELECT DISTINCT user_id FROM public.visited_pubs
  LOOP
    PERFORM public.compute_user_stats(uid);
  END LOOP;
END $$;

-- Verification
SELECT COUNT(*) AS corrected_assignments_loaded FROM public.pub_spatial_assignments;
SELECT COUNT(*) AS pubs_with_corrected_borough FROM public.pub_spatial_assignments WHERE corrected_borough_name IS NOT NULL;
SELECT COUNT(*) AS pubs_with_corrected_ward FROM public.pub_spatial_assignments WHERE corrected_ward_name IS NOT NULL;
