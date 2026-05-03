#!/usr/bin/env python3
"""
From a ``serper_suggest_pub_websites.py`` output CSV, write a smaller CSV with only
rows the model treated as confident (non-empty suggested URL and confidence >= threshold).

Column ``accept`` is pre-filled with 1; set to 0 for any row where the website is wrong.

Example
-------
  python3 scripts/build_serper_ai_confident_accept_csv.py \\
    --input data/serper_website_suggestions_all_missing.csv \\
    --output data/serper_all_missing_ai_confident_accept.csv \\
    --min-confidence 0.65
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path


def _conf(s: str) -> float:
    try:
        return float((s or "0").strip())
    except ValueError:
        return 0.0


def main() -> int:
    p = argparse.ArgumentParser(description="Filter Serper output to AI-confident rows; add accept=1 for manual QA.")
    p.add_argument("--input", type=Path, required=True, help="Serper suggestions CSV")
    p.add_argument("--output", type=Path, required=True, help="Smaller CSV for manual accept/reject")
    p.add_argument(
        "--min-confidence",
        type=float,
        default=0.65,
        help="Minimum confidence to include (default: 0.65)",
    )
    args = p.parse_args()

    if not args.input.is_file():
        print(f"Input not found: {args.input}", file=sys.stderr)
        return 1

    out_fields = [
        "accept",
        "suggested_website",
        "id",
        "name",
        "operator",
        "calc_postcode_district",
        "calc_postcode_area",
        "addr_housenumber",
        "addr_street",
        "addr_city",
        "confidence",
        "notes",
    ]

    written = 0
    scanned = 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.input.open(newline="", encoding="utf-8") as fin, args.output.open("w", newline="", encoding="utf-8") as fout:
        r = csv.DictReader(fin)
        w = csv.DictWriter(fout, fieldnames=out_fields, extrasaction="ignore")
        w.writeheader()
        for row in r:
            scanned += 1
            url = (row.get("suggested_website") or "").strip()
            if not url:
                continue
            c = _conf(row.get("confidence", ""))
            if c < float(args.min_confidence):
                continue
            w.writerow(
                {
                    "accept": "1",
                    "suggested_website": url,
                    "id": (row.get("id") or "").strip(),
                    "name": (row.get("name") or "").strip(),
                    "operator": (row.get("operator") or "").strip(),
                    "calc_postcode_district": (row.get("calc_postcode_district") or "").strip(),
                    "calc_postcode_area": (row.get("calc_postcode_area") or "").strip(),
                    "addr_housenumber": (row.get("addr_housenumber") or "").strip(),
                    "addr_street": (row.get("addr_street") or "").strip(),
                    "addr_city": (row.get("addr_city") or "").strip(),
                    "confidence": f"{c:.3f}",
                    "notes": (row.get("notes") or "").strip(),
                }
            )
            written += 1

    print(f"rows_scanned={scanned}")
    print(f"rows_written_confidence>={args.min_confidence}={written}")
    print(f"output={args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
