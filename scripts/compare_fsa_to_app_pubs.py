#!/usr/bin/env python3
"""
Compare FSA London export (minimal_unique or any two-column CSV) to pubs in ``pubs_all``.

Matching uses the same ``normalize_address_for_dedupe`` logic as ``fetch_fsa_london_pubs.py``.
App addresses often use newlines; those are flattened to spaces before normalisation.

Usage
-----
  export $(grep -v '^#' .env | xargs)   # or set SUPABASE_URL + SUPABASE_KEY
  python3 scripts/compare_fsa_to_app_pubs.py \\
    --fsa-csv data/fsa_london_pubs_minimal_unique.csv

  # Or pass a CSV export with columns name,address (header optional):
  python3 scripts/compare_fsa_to_app_pubs.py --fsa-csv ... --app-csv pubs_export.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# Reuse FSA normalisation (dedupe keys).
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))
from fetch_fsa_london_pubs import normalize_address_for_dedupe  # noqa: E402


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


def flatten_multiline_address(address: Optional[str]) -> str:
    if not address or not str(address).strip():
        return ""
    return re.sub(r"[\s\n\r]+", " ", str(address).strip())


def address_key(address: str) -> str:
    return normalize_address_for_dedupe(flatten_multiline_address(address))


_RE_UK_POSTCODE = re.compile(
    r"\b([A-Z]{1,2}[0-9][0-9A-Z]?)\s*([0-9][A-Z]{2})\b",
    re.IGNORECASE,
)


def extract_postcode_compact(address: str) -> str:
    """Last full UK postcode in string, compact uppercase e.g. SE12LN -> SE1 2LN handled."""
    if not address:
        return ""
    u = flatten_multiline_address(address).upper()
    matches = list(_RE_UK_POSTCODE.finditer(u))
    if not matches:
        return ""
    m = matches[-1]
    return f"{m.group(1).upper()} {m.group(2).upper()}"


def leading_building_number(address: str) -> Optional[int]:
    """
    First numeric street number (20a / 20-A -> 20). Used for relaxed matching only.
    """
    flat = flatten_multiline_address(address)
    if not flat:
        return None
    before_pc = flat
    m_pc = list(_RE_UK_POSTCODE.finditer(flat.upper()))
    if m_pc:
        before_pc = flat[: m_pc[-1].start()]
    chunk = before_pc.split(",")[0].strip()
    m = re.search(r"\b(\d{1,4})\s*[A-Z]?\b", chunk, re.I)
    if not m:
        return None
    return int(m.group(1))


def relaxed_address_key(address: str) -> Tuple[str, int]:
    """(normalised postcode, building number) or ('', -1) if unusable."""
    pc = extract_postcode_compact(address)
    n = leading_building_number(address)
    if not pc or n is None:
        return ("", -1)
    return (pc, n)


def load_fsa_relaxed_keys_csv(path: Path) -> Set[Tuple[str, int]]:
    keys: Set[Tuple[str, int]] = set()
    with path.open(newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        fn = {k.lower().strip(): k for k in (r.fieldnames or [])}
        addr_col = fn.get("address")
        if not addr_col:
            return keys
        for row in r:
            addr = row.get(addr_col) or ""
            rk = relaxed_address_key(addr)
            if rk[0] and rk[1] >= 0:
                keys.add(rk)
    return keys


def load_fsa_keys_csv(path: Path) -> Tuple[Set[str], int]:
    """Return set of normalised address keys and row count (excl. header)."""
    keys: Set[str] = set()
    n = 0
    with path.open(newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        fn = {k.lower().strip(): k for k in (r.fieldnames or [])}
        addr_col = fn.get("address")
        if not addr_col:
            print("CSV must include an 'address' column.", file=sys.stderr)
            return keys, 0
        for row in r:
            n += 1
            addr = row.get(addr_col) or ""
            k = address_key(addr)
            if k:
                keys.add(k)
    return keys, n


def load_app_csv(path: Path) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    with path.open(newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        fn = {k.lower().strip(): k for k in (r.fieldnames or [])}
        name_col = fn.get("name") or fn.get("pub_name") or "name"
        addr_col = fn.get("address") or "address"
        for row in r:
            rows.append(
                {
                    "name": (row.get(name_col) or "").strip(),
                    "address": (row.get(addr_col) or "").strip(),
                }
            )
    return rows


def fetch_pubs_all_from_supabase(url: str, key: str, page_size: int = 1000) -> List[Dict[str, Any]]:
    """Paginated GET pubs_all?name,address via PostgREST."""
    base = url.rstrip("/") + "/rest/v1/pubs_all"
    params = {"select": "name,address"}
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
                "Prefer": "count=exact",
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


def main(argv: Optional[List[str]] = None) -> int:
    repo_root = Path(__file__).resolve().parents[1]
    load_dotenv_simple(repo_root / ".env")

    p = argparse.ArgumentParser(description="Compare FSA CSV to app pubs_all addresses.")
    p.add_argument(
        "--fsa-csv",
        type=Path,
        default=repo_root / "data/fsa_london_pubs_minimal_unique.csv",
        help="FSA export with an address column (default: data/fsa_london_pubs_minimal_unique.csv)",
    )
    p.add_argument(
        "--app-csv",
        type=Path,
        default=None,
        help="Optional: name,address CSV instead of Supabase",
    )
    p.add_argument("--page-size", type=int, default=1000, help="Supabase page size (default 1000)")
    p.add_argument(
        "--relaxed",
        action="store_true",
        help="Also report matches on same postcode + leading street number (stricter addresses often differ).",
    )
    args = p.parse_args(argv)

    if not args.fsa_csv.is_file():
        print(f"FSA file not found: {args.fsa_csv}", file=sys.stderr)
        return 1

    fsa_keys, fsa_rows = load_fsa_keys_csv(args.fsa_csv)
    fsa_relaxed: Set[Tuple[str, int]] = set()
    if args.relaxed:
        fsa_relaxed = load_fsa_relaxed_keys_csv(args.fsa_csv)
    print(f"FSA file: {args.fsa_csv} ({fsa_rows} rows, {len(fsa_keys)} distinct normalised addresses)", file=sys.stderr)
    if args.relaxed:
        print(
            f"FSA relaxed keys (postcode + building no.): {len(fsa_relaxed)}",
            file=sys.stderr,
        )

    if args.app_csv:
        if not args.app_csv.is_file():
            print(f"App CSV not found: {args.app_csv}", file=sys.stderr)
            return 1
        app_rows = load_app_csv(args.app_csv)
    else:
        supabase_url = os.environ.get("SUPABASE_URL", "").strip()
        supabase_key = os.environ.get("SUPABASE_KEY", "").strip() or os.environ.get(
            "SUPABASE_SERVICE_ROLE_KEY", ""
        ).strip()
        if not supabase_url or not supabase_key:
            print(
                "Set SUPABASE_URL and SUPABASE_KEY (or SUPABASE_SERVICE_ROLE_KEY), "
                "or pass --app-csv.",
                file=sys.stderr,
            )
            return 1
        print("Fetching pubs_all from Supabase…", file=sys.stderr)
        app_rows = fetch_pubs_all_from_supabase(supabase_url, supabase_key, args.page_size)

    n_app = len(app_rows)
    matched = 0
    matched_relaxed = 0
    unmatched_samples: List[Tuple[str, str, str]] = []

    for row in app_rows:
        addr = row.get("address") if isinstance(row, dict) else ""
        name = row.get("name") if isinstance(row, dict) else ""
        saddr = str(addr) if addr else ""
        k = address_key(saddr)
        if not k:
            unmatched_samples.append((str(name), str(addr)[:80], "(empty normalised key)"))
            continue
        if k in fsa_keys:
            matched += 1
        elif args.relaxed:
            rk = relaxed_address_key(saddr)
            if rk[0] and rk[1] >= 0 and rk in fsa_relaxed:
                matched_relaxed += 1
            elif len(unmatched_samples) < 15:
                unmatched_samples.append((str(name), str(addr)[:120].replace("\n", " "), k[:80]))
        else:
            if len(unmatched_samples) < 15:
                unmatched_samples.append((str(name), str(addr)[:120].replace("\n", " "), k[:80]))

    pct = (100.0 * matched / n_app) if n_app else 0.0
    pct_relaxed_extra = (100.0 * matched_relaxed / n_app) if n_app else 0.0
    pct_either = (100.0 * (matched + matched_relaxed) / n_app) if n_app else 0.0

    # How much of FSA is "used" by app (optional).
    app_keys = {address_key(str(r.get("address") or "")) for r in app_rows}
    app_keys.discard("")
    fsa_hit_by_app = len(fsa_keys & app_keys)

    report: Dict[str, Any] = {
        "app_pubs_total": n_app,
        "fsa_csv_rows": fsa_rows,
        "fsa_distinct_normalized_addresses": len(fsa_keys),
        "app_pubs_matched_strict_address": matched,
        "percent_app_pubs_strict_match": round(pct, 2),
        "fsa_addresses_that_align_with_an_app_pub": fsa_hit_by_app,
        "note": "Strict = full string normalised like the FSA deduper. App uses newlines and CAMRA-style wording; FSA uses commas and different tokens (20 vs 20a, area names).",
    }
    if args.relaxed:
        report["app_pubs_matched_relaxed_postcode_plus_number_only"] = matched_relaxed
        report["percent_app_pubs_relaxed_only"] = round(pct_relaxed_extra, 2)
        report["percent_app_pubs_strict_or_relaxed"] = round(pct_either, 2)

    print(json.dumps(report, indent=2))
    print(
        f"\nStrict address match: {matched}/{n_app} ({pct:.1f}%) of app pubs appear in the FSA list.",
        file=sys.stderr,
    )
    if args.relaxed:
        print(
            f"Relaxed (postcode + street number, not in strict set): +{matched_relaxed} "
            f"({pct_relaxed_extra:.1f}%); combined {matched + matched_relaxed}/{n_app} ({pct_either:.1f}%).",
            file=sys.stderr,
        )
    if unmatched_samples and n_app - matched > 0:
        print("\nSample non-matching (name, address snippet, normalised key):", file=sys.stderr)
        for t in unmatched_samples[:10]:
            print(f"  {t[0][:50]!r} | {t[1][:70]!r}…", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
