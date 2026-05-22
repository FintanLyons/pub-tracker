-- ============================================================================
-- Parse postcode_district / postcode_area on report apply (Pubs_List insert/update)
-- ============================================================================
-- Run in Supabase SQL Editor. Safe to re-run.
--
-- Fixes apply when legacy report columns are empty but newer equivalents exist:
--   postcode → postcode_district / postcode_area (uk_postcode_parts)
--   history OR reporter_description → Pubs_List.description
-- ============================================================================

CREATE OR REPLACE FUNCTION public.uk_postcode_parts(p_postcode text)
RETURNS TABLE (
  postcode_district text,
  postcode_area text
)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH normalized AS (
    SELECT upper(regexp_replace(trim(p_postcode), '\s+', '', 'g')) AS c
  ),
  split AS (
    SELECT left(c, length(c) - 3) AS outward
    FROM normalized
    WHERE c IS NOT NULL
      AND length(c) >= 5
      AND right(c, 3) ~ '^[0-9][A-Z]{2}$'
      AND left(c, length(c) - 3) ~ '^[A-Z]{1,2}[0-9][0-9A-Z]?$'
  )
  SELECT
    split.outward AS postcode_district,
    (regexp_match(split.outward, '^([A-Z]+)'))[1] AS postcode_area
  FROM split;
$$;

COMMENT ON FUNCTION public.uk_postcode_parts(text) IS
  'Outward code + letter area from a UK postcode, e.g. SW1A 1AA → SW1A, SW.';

-- Re-apply apply_report_to_pub with postcode parsing (merge with rollback_fixes version)

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
  v_postcode_district text;
  v_postcode_area text;
  v_description text;
BEGIN
  SELECT * INTO r FROM public.reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found';
  END IF;

  IF r.applied_at IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(NULLIF(trim(r.postcode_district), ''), p.postcode_district),
    COALESCE(NULLIF(trim(r.postcode_area), ''), p.postcode_area)
    INTO v_postcode_district, v_postcode_area
    FROM public.uk_postcode_parts(r.postcode) p;

  v_description := COALESCE(
    NULLIF(trim(r.history), ''),
    NULLIF(trim(r.reporter_description), '')
  );

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
      r.addr_housenumber, r.addr_street, v_postcode_district, v_postcode_area,
      r.website, r.phone, r.founded, v_description, r.closing_time, true,
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
           postcode_district = v_postcode_district,
           postcode_area = v_postcode_area,
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
    postcode_district = COALESCE(v_postcode_district, pl.postcode_district),
    postcode_area = COALESCE(v_postcode_area, pl.postcode_area),
    website = COALESCE(r.website, pl.website),
    phone = COALESCE(r.phone, pl.phone),
    founded = COALESCE(r.founded, pl.founded),
    description = COALESCE(v_description, pl.description),
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
     SET postcode_district = COALESCE(v_postcode_district, postcode_district),
         postcode_area = COALESCE(v_postcode_area, postcode_area),
         applied_at = now(),
         apply_error = NULL
   WHERE id = p_report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_report_to_pub(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_report_to_pub(uuid) TO service_role;
