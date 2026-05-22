-- ============================================================================
-- Pubs_List.is_active — hide permanently closed / not-a-pub venues from map
-- ============================================================================
-- Run in Supabase SQL Editor. Safe to re-run (idempotent).
--
-- • All existing rows default to is_active = true
-- • Approved report with still_operating = false → is_active = false (row kept)
-- • Map search + district/area stats exclude inactive pubs from totals
-- • Visited inactive pubs still count toward visit points / history
--
-- If you approved a "not a pub" report before this migration, set manually:
--   UPDATE public."Pubs_List" SET is_active = false WHERE id = '<pub_id>';
-- ============================================================================

ALTER TABLE public."Pubs_List"
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public."Pubs_List".is_active IS
  'When false, pub is permanently closed / no longer a pub — hidden from map and discovery; row is never deleted.';

CREATE INDEX IF NOT EXISTS idx_pubs_list_is_active_true
  ON public."Pubs_List"(is_active)
  WHERE is_active = true;

-- --- Apply report: set is_active from still_operating -----------------------

CREATE OR REPLACE FUNCTION public.apply_report_to_pub(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.reports%ROWTYPE;
  pl public."Pubs_List"%ROWTYPE;
  v_photo_count int;
BEGIN
  SELECT * INTO r FROM public.reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found';
  END IF;

  IF r.applied_at IS NOT NULL THEN
    RETURN;
  END IF;

  IF r.report_type = 'missing_pub' THEN
    RAISE EXCEPTION 'missing_pub apply not implemented (needs lat/lon)';
  END IF;

  IF r.report_type <> 'pub_correction' OR r.pub_id IS NULL THEN
    RAISE EXCEPTION 'report is not a pub correction with pub_id';
  END IF;

  SELECT * INTO pl FROM public."Pubs_List" WHERE id = r.pub_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pub not found: %', r.pub_id;
  END IF;

  v_photo_count := CASE
    WHEN r.photo_urls IS NULL THEN 0
    ELSE LEAST(COALESCE(array_length(r.photo_urls, 1), 0), 5)
  END;

  UPDATE public."Pubs_List" SET
    name = COALESCE(NULLIF(trim(r.pub_name), ''), pl.name),
    ownership = COALESCE(r.chain_or_independent, pl.ownership),
    addr_housenumber = COALESCE(r.addr_housenumber, pl.addr_housenumber),
    addr_street = COALESCE(r.addr_street, pl.addr_street),
    postcode_district = COALESCE(r.postcode_district, pl.postcode_district),
    postcode_area = COALESCE(r.postcode_area, pl.postcode_area),
    website = COALESCE(r.website, pl.website),
    phone = COALESCE(r.phone, pl.phone),
    founded = COALESCE(r.founded, pl.founded),
    description = COALESCE(r.history, pl.description),
    is_active = CASE
      WHEN r.still_operating IS NOT NULL THEN r.still_operating
      ELSE pl.is_active
    END,
    opening_hours = CASE
      WHEN r.still_operating = false THEN 'closed'
      WHEN r.closing_time IS NOT NULL AND trim(r.closing_time) <> '' THEN r.closing_time
      ELSE pl.opening_hours
    END,
    has_pub_garden = COALESCE(public.report_feature_bool(r.features_snapshot, 'Pub garden'), pl.has_pub_garden),
    has_live_music = COALESCE(public.report_feature_bool(r.features_snapshot, 'Live music'), pl.has_live_music),
    has_food_available = COALESCE(public.report_feature_bool(r.features_snapshot, 'Food available'), pl.has_food_available),
    has_dog_friendly = COALESCE(public.report_feature_bool(r.features_snapshot, 'Dog friendly'), pl.has_dog_friendly),
    has_pool_darts = COALESCE(public.report_feature_bool(r.features_snapshot, 'Pool/darts'), pl.has_pool_darts),
    has_accommodation = COALESCE(public.report_feature_bool(r.features_snapshot, 'Accommodation'), pl.has_accommodation),
    has_live_sport = COALESCE(public.report_feature_bool(r.features_snapshot, 'Live sport'), pl.has_live_sport),
    photo_url1 = CASE WHEN v_photo_count >= 1 THEN r.photo_urls[1] ELSE pl.photo_url1 END,
    photo_url2 = CASE WHEN v_photo_count >= 2 THEN r.photo_urls[2] ELSE pl.photo_url2 END,
    photo_url3 = CASE WHEN v_photo_count >= 3 THEN r.photo_urls[3] ELSE pl.photo_url3 END,
    photo_url4 = CASE WHEN v_photo_count >= 4 THEN r.photo_urls[4] ELSE pl.photo_url4 END,
    photo_url5 = CASE WHEN v_photo_count >= 5 THEN r.photo_urls[5] ELSE pl.photo_url5 END
  WHERE id = r.pub_id;

  UPDATE public.reports
     SET applied_at = now(),
         apply_error = NULL
   WHERE id = p_report_id;

EXCEPTION WHEN OTHERS THEN
  UPDATE public.reports
     SET status = 'apply_failed',
         apply_error = SQLERRM
   WHERE id = p_report_id;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_report_to_pub(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_report_to_pub(uuid) TO service_role;

-- --- search_pubs: active pubs only ------------------------------------------

DROP FUNCTION IF EXISTS public.search_pubs(TEXT, INT);

CREATE OR REPLACE FUNCTION public.search_pubs(
  p_query TEXT,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id                TEXT,
  name              TEXT,
  lat               DOUBLE PRECISION,
  lon               DOUBLE PRECISION,
  area              TEXT,
  borough           TEXT,
  postcode_district TEXT,
  postcode_area     TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pl.id,
    pl.name,
    pl.lat::DOUBLE PRECISION,
    pl.lon::DOUBLE PRECISION,
    pl.postcode_district AS area,
    pl.postcode_area     AS borough,
    pl.postcode_district,
    pl.postcode_area
  FROM public."Pubs_List" pl
  WHERE pl.is_active = true
    AND pl.name ILIKE '%' || p_query || '%'
  ORDER BY
    CASE
      WHEN LOWER(pl.name) = LOWER(p_query)           THEN 0
      WHEN LOWER(pl.name) LIKE LOWER(p_query) || '%' THEN 1
      ELSE 2
    END,
    pl.name
  LIMIT LEAST(p_limit, 50);
$$;

GRANT EXECUTE ON FUNCTION public.search_pubs(TEXT, INT) TO authenticated, anon;

-- --- Stats RPCs: exclude inactive from district/area totals -----------------

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
    WHERE pl.is_active = true
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
    WHERE pl.is_active = true
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

-- compute_user_stats: district/region completion uses active pubs only;
-- visit points still include inactive pubs the user visited before closure.

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
    WHERE pl.is_active = true
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
    WHERE pl.is_active = true
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
     AND r.status IN ('approved', 'auto_applied');

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

-- get_achievements: trophy totals exclude inactive pubs

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
    WHERE pl.is_active = true
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
    WHERE pl.is_active = true
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
