#!/usr/bin/env python3
"""Report bad website domains and duplicate website URLs. Read-only."""

from __future__ import annotations

import csv
import sys
from collections import defaultdict
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from discover_operator_website_patterns import INVALID_WEBSITE_DOMAINS, norm_host, registrable_domain


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def main() -> None:
    p = repo_root() / "data" / "data_list_photos_enriched.csv"
    with p.open(encoding="utf-8", errors="replace") as f:
        rows = list(csv.DictReader(f))

    bad_rows = []
    for r in rows:
        dom = registrable_domain(norm_host(r.get("website") or ""))
        if dom in INVALID_WEBSITE_DOMAINS:
            bad_rows.append({
                "id": r.get("id", ""),
                "name": r.get("name", ""),
                "website": r.get("website", ""),
                "bad_domain": dom,
                "operator": r.get("operator", ""),
            })

    by_url: dict = defaultdict(list)
    for r in rows:
        w = (r.get("website") or "").strip().rstrip("/").lower()
        if not w:
            continue
        if not w.startswith("http"):
            w = "https://" + w
        by_url[w].append(r)

    dup_rows = []
    for url, pubs in by_url.items():
        if len(pubs) < 2:
            continue
        for r in pubs:
            dup_rows.append({
                "shared_website": url,
                "pub_count": len(pubs),
                "id": r.get("id", ""),
                "name": r.get("name", ""),
                "operator": r.get("operator", ""),
            })

    out = repo_root() / "data"
    bad_path = out / "website_invalid_domain_pubs.csv"
    dup_path = out / "website_duplicate_url_pubs.csv"

    if bad_rows:
        with bad_path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(bad_rows[0].keys()))
            w.writeheader()
            w.writerows(bad_rows)
    if dup_rows:
        with dup_path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(dup_rows[0].keys()))
            w.writeheader()
            w.writerows(dup_rows)

    print(f"Invalid-domain pubs: {len(bad_rows)} → {bad_path}")
    print(f"Duplicate-URL pub rows: {len(dup_rows)} ({len([u for u,p in by_url.items() if len(p)>1])} URLs) → {dup_path}")


if __name__ == "__main__":
    main()
