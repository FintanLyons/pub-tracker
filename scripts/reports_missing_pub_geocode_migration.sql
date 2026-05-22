-- ============================================================================
-- missing_pub apply: geocode address on approval → insert Pubs_List row
-- ============================================================================
-- Run in Supabase SQL Editor AFTER pubs_list_is_active_migration.sql (or equivalent
-- apply_report_to_pub with is_active support).
--
-- Requires synchronous HTTP inside the approve trigger:
--   • Run scripts/reports_apply_rollback_fixes.sql after this file (uses extensions.http).
--   • pg_net does NOT work in triggers (requests only run after COMMIT).
--   • Enable "http" extension in Dashboard → Database → Extensions if CREATE EXTENSION fails.
--
-- App must send addr_housenumber, addr_street, postcode for missing_pub reports.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- --- URL helper for query strings ------------------------------------------------

CREATE OR REPLACE FUNCTION public.uri_component(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  c text;
  result text := '';
  b bytea;
  i int;
BEGIN
  IF p IS NULL THEN
    RETURN '';
  END IF;

  FOR c IN SELECT regexp_split_to_table(p, '') LOOP
    IF c ~ '^[-_.~0-9A-Za-z]$' THEN
      result := result || c;
    ELSIF c = ' ' THEN
      result := result || '+';
    ELSE
      b := convert_to(c, 'UTF8');
      FOR i IN 0 .. octet_length(b) - 1 LOOP
        result := result || '%' || upper(lpad(to_hex(get_byte(b, i)), 2, '0'));
      END LOOP;
    END IF;
  END LOOP;

  RETURN result;
END;
$$;

-- --- Synchronous GET via pg_net (poll net._http_response) -----------------------

CREATE OR REPLACE FUNCTION public.net_http_get_text(
  p_url text,
  p_timeout_ms int DEFAULT 10000
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_request_id bigint;
  v_response record;
  v_elapsed int := 0;
  v_headers jsonb := jsonb_build_object(
    'User-Agent', 'PubTracker/1.0 (missing-pub geocode; contact: admin@pubtracker.app)',
    'Accept', 'application/json'
  );
BEGIN
  SELECT net.http_get(url := p_url, headers := v_headers)
    INTO v_request_id;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'pg_net failed to enqueue HTTP GET';
  END IF;

  LOOP
    SELECT id, status_code, content, error_msg, timed_out
      INTO v_response
      FROM net._http_response
     WHERE id = v_request_id;

    IF FOUND THEN
      IF COALESCE(v_response.timed_out, false) THEN
        RAISE EXCEPTION 'HTTP timeout (pg_net)';
      END IF;
      IF v_response.error_msg IS NOT NULL AND trim(v_response.error_msg) <> '' THEN
        RAISE EXCEPTION 'HTTP error: %', v_response.error_msg;
      END IF;
      IF v_response.status_code IS NULL OR v_response.status_code < 200 OR v_response.status_code >= 300 THEN
        RAISE EXCEPTION 'HTTP status % from %', COALESCE(v_response.status_code::text, 'null'), p_url;
      END IF;
      RETURN v_response.content;
    END IF;

    PERFORM pg_sleep(0.05);
    v_elapsed := v_elapsed + 50;
    IF v_elapsed >= p_timeout_ms THEN
      RAISE EXCEPTION 'HTTP timeout after % ms', p_timeout_ms;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.net_http_get_text(text, int) FROM PUBLIC;

-- --- Geocode UK address (house number + street + postcode) ----------------------

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
SET search_path = public, extensions, net, pg_temp
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

  -- 1) Nominatim structured search (best for full address)
  v_url :=
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb'
    || '&street=' || public.uri_component(v_street_line)
    || '&postalcode=' || public.uri_component(v_postcode);

  BEGIN
    v_body := public.net_http_get_text(v_url);
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

  -- 2) Nominatim free-text query
  v_url :=
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb'
    || '&q=' || public.uri_component(v_street_line || ', ' || v_postcode || ', UK');

  BEGIN
    v_body := public.net_http_get_text(v_url);
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

  -- 3) postcodes.io centroid (approximate fallback)
  v_url := 'https://api.postcodes.io/postcodes/' || replace(v_postcode, ' ', '');

  BEGIN
    v_body := public.net_http_get_text(v_url);
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

-- --- Apply: pub_correction + missing_pub --------------------------------------

CREATE OR REPLACE FUNCTION public.apply_report_to_pub(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
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

    -- Distinct from OSM imports (node/, way/) and manual UUID inserts
    v_new_pub_id := 'submission/' || gen_random_uuid()::text;

    INSERT INTO public."Pubs_List" (
      id,
      name,
      lat,
      lon,
      ownership,
      addr_housenumber,
      addr_street,
      postcode_district,
      postcode_area,
      website,
      phone,
      founded,
      description,
      opening_hours,
      is_active,
      has_pub_garden,
      has_live_music,
      has_food_available,
      has_dog_friendly,
      has_pool_darts,
      has_accommodation,
      has_live_sport,
      photo_url1,
      photo_url2,
      photo_url3,
      photo_url4,
      photo_url5
    ) VALUES (
      v_new_pub_id,
      COALESCE(NULLIF(trim(r.pub_name), ''), 'Unknown Pub'),
      v_lat,
      v_lon,
      r.chain_or_independent,
      r.addr_housenumber,
      r.addr_street,
      r.postcode_district,
      r.postcode_area,
      r.website,
      r.phone,
      r.founded,
      r.history,
      r.closing_time,
      true,
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

COMMENT ON FUNCTION public.geocode_uk_address(text, text, text) IS
  'Geocode UK pub address for missing_pub apply. Nominatim first, postcodes.io postcode centroid fallback.';
