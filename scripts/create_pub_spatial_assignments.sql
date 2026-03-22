-- Spatially corrected pub-to-ward / pub-to-borough assignments.
-- Non-destructive: this does not modify public.pubs_all.
-- Load this first, then run scripts/load_pub_spatial_assignments.sql.

CREATE TABLE IF NOT EXISTS public.pub_spatial_assignments (
  pub_id UUID PRIMARY KEY REFERENCES public.pubs_all(id) ON DELETE CASCADE,
  pub_name TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  current_area TEXT,
  current_borough TEXT,
  corrected_ward_name TEXT,
  corrected_ward_id TEXT,
  corrected_borough_name TEXT,
  corrected_borough_id TEXT,
  assignment_status TEXT NOT NULL CHECK (
    assignment_status IN ('inside_supported_polygons', 'outside_supported_polygons')
  ),
  borough_changed BOOLEAN NOT NULL DEFAULT FALSE,
  ward_name_matches_existing_area BOOLEAN NOT NULL DEFAULT FALSE,
  assignment_method TEXT NOT NULL DEFAULT 'point_in_polygon',
  geometry_source TEXT NOT NULL DEFAULT 'data/geo/london_wards.min.json + data/geo/london_boroughs.min.json',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pub_spatial_assignments_corrected_ward_id
  ON public.pub_spatial_assignments(corrected_ward_id);

CREATE INDEX IF NOT EXISTS idx_pub_spatial_assignments_corrected_borough_id
  ON public.pub_spatial_assignments(corrected_borough_id);

CREATE INDEX IF NOT EXISTS idx_pub_spatial_assignments_assignment_status
  ON public.pub_spatial_assignments(assignment_status);

COMMENT ON TABLE public.pub_spatial_assignments IS
  'Polygon-based ward and borough assignments for pubs, generated from pub lat/lon against the bundled London ward and borough GeoJSON files.';
