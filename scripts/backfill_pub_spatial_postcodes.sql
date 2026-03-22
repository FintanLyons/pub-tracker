-- ============================================================================
-- Backfill pub_spatial_assignments.postcode_district / postcode_area
-- ============================================================================
-- Run in Supabase SQL Editor (or psql).
--
-- Why columns stay NULL:
--   1. The phase6 UPDATE was never run after adding columns.
--   2. pubs_all.address has no UK postcode the parser can read (or address is empty).
--   3. Rare: no row in pub_spatial_assignments for a pub (run spatial assignment load).
--
-- After SQL backfill, if many rows are still NULL, run:
--   python3 scripts/backfill_spatial_postcodes_from_latlon.py
-- ============================================================================

-- --- Diagnostics (read-only) ------------------------------------------------
-- SELECT COUNT(*) AS assignment_rows FROM public.pub_spatial_assignments;
-- SELECT COUNT(*) AS filled_district
--   FROM public.pub_spatial_assignments WHERE postcode_district IS NOT NULL;
-- SELECT COUNT(*) AS pubs_with_address
--   FROM public.pubs_all WHERE address IS NOT NULL AND trim(address) <> '';
-- SELECT COUNT(*) AS could_parse
-- FROM public.pubs_all pa
-- WHERE EXISTS (
--   SELECT 1 FROM public.uk_postcode_from_address(pa.address) x
--   WHERE x.district IS NOT NULL OR x.area IS NOT NULL
-- );

-- --- Ensure parser exists (same as phase6; safe to re-run) -------------------
CREATE OR REPLACE FUNCTION public.uk_postcode_from_address(p_address TEXT)
RETURNS TABLE(district TEXT, area TEXT)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $func$
  WITH s AS (
    SELECT CASE
      WHEN p_address IS NULL OR length(trim(p_address)) = 0 THEN NULL::text
      ELSE upper(regexp_replace(p_address, E'[\\n\\r\\t]+', ' ', 'g'))
    END AS txt
  ),
  lastm AS (
    SELECT (rm.arr)[1] AS pc
    FROM s
    CROSS JOIN LATERAL regexp_matches(
      s.txt,
      '([A-Z]{1,2}[0-9]{1,2}[A-Z]?\\s?[0-9][A-Z]{2})',
      'gi'
    ) WITH ORDINALITY AS rm(arr, ord)
    ORDER BY rm.ord DESC
    LIMIT 1
  ),
  compact AS (
    SELECT regexp_replace(lastm.pc, '\\s+', '', 'g') AS c
    FROM lastm
    WHERE lastm.pc IS NOT NULL
  ),
  split AS (
    SELECT
      left(c, length(c) - 3) AS outward,
      right(c, 3) AS inward3
    FROM compact
    WHERE length(c) >= 5
      AND right(c, 3) ~ '^[0-9][A-Z]{2}$'
  )
  SELECT
    split.outward AS district,
    (regexp_match(split.outward, '^([A-Z]+)'))[1] AS area
  FROM split;
$func$;

-- --- Populate from pubs_all.address -----------------------------------------
UPDATE public.pub_spatial_assignments psa
SET
  postcode_district = p.district,
  postcode_area = p.area
FROM public.pubs_all pa
LEFT JOIN LATERAL public.uk_postcode_from_address(pa.address) p ON true
WHERE psa.pub_id = pa.id
  AND (p.district IS NOT NULL OR p.area IS NOT NULL);

-- Optional: clear stale values first (only if you need a full re-parse from addresses)
-- UPDATE public.pub_spatial_assignments SET postcode_district = NULL, postcode_area = NULL;

-- If this UPDATE still leaves columns empty (addresses without postcodes), run the Python
-- backfill which uses lat/lon + postcodes.io:
--   pip install supabase python-dotenv requests
--   Set SUPABASE_URL and SUPABASE_KEY in .env  (**service_role** key, not anon)
--   python3 scripts/backfill_spatial_postcodes_from_latlon.py --dry-run --limit 10
--   python3 scripts/backfill_spatial_postcodes_from_latlon.py --delay 0.12
