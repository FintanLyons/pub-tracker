#!/usr/bin/env python3
"""
Merge manual Cambridge enrichment JSON (Tavily replacement) into data_list CSV.

Reads data/cambridge_manual_enrich_results_batch*.json and applies fills to
empty cells only, matching enrich_search_pubs.py policy.

Usage:
  python3 scripts/merge_cambridge_manual_enrich_results.py \\
    --input data/data_list_cambridge_firecrawl_enriched.csv \\
    -o data/data_list_cambridge_search_enriched.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SOFT_FIELDS = [
    ("description", "conf_description"),
    ("phone", "conf_phone"),
    ("founded", "conf_founded"),
    ("operator", "conf_operator"),
]

FEATURE_FIELDS = [
    "has_pub_garden",
    "has_live_music",
    "has_live_sport_tv",
    "has_food_available",
    "has_dog_friendly",
    "has_pool_darts",
    "has_accommodation",
]

FCS_COLUMNS = [
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

WEBSITE_GUESS_THRESHOLD = 0.70


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def is_empty(val: Any) -> bool:
    return val is None or str(val).strip() == ""


def load_results(repo: Path) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for path in sorted(repo.glob("data/cambridge_manual_enrich_results_batch*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            continue
        for item in data:
            pid = (item.get("id") or "").strip()
            if pid:
                out[pid] = item
    return out


def build_fieldnames(base: List[str]) -> List[str]:
    extra: List[str] = []
    for col, conf in SOFT_FIELDS:
        extra.extend([col, conf])
    for col in FEATURE_FIELDS:
        extra.extend([col, f"conf_{col}"])
    extra.extend(FCS_COLUMNS)
    return list(dict.fromkeys([*base, *extra]))


def apply_item(row: Dict[str, str], item: Dict[str, Any]) -> int:
    fills = 0
    conf = float(item.get("confidence") or 0)
    conf_str = f"{conf:.4f}"

    for col, conf_col in SOFT_FIELDS:
        val = (item.get(col) or "").strip()
        if val and is_empty(row.get(col)):
            row[col] = val
            row[conf_col] = conf_str
            fills += 1
        elif val:
            row[conf_col] = row.get(conf_col) or conf_str

    for col in FEATURE_FIELDS:
        val = (item.get(col) or "").strip()
        conf_col = f"conf_{col}"
        if val in ("TRUE", "FALSE") and is_empty(row.get(col)):
            row[col] = val
            row[conf_col] = conf_str
            fills += 1
        elif val in ("TRUE", "FALSE"):
            row[conf_col] = row.get(conf_col) or conf_str

    guess = (item.get("website_guess") or "").strip()
    if guess:
        row["fcs_website_guess"] = guess
        row["fcs_website_conf"] = conf_str
        if is_empty(row.get("website")) and conf >= WEBSITE_GUESS_THRESHOLD:
            row["website"] = guess
            fills += 1

    row["fcs_status"] = "ok"
    row["fcs_query"] = (item.get("search_query") or "").strip()
    row["fcs_quality_note"] = f"manual:{(item.get('notes') or '').strip()}"[:500]
    row["fcs_source_url"] = "manual:cambridge-camra.org.uk"
    row["fcs_source_title"] = "Manual enrichment (Tavily replacement)"
    return fills


def main(argv: Optional[List[str]] = None) -> int:
    repo = repo_root()
    p = argparse.ArgumentParser(description="Merge manual Cambridge enrich batches into data_list CSV.")
    p.add_argument(
        "--input",
        type=Path,
        default=repo / "data/data_list_cambridge_firecrawl_enriched.csv",
    )
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=repo / "data/data_list_cambridge_search_enriched.csv",
    )
    args = p.parse_args(argv)

    results = load_results(repo)
    if not results:
        print("No cambridge_manual_enrich_results_batch*.json files found", file=sys.stderr)
        return 1

    with args.input.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = build_fieldnames(list(reader.fieldnames or []))
        rows = [dict(r) for r in reader]

    total_fills = 0
    matched = 0
    for row in rows:
        pid = (row.get("id") or "").strip()
        item = results.get(pid)
        if not item:
            continue
        for col in fieldnames:
            row.setdefault(col, "")
        matched += 1
        total_fills += apply_item(row, item)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    # Reorder columns + merge opening_hours_a..f (Firecrawl appends has_live_sport_tv late)
    import subprocess

    subprocess.run(
        [
            sys.executable,
            str(repo / "scripts/normalize_data_list_columns.py"),
            "-i",
            str(args.output),
            "-o",
            str(args.output),
        ],
        check=True,
    )

    with_desc = sum(1 for r in rows if not is_empty(r.get("description")))
    print(f"results_loaded={len(results)}")
    print(f"rows_matched={matched}")
    print(f"cell_fills={total_fills}")
    print(f"with_description={with_desc}/{len(rows)}")
    print(f"output={args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
