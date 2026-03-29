-- ============================================================================
-- TIER 2: Security hardening (run in Supabase SQL Editor on your project)
-- ============================================================================
-- 1) RPCs only return stats for the caller when JWT is present (blocks
--    authenticated users from passing another user's UUID).
-- 2) delete_my_account() removes app data and the auth user (GDPR / App Store).
--
-- Maintenance: SQL editor / service-role jobs run with auth.uid() = NULL, so
-- compute_user_stats(uid) still works for backfills.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. compute_user_stats — caller cannot recompute another user's stats
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.compute_user_stats(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pubs_visited         INT;
  v_pub_points           INT;
  v_completed_districts INT;
  v_completed_areas      INT;
  v_total_score          INT;
  v_level                INT;
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

  v_total_score := v_pub_points
                 + (v_completed_districts * 50)
                 + (v_completed_areas * 500);
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

-- ---------------------------------------------------------------------------
-- 2. get_area_stats — plpgsql + auth check + RETURN QUERY
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_area_stats(p_user_id UUID)
RETURNS TABLE (
  district       TEXT,
  postcode_area  TEXT,
  total          BIGINT,
  visited        BIGINT,
  percentage     INT,
  center_lat     DOUBLE PRECISION,
  center_lon     DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH visited_ids AS (
    SELECT pub_id FROM public.visited_pubs WHERE user_id = p_user_id
  ),
  effective_pubs AS (
    SELECT
      pa.id,
      pa.lat,
      pa.lon,
      COALESCE(NULLIF(TRIM(psa.postcode_district), ''), 'Unknown') AS effective_district,
      COALESCE(NULLIF(TRIM(psa.postcode_area), ''), 'Unknown') AS effective_area
    FROM public.pubs_all pa
    LEFT JOIN public.pub_spatial_assignments psa ON psa.pub_id = pa.id
  )
  SELECT
    ep.effective_district AS district,
    MAX(ep.effective_area) AS postcode_area,
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
  GROUP BY ep.effective_district
  ORDER BY ep.effective_district;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_area_stats(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_borough_stats
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_borough_stats(p_user_id UUID)
RETURNS TABLE (
  postcode_area        TEXT,
  total_pubs           BIGINT,
  visited_pubs         BIGINT,
  percentage           INT,
  total_districts      BIGINT,
  completed_districts  BIGINT,
  center_lat           DOUBLE PRECISION,
  center_lon           DOUBLE PRECISION,
  min_lat              DOUBLE PRECISION,
  max_lat              DOUBLE PRECISION,
  min_lon              DOUBLE PRECISION,
  max_lon              DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH visited_ids AS (
    SELECT pub_id FROM public.visited_pubs WHERE user_id = p_user_id
  ),
  effective_pubs AS (
    SELECT
      pa.id,
      pa.lat,
      pa.lon,
      COALESCE(NULLIF(TRIM(psa.postcode_district), ''), 'Unknown') AS effective_district,
      COALESCE(NULLIF(TRIM(psa.postcode_area), ''), 'Unknown') AS effective_area
    FROM public.pubs_all pa
    LEFT JOIN public.pub_spatial_assignments psa ON psa.pub_id = pa.id
  ),
  district_completion AS (
    SELECT
      ep.effective_area AS area_name,
      ep.effective_district AS district_name,
      COUNT(*) AS district_total,
      COUNT(v.pub_id) AS district_visited
    FROM effective_pubs ep
    LEFT JOIN visited_ids v ON v.pub_id = ep.id
    WHERE ep.effective_district IS NOT NULL AND TRIM(ep.effective_district) <> '' AND ep.effective_district <> 'Unknown'
    GROUP BY 1, 2
  ),
  area_district_agg AS (
    SELECT
      area_name,
      COUNT(*)::BIGINT AS total_districts,
      COUNT(*) FILTER (
        WHERE district_visited = district_total AND district_total > 0
      )::BIGINT AS completed_districts
    FROM district_completion
    GROUP BY area_name
  )
  SELECT
    ep.effective_area AS postcode_area,
    COUNT(*)::BIGINT AS total_pubs,
    COUNT(v.pub_id)::BIGINT AS visited_pubs,
    CASE WHEN COUNT(*) > 0
      THEN ROUND((COUNT(v.pub_id)::NUMERIC / COUNT(*)) * 100)::INT
      ELSE 0
    END AS percentage,
    COALESCE(ada.total_districts, 0)::BIGINT AS total_districts,
    COALESCE(ada.completed_districts, 0)::BIGINT AS completed_districts,
    AVG(ep.lat::DOUBLE PRECISION) AS center_lat,
    AVG(ep.lon::DOUBLE PRECISION) AS center_lon,
    MIN(ep.lat::DOUBLE PRECISION) AS min_lat,
    MAX(ep.lat::DOUBLE PRECISION) AS max_lat,
    MIN(ep.lon::DOUBLE PRECISION) AS min_lon,
    MAX(ep.lon::DOUBLE PRECISION) AS max_lon
  FROM effective_pubs ep
  LEFT JOIN visited_ids v ON v.pub_id = ep.id
  LEFT JOIN area_district_agg ada ON ada.area_name = ep.effective_area
  WHERE ep.effective_area IS NOT NULL AND TRIM(ep.effective_area) <> '' AND ep.effective_area <> 'Unknown'
  GROUP BY ep.effective_area, ada.total_districts, ada.completed_districts
  ORDER BY ep.effective_area;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_borough_stats(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_achievements — auth check at start
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_achievements(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pub_points              INT;
  v_completed_districts     INT;
  v_completed_areas         INT;
  v_total_score             INT;
  v_district_trophies       JSONB;
  v_postcode_area_trophies  JSONB;
  v_pub_achievements        JSONB;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(COALESCE(pa.points, 10)), 0)
    INTO v_pub_points
    FROM public.visited_pubs vp
    JOIN public.pubs_all pa ON pa.id = vp.pub_id
   WHERE vp.user_id = p_user_id;

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
  SELECT
    COUNT(*) FILTER (WHERE visited = total AND total > 0),
    COALESCE(jsonb_agg(
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
  INTO v_completed_districts, v_district_trophies
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
  SELECT
    COUNT(*) FILTER (WHERE visited = total AND total > 0),
    COALESCE(jsonb_agg(
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
  INTO v_completed_areas, v_postcode_area_trophies
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

  v_total_score := v_pub_points
                 + (v_completed_districts * 50)
                 + (v_completed_areas * 500);

  RETURN jsonb_build_object(
    'totalScore',              v_total_score,
    'level',                   FLOOR(v_total_score / 50.0)::INT + 1,
    'pubsVisited',             (SELECT COUNT(*) FROM public.visited_pubs WHERE user_id = p_user_id),
    'districtTrophies',        v_district_trophies,
    'postcodeAreaTrophies',    v_postcode_area_trophies,
    'pubAchievements',         v_pub_achievements
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_achievements(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. delete_my_account — call from app while signed in (authenticated JWT)
-- ---------------------------------------------------------------------------
-- Removes social/data rows, then auth user. If DELETE FROM auth.users fails
-- (permissions), run the same cleanup via Dashboard or an Edge Function with
-- service role instead.

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  DELETE FROM public.pub_reviews WHERE user_id = uid;
  DELETE FROM public.pub_drinks WHERE user_id = uid;
  DELETE FROM public.visited_pubs WHERE user_id = uid;
  DELETE FROM public.favorite_pubs WHERE user_id = uid;
  DELETE FROM public.friendships WHERE user_id = uid OR friend_id = uid;

  DELETE FROM public.league_members
  WHERE league_id IN (SELECT id FROM public.leagues WHERE created_by = uid);

  DELETE FROM public.leagues WHERE created_by = uid;

  DELETE FROM public.league_members WHERE user_id = uid;

  DELETE FROM public.user_stats WHERE user_id = uid;

  DELETE FROM public.users WHERE id = uid;

  DELETE FROM auth.users WHERE id = uid;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
