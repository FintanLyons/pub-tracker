#!/usr/bin/env python3
"""
Normalize OSM pubs CSV columns and recalculate postcode fields from lat/lon.

What this script does:
1) Renames unlabeled overflow opening-hours columns to opening_hours_a/b/c/...
2) Inserts new postcode columns at the start of the CSV:
   - calc_postcode
   - calc_postcode_district
   - calc_postcode_area
3) Recomputes those new columns from lat/lon for EVERY row, even if postcode
   data already exists elsewhere in the file.

Usage:
  python3 scripts/rebuild_osm_postcodes_csv.py --input data/osm_london_pubs.csv --in-place
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple


BULK_POSTCODES_URL = "https://api.postcodes.io/postcodes"
CHUNK_SIZE = 100  # postcodes.io bulk endpoint supports up to 100 geolocations
CALC_COLS = ["calc_postcode", "calc_postcode_district", "calc_postcode_area"]


def area_from_outcode(outcode: str) -> str:
    match = re.match(r"^([A-Z]+)", (outcode or "").upper())
    return match.group(1) if match else ""


def normalize_header(header: List[str]) -> List[str]:
    """
    Rename unlabeled columns after opening_hours to opening_hours_a/b/c...
    Leaves existing named columns unchanged.
    """
    out = list(header)
    try:
        opening_idx = out.index("opening_hours")
    except ValueError:
        return out

    # Rename unlabeled/placeholder columns that immediately follow opening_hours.
    suffix_index = 0
    for i in range(opening_idx + 1, len(out)):
        name = (out[i] or "").strip()
        is_unlabeled = (not name) or name.startswith("unlabeled_col_")
        if not is_unlabeled:
            # Keep scanning; some files may have mixed naming.
            continue
        suffix = chr(ord("a") + suffix_index) if suffix_index < 26 else f"x{suffix_index}"
        out[i] = f"opening_hours_{suffix}"
        suffix_index += 1

    return out


def strip_existing_calc_columns(header: List[str], rows: List[Dict[str, str]]) -> Tuple[List[str], List[Dict[str, str]]]:
    kept_header = [h for h in header if h not in CALC_COLS]
    if len(kept_header) == len(header):
        return header, rows
    new_rows: List[Dict[str, str]] = []
    for row in rows:
        new_rows.append({k: row.get(k, "") for k in kept_header})
    return kept_header, new_rows


def load_seed_by_id(seed_path: str) -> Dict[str, Dict[str, str]]:
    out: Dict[str, Dict[str, str]] = {}
    if not seed_path:
        return out
    p = Path(seed_path)
    if not p.exists():
        return out
    with p.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rid = (row.get("id") or "").strip()
            if not rid:
                continue
            out[rid] = {
                "calc_postcode": (row.get("latlon_postcode") or "").strip().upper(),
                "calc_postcode_district": (row.get("latlon_postcode_district") or "").strip().upper(),
                "calc_postcode_area": (row.get("latlon_postcode_area") or "").strip().upper(),
            }
    return out


def bulk_reverse_geocode(coords: List[Tuple[float, float]]) -> List[Optional[Tuple[str, str, str]]]:
    """
    For each (lat, lon), return either:
      (postcode, outcode, area) or None
    """
    body = {
        "geolocations": [
            {"longitude": lon, "latitude": lat, "limit": 1}
            for lat, lon in coords
        ]
    }
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        BULK_POSTCODES_URL,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    results: List[Optional[Tuple[str, str, str]]] = []
    for item in payload.get("result", []):
        nearest_list = item.get("result") or []
        if not nearest_list:
            results.append(None)
            continue
        nearest = nearest_list[0] or {}
        postcode = str(nearest.get("postcode") or "").strip().upper()
        outcode = str(nearest.get("outcode") or "").strip().upper()
        if not outcode and postcode:
            outcode = postcode.split(" ")[0]
        if not postcode or not outcode:
            results.append(None)
            continue
        area = area_from_outcode(outcode)
        if not area:
            results.append(None)
            continue
        results.append((postcode, outcode, area))
    return results


def recalc_postcodes(
    rows: List[Dict[str, str]],
    lat_key: str,
    lon_key: str,
    seed_by_id: Dict[str, Dict[str, str]],
    pause_seconds: float = 0.1,
) -> Tuple[int, int]:
    total = len(rows)
    filled = 0
    pending_indices: List[int] = []
    pending_coords: List[Tuple[float, float]] = []

    for idx, row in enumerate(rows):
        lat_raw = (row.get(lat_key) or "").strip()
        lon_raw = (row.get(lon_key) or "").strip()
        try:
            lat = float(lat_raw)
            lon = float(lon_raw)
        except ValueError:
            seed = seed_by_id.get((row.get("id") or "").strip(), {})
            row["calc_postcode"] = seed.get("calc_postcode", "")
            row["calc_postcode_district"] = seed.get("calc_postcode_district", "")
            row["calc_postcode_area"] = seed.get("calc_postcode_area", "")
            continue
        pending_indices.append(idx)
        pending_coords.append((lat, lon))

    for start in range(0, len(pending_coords), CHUNK_SIZE):
        end = start + CHUNK_SIZE
        chunk_coords = pending_coords[start:end]
        chunk_indices = pending_indices[start:end]
        try:
            chunk_results = bulk_reverse_geocode(chunk_coords)
        except urllib.error.URLError:
            chunk_results = [None] * len(chunk_coords)

        for row_idx, resolved in zip(chunk_indices, chunk_results):
            row = rows[row_idx]
            if not resolved:
                seed = seed_by_id.get((row.get("id") or "").strip(), {})
                row["calc_postcode"] = seed.get("calc_postcode", "")
                row["calc_postcode_district"] = seed.get("calc_postcode_district", "")
                row["calc_postcode_area"] = seed.get("calc_postcode_area", "")
                continue
            postcode, outcode, area = resolved
            row["calc_postcode"] = postcode
            row["calc_postcode_district"] = outcode
            row["calc_postcode_area"] = area
            filled += 1

        if end < len(pending_coords):
            time.sleep(max(0.0, pause_seconds))

    return total, filled


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize OSM CSV and recalculate postcodes from lat/lon.")
    parser.add_argument("--input", required=True, help="Path to source CSV.")
    parser.add_argument("--output", default="", help="Output CSV path. If omitted with --in-place, overwrites input.")
    parser.add_argument("--in-place", action="store_true", help="Overwrite input file.")
    parser.add_argument("--pause", type=float, default=0.1, help="Pause between bulk API calls in seconds.")
    parser.add_argument(
        "--seed-from",
        default="",
        help="Optional CSV with id + latlon_postcode* columns to seed values when API lookup fails.",
    )
    args = parser.parse_args()

    in_path = Path(args.input)
    if not in_path.exists():
        raise FileNotFoundError(f"Input file not found: {in_path}")

    if args.in_place:
        out_path = in_path
    elif args.output:
        out_path = Path(args.output)
    else:
        raise ValueError("Provide --output or use --in-place.")

    with in_path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        original_header = reader.fieldnames or []
        rows = list(reader)

    if not original_header:
        raise ValueError("Input CSV has no header row.")
    if "lat" not in original_header or "lon" not in original_header:
        raise ValueError("Input CSV must include lat and lon columns.")

    header_wo_calc, rows = strip_existing_calc_columns(original_header, rows)
    normalized_header = normalize_header(header_wo_calc)
    if normalized_header != original_header:
        remapped_rows: List[Dict[str, str]] = []
        for old_row in rows:
            new_row: Dict[str, str] = {}
            for old_name, new_name in zip(header_wo_calc, normalized_header):
                new_row[new_name] = old_row.get(old_name, "")
            remapped_rows.append(new_row)
        rows = remapped_rows

    seed_by_id = load_seed_by_id(args.seed_from)
    total, filled = recalc_postcodes(
        rows,
        lat_key="lat",
        lon_key="lon",
        seed_by_id=seed_by_id,
        pause_seconds=args.pause,
    )

    # Insert new calculated columns at the start.
    final_header = [
        "calc_postcode",
        "calc_postcode_district",
        "calc_postcode_area",
        *normalized_header,
    ]

    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=final_header, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    print(f"Wrote {out_path} | rows={total} | postcodes_resolved={filled}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
