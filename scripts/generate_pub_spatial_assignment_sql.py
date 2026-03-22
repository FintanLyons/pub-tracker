import json, os, textwrap
from datetime import datetime, timezone

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
REPORT_PATH = '/tmp/pubs_spatial_assignment_report.json'
PUBS_PATH = '/tmp/pubs_all_full.json'

report = json.load(open(REPORT_PATH))
pubs = {row['id']: row for row in json.load(open(PUBS_PATH))}
rows = []
for r in report:
    p = pubs.get(r['id'], {})
    ward_id = r.get('ward_id')
    borough_id = r.get('borough_id')
    rows.append({
        'pub_id': r['id'],
        'pub_name': r.get('name'),
        'lat': p.get('lat'),
        'lon': p.get('lon'),
        'current_area': r.get('current_area'),
        'current_borough': r.get('current_borough'),
        'corrected_ward_name': r.get('ward_name'),
        'corrected_ward_id': ward_id,
        'corrected_borough_name': r.get('borough_name'),
        'corrected_borough_id': borough_id,
        'assignment_status': 'inside_supported_polygons' if ward_id and borough_id else 'outside_supported_polygons',
        'borough_changed': bool(borough_id and (r.get('current_borough') or '').strip() != (r.get('borough_name') or '').strip()),
        'ward_name_matches_existing_area': bool(ward_id and (r.get('current_area') or '').strip() == (r.get('ward_name') or '').strip()),
    })

def sql_str(v):
    if v is None:
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"

def sql_num(v):
    if v is None:
        return 'NULL'
    return str(v)

def sql_bool(v):
    return 'TRUE' if v else 'FALSE'

create_sql = textwrap.dedent("""
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
""").strip() + "
"

values = []
for row in rows:
    values.append('(' + ', '.join([
        sql_str(row['pub_id']),
        sql_str(row['pub_name']),
        sql_num(row['lat']),
        sql_num(row['lon']),
        sql_str(row['current_area']),
        sql_str(row['current_borough']),
        sql_str(row['corrected_ward_name']),
        sql_str(row['corrected_ward_id']),
        sql_str(row['corrected_borough_name']),
        sql_str(row['corrected_borough_id']),
        sql_str(row['assignment_status']),
        sql_bool(row['borough_changed']),
        sql_bool(row['ward_name_matches_existing_area']),
        sql_str('point_in_polygon'),
        sql_str('data/geo/london_wards.min.json + data/geo/london_boroughs.min.json'),
        'NOW()'
    ]) + ')')

chunks = []
chunk_size = 250
for i in range(0, len(values), chunk_size):
    chunk = values[i:i + chunk_size]
    stmt = 'INSERT INTO public.pub_spatial_assignments (
  pub_id, pub_name, lat, lon, current_area, current_borough,
  corrected_ward_name, corrected_ward_id, corrected_borough_name, corrected_borough_id,
  assignment_status, borough_changed, ward_name_matches_existing_area, assignment_method, geometry_source, computed_at
) VALUES
  ' + ',
  '.join(chunk) + '
ON CONFLICT (pub_id) DO UPDATE SET
  pub_name = EXCLUDED.pub_name,
  lat = EXCLUDED.lat,
  lon = EXCLUDED.lon,
  current_area = EXCLUDED.current_area,
  current_borough = EXCLUDED.current_borough,
  corrected_ward_name = EXCLUDED.corrected_ward_name,
  corrected_ward_id = EXCLUDED.corrected_ward_id,
  corrected_borough_name = EXCLUDED.corrected_borough_name,
  corrected_borough_id = EXCLUDED.corrected_borough_id,
  assignment_status = EXCLUDED.assignment_status,
  borough_changed = EXCLUDED.borough_changed,
  ward_name_matches_existing_area = EXCLUDED.ward_name_matches_existing_area,
  assignment_method = EXCLUDED.assignment_method,
  geometry_source = EXCLUDED.geometry_source,
  computed_at = NOW();
'
    chunks.append(stmt)
load_sql = '-- Generated from /tmp/pubs_spatial_assignment_report.json and /tmp/pubs_all_full.json
-- Generated at: ' + datetime.now(timezone.utc).isoformat() + '

TRUNCATE public.pub_spatial_assignments;

' + '
'.join(chunks)

verify_sql = textwrap.dedent("""
    -- Sanity checks for public.pub_spatial_assignments

    SELECT COUNT(*) AS total_rows FROM public.pub_spatial_assignments;

    SELECT assignment_status, COUNT(*) AS row_count
    FROM public.pub_spatial_assignments
    GROUP BY assignment_status
    ORDER BY assignment_status;

    SELECT COUNT(*) AS borough_changed_count
    FROM public.pub_spatial_assignments
    WHERE borough_changed IS TRUE;

    SELECT COUNT(*) AS ward_name_matches_existing_area_count
    FROM public.pub_spatial_assignments
    WHERE ward_name_matches_existing_area IS TRUE;

    SELECT pub_name, current_borough, corrected_borough_name, current_area, corrected_ward_name
    FROM public.pub_spatial_assignments
    WHERE borough_changed IS TRUE
    ORDER BY pub_name
    LIMIT 25;

    SELECT pub_name, current_borough, current_area
    FROM public.pub_spatial_assignments
    WHERE assignment_status = 'outside_supported_polygons'
    ORDER BY pub_name
    LIMIT 25;
""").strip() + "
"

scripts_dir = os.path.join(REPO, 'scripts')
os.makedirs(scripts_dir, exist_ok=True)
open(os.path.join(scripts_dir, 'create_pub_spatial_assignments.sql'), 'w').write(create_sql)
open(os.path.join(scripts_dir, 'load_pub_spatial_assignments.sql'), 'w').write(load_sql)
open(os.path.join(scripts_dir, 'verify_pub_spatial_assignments.sql'), 'w').write(verify_sql)
print('Wrote SQL artifacts to', scripts_dir)
