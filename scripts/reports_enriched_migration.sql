-- ============================================================================
-- Enriched pub reports (missing pub + correction) — run in Supabase SQL editor
-- Adds structured fields and photo URLs. Existing app columns stay compatible.
-- ============================================================================

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS reporter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS report_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reports_report_type_check'
  ) THEN
    ALTER TABLE public.reports ADD CONSTRAINT reports_report_type_check
    CHECK (report_type IS NULL OR report_type IN ('missing_pub', 'pub_correction'));
  END IF;
END $$;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS chain_or_independent text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS pub_address text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS website text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS reporter_description text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS history text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS features_snapshot jsonb;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS photo_urls text[];

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS closing_time text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS founded text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS reporter_username text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz DEFAULT now();

COMMENT ON COLUMN public.reports.report_type IS 'missing_pub | pub_correction';
COMMENT ON COLUMN public.reports.features_snapshot IS 'Feature label -> boolean as submitted by reporter';
COMMENT ON COLUMN public.reports.photo_urls IS 'Public or signed URLs after storage upload';
COMMENT ON COLUMN public.reports.reporter_id IS 'auth.users.id; join public.users(id) for profile fields';
COMMENT ON COLUMN public.reports.reporter_username IS 'Denormalized public.users.username at submit time (nullable if unset)';
COMMENT ON COLUMN public.reports.submitted_at IS 'Server timestamp when the report row was created';
COMMENT ON COLUMN public.reports.closing_time IS 'Reporter-supplied typical closing time (free text, e.g. 23:00)';
COMMENT ON COLUMN public.reports.founded IS 'Four-digit year from reporter (app picker); text column for flexibility';
COMMENT ON COLUMN public.reports.history IS 'Pub history narrative (matches card; same idea as pubs_all.description where used as long copy)';
COMMENT ON COLUMN public.reports.reporter_description IS 'Legacy: earlier app used this for free text; prefer history column';

-- Optional: validate constraint after backfill
-- ALTER TABLE public.reports VALIDATE CONSTRAINT reports_report_type_check;

-- ============================================================================
-- Storage: report photos (run once)
-- ============================================================================
-- 1. In Dashboard: Storage → New bucket → id: report-photos → Public bucket: ON
--    Or SQL:
--
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('report-photos', 'report-photos', true)
-- ON CONFLICT (id) DO NOTHING;
--
-- 2. Policies (authenticated users upload only under their user id folder):
--
-- CREATE POLICY "report_photos_insert_own"
-- ON storage.objects FOR INSERT TO authenticated
-- WITH CHECK (
--   bucket_id = 'report-photos'
--   AND (storage.foldername(name))[1] = auth.uid()::text
-- );
--
-- CREATE POLICY "report_photos_select_public"
-- ON storage.objects FOR SELECT TO public
-- USING (bucket_id = 'report-photos');
--
-- CREATE POLICY "report_photos_delete_own"
-- ON storage.objects FOR DELETE TO authenticated
-- USING (
--   bucket_id = 'report-photos'
--   AND (storage.foldername(name))[1] = auth.uid()::text
-- );
