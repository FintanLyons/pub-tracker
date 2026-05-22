-- ============================================================================
-- Fix report approve rollback (missing_pub geocode + stats recompute)
-- ============================================================================
-- Run in Supabase SQL Editor AFTER reports_missing_pub_geocode_migration.sql
--
-- Root causes fixed:
--   1. pg_net HTTP does not run until AFTER COMMIT — unusable inside approve trigger.
--      → use synchronous extensions.http_get instead (enable "http" extension).
--   2. compute_user_stats blocks when Dashboard JWT user ≠ reporter_id → rollback.
--      → system bypass flag set by the approve trigger.
--   3. apply errors rolled back entire approve → status stuck pending, no apply_error.
--      → trigger catches apply failures and sets status = apply_failed + apply_error.
--
-- Enable in Dashboard → Database → Extensions → "http" (if CREATE EXTENSION fails).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- --- Synchronous HTTP (works inside triggers; pg_net does not) ----------------

CREATE OR REPLACE FUNCTION public.http_get_text(
  p_url text,
  p_user_agent text DEFAULT 'PubTracker/1.0 (missing-pub geocode)'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_status int;
  v_content text;
BEGIN
  SELECT r.status, r.content
    INTO v_status, v_content
    FROM extensions.http((
      'GET',
      p_url,
      ARRAY[
        extensions.http_header('User-Agent', p_user_agent),
        extensions.http_header('Accept', 'application/json')
      ],
      NULL::text,
      NULL::text
    )::extensions.http_request) AS r;

  IF v_status IS NULL OR v_status < 200 OR v_status >= 300 THEN
    RAISE EXCEPTION 'HTTP status % from %', COALESCE(v_status::text, 'null'), p_url;
  END IF;

  RETURN v_content;
END;
$$;

REVOKE ALL ON FUNCTION public.http_get_text(text, text) FROM PUBLIC;

-- --- Geocode (same logic; synchronous HTTP) -----------------------------------

CREATE OR REPLACE FUNCTION public.geocode_uk_address(
  p_housenumber text,
  p_street text,
  p_postcode text
)
RETURNS TABLE (
  lat double precision,
  lon double precision,
  source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_hn text := NULLIF(trim(p_housenumber), '');
  v_street text := NULLIF(trim(p_street), '');
  v_postcode text := NULLIF(trim(p_postcode), '');
  v_street_line text;
  v_url text;
  v_body text;
  v_json jsonb;
  v_lat double precision;
  v_lon double precision;
BEGIN
  IF v_hn IS NULL THEN
    RAISE EXCEPTION 'house number is required for geocoding';
  END IF;
  IF v_street IS NULL THEN
    RAISE EXCEPTION 'street is required for geocoding';
  END IF;
  IF v_postcode IS NULL THEN
    RAISE EXCEPTION 'postcode is required for geocoding';
  END IF;

  v_street_line := v_hn || ' ' || v_street;

  v_url :=
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb'
    || '&street=' || public.uri_component(v_street_line)
    || '&postalcode=' || public.uri_component(v_postcode);

  BEGIN
    v_body := public.http_get_text(v_url);
    v_json := v_body::jsonb;

    IF jsonb_typeof(v_json) = 'array' AND jsonb_array_length(v_json) > 0 THEN
      v_lat := (v_json->0->>'lat')::double precision;
      v_lon := (v_json->0->>'lon')::double precision;
      IF v_lat IS NOT NULL AND v_lon IS NOT NULL THEN
        lat := v_lat;
        lon := v_lon;
        source := 'nominatim';
        RETURN NEXT;
        RETURN;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  v_url :=
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb'
    || '&q=' || public.uri_component(v_street_line || ', ' || v_postcode || ', UK');

  BEGIN
    v_body := public.http_get_text(v_url);
    v_json := v_body::jsonb;

    IF jsonb_typeof(v_json) = 'array' AND jsonb_array_length(v_json) > 0 THEN
      v_lat := (v_json->0->>'lat')::double precision;
      v_lon := (v_json->0->>'lon')::double precision;
      IF v_lat IS NOT NULL AND v_lon IS NOT NULL THEN
        lat := v_lat;
        lon := v_lon;
        source := 'nominatim_q';
        RETURN NEXT;
        RETURN;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  v_url := 'https://api.postcodes.io/postcodes/' || replace(v_postcode, ' ', '');

  BEGIN
    v_body := public.http_get_text(v_url);
    v_json := v_body::jsonb;

    IF COALESCE(v_json->>'status', '0')::int = 200 THEN
      v_lat := (v_json->'result'->>'latitude')::double precision;
      v_lon := (v_json->'result'->>'longitude')::double precision;
      IF v_lat IS NOT NULL AND v_lon IS NOT NULL THEN
        lat := v_lat;
        lon := v_lon;
        source := 'postcodes.io';
        RETURN NEXT;
        RETURN;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RAISE EXCEPTION 'could not geocode address: %, %, %', v_hn, v_street, v_postcode;
END;
$$;

REVOKE ALL ON FUNCTION public.geocode_uk_address(text, text, text) FROM PUBLIC;

-- --- compute_user_stats: allow trigger / SQL editor backfills -----------------

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
  v_system_recompute            boolean;
BEGIN
  v_system_recompute :=
    COALESCE(current_setting('app.system_stats_recompute', true), '') = 'true';

  IF NOT v_system_recompute
     AND auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM p_user_id THEN
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

-- --- apply_report_to_pub: no EXCEPTION re-raise (trigger handles failures) ----

CREATE OR REPLACE FUNCTION public.apply_report_to_pub(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  r public.reports%ROWTYPE;
  pl public."Pubs_List"%ROWTYPE;
  v_photo_count int;
  v_new_pub_id text;
  v_lat double precision;
  v_lon double precision;
  v_geo_source text;
BEGIN
  SELECT * INTO r FROM public.reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found';
  END IF;

  IF r.applied_at IS NOT NULL THEN
    RETURN;
  END IF;

  v_photo_count := CASE
    WHEN r.photo_urls IS NULL THEN 0
    ELSE LEAST(COALESCE(array_length(r.photo_urls, 1), 0), 5)
  END;

  IF r.report_type = 'missing_pub' THEN
    IF NULLIF(trim(r.addr_housenumber), '') IS NULL THEN
      RAISE EXCEPTION 'missing_pub requires house number (addr_housenumber)';
    END IF;
    IF NULLIF(trim(r.addr_street), '') IS NULL THEN
      RAISE EXCEPTION 'missing_pub requires street (addr_street)';
    END IF;
    IF NULLIF(trim(r.postcode), '') IS NULL THEN
      RAISE EXCEPTION 'missing_pub requires postcode';
    END IF;

    SELECT g.lat, g.lon, g.source
      INTO v_lat, v_lon, v_geo_source
      FROM public.geocode_uk_address(r.addr_housenumber, r.addr_street, r.postcode) g;

    v_new_pub_id := 'submission/' || gen_random_uuid()::text;

    INSERT INTO public."Pubs_List" (
      id, name, lat, lon, ownership,
      addr_housenumber, addr_street, postcode_district, postcode_area,
      website, phone, founded, description, opening_hours, is_active,
      has_pub_garden, has_live_music, has_food_available, has_dog_friendly,
      has_pool_darts, has_accommodation, has_live_sport,
      photo_url1, photo_url2, photo_url3, photo_url4, photo_url5
    ) VALUES (
      v_new_pub_id,
      COALESCE(NULLIF(trim(r.pub_name), ''), 'Unknown Pub'),
      v_lat, v_lon,
      r.chain_or_independent,
      r.addr_housenumber, r.addr_street, r.postcode_district, r.postcode_area,
      r.website, r.phone, r.founded, r.history, r.closing_time, true,
      COALESCE(public.report_feature_bool(r.features_snapshot, 'Pub garden'), false),
      COALESCE(public.report_feature_bool(r.features_snapshot, 'Live music'), false),
      COALESCE(public.report_feature_bool(r.features_snapshot, 'Food available'), false),
      COALESCE(public.report_feature_bool(r.features_snapshot, 'Dog friendly'), false),
      COALESCE(public.report_feature_bool(r.features_snapshot, 'Pool/darts'), false),
      COALESCE(public.report_feature_bool(r.features_snapshot, 'Accommodation'), false),
      COALESCE(public.report_feature_bool(r.features_snapshot, 'Live sport'), false),
      CASE WHEN v_photo_count >= 1 THEN r.photo_urls[1] END,
      CASE WHEN v_photo_count >= 2 THEN r.photo_urls[2] END,
      CASE WHEN v_photo_count >= 3 THEN r.photo_urls[3] END,
      CASE WHEN v_photo_count >= 4 THEN r.photo_urls[4] END,
      CASE WHEN v_photo_count >= 5 THEN r.photo_urls[5] END
    );

    UPDATE public.reports
       SET pub_id = v_new_pub_id,
           applied_at = now(),
           apply_error = NULL
     WHERE id = p_report_id;

    RETURN;
  END IF;

  IF r.report_type <> 'pub_correction' OR r.pub_id IS NULL THEN
    RAISE EXCEPTION 'report is not a pub correction with pub_id';
  END IF;

  SELECT * INTO pl FROM public."Pubs_List" WHERE id = r.pub_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pub not found: %', r.pub_id;
  END IF;

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
END;
$$;

REVOKE ALL ON FUNCTION public.apply_report_to_pub(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_report_to_pub(uuid) TO service_role;

-- --- Approve trigger: persist apply_failed instead of silent rollback ---------

CREATE OR REPLACE FUNCTION public.trg_reports_after_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved'::public.report_status
     AND OLD.status IS DISTINCT FROM 'approved'::public.report_status
     AND NEW.applied_at IS NULL THEN
    PERFORM set_config('app.system_stats_recompute', 'true', true);
    BEGIN
      PERFORM public.apply_report_to_pub(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.reports
         SET status = 'apply_failed'::public.report_status,
             apply_error = SQLERRM
       WHERE id = NEW.id;
      RETURN NEW;
    END;
  END IF;

  IF NEW.reporter_id IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM set_config('app.system_stats_recompute', 'true', true);
    BEGIN
      PERFORM public.compute_user_stats(NEW.reporter_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'compute_user_stats failed for reporter %: %', NEW.reporter_id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;
