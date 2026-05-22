-- ============================================================================
-- Report status enum — dropdown in Supabase Table Editor (no typing)
-- ============================================================================
-- Run AFTER scripts/reports_apply_migration.sql if status is still text.
--
-- Table Editor: click status cell → pick pending | approved | rejected
-- (auto_applied / apply_failed are system-only; ignore unless resetting)
--
-- Optional one-click in SQL Editor:
--   SELECT public.approve_report('report-uuid-here');
--   SELECT public.reject_report('report-uuid-here');
-- ============================================================================

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

COMMENT ON TYPE public.report_status IS
  'Moderation: pick pending | approved | rejected in Table Editor. auto_applied / apply_failed are set by triggers.';

-- Normalise any bad/NULL values before cast
UPDATE public.reports SET status = 'pending' WHERE status IS NULL;
UPDATE public.reports SET status = 'pending'
 WHERE status NOT IN ('pending', 'approved', 'rejected', 'auto_applied', 'apply_failed');

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_status_check;

-- Must drop trigger that references status before changing column type
DROP TRIGGER IF EXISTS trg_reports_on_status_change ON public.reports;
DROP TRIGGER IF EXISTS trg_reports_after_status_change ON public.reports;

ALTER TABLE public.reports
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.reports
  ALTER COLUMN status TYPE public.report_status
  USING status::public.report_status;

ALTER TABLE public.reports
  ALTER COLUMN status SET DEFAULT 'pending'::public.report_status;

ALTER TABLE public.reports
  ALTER COLUMN status SET NOT NULL;

-- Recreate approve trigger (same logic as reports_apply_migration.sql)
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
    PERFORM public.apply_report_to_pub(NEW.id);
  END IF;

  IF NEW.reporter_id IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.compute_user_stats(NEW.reporter_id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reports_after_status_change
  AFTER UPDATE OF status ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_reports_after_status_change();

COMMENT ON COLUMN public.reports.status IS
  'Enum: use Table Editor dropdown. You usually set pending → approved or rejected.';

-- --- One-click helpers (SQL Editor; not exposed to the mobile app) --------

CREATE OR REPLACE FUNCTION public.approve_report(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.reports
     SET status = 'approved'::public.report_status,
         reviewed_at = COALESCE(reviewed_at, now())
   WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found: %', p_report_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_report(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.reports
     SET status = 'rejected'::public.report_status,
         reviewed_at = COALESCE(reviewed_at, now())
   WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found: %', p_report_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_report(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_report(uuid) FROM PUBLIC;
