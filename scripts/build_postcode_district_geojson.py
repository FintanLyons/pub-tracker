#!/usr/bin/env python3
"""
Normalize sjwhitworth/london_geojson london_postcodes.json for Pub Tracker.

- Adds properties.name from Name (district code, e.g. E2, SW1)
- Adds properties.postcode_area (letters only, e.g. E, SW)
- Writes data/geo/london_postcode_districts.min.json

Usage:
  curl -sL -o /tmp/london_postcodes.json \
    https://raw.githubusercontent.com/sjwhitworth/london_geojson/master/london_postcodes.json
  python3 scripts/build_postcode_district_geojson.py /tmp/london_postcodes.json
  python3 scripts/generate_postcode_district_display_names.py
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "geo" / "london_postcode_districts.min.json"

AREA_PREFIX = re.compile(r"^([A-Z]+)")


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/london_postcodes.json")
    if not src.is_file():
        print(f"Missing input GeoJSON: {src}", file=sys.stderr)
        sys.exit(1)

    data = json.loads(src.read_text(encoding="utf-8"))
    features = data.get("features") or []
    out_features = []
    for f in features:
        props = dict(f.get("properties") or {})
        name = (props.get("Name") or props.get("name") or "").strip().upper()
        if not name:
            continue
        m = AREA_PREFIX.match(name)
        area = m.group(1) if m else ""
        props["name"] = name
        props["postcode_area"] = area
        out_features.append(
            {
                "type": "Feature",
                "properties": props,
                "geometry": f.get("geometry"),
            }
        )

    out = {"type": "FeatureCollection", "features": out_features}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(out_features)} features to {OUT}")


if __name__ == "__main__":
    main()
