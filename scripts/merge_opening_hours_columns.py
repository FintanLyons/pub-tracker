#!/usr/bin/env python3
"""
Merge opening_hours + opening_hours_a..f into a single opening_hours column.

Preserves each segment exactly as stored (Mo-Fr, Mo-Sa, Tu, PH, etc.).
Joins non-empty segments in column order with "; " (OSM multi-rule separator).

Removes opening_hours_a … opening_hours_f from the output CSV.

Usage:
  python3 scripts/merge_opening_hours_columns.py
  python3 scripts/merge_opening_hours_columns.py -i data/data_list_search_enriched.csv -o data/data_list_search_enriched.csv
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

DROP_COLUMNS = OH_COLUMNS_ORDER[1:]  # a..f


def normalize_segment(seg: str) -> str:
    """Collapse whitespace; do not change day abbreviations or times."""
    return " ".join((seg or "").split())


def merge_opening_hours_row(row: Dict[str, str]) -> str:
    """
    Collect segments from each column in order.
    If opening_hours already contains ';', treat it as one or more rules
    but still append additional columns (a..f) — OSM export often splits
  rules across columns rather than inside opening_hours.
    """
    seen: set[str] = set()
    parts: List[str] = []

    for col in OH_COLUMNS_ORDER:
        raw = (row.get(col) or "").strip()
        if not raw:
            continue
        # A column may itself contain multiple rules separated by ';'
        for piece in raw.split(";"):
            seg = normalize_segment(piece)
            if not seg:
                continue
            key = seg.lower()
            if key in seen:
                continue
            seen.add(key)
            parts.append(seg)

    return "; ".join(parts)


def merge_csv(in_path: Path, out_path: Path) -> None:
    with in_path.open(encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise SystemExit(f"No header: {in_path}")
        fieldnames = list(reader.fieldnames)
        rows = [dict(r) for r in reader]

    if "opening_hours" not in fieldnames:
        raise SystemExit(f"No opening_hours column in {in_path}")

    out_fields = [c for c in fieldnames if c not in DROP_COLUMNS]

    merged_count = 0
    for row in rows:
        merged = merge_opening_hours_row(row)
        if merged:
            merged_count += 1
        row["opening_hours"] = merged
        for col in DROP_COLUMNS:
            row.pop(col, None)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=out_fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    print(f"Read   : {in_path} ({len(rows)} rows)")
    print(f"Wrote  : {out_path}")
    print(f"Rows with merged opening_hours: {merged_count}")


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "-i", "--input",
        type=Path,
        default=root / "data" / "data_list_photos_enriched.csv",
    )
    parser.add_argument(
        "-o", "--output",
        type=Path,
        default=None,
        help="Defaults to --input (in-place)",
    )
    args = parser.parse_args()
    out = args.output or args.input

    if not args.input.is_file():
        print(f"Not found: {args.input}", file=sys.stderr)
        return 1

    merge_csv(args.input, out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
