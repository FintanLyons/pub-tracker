#!/usr/bin/env python3
"""
Build a human review CSV: pubs with no existing website, a suggested URL, and
AI confidence at or above a threshold. Column ``validated`` is pre-filled with 1;
set to 0 for any row you reject after checking by eye.

Typical flow
------------
1. Run ``serper_suggest_pub_websites.py`` over all rows missing ``website`` with
   ``--limit 0`` (no cap). Omit ``--only-osm-rows`` to include Supabase as well as OSM.
   Point ``--output`` at one or more suggestion CSVs.
2. Run this script with ``--input`` (master combined CSV) and ``--suggestions`` on
   those CSVs (later files override earlier on same ``id`` if confidence ties / merges).

Example
-------
  python3 scripts/build_ai_confident_website_review_table.py \\
    --input data/osm_london_pubs_combined.csv \\
    --suggestions data/serper_website_suggestions_full.csv \\
    --output data/website_ai_confident_review.csv \\
    --min-confidence 0.65
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List, Tuple


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _float_conf(s: str) -> float:
    try:
        return float((s or "0").strip())
    except ValueError:
        return 0.0


def _better_suggestion(
    a: Dict[str, str],
    b: Dict[str, str],
) -> Dict[str, str]:
    """Prefer higher confidence; on tie prefer b (assumed later file / newer)."""
    ca = _float_conf(a.get("confidence", ""))
    cb = _float_conf(b.get("confidence", ""))
    if cb > ca:
        return b
    if cb < ca:
        return a
    return b


def load_best_suggestion_per_id(paths: List[Path]) -> Dict[str, Dict[str, str]]:
    best: Dict[str, Dict[str, str]] = {}
    for path in paths:
        if not path.is_file():
            print(f"Warning: suggestions file not found, skipping: {path}", file=sys.stderr)
            continue
        with path.open(newline="", encoding="utf-8") as f:
            r = csv.DictReader(f)
            for row in r:
                pid = (row.get("id") or "").strip()
                if not pid:
                    continue
                if pid not in best:
                    best[pid] = dict(row)
                else:
                    best[pid] = _better_suggestion(best[pid], dict(row))
    return best


def main() -> int:
    root = _repo_root()
    p = argparse.ArgumentParser(
        description="Join master pubs (no website) with Serper outputs; emit AI-confident rows for eye validation.",
    )
    p.add_argument(
        "--input",
        type=Path,
        required=True,
        help="Master CSV (e.g. data/osm_london_pubs_combined.csv)",
    )
    p.add_argument(
        "--suggestions",
        type=Path,
        nargs="+",
        required=True,
        help="One or more serper_suggest_pub_websites.py output CSVs (later files win on tie)",
    )
    p.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Review table to write (e.g. data/website_ai_confident_review.csv)",
    )
    p.add_argument(
        "--min-confidence",
        type=float,
        default=0.65,
        help="Minimum AI confidence (0..1) to include a row (default: 0.65)",
    )
    p.add_argument(
        "--require-suggested-url",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Require non-empty suggested_website (default: on)",
    )
    args = p.parse_args()

    if not args.input.is_file():
        print(f"Input not found: {args.input}", file=sys.stderr)
        return 1

    suggestions = load_best_suggestion_per_id(list(args.suggestions))
    if not suggestions:
        print("No suggestion rows loaded; check --suggestions paths.", file=sys.stderr)
        return 1

    out_fields = [
        "validated",
        "id",
        "name",
        "operator",
        "osm_type",
        "calc_postcode",
        "calc_postcode_district",
        "calc_postcode_area",
        "lat",
        "lon",
        "addr_housenumber",
        "addr_street",
        "addr_city",
        "phone",
        "suggested_website",
        "suggested_website_original",
        "confidence",
        "validation_status",
        "serper_query",
        "notes",
    ]

    written = 0
    eligible_no_website = 0
    with args.input.open(newline="", encoding="utf-8") as fin:
        reader = csv.DictReader(fin)
        if not reader.fieldnames:
            print("Input CSV has no header", file=sys.stderr)
            return 1
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w", newline="", encoding="utf-8") as fout:
            w = csv.DictWriter(fout, fieldnames=out_fields, extrasaction="ignore")
            w.writeheader()
            for row in reader:
                if (row.get("website") or "").strip():
                    continue
                eligible_no_website += 1
                pid = (row.get("id") or "").strip()
                sug = suggestions.get(pid)
                if not sug:
                    continue
                url = (sug.get("suggested_website") or "").strip()
                if bool(args.require_suggested_url) and not url:
                    continue
                conf = _float_conf(sug.get("confidence", ""))
                if conf < float(args.min_confidence):
                    continue
                w.writerow(
                    {
                        "validated": "1",
                        "id": pid,
                        "name": (row.get("name") or "").strip(),
                        "operator": (row.get("operator") or "").strip(),
                        "osm_type": (row.get("osm_type") or "").strip(),
                        "calc_postcode": (row.get("calc_postcode") or "").strip(),
                        "calc_postcode_district": (row.get("calc_postcode_district") or "").strip(),
                        "calc_postcode_area": (row.get("calc_postcode_area") or "").strip(),
                        "lat": (row.get("lat") or "").strip(),
                        "lon": (row.get("lon") or "").strip(),
                        "addr_housenumber": (row.get("addr_housenumber") or "").strip(),
                        "addr_street": (row.get("addr_street") or "").strip(),
                        "addr_city": (row.get("addr_city") or "").strip(),
                        "phone": (row.get("phone") or "").strip(),
                        "suggested_website": url,
                        "suggested_website_original": (sug.get("suggested_website_original") or "").strip(),
                        "confidence": f"{conf:.3f}",
                        "validation_status": (sug.get("validation_status") or "").strip(),
                        "serper_query": (sug.get("serper_query") or "").strip(),
                        "notes": (sug.get("notes") or "").strip(),
                    }
                )
                written += 1

    print(f"eligible_missing_website_in_master={eligible_no_website}")
    print(f"rows_written_ai_confident={written}")
    print(f"min_confidence={args.min_confidence}")
    print(f"output={args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
