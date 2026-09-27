#!/usr/bin/env python3
"""
Normalize CB postcode district polygons for Pub Tracker.

Source (Wikipedia-derived):
  https://github.com/missinglink/uk-postcode-polygons/blob/master/geojson/CB.geojson

Only districts that appear in our Cambridge pub CSV are included (not the full
royal-mail CB area, which stretches to Ely, Haverhill, etc.).

The low-zoom "CB" area layer uses one Feature per district (not one giant
MultiPolygon) so MapLibre does not draw spurious lines between distant parts.

Outputs:
  data/geo/cambridge_postcode_districts.min.json
  data/geo/cambridge_postcode_areas.min.json
  data/geo/cambridge_postcode_area_label_points.min.json

Usage:
  curl -sL -o /tmp/CB.geojson \\
    https://raw.githubusercontent.com/missinglink/uk-postcode-polygons/master/geojson/CB.geojson
  python3 scripts/build_cambridge_postcode_geojson.py /tmp/CB.geojson
"""

from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DISTRICTS_OUT = ROOT / "data/geo/cambridge_postcode_districts.min.json"
AREAS_OUT = ROOT / "data/geo/cambridge_postcode_areas.min.json"
LABELS_OUT = ROOT / "data/geo/cambridge_postcode_area_label_points.min.json"
PUBS_CSV = ROOT / "data/data_list_cambridge_photos_enriched.csv"

AREA_PREFIX = re.compile(r"^([A-Z]+)")
AREA_CODE = "CB"
# Cambridge city centre — area label anchor (not bbox centre of distant CB districts).
LABEL_LON = 0.1218
LABEL_LAT = 52.2053


def load_pub_districts(csv_path: Path) -> set[str]:
    if not csv_path.is_file():
        return set()
    with csv_path.open(encoding="utf-8") as fh:
        return {
            (row.get("calc_postcode_district") or "").strip().upper()
            for row in csv.DictReader(fh)
            if (row.get("calc_postcode_district") or "").strip()
        }


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/CB.geojson")
    if not src.is_file():
        print(f"Missing input GeoJSON: {src}", file=sys.stderr)
        return 1

    allowed_districts = load_pub_districts(PUBS_CSV)
    if not allowed_districts:
        print(f"WARN: no districts from {PUBS_CSV}; including all CB features", file=sys.stderr)

    data = json.loads(src.read_text(encoding="utf-8"))
    district_features = []
    area_features = []

    for feature in data.get("features") or []:
        props = dict(feature.get("properties") or {})
        name = (props.get("name") or props.get("Name") or "").strip().upper()
        geometry = feature.get("geometry")
        if not name or not geometry:
            continue
        if allowed_districts and name not in allowed_districts:
            continue

        match = AREA_PREFIX.match(name)
        area = match.group(1) if match else AREA_CODE
        props["name"] = name
        props["postcode_area"] = area
        district_features.append(
            {
                "type": "Feature",
                "properties": props,
                "geometry": geometry,
            }
        )
        area_features.append(
            {
                "type": "Feature",
                "properties": {"postcode_area": AREA_CODE, "name": AREA_CODE},
                "geometry": geometry,
            }
        )

    if not district_features:
        print("No district features parsed", file=sys.stderr)
        return 1

    DISTRICTS_OUT.parent.mkdir(parents=True, exist_ok=True)
    DISTRICTS_OUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": district_features}, separators=(",", ":")),
        encoding="utf-8",
    )

    AREAS_OUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": area_features}, separators=(",", ":")),
        encoding="utf-8",
    )

    LABELS_OUT.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"postcode_area": AREA_CODE, "name": AREA_CODE},
                        "geometry": {"type": "Point", "coordinates": [LABEL_LON, LABEL_LAT]},
                    }
                ],
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    print(f"Wrote {len(district_features)} district features -> {DISTRICTS_OUT}")
    print(f"  districts: {', '.join(f['properties']['name'] for f in district_features)}")
    print(f"Wrote {len(area_features)} area features (one per district) -> {AREAS_OUT}")
    print(f"Wrote 1 label point at Cambridge centre -> {LABELS_OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
