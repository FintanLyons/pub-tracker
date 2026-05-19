-- ============================================================================
-- High-severity security fixes (Supabase SQL Editor)
-- ============================================================================
--
-- 1. Remove get_email_by_username — no username login; blocks username→email lookup
-- 2. get_area_stats / get_borough_stats — caller must match auth.uid() (location stats)
-- 3. get_achievements — same auth guard (trophy / progress JSON)
--
-- Idempotent. Requires public."Pubs_List" (pub_list_migration).
-- App uses email + password only; no client changes required.
--
-- Skipped (by product choice): cron secret hardening, medium findings (reports_insert, etc.)
-- ============================================================================


-- ============================================================================
-- 1. Remove username → email RPC
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_email_by_username(TEXT);


-- ============================================================================
-- 2. get_area_stats — postcode district stats (own user only when JWT present)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_area_stats(p_user_id UUID)
RETURNS TABLE (
  district      TEXT,
  postcode_area TEXT,
  total         BIGINT,
  visited       BIGINT,
  percentage    INT,
  center_lat    DOUBLE PRECISION,
  center_lon    DOUBLE PRECISION
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
      pl.id,
      pl.lat,
      pl.lon,
      COALESCE(NULLIF(TRIM(pl.postcode_district), ''), 'Unknown') AS effective_district,
      COALESCE(NULLIF(TRIM(pl.postcode_area), ''), 'Unknown') AS effective_area
    FROM public."Pubs_List" pl
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


-- ============================================================================
-- 3. get_borough_stats — postcode area stats (own user only when JWT present)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_borough_stats(p_user_id UUID)
RETURNS TABLE (
  postcode_area       TEXT,
  total_pubs          BIGINT,
  visited_pubs        BIGINT,
  percentage          INT,
  total_districts     BIGINT,
  completed_districts BIGINT,
  center_lat          DOUBLE PRECISION,
  center_lon          DOUBLE PRECISION,
  min_lat             DOUBLE PRECISION,
  max_lat             DOUBLE PRECISION,
  min_lon             DOUBLE PRECISION,
  max_lon             DOUBLE PRECISION
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
      pl.id,
      pl.lat,
      pl.lon,
      COALESCE(NULLIF(TRIM(pl.postcode_district), ''), 'Unknown') AS effective_district,
      COALESCE(NULLIF(TRIM(pl.postcode_area), ''), 'Unknown') AS effective_area
    FROM public."Pubs_List" pl
  ),
  district_completion AS (
    SELECT
      ep.effective_area AS area_name,
      ep.effective_district AS district_name,
      COUNT(*) AS district_total,
      COUNT(v.pub_id) AS district_visited
    FROM effective_pubs ep
    LEFT JOIN visited_ids v ON v.pub_id = ep.id
    WHERE ep.effective_district IS NOT NULL
      AND TRIM(ep.effective_district) <> ''
      AND ep.effective_district <> 'Unknown'
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
  WHERE ep.effective_area IS NOT NULL
    AND TRIM(ep.effective_area) <> ''
    AND ep.effective_area <> 'Unknown'
  GROUP BY ep.effective_area, ada.total_districts, ada.completed_districts
  ORDER BY ep.effective_area;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_borough_stats(UUID) TO authenticated;


-- ============================================================================
-- 4. get_achievements — trophies + scores (own user only when JWT present)
-- ============================================================================
-- Matches create_pub_achievements_table.sql §5 (pub_achievements milestones).

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
      pl.id,
      COALESCE(NULLIF(TRIM(pl.postcode_district), ''), 'Unknown') AS effective_district
    FROM public."Pubs_List" pl
  ),
  district_counts AS (
    SELECT
      ep.effective_district AS district_name,
      COUNT(*) AS total,
      COUNT(vp.pub_id) AS visited
    FROM effective_pubs ep
    LEFT JOIN public.visited_pubs vp
      ON vp.pub_id = ep.id AND vp.user_id = p_user_id
    WHERE ep.effective_district IS NOT NULL
      AND TRIM(ep.effective_district) <> ''
      AND ep.effective_district <> 'Unknown'
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
      pl.id,
      COALESCE(NULLIF(TRIM(pl.postcode_area), ''), 'Unknown') AS effective_area
    FROM public."Pubs_List" pl
  ),
  area_counts AS (
    SELECT
      ep.effective_area AS area_name,
      COUNT(*) AS total,
      COUNT(vp.pub_id) AS visited
    FROM effective_pubs ep
    LEFT JOIN public.visited_pubs vp
      ON vp.pub_id = ep.id AND vp.user_id = p_user_id
    WHERE ep.effective_area IS NOT NULL
      AND TRIM(ep.effective_area) <> ''
      AND ep.effective_area <> 'Unknown'
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
        'id',          'achievement-' || a.id::TEXT,
        'type',        'achievement',
        'title',       a.title,
        'description', COALESCE(NULLIF(TRIM(a.description), ''), pl.name),
        'points',      a.points,
        'isAchieved',  (vp.pub_id IS NOT NULL)
      ) ORDER BY (vp.pub_id IS NOT NULL) DESC, a.sort_order, a.title
    ), '[]'::JSONB)
  INTO v_pub_achievements
  FROM public.pub_achievements a
  JOIN public."Pubs_List" pl ON pl.id = a.pub_id
  LEFT JOIN public.visited_pubs vp
    ON vp.pub_id = a.pub_id AND vp.user_id = p_user_id;

  RETURN jsonb_build_object(
    'totalScore',           v_total_score,
    'level',                v_level,
    'pubsVisited',          v_pubs_visited,
    'districtTrophies',     v_district_trophies,
    'postcodeAreaTrophies', v_postcode_area_trophies,
    'pubAchievements',      v_pub_achievements
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_achievements(UUID) TO authenticated;


-- ============================================================================
-- 5. Verification
-- ============================================================================

-- get_email_by_username should be gone
SELECT proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND proname = 'get_email_by_username';

-- All three RPCs should include auth guard
SELECT proname,
       pg_get_functiondef(oid) LIKE '%auth.uid() IS NOT NULL%' AS has_auth_guard
FROM pg_proc
WHERE proname IN ('get_area_stats', 'get_borough_stats', 'get_achievements')
  AND pronamespace = 'public'::regnamespace;
