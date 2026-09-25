#!/usr/bin/env python3
"""
Normalize enriched data_list CSV column order and merge opening hours.

Fixes Firecrawl/Tavily append order where ``has_live_sport_tv`` lands between
``conf_has_live_music`` and ``conf_has_food_available`` instead of with the
other feature booleans.

Also merges opening_hours + opening_hours_a..f into a single opening_hours
column (same logic as merge_opening_hours_columns.py).

Usage:
  python3 scripts/normalize_data_list_columns.py \\
    -i data/data_list_cambridge_search_enriched.csv \\
    -o data/data_list_cambridge_search_enriched.csv
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List, Sequence

OH_COLUMNS_ORDER: List[str] = [
    "opening_hours",
    "opening_hours_a",
    "opening_hours_b",
    "opening_hours_c",
    "opening_hours_d",
    "opening_hours_e",
    "opening_hours_f",
]

FEATURE_COLUMNS: List[str] = [
    "has_pub_garden",
    "has_live_music",
    "has_live_sport_tv",
    "has_food_available",
    "has_dog_friendly",
    "has_pool_darts",
    "has_accommodation",
]

CONF_FEATURE_COLUMNS: List[str] = [f"conf_{c}" for c in FEATURE_COLUMNS]

SOFT_CONF_COLUMNS: List[str] = [
    "conf_description",
    "conf_phone",
    "conf_founded",
    "conf_operator",
]

FC_COLUMNS: List[str] = [
    "fc_status",
    "fc_error",
    "fc_quality_flags",
    "fc_quality_note",
]

FCS_COLUMNS: List[str] = [
    "fcs_status",
    "fcs_error",
    "fcs_query",
    "fcs_source_url",
    "fcs_source_title",
    "fcs_website_guess",
    "fcs_website_conf",
    "fcs_quality_flags",
    "fcs_quality_note",
]

BASE_BEFORE_FEATURES: List[str] = [
    "calc_postcode_district",
    "calc_postcode_area",
    "osm_type",
    "osm_id",
    "id",
    "lat",
    "lon",
    "name",
    "operator",
    "photo_url1",
    "photo_url2",
    "photo_url3",
    "photo_url4",
    "photo_url5",
    "founded",
    "description",
]

BASE_AFTER_FEATURES: List[str] = [
    "addr_housenumber",
    "addr_street",
    "phone",
    "website",
    "wikidata",
]


def merge_opening_hours_row(row: Dict[str, str]) -> str:
    seen: set[str] = set()
    parts: List[str] = []
    for col in OH_COLUMNS_ORDER:
        raw = (row.get(col) or "").strip()
        if not raw:
            continue
        for piece in raw.split(";"):
            seg = " ".join(piece.split())
            if not seg:
                continue
            key = seg.lower()
            if key in seen:
                continue
            seen.add(key)
            parts.append(seg)
    return "; ".join(parts)


def canonical_fieldnames(existing: Sequence[str]) -> List[str]:
    """Build ordered header; append any unknown columns at the end."""
    known = set(
        BASE_BEFORE_FEATURES
        + FEATURE_COLUMNS
        + BASE_AFTER_FEATURES
        + ["opening_hours"]
        + SOFT_CONF_COLUMNS
        + CONF_FEATURE_COLUMNS
        + FC_COLUMNS
        + FCS_COLUMNS
    )
    ordered = (
        BASE_BEFORE_FEATURES
        + FEATURE_COLUMNS
        + BASE_AFTER_FEATURES
        + ["opening_hours"]
        + SOFT_CONF_COLUMNS
        + CONF_FEATURE_COLUMNS
        + FC_COLUMNS
        + FCS_COLUMNS
    )
    extras = [c for c in existing if c not in known and c not in OH_COLUMNS_ORDER[1:]]
    return list(dict.fromkeys([*ordered, *extras]))


def normalize_csv(in_path: Path, out_path: Path) -> None:
    with in_path.open(encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise SystemExit(f"No header: {in_path}")
        old_fields = list(reader.fieldnames)
        rows = [dict(r) for r in reader]

    out_fields = canonical_fieldnames(old_fields)
    merged_oh = 0
    for row in rows:
        merged = merge_opening_hours_row(row)
        if merged:
            merged_oh += 1
        row["opening_hours"] = merged
        for col in OH_COLUMNS_ORDER[1:]:
            row.pop(col, None)
        for col in out_fields:
            row.setdefault(col, "")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=out_fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    print(f"Read   : {in_path} ({len(rows)} rows)")
    print(f"Wrote  : {out_path}")
    print(f"Columns: {len(old_fields)} -> {len(out_fields)}")
    print(f"Merged opening_hours on {merged_oh} rows")
    # sanity: live sport next to live music
    i_music = out_fields.index("has_live_music")
    i_sport = out_fields.index("has_live_sport_tv")
    i_food = out_fields.index("has_food_available")
    assert i_sport == i_music + 1 and i_food == i_sport + 1


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    p = argparse.ArgumentParser(description="Normalize data_list column order + merge opening hours.")
    p.add_argument("-i", "--input", type=Path, required=True)
    p.add_argument("-o", "--output", type=Path, default=None)
    args = p.parse_args()
    out = args.output or args.input
    if not args.input.is_file():
        print(f"Not found: {args.input}", file=sys.stderr)
        return 1
    normalize_csv(args.input, out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
