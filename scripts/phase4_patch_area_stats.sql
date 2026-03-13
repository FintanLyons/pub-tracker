-- ============================================================================
-- PHASE 4 PATCH: Add center coordinates to get_area_stats
-- ============================================================================
-- Run in Supabase Dashboard → SQL Editor → New query
--
-- Must DROP first because CREATE OR REPLACE cannot change return columns.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_area_stats(UUID);

CREATE OR REPLACE FUNCTION public.get_area_stats(p_user_id UUID)
RETURNS TABLE (
  area        TEXT,
  borough     TEXT,
  total       BIGINT,
  visited     BIGINT,
  percentage  INT,
  center_lat  DOUBLE PRECISION,
  center_lon  DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH visited_ids AS (
    SELECT pub_id FROM public.visited_pubs WHERE user_id = p_user_id
  )
  SELECT
    COALESCE(NULLIF(TRIM(pa.area), ''), 'Unknown')    AS area,
    MAX(CASE
      WHEN TRIM(pa.borough) <> '' THEN TRIM(pa.borough)
      ELSE NULL
    END)                                               AS borough,
    COUNT(*)::BIGINT                                   AS total,
    COUNT(v.pub_id)::BIGINT                            AS visited,
    CASE WHEN COUNT(*) > 0
      THEN ROUND((COUNT(v.pub_id)::NUMERIC / COUNT(*)) * 100)::INT
      ELSE 0
    END                                                AS percentage,
    AVG(pa.lat::DOUBLE PRECISION)                      AS center_lat,
    AVG(pa.lon::DOUBLE PRECISION)                      AS center_lon
  FROM public.pubs_all pa
  LEFT JOIN visited_ids v ON v.pub_id = pa.id
  GROUP BY COALESCE(NULLIF(TRIM(pa.area), ''), 'Unknown')
  ORDER BY area;
$$;

GRANT EXECUTE ON FUNCTION public.get_area_stats(UUID) TO authenticated;

-- Verify the updated return columns
SELECT
  p.parameter_name,
  p.data_type
FROM information_schema.parameters p
WHERE p.specific_schema = 'public'
  AND p.specific_name LIKE 'get_area_stats%'
  AND p.parameter_mode = 'OUT'
ORDER BY p.ordinal_position;
