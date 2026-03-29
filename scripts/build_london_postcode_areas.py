#!/usr/bin/env python3
"""
Merge london_postcode_districts into one polygon (MultiPolygon) per postcode_area
(E, EC, N, NW, SE, SW, W, WC) using Shapely — fixes bad/incomplete Turf unions.

Also emits one Point per area at representative_point() for exactly one map label each.

  pip install shapely
  python3 scripts/build_london_postcode_areas.py

Outputs:
  data/geo/london_postcode_areas.min.json           — polygon features only
  data/geo/london_postcode_area_label_points.min.json — Point features (postcode_area)
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
DISTRICTS_PATH = ROOT / "data/geo/london_postcode_districts.min.json"
OUT_POLYS_PATH = ROOT / "data/geo/london_postcode_areas.min.json"
OUT_LABELS_PATH = ROOT / "data/geo/london_postcode_area_label_points.min.json"


def main() -> int:
    if not DISTRICTS_PATH.is_file():
        print(f"Missing {DISTRICTS_PATH}", file=sys.stderr)
        return 1

    data = json.loads(DISTRICTS_PATH.read_text(encoding="utf-8"))
    by_area: dict[str, list] = defaultdict(list)

    for feat in data.get("features") or []:
        props = feat.get("properties") or {}
        area = str(props.get("postcode_area") or "").strip()
        if not area:
            continue
        geom = feat.get("geometry")
        if not geom:
            continue
        try:
            by_area[area.upper()].append(shape(geom))
        except Exception as e:
            print(f"skip geometry: {area}: {e}", file=sys.stderr)

    poly_features = []
    label_features = []

    for area_code in sorted(by_area.keys()):
        geoms = by_area[area_code]
        merged = unary_union(geoms)
        if not merged.is_valid:
            merged = merged.buffer(0)
        if merged.is_empty:
            print(f"empty merge for {area_code}", file=sys.stderr)
            continue

        poly_features.append(
            {
                "type": "Feature",
                "properties": {"postcode_area": area_code, "name": area_code},
                "geometry": mapping(merged),
            }
        )

        label_pt = merged.representative_point()
        label_features.append(
            {
                "type": "Feature",
                "properties": {"postcode_area": area_code, "name": area_code},
                "geometry": {"type": "Point", "coordinates": [label_pt.x, label_pt.y]},
            }
        )

    OUT_POLYS_PATH.write_text(
        json.dumps({"type": "FeatureCollection", "features": poly_features}, separators=(",", ":")),
        encoding="utf-8",
    )
    OUT_LABELS_PATH.write_text(
        json.dumps({"type": "FeatureCollection", "features": label_features}, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Wrote {len(poly_features)} area polygons -> {OUT_POLYS_PATH}")
    print(f"Wrote {len(label_features)} label points -> {OUT_LABELS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
