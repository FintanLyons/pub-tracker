#!/usr/bin/env python3
"""
Compare OpenStreetMap pub export (lat/lon + name) to ``pubs_all`` in Supabase.

**Default matching (strict):** an app pub matches only if there is an OSM point
within ``--max-distance-m`` *and* the pub names are similar enough after
normalisation (leading **The** removed, punctuation flattened, case ignored).
Among all OSM candidates within the distance cap, the **closest** one that
passes the name threshold wins—so two different pubs on the same street should
not match each other unless names are confused (tighten ``--max-distance-m``).

Use ``--distance-only`` to reproduce the old behaviour (distance-only, wider
radius).

Where to run
------------
  cd /path/to/pub-tracker
  python3 scripts/compare_osm_to_app_pubs.py

Reads ``data/osm_london_pubs.csv`` by default. Loads ``.env`` for Supabase.
"""

from __future__ import annotations

import argparse
import csv
import difflib
import json
import math
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_SCRIPT_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _SCRIPT_DIR.parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))


def load_dotenv_simple(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def normalize_pub_name(raw: str) -> str:
    """
    Lowercase, drop leading 'The ', strip punctuation except word chars,
    collapse spaces. Empty string if nothing usable.
    """
    if not raw or not str(raw).strip():
        return ""
    s = str(raw).lower().strip()
    s = re.sub(r"[''`]", "", s)
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if s.startswith("the "):
        s = s[4:].strip()
    return s


def name_similarity(a_raw: str, b_raw: str) -> float:
    """0..1; uses normalised strings and SequenceMatcher."""
    a = normalize_pub_name(a_raw)
    b = normalize_pub_name(b_raw)
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def load_osm_csv(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with path.open(newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            try:
                lat = float(row.get("lat") or "")
                lon = float(row.get("lon") or "")
            except (TypeError, ValueError):
                continue
            if not (math.isfinite(lat) and math.isfinite(lon)):
                continue
            rows.append(
                {
                    "id": row.get("id") or "",
                    "lat": lat,
                    "lon": lon,
                    "name": (row.get("name") or "").strip(),
                }
            )
    return rows


def fetch_pubs_all_coords(url: str, key: str, page_size: int = 1000) -> List[Dict[str, Any]]:
    base = url.rstrip("/") + "/rest/v1/pubs_all"
    params = {"select": "id,name,lat,lon"}
    out: List[Dict[str, Any]] = []
    start = 0
    while True:
        q = urllib.parse.urlencode(params)
        req_url = f"{base}?{q}"
        end = start + page_size - 1
        req = urllib.request.Request(
            req_url,
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Accept": "application/json",
                "Range-Unit": "items",
                "Range": f"{start}-{end}",
            },
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read().decode("utf-8")
            chunk = json.loads(body)
        if not chunk:
            break
        out.extend(chunk)
        if len(chunk) < page_size:
            break
        start += page_size
    return out


def min_distance_to_any(
    lat: float, lon: float, osm_points: List[Tuple[float, float, str]]
) -> float:
    best = float("inf")
    for olat, olon, _oid in osm_points:
        d = haversine_m(lat, lon, olat, olon)
        if d < best:
            best = d
    return best


def find_strict_match(
    app_lat: float,
    app_lon: float,
    app_name: str,
    osm_rows: List[Dict[str, Any]],
    max_distance_m: float,
    min_name_ratio: float,
) -> Tuple[
    Optional[Tuple[float, str, float]],
    str,
]:
    """
    Among OSM rows within max_distance_m with name_similarity >= min_name_ratio,
    return ((distance_m, osm_id, name_ratio) or None, reason).

    ``reason`` is ``matched``, ``no_named_osm_in_radius``, or ``name_similarity_too_low``.
    OSM rows with empty normalised name are ignored (cannot verify identity).
    """
    if not normalize_pub_name(app_name):
        return None, "no_named_osm_in_radius"

    dlat = max_distance_m / 111_320.0
    cos_lat = max(0.2, abs(math.cos(math.radians(app_lat))))
    dlon = max_distance_m / (111_320.0 * cos_lat)

    best: Optional[Tuple[float, str, float]] = None
    named_in_radius = False

    for osm in osm_rows:
        oname = osm.get("name") or ""
        if not normalize_pub_name(oname):
            continue
        olat = float(osm["lat"])
        olon = float(osm["lon"])
        if abs(olat - app_lat) > dlat * 1.15:
            continue
        if abs(olon - app_lon) > dlon * 1.15:
            continue
        d = haversine_m(app_lat, app_lon, olat, olon)
        if d > max_distance_m:
            continue
        named_in_radius = True
        nr = name_similarity(app_name, oname)
        if nr < min_name_ratio:
            continue
        if best is None or d < best[0]:
            best = (d, str(osm.get("id") or ""), nr)

    if best is not None:
        return best, "matched"
    if named_in_radius:
        return None, "name_similarity_too_low"
    return None, "no_named_osm_in_radius"


def main(argv: Optional[List[str]] = None) -> int:
    load_dotenv_simple(_REPO_ROOT / ".env")

    p = argparse.ArgumentParser(description="Compare OSM pub CSV to pubs_all (distance + name).")
    p.add_argument(
        "--osm-csv",
        type=Path,
        default=_REPO_ROOT / "data/osm_london_pubs.csv",
        help="CSV from fetch_osm_london_pubs.py",
    )
    p.add_argument(
        "--max-distance-m",
        type=float,
        default=45.0,
        help="Max metres between app and OSM point for a candidate (default 45; tight block/street)",
    )
    p.add_argument(
        "--min-name-ratio",
        type=float,
        default=0.72,
        help="Minimum difflib name similarity on normalised names (default 0.72)",
    )
    p.add_argument(
        "--distance-only",
        action="store_true",
        help="Ignore names: match if any OSM within --distance-only-max-m (default 100)",
    )
    p.add_argument(
        "--distance-only-max-m",
        type=float,
        default=100.0,
        help="Radius when --distance-only is set",
    )
    p.add_argument(
        "--thresholds",
        type=str,
        default="25,50,75,100,150",
        help="With --distance-only: comma-separated distance report thresholds",
    )
    p.add_argument("--page-size", type=int, default=1000)
    args = p.parse_args(argv)

    if not args.osm_csv.is_file():
        print(f"OSM CSV not found: {args.osm_csv}", file=sys.stderr)
        return 1

    osm_rows = load_osm_csv(args.osm_csv)
    osm_points: List[Tuple[float, float, str]] = [
        (float(r["lat"]), float(r["lon"]), str(r.get("id") or "")) for r in osm_rows
    ]
    print(
        f"Loaded {len(osm_rows)} OSM points from {args.osm_csv}",
        file=sys.stderr,
    )

    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    supabase_key = os.environ.get("SUPABASE_KEY", "").strip() or os.environ.get(
        "SUPABASE_SERVICE_ROLE_KEY", ""
    ).strip()
    if not supabase_url or not supabase_key:
        print("Set SUPABASE_URL and SUPABASE_KEY in .env", file=sys.stderr)
        return 1

    print("Fetching pubs_all from Supabase…", file=sys.stderr)
    app_rows = fetch_pubs_all_coords(supabase_url, supabase_key, args.page_size)

    app_with_coords: List[Dict[str, Any]] = []
    app_no_coords = 0
    for row in app_rows:
        try:
            lat = float(row.get("lat"))
            lon = float(row.get("lon"))
        except (TypeError, ValueError):
            app_no_coords += 1
            continue
        if not (math.isfinite(lat) and math.isfinite(lon)):
            app_no_coords += 1
            continue
        app_with_coords.append(row)

    n_app = len(app_rows)
    n_valid = len(app_with_coords)

    if args.distance_only:
        min_dists: List[float] = []
        for row in app_with_coords:
            lat, lon = float(row["lat"]), float(row["lon"])
            min_dists.append(min_distance_to_any(lat, lon, osm_points))

        thresh_list = [float(x.strip()) for x in args.thresholds.split(",") if x.strip()]
        counts_by_t = {t: sum(1 for d in min_dists if d <= t) for t in thresh_list}
        primary_t = args.distance_only_max_m
        app_matched = sum(1 for d in min_dists if d <= primary_t)

        osm_matched = 0
        for olat, olon, _oid in osm_points:
            for row in app_with_coords:
                alat, alon = float(row["lat"]), float(row["lon"])
                if haversine_m(alat, alon, olat, olon) <= primary_t:
                    osm_matched += 1
                    break

        sorted_d = sorted(min_dists)
        median_d = sorted_d[len(sorted_d) // 2] if sorted_d else None

        report = {
            "mode": "distance_only",
            "osm_csv": str(args.osm_csv.resolve()),
            "osm_points_with_coords": len(osm_points),
            "app_pubs_total": n_app,
            "app_pubs_with_lat_lon": n_valid,
            "app_pubs_missing_coords": app_no_coords,
            "match_within_meters": primary_t,
            "app_pubs_matched": app_matched,
            "percent_app_matched": round(100.0 * app_matched / n_valid, 2) if n_valid else 0.0,
            "osm_points_with_app_within_m": osm_matched,
            "percent_osm_touched": round(100.0 * osm_matched / len(osm_points), 2) if osm_points else 0.0,
            "median_nearest_osm_m": round(median_d, 2) if median_d is not None else None,
            "counts_by_threshold_m": {str(int(t)) if t == int(t) else str(t): counts_by_t[t] for t in thresh_list},
        }
        print(json.dumps(report, indent=2))
        print(
            f"\n[Distance-only] Within {primary_t:g}m: {app_matched}/{n_valid} app pubs ({report['percent_app_matched']}%).",
            file=sys.stderr,
        )
        return 0

    # Strict: name + distance
    matched = 0
    match_dists: List[float] = []
    match_ratios: List[float] = []
    osm_ids_matched: set[str] = set()

    near_but_name_fail = 0
    no_osm_in_radius = 0
    app_empty_name = 0

    for row in app_with_coords:
        aname = (row.get("name") or "").strip()
        if not normalize_pub_name(aname):
            app_empty_name += 1
            continue
        alat, alon = float(row["lat"]), float(row["lon"])
        res, reason = find_strict_match(
            alat, alon, aname, osm_rows, args.max_distance_m, args.min_name_ratio
        )
        if res is not None:
            d, oid, nr = res
            matched += 1
            match_dists.append(d)
            match_ratios.append(nr)
            if oid:
                osm_ids_matched.add(oid)
        elif reason == "name_similarity_too_low":
            near_but_name_fail += 1
        else:
            no_osm_in_radius += 1

    median_d = sorted(match_dists)[len(match_dists) // 2] if match_dists else None
    median_r = sorted(match_ratios)[len(match_ratios) // 2] if match_ratios else None

    eligible = n_valid - app_empty_name
    report = {
        "mode": "name_and_distance",
        "osm_csv": str(args.osm_csv.resolve()),
        "max_distance_m": args.max_distance_m,
        "min_name_ratio": args.min_name_ratio,
        "name_normalisation": "leading 'The' stripped; punctuation removed; case-insensitive; difflib.SequenceMatcher",
        "osm_points_with_coords": len(osm_points),
        "app_pubs_total": n_app,
        "app_pubs_with_lat_lon": n_valid,
        "app_pubs_missing_coords": app_no_coords,
        "app_pubs_with_empty_normalised_name_skipped": app_empty_name,
        "app_pubs_eligible_for_name_match": eligible,
        "app_pubs_matched": matched,
        "percent_matched_of_eligible": round(100.0 * matched / eligible, 2) if eligible else 0.0,
        "percent_matched_of_all_with_coords": round(100.0 * matched / n_valid, 2) if n_valid else 0.0,
        "unique_osm_ids_matched": len(osm_ids_matched),
        "percent_osm_points_matched": round(100.0 * len(osm_ids_matched) / len(osm_points), 2) if osm_points else 0.0,
        "median_distance_m_among_matches": round(median_d, 2) if median_d is not None else None,
        "median_name_ratio_among_matches": round(median_r, 4) if median_r is not None else None,
        "unmatched_app_near_osm_but_name_too_low": near_but_name_fail,
        "unmatched_app_no_osm_within_max_distance": no_osm_in_radius,
        "note": "Each app picks the closest OSM within max_distance_m whose name passes the threshold. Unnamed OSM entries are ignored.",
    }

    print(json.dumps(report, indent=2))
    print(
        f"\n[Name + ≤{args.max_distance_m:g}m] Matched {matched}/{eligible} app pubs with usable names "
        f"({report['percent_matched_of_eligible']}%). "
        f"{len(osm_ids_matched)} distinct OSM points ({report['percent_osm_points_matched']}% of OSM).",
        file=sys.stderr,
    )
    if median_d is not None:
        print(
            f"Among matches: median distance {median_d:.1f}m, median name ratio {median_r:.2f}",
            file=sys.stderr,
        )
    print(
        f"Unmatched: {no_osm_in_radius} no OSM within {args.max_distance_m:g}m; "
        f"{near_but_name_fail} had OSM nearby but name similarity < {args.min_name_ratio}; "
        f"{app_empty_name} app name empty after normalisation.",
        file=sys.stderr,
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
