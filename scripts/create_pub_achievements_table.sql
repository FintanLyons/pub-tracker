-- ============================================================================
-- pub_achievements — sparse milestone rows (most pubs have none)
-- ============================================================================
-- Run once in Supabase SQL Editor after Pubs_List + pub_list_migration.sql.
--
-- Adds:
--   • public.pub_achievements (FK → Pubs_List.id)
--   • RLS: public read, no client writes
--   • get_achievements: Milestones tab reads this table
--   • compute_user_stats: adds bonus points for earned milestones (visited pub)
--   • Optional backfill from pubs_all.achievement when that column exists
--
-- Manage data via SQL Editor / service role, e.g.:
--   INSERT INTO public.pub_achievements (pub_id, title, points)
--   VALUES ('738', 'CAMRA Greater London Pub of the Year 2018', 25);
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pub_achievements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pub_id       TEXT NOT NULL REFERENCES public."Pubs_List"(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  points       INT NOT NULL DEFAULT 0,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pub_achievements_title_nonempty CHECK (TRIM(title) <> ''),
  CONSTRAINT pub_achievements_points_nonneg CHECK (points >= 0)
);

-- If the table already exists without points (earlier run of this script):
ALTER TABLE public.pub_achievements
  ADD COLUMN IF NOT EXISTS points INT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pub_achievements_points_nonneg'
       AND conrelid = 'public.pub_achievements'::regclass
  ) THEN
    ALTER TABLE public.pub_achievements
      ADD CONSTRAINT pub_achievements_points_nonneg CHECK (points >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pub_achievements_pub_id
  ON public.pub_achievements(pub_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pub_achievements_pub_title
  ON public.pub_achievements(pub_id, lower(trim(title)));

COMMENT ON TABLE public.pub_achievements IS
  'Optional pub milestones (CAMRA awards, etc.). One row per award; most pubs have no rows.';
COMMENT ON COLUMN public.pub_achievements.title IS
  'Short label shown on the trophy and pub card (e.g. CAMRA Pub of the Year 2018).';
COMMENT ON COLUMN public.pub_achievements.description IS
  'Optional subtitle; defaults to pub name in get_achievements when null.';
COMMENT ON COLUMN public.pub_achievements.points IS
  'Bonus score when the user has visited pub_id (0 = display-only milestone). Stacks per row if a pub has several awards.';

-- ---------------------------------------------------------------------------
-- 2. RLS — readable by app; writes via dashboard / service role only
-- ---------------------------------------------------------------------------

ALTER TABLE public.pub_achievements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pub_achievements_public_read" ON public.pub_achievements;
CREATE POLICY "pub_achievements_public_read"
  ON public.pub_achievements
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- 3. Backfill from legacy pubs_all.achievement (safe if column/table missing)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'pubs_all'
       AND column_name = 'achievement'
  ) THEN
    INSERT INTO public.pub_achievements (pub_id, title)
    SELECT pl.id, TRIM(pa.achievement)
      FROM public.pubs_all pa
      JOIN public."Pubs_List" pl
        ON pl.id = COALESCE(NULLIF(TRIM(pa.legacy_id::TEXT), ''), pa.id::TEXT)
     WHERE pa.achievement IS NOT NULL
       AND TRIM(pa.achievement) <> ''
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. compute_user_stats — include earned pub_achievements bonus points
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.compute_user_stats(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pubs_visited          INT;
  v_pub_points            INT;
  v_achievement_points    INT;
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
                 + v_achievement_points
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

-- Recompute all users so new achievement points apply (safe on small user bases)
DO $$
DECLARE
  uid UUID;
BEGIN
  FOR uid IN SELECT DISTINCT user_id FROM public.visited_pubs LOOP
    PERFORM public.compute_user_stats(uid);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. get_achievements — geography from Pubs_List; milestones from pub_achievements
-- ---------------------------------------------------------------------------

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
