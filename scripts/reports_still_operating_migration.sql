-- Optional: run in Supabase SQL editor after deploying the app change that sends still_operating.
-- Stores whether the reporter says the pub is still trading vs permanently closed (not opening hours).

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS still_operating boolean;

COMMENT ON COLUMN public.reports.still_operating IS
  'pub_correction: true = still operating as a pub, false = permanently closed / no longer a pub at this listing. NULL = legacy row or missing_pub.';
