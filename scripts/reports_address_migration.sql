-- ============================================================================
-- Structured address fields on pub reports
-- Run in Supabase SQL Editor after reports_enriched_migration.sql
-- ============================================================================

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS addr_housenumber text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS addr_street text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS postcode text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS postcode_district text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS postcode_area text;

COMMENT ON COLUMN public.reports.addr_housenumber IS 'Maps to Pubs_List.addr_housenumber';
COMMENT ON COLUMN public.reports.addr_street IS 'Maps to Pubs_List.addr_street';
COMMENT ON COLUMN public.reports.postcode IS 'Full UK postcode as submitted (normalised in app), e.g. SW1A 1AA';
COMMENT ON COLUMN public.reports.postcode_district IS 'Outward code parsed from postcode, e.g. SW1A';
COMMENT ON COLUMN public.reports.postcode_area IS 'Letter area parsed from postcode, e.g. SW';
COMMENT ON COLUMN public.reports.pub_address IS 'Denormalised audit string: housenumber, street, postcode (newline-separated)';
COMMENT ON COLUMN public.reports.photo_urls IS 'Up to 5 public URLs; maps to Pubs_List.photo_url1..photo_url5 on apply';
