-- ROLLBACK for scripts/pub_rating_summaries_view_2026_09.sql
-- The app automatically falls back to reading pub_reviews directly.

BEGIN;
DROP VIEW IF EXISTS public.pub_rating_summaries;
COMMIT;
