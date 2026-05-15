#!/usr/bin/env python3
"""
Fetch OpenStreetMap features tagged ``amenity=pub`` inside a bounding box
(default: Greater London). Uses the public Overpass API (no API key).

This does **not** include ``amenity=bar`` or ``amenity=nightclub`` (those are
separate tags in OSM). Some venues may still be mis-tagged.

Where to run
------------
From the **repository root** (same as other scripts)::

  cd /path/to/pub-tracker
  python3 scripts/fetch_osm_london_pubs.py

Requires **network** access to ``overpass-api.de`` (or use ``--endpoint``).

Outputs (default)
-----------------
  data/osm_london_pubs.json  — raw Overpass elements + summary
  data/osm_london_pubs.csv   — flat table for spreadsheets

Optional: ``--bbox south,west,north,east`` in WGS84 (defaults to Greater London).

Overpass can time out on huge areas; increase ``--timeout`` if needed.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

# Approximate WGS84 bbox for Greater London (south, west, north, east).
DEFAULT_BBOX = (51.286, -0.510, 51.672, 0.335)

DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter"
# Often completes large London queries when .de returns 504 Gateway Timeout.
MIRROR_ENDPOINT = "https://overpass.kumi.systems/api/interpreter"


def build_overpass_query(south: float, west: float, north: float, east: float, timeout: int) -> str:
    # BBox order in Overpass: (south, west, north, east)
    return f"""[out:json][timeout:{timeout}];
(
  node["amenity"="pub"]({south},{west},{north},{east});
  way["amenity"="pub"]({south},{west},{north},{east});
  relation["amenity"="pub"]({south},{west},{north},{east});
);
out center;
"""


def overpass_post(endpoint: str, query: str, user_agent: str) -> Dict[str, Any]:
    body = query.encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": user_agent,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw)


def element_lat_lon(el: Dict[str, Any]) -> Optional[tuple[float, float]]:
    t = el.get("type")
    if t == "node":
        lat, lon = el.get("lat"), el.get("lon")
        if lat is not None and lon is not None:
            return float(lat), float(lon)
        return None
    if t in ("way", "relation"):
        c = el.get("center") or {}
        lat, lon = c.get("lat"), c.get("lon")
        if lat is not None and lon is not None:
            return float(lat), float(lon)
        return None
    return None


def tags_get(tags: Dict[str, str], *keys: str) -> str:
    if not tags:
        return ""
    for k in keys:
        if k in tags and tags[k]:
            return str(tags[k]).strip()
    return ""


def flatten_element(el: Dict[str, Any]) -> Dict[str, Any]:
    tags = el.get("tags") or {}
    latlon = element_lat_lon(el)
    lat, lon = latlon if latlon else (None, None)
    oid = el.get("id")
    et = el.get("type")
    return {
        "osm_type": et,
        "osm_id": oid,
        "id": f"{et}/{oid}" if et and oid is not None else "",
        "lat": lat,
        "lon": lon,
        "name": tags_get(tags, "name"),
        "operator": tags_get(tags, "operator"),
        "brand": tags_get(tags, "brand"),
        "addr_housenumber": tags_get(tags, "addr:housenumber"),
        "addr_street": tags_get(tags, "addr:street"),
        "addr_city": tags_get(tags, "addr:city", "addr:place"),
        "addr_postcode": tags_get(tags, "addr:postcode"),
        "addr_full": tags_get(tags, "addr:full", "address"),
        "phone": tags_get(tags, "phone", "contact:phone"),
        "website": tags_get(tags, "website", "contact:website"),
        "wikidata": tags_get(tags, "wikidata"),
        "opening_hours": tags_get(tags, "opening_hours"),
    }


def parse_bbox(s: str) -> tuple[float, float, float, float]:
    parts = [float(x.strip()) for x in s.split(",")]
    if len(parts) != 4:
        raise ValueError("bbox must be south,west,north,east (four comma-separated numbers)")
    south, west, north, east = parts
    if south >= north or west >= east:
        raise ValueError("invalid bbox: need south<north and west<east")
    return south, west, north, east


def main(argv: Optional[List[str]] = None) -> int:
    repo_root = Path(__file__).resolve().parents[1]
    p = argparse.ArgumentParser(description="Download OSM pubs (amenity=pub) via Overpass.")
    p.add_argument(
        "--bbox",
        type=str,
        default=None,
        help=f"Bbox south,west,north,east (default Greater London: {','.join(map(str, DEFAULT_BBOX))})",
    )
    p.add_argument(
        "--output-prefix",
        type=Path,
        default=repo_root / "data/osm_london_pubs",
        help="Write {{prefix}}.json and {{prefix}}.csv (default: data/osm_london_pubs)",
    )
    p.add_argument(
        "--endpoint",
        default=DEFAULT_ENDPOINT,
        help=f"Overpass API URL (default: {DEFAULT_ENDPOINT}). If you get 504, try {MIRROR_ENDPOINT}",
    )
    p.add_argument(
        "--fallback-mirror",
        action=argparse.BooleanOptionalAction,
        default=True,
        help=f"If the primary request fails with HTTP 504, retry once on mirror (default: on).",
    )
    p.add_argument("--timeout", type=int, default=300, help="Overpass [timeout:N] seconds (default 300)")
    p.add_argument(
        "--user-agent",
        default="pub-tracker-osm-fetch/1.0 (https://github.com/)",
        help="Identify your requests (Overpass fair-use).",
    )
    p.add_argument("--dry-run", action="store_true", help="Print query only, do not request")
    args = p.parse_args(argv)

    if args.bbox:
        south, west, north, east = parse_bbox(args.bbox)
    else:
        south, west, north, east = DEFAULT_BBOX

    query = build_overpass_query(south, west, north, east, args.timeout)
    if args.dry_run:
        print(query)
        return 0

    print(
        f"Querying Overpass ({args.endpoint}) for amenity=pub in bbox "
        f"{south},{west},{north},{east} …",
        file=sys.stderr,
    )
    t0 = time.time()
    endpoint = args.endpoint
    try:
        data = overpass_post(endpoint, query, args.user_agent)
    except urllib.error.HTTPError as e:
        if (
            e.code == 504
            and args.fallback_mirror
            and endpoint.rstrip("/") == DEFAULT_ENDPOINT.rstrip("/")
        ):
            print(f"504 from primary; retrying mirror…", file=sys.stderr)
            endpoint = MIRROR_ENDPOINT
            try:
                data = overpass_post(endpoint, query, args.user_agent)
            except urllib.error.HTTPError as e2:
                print(f"HTTP error: {e2.code} {e2.reason}", file=sys.stderr)
                return 1
        else:
            print(f"HTTP error: {e.code} {e.reason}", file=sys.stderr)
            return 1
    except urllib.error.URLError as e:
        print(f"Network error: {e}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as e:
        print(f"Invalid JSON: {e}", file=sys.stderr)
        return 1

    elements = data.get("elements") or []
    rows = [flatten_element(el) for el in elements if isinstance(el, dict)]

    elapsed = time.time() - t0
    meta = {
        "source": "OpenStreetMap via Overpass API",
        "endpoint": endpoint,
        "bbox": {"south": south, "west": west, "north": north, "east": east},
        "amenity_filter": "pub",
        "overpass_remarks": data.get("remark"),
        "generator": data.get("generator"),
        "osm3s": data.get("osm3s"),
        "count_elements": len(elements),
        "count_rows": len(rows),
        "elapsed_seconds": round(elapsed, 2),
    }

    out_prefix = Path(args.output_prefix)
    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = out_prefix.with_suffix(".json")
    csv_path = out_prefix.with_suffix(".csv")

    payload = {"meta": meta, "elements": elements}
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    if rows:
        fieldnames = list(rows[0].keys())
        with csv_path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
    else:
        csv_path.write_text("", encoding="utf-8")

    print(
        f"Wrote {json_path} and {csv_path} ({len(rows)} pubs, {elapsed:.1f}s).",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
