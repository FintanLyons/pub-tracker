-- ============================================================================
-- PHASE 3: SERVER-SIDE FUNCTIONS & TRIGGER
-- ============================================================================
-- Run in the Supabase Dashboard → SQL Editor → New query
--
-- Creates:
--   1. compute_user_stats(UUID) – recomputes a single user's stats
--   2. recompute_user_stats()   – trigger wrapper (AFTER INSERT/DELETE on visited_pubs)
--   3. get_area_stats(UUID)     – per-area visited/total for a user
--   4. get_borough_stats(UUID)  – per-borough stats with coordinates
--   5. get_achievements(UUID)   – trophies + total score
--   6. search_pubs(TEXT, INT)   – server-side name search
--
-- Scoring rules (mirrored from client):
--   • Each visited pub   → pub.points (default 10)
--   • Each completed area    → +50 bonus
--   • Each completed borough → +200 bonus
--   • Level = floor(score / 50) + 1
-- ============================================================================


-- ============================================================================
-- 0. Ensure user_stats has a unique constraint on user_id (needed for upsert)
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_stats_user_id_unique
  ON public.user_stats(user_id);


-- ============================================================================
-- 1. compute_user_stats(UUID)
-- ============================================================================
-- Standalone function so it can be called by the trigger AND by a one-off
-- backfill.  SECURITY DEFINER so it can write to user_stats regardless of
-- the calling user's RLS grants.
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
  -- Visited pub count
  SELECT COUNT(*)
    INTO v_pubs_visited
    FROM public.visited_pubs
   WHERE user_id = p_user_id;

  -- Points from visited pubs
  SELECT COALESCE(SUM(COALESCE(pa.points, 10)), 0)
    INTO v_pub_points
    FROM public.visited_pubs vp
    JOIN public.pubs_all pa ON pa.id = vp.pub_id
   WHERE vp.user_id = p_user_id;

  -- Completed areas (every pub in the area visited)
  WITH area_counts AS (
    SELECT pa.area,
           COUNT(*)           AS total,
           COUNT(vp.pub_id)   AS visited
      FROM public.pubs_all pa
      LEFT JOIN public.visited_pubs vp
        ON vp.pub_id = pa.id AND vp.user_id = p_user_id
     WHERE pa.area IS NOT NULL AND TRIM(pa.area) <> ''
     GROUP BY pa.area
  )
  SELECT COUNT(*)
    INTO v_completed_areas
    FROM area_counts
   WHERE visited = total AND total > 0;

  -- Completed boroughs
  WITH borough_counts AS (
    SELECT pa.borough,
           COUNT(*)           AS total,
           COUNT(vp.pub_id)   AS visited
      FROM public.pubs_all pa
      LEFT JOIN public.visited_pubs vp
        ON vp.pub_id = pa.id AND vp.user_id = p_user_id
     WHERE pa.borough IS NOT NULL AND TRIM(pa.borough) <> ''
     GROUP BY pa.borough
  )
  SELECT COUNT(*)
    INTO v_completed_boroughs
    FROM borough_counts
   WHERE visited = total AND total > 0;

  -- Score & level
  v_total_score := v_pub_points
                 + (v_completed_areas    * 50)
                 + (v_completed_boroughs * 200);
  v_level := FLOOR(v_total_score / 50.0)::INT + 1;

  -- Upsert
  INSERT INTO public.user_stats (user_id, pubs_visited, total_score, level, last_synced_at)
  VALUES (p_user_id, v_pubs_visited, v_total_score, v_level, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    pubs_visited   = EXCLUDED.pubs_visited,
    total_score    = EXCLUDED.total_score,
    level          = EXCLUDED.level,
    last_synced_at = EXCLUDED.last_synced_at;
END;
$$;


-- ============================================================================
-- 2. Trigger function + trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recompute_user_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.compute_user_stats(OLD.user_id);
  ELSE
    PERFORM public.compute_user_stats(NEW.user_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_user_stats ON public.visited_pubs;

CREATE TRIGGER trg_recompute_user_stats
  AFTER INSERT OR DELETE ON public.visited_pubs
  FOR EACH ROW
  EXECUTE FUNCTION public.recompute_user_stats();


-- ============================================================================
-- 3. get_area_stats(UUID)
-- ============================================================================
-- Returns one row per area with visited/total counts.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_area_stats(p_user_id UUID)
RETURNS TABLE (
  area        TEXT,
  borough     TEXT,
  total       BIGINT,
  visited     BIGINT,
  percentage  INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH visited_ids AS (
    SELECT pub_id FROM public.visited_pubs WHERE user_id = p_user_id
  )
  SELECT
    COALESCE(NULLIF(TRIM(pa.area), ''), 'Unknown')    AS area,
    MAX(CASE
      WHEN TRIM(pa.borough) <> '' THEN TRIM(pa.borough)
      ELSE NULL
    END)                                               AS borough,
    COUNT(*)::BIGINT                                   AS total,
    COUNT(v.pub_id)::BIGINT                            AS visited,
    CASE WHEN COUNT(*) > 0
      THEN ROUND((COUNT(v.pub_id)::NUMERIC / COUNT(*)) * 100)::INT
      ELSE 0
    END                                                AS percentage
  FROM public.pubs_all pa
  LEFT JOIN visited_ids v ON v.pub_id = pa.id
  GROUP BY COALESCE(NULLIF(TRIM(pa.area), ''), 'Unknown')
  ORDER BY area;
$$;

GRANT EXECUTE ON FUNCTION public.get_area_stats(UUID) TO authenticated;


-- ============================================================================
-- 4. get_borough_stats(UUID)
-- ============================================================================
-- Returns one row per borough with visited/total, area completion counts,
-- center coordinates, and bounding box.
-- ============================================================================

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
  area_completion AS (
    SELECT
      COALESCE(NULLIF(TRIM(pa.borough), ''), 'Unknown') AS borough_name,
      COALESCE(NULLIF(TRIM(pa.area), ''), 'Unknown')    AS area_name,
      COUNT(*)           AS area_total,
      COUNT(v.pub_id)    AS area_visited
    FROM public.pubs_all pa
    LEFT JOIN visited_ids v ON v.pub_id = pa.id
    WHERE pa.area IS NOT NULL AND TRIM(pa.area) <> ''
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
    COALESCE(NULLIF(TRIM(pa.borough), ''), 'Unknown')       AS borough,
    COUNT(*)::BIGINT                                         AS total_pubs,
    COUNT(v.pub_id)::BIGINT                                  AS visited_pubs,
    CASE WHEN COUNT(*) > 0
      THEN ROUND((COUNT(v.pub_id)::NUMERIC / COUNT(*)) * 100)::INT
      ELSE 0
    END                                                      AS percentage,
    COALESCE(baa.total_areas, 0)::BIGINT                     AS total_areas,
    COALESCE(baa.completed_areas, 0)::BIGINT                 AS completed_areas,
    AVG(pa.lat::DOUBLE PRECISION)                            AS center_lat,
    AVG(pa.lon::DOUBLE PRECISION)                            AS center_lon,
    MIN(pa.lat::DOUBLE PRECISION)                            AS min_lat,
    MAX(pa.lat::DOUBLE PRECISION)                            AS max_lat,
    MIN(pa.lon::DOUBLE PRECISION)                            AS min_lon,
    MAX(pa.lon::DOUBLE PRECISION)                            AS max_lon
  FROM public.pubs_all pa
  LEFT JOIN visited_ids v ON v.pub_id = pa.id
  LEFT JOIN borough_area_agg baa
    ON baa.borough_name = COALESCE(NULLIF(TRIM(pa.borough), ''), 'Unknown')
  WHERE pa.borough IS NOT NULL AND TRIM(pa.borough) <> ''
  GROUP BY
    COALESCE(NULLIF(TRIM(pa.borough), ''), 'Unknown'),
    baa.total_areas,
    baa.completed_areas
  ORDER BY borough;
$$;

GRANT EXECUTE ON FUNCTION public.get_borough_stats(UUID) TO authenticated;


-- ============================================================================
-- 5. get_achievements(UUID)
-- ============================================================================
-- Returns a single JSONB object:
--   { totalScore, level, areaTrophies[], boroughTrophies[], pubAchievements[] }
-- ============================================================================

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
  -- Points from visited pubs
  SELECT COALESCE(SUM(COALESCE(pa.points, 10)), 0)
    INTO v_pub_points
    FROM public.visited_pubs vp
    JOIN public.pubs_all pa ON pa.id = vp.pub_id
   WHERE vp.user_id = p_user_id;

  -- Area trophies + completed count
  WITH area_counts AS (
    SELECT
      COALESCE(NULLIF(TRIM(pa.area), ''), 'Unknown') AS area_name,
      COUNT(*)          AS total,
      COUNT(vp.pub_id)  AS visited
    FROM public.pubs_all pa
    LEFT JOIN public.visited_pubs vp
      ON vp.pub_id = pa.id AND vp.user_id = p_user_id
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

  -- Borough trophies + completed count
  WITH borough_counts AS (
    SELECT
      COALESCE(NULLIF(TRIM(pa.borough), ''), 'Unknown') AS borough_name,
      COUNT(*)          AS total,
      COUNT(vp.pub_id)  AS visited
    FROM public.pubs_all pa
    LEFT JOIN public.visited_pubs vp
      ON vp.pub_id = pa.id AND vp.user_id = p_user_id
    WHERE pa.borough IS NOT NULL AND TRIM(pa.borough) <> ''
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

  -- Pub-specific achievements (from the achievement column on pubs_all)
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

  -- Score & level
  v_total_score := v_pub_points
                 + (v_completed_areas    * 50)
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


-- ============================================================================
-- 6. search_pubs(TEXT, INT)
-- ============================================================================
-- Name-based search with relevance ordering:
--   exact match > starts-with > contains
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_pubs(
  p_query TEXT,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id       UUID,
  name     TEXT,
  lat      DOUBLE PRECISION,
  lon      DOUBLE PRECISION,
  area     TEXT,
  borough  TEXT
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
    pa.borough
  FROM public.pubs_all pa
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


-- ============================================================================
-- 7. Backfill: recompute stats for every user who already has visits
-- ============================================================================

DO $$
DECLARE
  uid UUID;
  cnt INT := 0;
BEGIN
  FOR uid IN SELECT DISTINCT user_id FROM public.visited_pubs
  LOOP
    PERFORM public.compute_user_stats(uid);
    cnt := cnt + 1;
  END LOOP;
  RAISE NOTICE 'Backfilled user_stats for % users', cnt;
END $$;


-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT
  routine_name,
  routine_type,
  data_type AS returns
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'compute_user_stats',
    'recompute_user_stats',
    'get_area_stats',
    'get_borough_stats',
    'get_achievements',
    'search_pubs'
  )
ORDER BY routine_name;

SELECT
  trigger_name,
  event_manipulation,
  event_object_table,
  action_timing
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name = 'trg_recompute_user_stats';
