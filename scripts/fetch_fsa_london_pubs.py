#!/usr/bin/env python3
"""
Download pub/bar/nightclub establishments from the UK Food Standards Agency (FSA)
Food Hygiene Rating Scheme (FHRS) HTTP API, keep those in London postcodes, and
write JSON + CSV for downstream matching (e.g. to pubs_all).

API docs: https://api.ratings.food.gov.uk/help
No API key is required; send header ``x-api-version: 2`` on every request.

Business type
-------------
``businessTypeId=7843`` is **Pub/bar/nightclub** (one FSA category). Nightclubs
share this type; this script does not split them unless you post-filter names.

“Currently open”
----------------
The FHRS JSON model exposed by the public API does **not** include a reliable
``closed`` / ``trading`` flag. FSA guidance is that non‑trading premises should
not be published on the ratings site; in practice treat this export as
“premises present in FHRS as at extract date”, not a legal warranty of opening
hours or trading status. For hard closures, merge another source later.

London postcodes
----------------
Default: **Greater London** outward letter prefixes (BR, CR, DA, E, EC, EN,
HA, IG, KT, N, NW, RM, SE, SM, SW, TW, UB, W, WC) — common for GLA-aligned lists.

Use ``--london-set central`` to restrict to the eight areas used by this app’s
district GeoJSON (E, EC, N, NW, SE, SW, W, WC only).

Dependencies
------------
None (uses stdlib only: ``urllib`` + ``json``). On Debian/Ubuntu, avoid ``pip install``
into the system interpreter (PEP 668); this script does not need it.

Minimal CSV and duplicate report
--------------------------------
After a full fetch, or from a saved JSON export:

  python3 scripts/fetch_fsa_london_pubs.py --from-json data/fsa_london_pubs.json

Writes ``{prefix}_minimal.csv`` (columns ``pub_name``, ``address``) and
``{prefix}_duplicate_addresses.csv`` (groups sharing the same normalized address).
``{prefix}_minimal_unique.csv`` uses the same columns with title-style casing for
display (trailing UK postcode remains uppercase). Dedupe logic still uses the
normalised uppercase form; it does not equate spelling variants (e.g. St vs Street).

Usage
-----
  python3 scripts/fetch_fsa_london_pubs.py
  python3 scripts/fetch_fsa_london_pubs.py --output-prefix data/fsa_london_pubs --delay 0.2
  python3 scripts/fetch_fsa_london_pubs.py --dry-run --max-pages 1
  python3 scripts/fetch_fsa_london_pubs.py --from-json data/fsa_london_pubs.json
  python3 scripts/fetch_fsa_london_pubs.py --write-minimal --dedupe-report
  python3 scripts/fetch_fsa_london_pubs.py --from-json data/fsa_london_pubs.json --write-minimal-unique
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import string
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from collections import defaultdict
from typing import Any, DefaultDict, Dict, Iterable, List, Optional, Set, Tuple

FHRS_BASE = "https://api.ratings.food.gov.uk"
# See FSA BusinessTypes (7843 = Pub/bar/nightclub), e.g. food-hygiene-ratings npm docs.
BUSINESS_TYPE_PUB_BAR_NIGHTCLUB = 7843
COUNTRY_ENGLAND = 1

# Letter-prefix of outward code (part before inward), e.g. SW1A -> SW, BR1 -> BR.
GREATER_LONDON_POSTCODE_AREAS: Set[str] = {
    "BR",
    "CR",
    "DA",
    "E",
    "EC",
    "EN",
    "HA",
    "IG",
    "KT",
    "N",
    "NW",
    "RM",
    "SE",
    "SM",
    "SW",
    "TW",
    "UB",
    "W",
    "WC",
}

# Matches london_postcode_districts.min.json postcode_area values only.
CENTRAL_LONDON_GEO_POSTCODE_AREAS: Set[str] = {"E", "EC", "N", "NW", "SE", "SW", "W", "WC"}


def postcode_area_from_string(postcode: Optional[str]) -> Optional[str]:
    """
    Extract postcode_area letters from a full UK postcode string.
    Examples: 'NW5 1LE' -> NW, 'EC1A1BB' -> EC, 'BR6 0AA' -> BR
    """
    if not postcode or not str(postcode).strip():
        return None
    compact = re.sub(r"\s+", "", str(postcode).upper())
    if len(compact) < 5:
        return None
    inward = compact[-3:]
    if not re.match(r"^[0-9][A-Z]{2}$", inward):
        return None
    outward = compact[:-3]
    if not outward:
        return None
    m = re.match(r"^([A-Z]+)", outward)
    return m.group(1) if m else None


def is_london_postcode(postcode: Optional[str], allowed_areas: Set[str]) -> bool:
    area = postcode_area_from_string(postcode)
    return bool(area and area in allowed_areas)


# UK outward + inward at end of string (for normalizing spacing before dedupe).
_RE_POSTCODE_END = re.compile(
    r"\b([A-Z]{1,2}[0-9][0-9A-Z]?)\s*([0-9][A-Z]{2})\s*$",
    re.IGNORECASE,
)


def format_display_pub_name(name: str) -> str:
    """Title-style casing for CSV display; ``|``-separated names each formatted."""
    if not name or not str(name).strip():
        return ""
    parts = [string.capwords(p.strip()) for p in str(name).split("|")]
    return " | ".join(parts)


def _title_case_commas(s: str) -> str:
    """Comma-separated clauses; each clause gets ``string.capwords``."""
    s = re.sub(r"\s+", " ", s.strip())
    if not s:
        return ""
    out: List[str] = []
    for p in s.split(","):
        p = p.strip()
        out.append(string.capwords(p) if p else "")
    return ", ".join(x for x in out if x)


def format_display_address(address: str) -> str:
    """
    Human-readable address: title case on the street/town part; trailing UK
    postcode kept in standard uppercase (e.g. ``NW5 1LE``).
    """
    if not address or not str(address).strip():
        return ""
    raw = str(address).strip()
    m = _RE_POSTCODE_END.search(raw)
    if m:
        before = raw[: m.start()].strip()
        outward, inward = m.group(1).upper(), m.group(2).upper()
        pc = f"{outward} {inward}"
        body = _title_case_commas(before) if before else ""
        return f"{body} {pc}".strip() if body else pc
    return _title_case_commas(raw)


def normalize_address_for_dedupe(address: str) -> str:
    """
    Deterministic key for grouping: uppercase, strip commas (FSA line breaks
    vary), collapse whitespace, normalize trailing UK postcode spacing. Does not
    expand abbreviations (St vs Street).
    """
    if not address or not str(address).strip():
        return ""
    t = str(address).strip().upper().replace(",", " ")
    t = re.sub(r"\s+", " ", t).strip()
    m = _RE_POSTCODE_END.search(t)
    if m:
        outward, inward = m.group(1).upper(), m.group(2).upper()
        rest = t[: m.start()].strip()
        t = f"{rest} {outward} {inward}".strip() if rest else f"{outward} {inward}"
    return t


def join_address(row: Dict[str, Any]) -> str:
    parts = [
        row.get("AddressLine1") or "",
        row.get("AddressLine2") or "",
        row.get("AddressLine3") or "",
        row.get("AddressLine4") or "",
        row.get("PostCode") or "",
    ]
    return ", ".join(p.strip() for p in parts if p and str(p).strip())


def normalise_establishment(raw: Dict[str, Any]) -> Dict[str, Any]:
    geo = raw.get("geocode") or {}
    lon = geo.get("longitude")
    lat = geo.get("latitude")
    try:
        lon_f = float(lon) if lon is not None and str(lon).strip() != "" else None
    except (TypeError, ValueError):
        lon_f = None
    try:
        lat_f = float(lat) if lat is not None and str(lat).strip() != "" else None
    except (TypeError, ValueError):
        lat_f = None

    pc = (raw.get("PostCode") or "").strip()
    return {
        "fhrs_id": raw.get("FHRSID"),
        "business_name": (raw.get("BusinessName") or "").strip(),
        "address_line1": (raw.get("AddressLine1") or "").strip(),
        "address_line2": (raw.get("AddressLine2") or "").strip(),
        "address_line3": (raw.get("AddressLine3") or "").strip(),
        "address_line4": (raw.get("AddressLine4") or "").strip(),
        "postcode": pc,
        "postcode_area": postcode_area_from_string(pc) or "",
        "address_single_line": join_address(raw),
        "local_authority_name": (raw.get("LocalAuthorityName") or "").strip(),
        "local_authority_code": (raw.get("LocalAuthorityCode") or "").strip(),
        "business_type": (raw.get("BusinessType") or "").strip(),
        "business_type_id": raw.get("BusinessTypeID"),
        "rating_value": (raw.get("RatingValue") or "").strip(),
        "rating_key": (raw.get("RatingKey") or "").strip(),
        "rating_date": (raw.get("RatingDate") or "").strip(),
        "scheme_type": (raw.get("SchemeType") or "").strip(),
        "longitude": lon_f,
        "latitude": lat_f,
        "new_rating_pending": raw.get("NewRatingPending"),
    }


def fetch_page(
    page_number: int,
    page_size: int,
    scheme_type_key: Optional[str],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    params: Dict[str, Any] = {
        "businessTypeId": BUSINESS_TYPE_PUB_BAR_NIGHTCLUB,
        "countryId": COUNTRY_ENGLAND,
        "pageNumber": page_number,
        "pageSize": page_size,
    }
    if scheme_type_key:
        params["schemeTypeKey"] = scheme_type_key

    query = urllib.parse.urlencode(params)
    url = f"{FHRS_BASE}/Establishments?{query}"
    req = urllib.request.Request(
        url,
        headers={
            "x-api-version": "2",
            "Accept": "application/json",
            "User-Agent": "pub-tracker/FSA-fetch",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
    data = json.loads(raw)

    establishments = data.get("establishments")
    if establishments is None:
        # Defensive: some clients wrap differently
        establishments = data.get("Establishments") or []

    meta = data.get("meta") or data.get("Meta") or {}
    return list(establishments), meta


def paginate_all(
    page_size: int,
    delay_s: float,
    scheme_type_key: Optional[str],
    max_pages: Optional[int],
) -> Iterable[Tuple[int, List[Dict[str, Any]], Dict[str, Any]]]:
    page = 1
    while True:
        rows, meta = fetch_page(page, page_size, scheme_type_key)
        yield page, rows, meta

        total_pages = int(meta.get("totalPages") or meta.get("TotalPages") or 0)
        if max_pages is not None and page >= max_pages:
            break
        if not rows:
            break
        if total_pages:
            if page >= total_pages:
                break
        elif len(rows) < page_size:
            # Last page when API omits totalPages
            break
        page += 1
        if delay_s > 0:
            time.sleep(delay_s)


def write_json(path: Path, records: List[Dict[str, Any]], meta_summary: Dict[str, Any]) -> None:
    payload = {
        "source": "https://api.ratings.food.gov.uk (FHRS API v2)",
        "business_type_id": BUSINESS_TYPE_PUB_BAR_NIGHTCLUB,
        "country_id": COUNTRY_ENGLAND,
        "summary": meta_summary,
        "count": len(records),
        "establishments": records,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def write_csv(path: Path, records: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not records:
        path.write_text("", encoding="utf-8")
        return
    fieldnames = list(records[0].keys())
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(records)


def write_minimal_csv(path: Path, records: List[Dict[str, Any]]) -> None:
    """Two columns: pub_name, address (from business_name + address_single_line)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=("pub_name", "address"),
            extrasaction="ignore",
        )
        w.writeheader()
        for r in records:
            w.writerow(
                {
                    "pub_name": r.get("business_name") or "",
                    "address": r.get("address_single_line") or "",
                }
            )


def load_establishments_from_json(path: Path) -> List[Dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data.get("establishments")
    if rows is None:
        raise ValueError(f"No 'establishments' array in {path}")
    return list(rows)


def group_by_normalized_address(
    records: List[Dict[str, Any]],
) -> Tuple[Dict[str, List[Dict[str, Any]]], int]:
    """Return mapping normalized_address -> list of rows, and count of duplicate rows (extras beyond first)."""
    buckets: DefaultDict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in records:
        addr = r.get("address_single_line") or ""
        key = normalize_address_for_dedupe(addr)
        if not key:
            key = f"__missing_address__:{r.get('fhrs_id')}"
        buckets[key].append(r)

    duplicate_extra = 0
    for _k, lst in buckets.items():
        if len(lst) > 1:
            duplicate_extra += len(lst) - 1
    return dict(buckets), duplicate_extra


def write_duplicate_addresses_csv(path: Path, records: List[Dict[str, Any]]) -> Tuple[int, int]:
    """
    One row per normalized address that appears more than once.
    Returns (number of duplicate groups, number of rows written).
    """
    buckets, _ = group_by_normalized_address(records)
    dup_groups = {k: v for k, v in buckets.items() if len(v) > 1 and not k.startswith("__missing")}
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = (
        "normalized_address",
        "occurrence_count",
        "fhrs_ids",
        "pub_names",
    )
    n_rows = 0
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for key in sorted(dup_groups.keys()):
            lst = dup_groups[key]
            w.writerow(
                {
                    "normalized_address": key,
                    "occurrence_count": len(lst),
                    "fhrs_ids": "|".join(str(x.get("fhrs_id") or "") for x in lst),
                    "pub_names": "|".join((x.get("business_name") or "").replace("|", "/") for x in lst),
                }
            )
            n_rows += 1
    return len(dup_groups), n_rows


def collapse_unique_by_address(records: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """
    One row per normalized address. If several FHRS rows share an address,
    pub_name lists distinct business names joined with `` | `` (sorted).
    """
    buckets, _ = group_by_normalized_address(records)
    result: List[Dict[str, str]] = []
    for key in sorted(buckets.keys()):
        lst = buckets[key]
        names: List[str] = []
        seen: Set[str] = set()
        for r in sorted(
            lst,
            key=lambda x: (str(x.get("business_name") or "").lower(), x.get("fhrs_id") or 0),
        ):
            n = (r.get("business_name") or "").strip()
            if n and n not in seen:
                seen.add(n)
                names.append(n)
        pub_name = " | ".join(names)
        candidates = [(r.get("address_single_line") or "").strip() for r in lst]
        address = max(candidates, key=len) if candidates else ""
        result.append({"pub_name": pub_name, "address": address})
    return result


def write_minimal_unique_csv(path: Path, records: List[Dict[str, Any]]) -> int:
    """Two columns, one row per distinct normalized address. Returns row count."""
    rows = collapse_unique_by_address(records)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=("pub_name", "address"),
            extrasaction="ignore",
        )
        w.writeheader()
        for row in rows:
            w.writerow(
                {
                    "pub_name": format_display_pub_name(row["pub_name"]),
                    "address": format_display_address(row["address"]),
                }
            )
    return len(rows)


def print_dedupe_summary(records: List[Dict[str, Any]], file=sys.stderr) -> None:
    buckets, duplicate_extra = group_by_normalized_address(records)
    n_addresses = len(buckets)
    n_dup_groups = sum(1 for k, v in buckets.items() if len(v) > 1 and not k.startswith("__missing"))
    n_rows = len(records)
    print(
        f"Dedupe: {n_rows} rows, {n_addresses} distinct normalized addresses, "
        f"{n_dup_groups} address(es) with multiple premises, "
        f"{duplicate_extra} extra row(s) beyond one per address.",
        file=file,
    )


def parse_args(argv: List[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Export London pubs from FSA FHRS API.")
    p.add_argument(
        "--output-prefix",
        default="data/fsa_london_pubs",
        help="Output path without extension; writes .json and .csv (default: data/fsa_london_pubs)",
    )
    p.add_argument("--page-size", type=int, default=500, help="FHRS page size (default 500)")
    p.add_argument("--delay", type=float, default=0.2, help="Seconds between page requests")
    p.add_argument(
        "--london-set",
        choices=("greater", "central"),
        default="greater",
        help="greater = GLA-style postcode areas; central = E/EC/N/NW/SE/SW/W/WC only",
    )
    p.add_argument(
        "--scheme-type-key",
        default="FHRS",
        help="Pass empty string to omit filter. Default FHRS (England/Wales/NI style scheme key).",
    )
    p.add_argument("--dry-run", action="store_true", help="Do not write files")
    p.add_argument("--max-pages", type=int, default=None, help="Stop after N pages (testing)")
    p.add_argument(
        "--require-geocode",
        action="store_true",
        help="Drop rows missing latitude/longitude",
    )
    p.add_argument(
        "--from-json",
        metavar="PATH",
        default=None,
        help="Load establishments from a prior export (same schema as written by this script); "
        "skips the API. If none of --write-minimal, --write-minimal-unique, or "
        "--dedupe-report is set, --write-minimal and --dedupe-report are enabled.",
    )
    p.add_argument(
        "--write-minimal",
        action="store_true",
        help="Write {prefix}_minimal.csv with columns pub_name, address.",
    )
    p.add_argument(
        "--write-minimal-unique",
        action="store_true",
        help="Write {prefix}_minimal_unique.csv: pub_name + address, one row per distinct "
        "normalized address (multiple names at same address joined with ' | ').",
    )
    p.add_argument(
        "--dedupe-report",
        action="store_true",
        help="Write {prefix}_duplicate_addresses.csv and print a dedupe summary.",
    )
    p.add_argument(
        "--write-full",
        action="store_true",
        help="With --from-json, also rewrite the full .json and .csv (default is post-process only).",
    )
    return p.parse_args(argv)


def main(argv: List[str]) -> int:
    args = parse_args(argv)
    out_prefix = Path(args.output_prefix)

    if args.from_json:
        if (
            not args.write_minimal
            and not args.dedupe_report
            and not args.write_minimal_unique
        ):
            args.write_minimal = True
            args.dedupe_report = True

    allowed = (
        CENTRAL_LONDON_GEO_POSTCODE_AREAS
        if args.london_set == "central"
        else GREATER_LONDON_POSTCODE_AREAS
    )

    scheme_key = (args.scheme_type_key or "").strip() or None

    kept: List[Dict[str, Any]] = []
    seen_ids: Set[Any] = set()
    skipped_no_pc = 0
    skipped_non_london = 0
    skipped_dup = 0
    skipped_geo = 0
    total_from_api = 0
    last_meta: Dict[str, Any] = {}

    if args.from_json:
        src = Path(args.from_json)
        if not src.is_file():
            print(f"File not found: {src}", file=sys.stderr)
            return 1
        try:
            kept = load_establishments_from_json(src)
        except (ValueError, json.JSONDecodeError, OSError) as e:
            print(f"Failed to read JSON: {e}", file=sys.stderr)
            return 1
        total_from_api = len(kept)
    else:
        try:
            for page_num, rows, meta in paginate_all(
                args.page_size, args.delay, scheme_key, args.max_pages
            ):
                last_meta = meta
                total_from_api += len(rows)
                for raw in rows:
                    norm = normalise_establishment(raw)
                    fid = norm["fhrs_id"]
                    if fid is None:
                        continue
                    if fid in seen_ids:
                        skipped_dup += 1
                        continue

                    pc = norm["postcode"]
                    if not pc:
                        skipped_no_pc += 1
                        continue
                    if not is_london_postcode(pc, allowed):
                        skipped_non_london += 1
                        continue

                    if args.require_geocode and (
                        norm["latitude"] is None or norm["longitude"] is None
                    ):
                        skipped_geo += 1
                        continue

                    seen_ids.add(fid)
                    kept.append(norm)

                print(
                    f"Page {page_num}: +{len(rows)} from API, "
                    f"cumulative London matches: {len(kept)}",
                    file=sys.stderr,
                )
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as e:
            print(f"HTTP/network error: {e}", file=sys.stderr)
            return 1
        except json.JSONDecodeError as e:
            print(f"Invalid JSON from API: {e}", file=sys.stderr)
            return 1

    kept.sort(key=lambda r: (r["postcode"], r["business_name"].lower()))

    summary: Dict[str, Any] = {
        "london_set": args.london_set,
        "allowed_postcode_area_prefixes": sorted(allowed),
        "pages_read_last_meta": last_meta,
        "rows_read_total": total_from_api,
        "rows_written": len(kept),
        "skipped_duplicate_fhrs_id": skipped_dup,
        "skipped_missing_postcode": skipped_no_pc,
        "skipped_non_london_postcode": skipped_non_london,
        "skipped_missing_geocode": skipped_geo,
    }
    if args.from_json:
        summary["loaded_from_json"] = str(Path(args.from_json).resolve())

    if args.dedupe_report:
        print_dedupe_summary(kept)

    if args.dry_run:
        print(json.dumps(summary, indent=2))
        return 0

    json_path = out_prefix.with_suffix(".json")
    csv_path = out_prefix.with_suffix(".csv")
    minimal_path = out_prefix.parent / f"{out_prefix.name}_minimal.csv"
    minimal_unique_path = out_prefix.parent / f"{out_prefix.name}_minimal_unique.csv"
    dup_path = out_prefix.parent / f"{out_prefix.name}_duplicate_addresses.csv"

    if not args.from_json or args.write_full:
        write_json(json_path, kept, summary)
        write_csv(csv_path, kept)
        print(f"Wrote {json_path} and {csv_path} ({len(kept)} establishments).", file=sys.stderr)

    if args.write_minimal:
        write_minimal_csv(minimal_path, kept)
        print(f"Wrote {minimal_path} (pub_name, address).", file=sys.stderr)

    if args.write_minimal_unique:
        n_u = write_minimal_unique_csv(minimal_unique_path, kept)
        print(
            f"Wrote {minimal_unique_path} ({n_u} row(s), one per distinct address).",
            file=sys.stderr,
        )

    if args.dedupe_report:
        n_groups, n_lines = write_duplicate_addresses_csv(dup_path, kept)
        print(
            f"Wrote {dup_path} ({n_groups} row(s), one per duplicate address).",
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
