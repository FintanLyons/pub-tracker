-- ============================================================================
-- PHASE 6: Postcode district / postcode area grouping (replaces ward / borough)
-- ============================================================================
-- Prerequisites:
--   1. public.pub_spatial_assignments exists
--   2. Run AFTER this file: populate postcode columns (see UPDATE below)
--
-- Scoring:
--   - Each visited pub: pub.points (default 10; higher for special pubs)
--   - Each drink logged: +1 (sum of pub_drinks.count)
--   - Complete all pubs in a postcode district: +50
--   - Complete all pubs in a postcode area (e.g. SW, E): +1000
--   - Level = floor(total_score / 50) + 1
--
-- Non-destructive to pubs_all.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add postcode columns to pub_spatial_assignments
-- ---------------------------------------------------------------------------

ALTER TABLE public.pub_spatial_assignments
  ADD COLUMN IF NOT EXISTS postcode_district TEXT,
  ADD COLUMN IF NOT EXISTS postcode_area TEXT;

CREATE INDEX IF NOT EXISTS idx_pub_spatial_assignments_postcode_district
  ON public.pub_spatial_assignments(postcode_district);

CREATE INDEX IF NOT EXISTS idx_pub_spatial_assignments_postcode_area
  ON public.pub_spatial_assignments(postcode_area);

COMMENT ON COLUMN public.pub_spatial_assignments.postcode_district IS
  'UK postcode outward code / district (e.g. SW1, EC1M, SE25).';

COMMENT ON COLUMN public.pub_spatial_assignments.postcode_area IS
  'UK postcode area letters only (e.g. SW, EC, SE).';

-- ---------------------------------------------------------------------------
-- 2. Parse UK postcode from address text → district + area
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.uk_postcode_from_address(p_address TEXT)
RETURNS TABLE(district TEXT, area TEXT)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $func$
  WITH s AS (
    SELECT CASE
      WHEN p_address IS NULL OR length(trim(p_address)) = 0 THEN NULL::text
      ELSE upper(regexp_replace(p_address, E'[\\n\\r\\t]+', ' ', 'g'))
    END AS txt
  ),
  lastm AS (
    SELECT (rm.arr)[1] AS pc
    FROM s
    CROSS JOIN LATERAL regexp_matches(
      s.txt,
      '([A-Z]{1,2}[0-9]{1,2}[A-Z]?\\s?[0-9][A-Z]{2})',
      'gi'
    ) WITH ORDINALITY AS rm(arr, ord)
    ORDER BY rm.ord DESC
    LIMIT 1
  ),
  compact AS (
    SELECT regexp_replace(lastm.pc, '\\s+', '', 'g') AS c
    FROM lastm
    WHERE lastm.pc IS NOT NULL
  ),
  split AS (
    SELECT
      left(c, length(c) - 3) AS outward,
      right(c, 3) AS inward3
    FROM compact
    WHERE length(c) >= 5
      AND right(c, 3) ~ '^[0-9][A-Z]{2}$'
  )
  SELECT
    split.outward AS district,
    (regexp_match(split.outward, '^([A-Z]+)'))[1] AS area
  FROM split;
$func$;

-- Populate from pubs_all.address for all existing assignment rows
UPDATE public.pub_spatial_assignments psa
SET
  postcode_district = p.district,
  postcode_area = p.area
FROM public.pubs_all pa
LEFT JOIN LATERAL public.uk_postcode_from_address(pa.address) p ON true
WHERE psa.pub_id = pa.id
  AND (p.district IS NOT NULL OR p.area IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 2b. Drink totals on user_stats (requires public.pub_drinks)
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_stats
  ADD COLUMN IF NOT EXISTS total_drinks INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 3. compute_user_stats
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 3a. Keep total_drinks in sync when pub_drinks rows change
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 3b. Drop RPCs whose TABLE return columns changed
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE cannot alter OUT / RETURNS TABLE row types (42P13).
-- PostgREST clients only call these by name; re-GRANT after recreate.

DROP FUNCTION IF EXISTS public.get_area_stats(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_borough_stats(UUID) CASCADE;

-- ---------------------------------------------------------------------------
-- 4. get_area_stats → postcode district stats (RPC name unchanged)
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
  ORDER BY district;
$$;

GRANT EXECUTE ON FUNCTION public.get_area_stats(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. get_borough_stats → postcode area stats (RPC name unchanged)
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
  ORDER BY postcode_area;
$$;

GRANT EXECUTE ON FUNCTION public.get_borough_stats(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. get_achievements
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_achievements(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_pub_points              INT;
  v_completed_districts     INT;
  v_completed_areas         INT;
  v_total_drinks            INT;
  v_total_score             INT;
  v_district_trophies       JSONB;
  v_postcode_area_trophies  JSONB;
  v_pub_achievements        JSONB;
BEGIN
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

  SELECT COALESCE(SUM(count), 0)::INT
    INTO v_total_drinks
    FROM public.pub_drinks
   WHERE user_id = p_user_id;

  v_total_score := v_pub_points
                 + v_total_drinks
                 + (v_completed_districts * 50)
                 + (v_completed_areas * 1000);

  RETURN jsonb_build_object(
    'totalScore',              v_total_score,
    'level',                   FLOOR(v_total_score / 50.0)::INT + 1,
    'pubsVisited',             (SELECT COUNT(*) FROM public.visited_pubs WHERE user_id = p_user_id),
    'districtTrophies',      v_district_trophies,
    'postcodeAreaTrophies',    v_postcode_area_trophies,
    'pubAchievements',         v_pub_achievements
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_achievements(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. search_pubs
-- ---------------------------------------------------------------------------

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
  postcode_district  TEXT,
  postcode_area      TEXT
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
    psa.postcode_district,
    psa.postcode_area
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

-- ---------------------------------------------------------------------------
-- 8. Backfill user_stats for all users with visits
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  uid UUID;
BEGIN
  FOR uid IN SELECT DISTINCT user_id FROM public.visited_pubs
  LOOP
    PERFORM public.compute_user_stats(uid);
  END LOOP;
END $$;
