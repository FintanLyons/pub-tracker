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
-- Image uploads (report attachments, future avatars / pub gallery)
-- ============================================================================
-- The app uploads to Cloudflare R2 via the Edge Function presign-r2-upload
-- (see supabase/functions/presign-r2-upload/). Postgres stores public HTTPS
-- URLs only (e.g. reports.photo_urls). Supabase Storage is not required for that flow.
--
-- Cloudflare R2 (one bucket, prefixes: reports/, avatars/, pubs/):
--   1. Create bucket; attach a public access custom domain or R2 public URL.
--   2. CORS: allow PUT + GET from your app; allow Header Content-Type.
--   3. Deploy function: supabase functions deploy presign-r2-upload
--   4. Set secrets (Dashboard → Edge Functions → Secrets, or CLI):
--        R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
--        R2_BUCKET_NAME, R2_PUBLIC_BASE_URL (no trailing slash)
--      Optional: R2_ALLOW_CLIENT_PUB_UPLOAD=true for client pub_gallery presigns.
--   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
