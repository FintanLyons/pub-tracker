-- =============================================================================
-- Pub rating summaries view — audit Batch 5 (2026-09-26)
-- =============================================================================
-- Run once in the Supabase SQL editor (paste the WHOLE file, nothing highlighted).
-- Rollback: scripts/pub_rating_summaries_view_2026_09_rollback.sql
--
-- WHY: the app downloaded every row of pub_reviews to compute star averages for
-- the map's rating filter. This view returns one row per reviewed pub instead.
--
-- EFFECT: adds a read-only view; no existing table or data changes.
-- security_invoker = true → it applies the caller's RLS on pub_reviews (reviews
-- are publicly readable, so the numbers are the same for everyone).
-- The app falls back to the old method if this view does not exist yet.
-- =============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.pub_rating_summaries
  WITH (security_invoker = true) AS
SELECT
  pub_id,
  avg(rating)::double precision AS avg_rating,
  count(*)::integer             AS review_count
FROM public.pub_reviews
GROUP BY pub_id;

COMMENT ON VIEW public.pub_rating_summaries IS
  'Average star rating and review count per pub (map rating filter).';

-- Supabase auto-grants new relations to anon/authenticated; allow read-only for signed-in users.
REVOKE ALL ON public.pub_rating_summaries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pub_rating_summaries TO authenticated;

COMMIT;
