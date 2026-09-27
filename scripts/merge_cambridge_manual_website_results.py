#!/usr/bin/env python3
"""
Merge manual website-search batch JSON files into a Serper-shaped review CSV.

Input: data/cambridge_website_results_batch*.json (from agent/manual search)
Source pub rows: data/osm_cambridge_pubs_cb.csv

Output: data/cambridge_website_suggestions_manual.csv

Optionally HTTP-HEAD/GET validates suggested URLs (like serper_suggest_pub_websites.py).
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional


def load_pub_index(csv_path: Path) -> Dict[str, Dict[str, str]]:
    with csv_path.open(newline="", encoding="utf-8") as f:
        return {(r.get("id") or "").strip(): r for r in csv.DictReader(f)}


def load_batch_results(repo: Path) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for path in sorted(repo.glob("data/cambridge_website_results_batch*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            out.extend(data)
    return out


def validate_url(url: str, timeout: int = 15) -> str:
    if not url:
        return ""
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "pub-tracker-manual-website-check/1.0"},
            method="HEAD",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return str(resp.status)
    except urllib.error.HTTPError as e:
        if e.code in (403, 405):
            try:
                req = urllib.request.Request(
                    url,
                    headers={"User-Agent": "pub-tracker-manual-website-check/1.0"},
                )
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    return str(resp.status)
            except Exception:
                return str(e.code)
        return str(e.code)
    except Exception:
        return "error"


def main(argv: Optional[List[str]] = None) -> int:
    repo = Path(__file__).resolve().parents[1]
    p = argparse.ArgumentParser(description="Merge manual Cambridge website search batches to Serper CSV.")
    p.add_argument(
        "--pubs-csv",
        type=Path,
        default=repo / "data/osm_cambridge_pubs_cb.csv",
        help="Source OSM CB pubs CSV",
    )
    p.add_argument(
        "--output",
        type=Path,
        default=repo / "data/cambridge_website_suggestions_manual.csv",
    )
    p.add_argument("--no-validate", action="store_true", help="Skip HTTP validation")
    args = p.parse_args(argv)

    pubs = load_pub_index(args.pubs_csv)
    results = load_batch_results(repo)
    if not results:
        print("No batch result files found in data/cambridge_website_results_batch*.json", file=sys.stderr)
        return 1

    out_fields = [
        "id",
        "name",
        "operator",
        "calc_postcode_district",
        "calc_postcode_area",
        "lat",
        "lon",
        "addr_housenumber",
        "addr_street",
        "addr_city",
        "serper_query",
        "confidence",
        "suggested_website",
        "suggested_website_original",
        "validation_status",
        "alternates_json",
        "notes",
    ]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with args.output.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=out_fields)
        w.writeheader()
        for r in results:
            pid = (r.get("id") or "").strip()
            pub = pubs.get(pid, {})
            url = (r.get("suggested_website") or "").strip()
            vstat = ""
            if url and not args.no_validate:
                vstat = validate_url(url)
            w.writerow(
                {
                    "id": pid,
                    "name": (pub.get("name") or r.get("name") or "").strip(),
                    "operator": (pub.get("operator") or "").strip(),
                    "calc_postcode_district": (pub.get("calc_postcode_district") or "").strip(),
                    "calc_postcode_area": (pub.get("calc_postcode_area") or "").strip(),
                    "lat": (pub.get("lat") or "").strip(),
                    "lon": (pub.get("lon") or "").strip(),
                    "addr_housenumber": (pub.get("addr_housenumber") or "").strip(),
                    "addr_street": (pub.get("addr_street") or "").strip(),
                    "addr_city": (pub.get("addr_city") or "").strip(),
                    "serper_query": (r.get("search_query") or "").strip(),
                    "confidence": f"{float(r.get('confidence') or 0):.3f}",
                    "suggested_website": url,
                    "suggested_website_original": url,
                    "validation_status": vstat,
                    "alternates_json": json.dumps(r.get("alternates") or [], ensure_ascii=False),
                    "notes": f"manual:{(r.get('notes') or '').strip()}",
                }
            )
            written += 1

    found = sum(1 for r in results if (r.get("suggested_website") or "").strip())
    print(f"wrote_suggestions={written}")
    print(f"with_website={found}")
    print(f"output={args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
