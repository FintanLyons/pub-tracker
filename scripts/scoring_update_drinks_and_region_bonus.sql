-- ============================================================================
-- Scoring update: +1 per drink, postcode area completion +1000 (was +500).
-- ============================================================================
--
-- Safe / non-destructive:
--   - Replaces only RPC bodies and the pub_drinks trigger wiring.
--   - Does NOT truncate, CASCADE-drop, or bulk-update business tables.
--
-- Prerequisites (typical Pub Tracker / phase6 DB):
--   - public.pub_drinks, public.user_stats.total_drinks, public.pub_spatial_assignments
--
-- After run: scores refresh on next visit/drink/recompute. Optional backfill at bottom.
--
-- If you applied scripts/tier2_security_hardening.sql, those functions add an
-- auth.uid() check — merge that block into compute_user_stats / get_achievements
-- after this file, or edit tier2 copies to match this scoring logic.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- compute_user_stats — total_score includes drink counts; area bonus 1000
-- ---------------------------------------------------------------------------

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
  v_total_score           INT;
  v_level                 INT;
  v_total_drinks          INT;
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
-- Drink changes → full recompute (keeps total_score in sync with drinks)
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
-- get_achievements — totalScore / level / pubsVisited from user_stats (Option A)
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

-- ---------------------------------------------------------------------------
-- Optional: backfill user_stats for everyone who has visits OR drinks (uncomment)
-- ---------------------------------------------------------------------------
-- DO $$
-- DECLARE
--   r RECORD;
-- BEGIN
--   FOR r IN
--     SELECT user_id FROM public.visited_pubs
--     UNION
--     SELECT user_id FROM public.pub_drinks
--   LOOP
--     PERFORM public.compute_user_stats(r.user_id);
--   END LOOP;
-- END $$;
