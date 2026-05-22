-- ============================================================================
-- Report approval + apply to Pubs_List
-- ============================================================================
-- Run in Supabase SQL Editor AFTER:
--   • scripts/reports_enriched_migration.sql
--   • scripts/reports_still_operating_migration.sql
--   • scripts/reports_address_migration.sql
--
-- Manual approval: pick status in Table Editor dropdown (see reports_status_enum_migration.sql)
--   or: SELECT approve_report('uuid'); / reject_report('uuid');
-- Points count only for status IN ('approved', 'auto_applied').
--
-- pub_correction: updates existing Pubs_List row (pub_id required).
-- missing_pub: not applied yet (needs lat/lon / geocoding).
-- ============================================================================

-- --- Workflow columns -------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_status') THEN
    CREATE TYPE public.report_status AS ENUM (
      'pending',
      'approved',
      'rejected',
      'auto_applied',
      'apply_failed'
    );
  END IF;
END $$;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS status public.report_status NOT NULL DEFAULT 'pending';

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS apply_error text;

COMMENT ON COLUMN public.reports.status IS
  'Enum: pending | approved | rejected (+ auto_applied, apply_failed). Use Table Editor dropdown after reports_status_enum_migration.sql.';
COMMENT ON COLUMN public.reports.photo_urls IS 'Up to 5 public URLs; on apply maps to Pubs_List.photo_url1..photo_url5';

-- --- Feature snapshot helper (labels match constants/pubFeatureChips.js) ----

CREATE OR REPLACE FUNCTION public.report_feature_bool(p_features jsonb, p_label text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_features IS NULL THEN NULL
    WHEN NOT (p_features ? p_label) THEN NULL
    ELSE COALESCE((p_features->>p_label)::boolean, false)
  END;
$$;

-- --- Apply approved correction to Pubs_List ---------------------------------

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

-- --- Approve trigger (Dashboard: UPDATE status → approved) ------------------

CREATE OR REPLACE FUNCTION public.trg_reports_after_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved'
     AND OLD.status IS DISTINCT FROM 'approved'
     AND NEW.applied_at IS NULL THEN
    PERFORM public.apply_report_to_pub(NEW.id);
  END IF;

  IF NEW.reporter_id IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.compute_user_stats(NEW.reporter_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reports_on_status_change ON public.reports;
DROP TRIGGER IF EXISTS trg_reports_after_status_change ON public.reports;
CREATE TRIGGER trg_reports_after_status_change
  AFTER UPDATE OF status ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_reports_after_status_change();

-- Insert: recompute stats (report starts pending → no contribution points yet)
DROP TRIGGER IF EXISTS trg_reports_recompute_user_stats ON public.reports;

CREATE OR REPLACE FUNCTION public.trg_reports_recompute_user_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reporter_id IS NOT NULL THEN
    PERFORM public.compute_user_stats(NEW.reporter_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reports_recompute_user_stats
  AFTER INSERT ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_reports_recompute_user_stats();

-- --- Scoring: merge into live compute_user_stats ---------------------------
-- If you use scripts/scoring_postcode_district_tiered_bonus.sql (recommended),
-- re-run that file after adding the status filter below to its contribution
-- query, OR run this one-line patch manually:
--
--   WHERE r.reporter_id = p_user_id
--     AND r.status IN ('approved', 'auto_applied');
--
-- See the updated scripts/scoring_postcode_district_tiered_bonus.sql in repo.

-- Backfill: existing reports stay pending (no retroactive points until approved)
UPDATE public.reports SET status = 'pending' WHERE status IS NULL;
