-- ============================================================================
-- pub_list migration
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- It does the following:
--
--   A. RLS on pub_list                    (public read, no public write)
--   B. Rewire visited_pubs / favorite_pubs / pub_drinks / pub_reviews
--      so pub_id is TEXT referencing pub_list(id) instead of UUID→pubs_all.
--      ⚠ This deletes any existing rows in those tables (test data only).
--   C. search_pubs RPC                    (reads pub_list directly)
--   D. compute_user_stats RPC             (reads pub_list directly)
--   E. get_area_stats RPC                 (reads pub_list directly)
--   F. get_borough_stats RPC              (reads pub_list directly)
--   G. get_achievements RPC               (reads pub_list directly)
--
-- pubs_all and pub_spatial_assignments are NOT touched or dropped.
-- ============================================================================


-- ============================================================================
-- A0. Ensure Pubs_List.id is the primary key
--     (Supabase dashboard CSV imports often create a separate auto-id column
--      and leave the imported id column without a constraint.)
-- ============================================================================

-- If Supabase added its own integer/uuid PK column (commonly named "id" or
-- left unnamed), drop it and promote our text id column instead.
-- This block is safe to run even if id is already the PK.
-- Rename calc_postcode_* columns to plain names so the rest of the script matches.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='Pubs_List'
                AND column_name='calc_postcode_district') THEN
    ALTER TABLE public."Pubs_List" RENAME COLUMN calc_postcode_district TO postcode_district;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='Pubs_List'
                AND column_name='calc_postcode_area') THEN
    ALTER TABLE public."Pubs_List" RENAME COLUMN calc_postcode_area TO postcode_area;
  END IF;
END $$;

DO $$
DECLARE
  v_pk_col  TEXT;
  v_pk_name TEXT;
BEGIN
  -- Find current PK column name (if any)
  SELECT kcu.column_name, tc.constraint_name
    INTO v_pk_col, v_pk_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema    = kcu.table_schema
   WHERE tc.table_schema   = 'public'
     AND tc.table_name     = 'Pubs_List'
     AND tc.constraint_type = 'PRIMARY KEY'
   LIMIT 1;

  -- If no PK at all, just add one on id
  IF v_pk_col IS NULL THEN
    ALTER TABLE public."Pubs_List" ADD PRIMARY KEY (id);

  -- If PK exists but is NOT on id, drop it and add on id
  ELSIF v_pk_col <> 'id' THEN
    EXECUTE format('ALTER TABLE public."Pubs_List" DROP CONSTRAINT %I', v_pk_name);
    ALTER TABLE public."Pubs_List" ADD PRIMARY KEY (id);

  -- Else id is already the PK — nothing to do
  END IF;
END $$;


-- ============================================================================
-- A. Row Level Security for Pubs_List
-- ============================================================================

ALTER TABLE public."Pubs_List" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pub_list_public_read" ON public."Pubs_List";
CREATE POLICY "pub_list_public_read"
  ON public."Pubs_List"
  FOR SELECT
  TO anon, authenticated
  USING (true);


-- ============================================================================
-- B. Rewire pub_id columns to TEXT → pub_list(id)
--
-- ⚠ TRUNCATES visited_pubs, favorite_pubs, pub_drinks, pub_reviews first.
--   If you have real user data to keep, stop here and migrate rows manually.
-- ============================================================================

-- visited_pubs
ALTER TABLE public.visited_pubs DROP CONSTRAINT IF EXISTS visited_pubs_pub_id_fkey;
TRUNCATE public.visited_pubs;
ALTER TABLE public.visited_pubs ALTER COLUMN pub_id TYPE TEXT USING pub_id::TEXT;
ALTER TABLE public.visited_pubs
  ADD CONSTRAINT visited_pubs_pub_id_fkey
  FOREIGN KEY (pub_id) REFERENCES public."Pubs_List"(id) ON DELETE CASCADE;

-- favorite_pubs
ALTER TABLE public.favorite_pubs DROP CONSTRAINT IF EXISTS favorite_pubs_pub_id_fkey;
TRUNCATE public.favorite_pubs;
ALTER TABLE public.favorite_pubs ALTER COLUMN pub_id TYPE TEXT USING pub_id::TEXT;
ALTER TABLE public.favorite_pubs
  ADD CONSTRAINT favorite_pubs_pub_id_fkey
  FOREIGN KEY (pub_id) REFERENCES public."Pubs_List"(id) ON DELETE CASCADE;

-- pub_drinks (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pub_drinks' AND table_schema = 'public') THEN
    ALTER TABLE public.pub_drinks DROP CONSTRAINT IF EXISTS pub_drinks_pub_id_fkey;
    TRUNCATE public.pub_drinks;
    ALTER TABLE public.pub_drinks ALTER COLUMN pub_id TYPE TEXT USING pub_id::TEXT;
    ALTER TABLE public.pub_drinks
      ADD CONSTRAINT pub_drinks_pub_id_fkey
      FOREIGN KEY (pub_id) REFERENCES public."Pubs_List"(id) ON DELETE CASCADE;
  END IF;
END $$;

-- pub_reviews (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pub_reviews' AND table_schema = 'public') THEN
    ALTER TABLE public.pub_reviews DROP CONSTRAINT IF EXISTS pub_reviews_pub_id_fkey;
    TRUNCATE public.pub_reviews;
    ALTER TABLE public.pub_reviews ALTER COLUMN pub_id TYPE TEXT USING pub_id::TEXT;
    ALTER TABLE public.pub_reviews
      ADD CONSTRAINT pub_reviews_pub_id_fkey
      FOREIGN KEY (pub_id) REFERENCES public."Pubs_List"(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Also update the trigger / function that auto-updates user_stats on visit insert/delete.
-- The trigger itself is fine; the function it calls (compute_user_stats) is replaced in step D.


-- ============================================================================
-- C. search_pubs — reads pub_list, id is TEXT
-- ============================================================================

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
  WHERE pl.name ILIKE '%' || p_query || '%'
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


-- ============================================================================
-- D. compute_user_stats — reads pub_list
--    pub_list has no `points` column yet, defaults all pubs to 10 pts.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compute_user_stats(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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
  SELECT COUNT(*)
    INTO v_pubs_visited
    FROM public.visited_pubs
   WHERE user_id = p_user_id;

  -- pub_list has no points column yet; default 10 per visited pub
  SELECT COALESCE(COUNT(*) * 10, 0)::INT
    INTO v_pub_points
    FROM public.visited_pubs vp
    JOIN public."Pubs_List" pl ON pl.id = vp.pub_id
   WHERE vp.user_id = p_user_id;

  WITH effective_pubs AS (
    SELECT
      pl.id,
      COALESCE(NULLIF(TRIM(pl.postcode_district), ''), 'Unknown') AS effective_district,
      COALESCE(NULLIF(TRIM(pl.postcode_area), ''), 'Unknown') AS effective_area
    FROM public."Pubs_List" pl
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
      pl.id,
      COALESCE(NULLIF(TRIM(pl.postcode_area), ''), 'Unknown') AS effective_area
    FROM public."Pubs_List" pl
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
           ), 0)::INT
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

GRANT EXECUTE ON FUNCTION public.compute_user_stats(UUID) TO authenticated;


-- ============================================================================
-- E. get_area_stats — postcode district stats, reads pub_list
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_area_stats(UUID) CASCADE;

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
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
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
  ORDER BY district;
$$;

GRANT EXECUTE ON FUNCTION public.get_area_stats(UUID) TO authenticated;


-- ============================================================================
-- F. get_borough_stats — postcode area stats, reads pub_list
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_borough_stats(UUID) CASCADE;

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
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
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


-- ============================================================================
-- G. get_achievements — reads pub_list (pub milestones: run create_pub_achievements_table.sql)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_achievements(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_score            INT;
  v_level                  INT;
  v_pubs_visited           INT;
  v_district_trophies      JSONB;
  v_postcode_area_trophies JSONB;
BEGIN
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

  v_total_score  := COALESCE(v_total_score, 0);
  v_level        := COALESCE(v_level, 1);
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

  RETURN jsonb_build_object(
    'totalScore',           v_total_score,
    'level',                v_level,
    'pubsVisited',          v_pubs_visited,
    'districtTrophies',     v_district_trophies,
    'postcodeAreaTrophies', v_postcode_area_trophies,
    'pubAchievements',      '[]'::JSONB
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_achievements(UUID) TO authenticated;
