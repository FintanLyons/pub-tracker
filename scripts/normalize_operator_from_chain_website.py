#!/usr/bin/env python3
"""
Fill or normalize ``operator`` from obvious multi-venue chain ``website`` hosts.

Standard names (must match app copy / your list):
  Wetherspoon, Fuller's, Greene King, Young's, Nicholson's, Urban Pubs & Bars

Rules (conservative)
--------------------
- If the website host clearly belongs to a chain below:
  - **Empty operator** → set the standard name.
  - **Urban Pubs & Bars**: also fix ``Urban Pubs and Bars`` (ampersand), ``Antic London``,
    and other Urban-group trading names when the host is ``urbanpubsandbars.com``.
  - **Young's**: when host is ``youngs.co.uk``, set ``Young's`` if operator is empty or
    ``Geronimo Inns`` (Young's trading name on the same estate).
- **Fuller's** is only inferred when the host is ``fullers.co.uk`` (rare in exports where
  pubs use vanity domains); vanity-only Fuller's sites are not changed here.

Dry-run by default; pass ``--write`` to update the CSV in place.

Example
-------
  python3 scripts/normalize_operator_from_chain_website.py \\
    --input data/osm_london_pubs_combined.csv --write
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse


def _norm_host(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return ""
    if not u.startswith(("http://", "https://")):
        u = "https://" + u
    try:
        h = urlparse(u).netloc.lower()
        if h.startswith("www."):
            h = h[4:]
        return h
    except Exception:
        return ""


def _host_matches(h: str, domain: str) -> bool:
    return h == domain or h.endswith("." + domain)


def chain_operator_for_url(url: str) -> Optional[str]:
    """Return standard operator name if host is an obvious chain site."""
    h = _norm_host(url)
    if not h:
        return None
    if _host_matches(h, "jdwetherspoon.com"):
        return "Wetherspoon"
    if _host_matches(h, "greeneking.co.uk") or _host_matches(h, "greeneking.com"):
        return "Greene King"
    if _host_matches(h, "youngs.co.uk"):
        return "Young's"
    if _host_matches(h, "nicholsonspubs.co.uk") or _host_matches(h, "nicholsons.co.uk"):
        return "Nicholson's"
    if _host_matches(h, "urbanpubsandbars.com"):
        return "Urban Pubs & Bars"
    if _host_matches(h, "fullers.co.uk") or _host_matches(h, "fuller.co.uk"):
        return "Fuller's"
    return None


def _should_set_operator(current: str, expected: str) -> bool:
    cur = (current or "").strip()
    if not cur:
        return True
    if cur == expected:
        return False
    if expected == "Urban Pubs & Bars":
        if cur in ("Urban Pubs and Bars", "Antic London"):
            return True
        return False
    if expected == "Young's":
        if cur == "Geronimo Inns":
            return True
        return False
    return False


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--input", type=Path, required=True)
    p.add_argument(
        "--write",
        action="store_true",
        help="Write changes to --input (otherwise print summary only)",
    )
    args = p.parse_args()

    if not args.input.is_file():
        print(f"Input not found: {args.input}", file=sys.stderr)
        return 1

    with args.input.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        if not fields or "operator" not in fields or "website" not in fields:
            print("CSV must have operator and website columns", file=sys.stderr)
            return 1
        rows: List[Dict[str, str]] = list(reader)

    changes: List[Tuple[str, str, str, str]] = []  # id, name, old, new

    for row in rows:
        url = (row.get("website") or "").strip()
        if not url:
            continue
        expected = chain_operator_for_url(url)
        if not expected:
            continue
        cur = (row.get("operator") or "").strip()
        if not _should_set_operator(cur, expected):
            continue
        new_op = expected
        changes.append(
            (
                (row.get("id") or "").strip(),
                (row.get("name") or "").strip(),
                cur,
                new_op,
            )
        )
        row["operator"] = new_op

    print(f"rows_considered={len(rows)}")
    print(f"operator_updates={len(changes)}")
    for pid, name, old, new in changes[:40]:
        o = old if old else "(empty)"
        print(f"  {pid}\t{name}\t{o!r} -> {new!r}")
    if len(changes) > 40:
        print(f"  ... and {len(changes) - 40} more")

    if args.write and changes:
        with args.input.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
        print(f"wrote={args.input.resolve()}")
    elif args.write:
        print("no changes; file not rewritten")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
