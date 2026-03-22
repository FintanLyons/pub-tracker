#!/usr/bin/env python3
"""
Fill pub_spatial_assignments.postcode_district / postcode_area when SQL backfill left them empty.

Strategy
--------
1. Parse UK postcode from pubs_all.address (robust regex + optional compact form).
2. If still missing, reverse-geocode with postcodes.io using lat/lon (nearest postcode).
   Uses widesearch=true on retry if the default radius returns nothing.

Why SQL might fill nothing
--------------------------
Addresses often omit postcodes or use formats the SQL regex misses; coordinates still work.

Setup
-----
  pip install supabase python-dotenv requests

  .env (use **service_role** key so RLS does not block updates):
    SUPABASE_URL=https://xxxx.supabase.co
    SUPABASE_KEY=eyJ...service_role...

Run
---
  python3 scripts/backfill_spatial_postcodes_from_latlon.py --dry-run --limit 20
  python3 scripts/backfill_spatial_postcodes_from_latlon.py --delay 0.12
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from typing import Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
POSTCODES_IO = "https://api.postcodes.io/postcodes"

PAGE_SIZE = 300


def row_needs_postcode(row: dict) -> bool:
    """Treat NULL, empty string, or whitespace-only as missing."""
    d = row.get("postcode_district")
    a = row.get("postcode_area")
    ds = (d if isinstance(d, str) else d or "").strip() if d is not None else ""
    aa = (a if isinstance(a, str) else a or "").strip() if a is not None else ""
    return not ds or not aa


def extract_postcode_from_address(address: str) -> Optional[str]:
    if not address or not str(address).strip():
        return None
    text = str(address).upper().replace("\n", " ").replace("\r", " ")
    # Spaced form: NW5 1LE, SW1A 2AA
    pattern_spaced = r"\b([A-Z]{1,2}[0-9]{1,2}[A-Z]?\s+[0-9][A-Z]{2})\b"
    # Compact: SW1A1AA (no space before inward)
    pattern_compact = r"\b([A-Z]{1,2}[0-9]{1,2}[A-Z]?[0-9][A-Z]{2})\b"
    matches = re.findall(pattern_spaced, text) or re.findall(pattern_compact, text)
    if not matches:
        return None
    postcode = matches[-1].strip()
    if " " not in postcode and len(postcode) > 5:
        postcode = postcode[:-3] + " " + postcode[-3:]
    return postcode


def outward_and_area_from_full_postcode(full_pc: str) -> Optional[Tuple[str, str]]:
    """Return (postcode_district, postcode_area) e.g. ('SW1A', 'SW')."""
    compact = re.sub(r"\s+", "", full_pc.upper())
    if len(compact) < 5:
        return None
    inward = compact[-3:]
    if not re.match(r"^[0-9][A-Z]{2}$", inward):
        return None
    outward = compact[:-3]
    if not outward:
        return None
    m = re.match(r"^([A-Z]+)", outward)
    area = m.group(1) if m else ""
    if not area:
        return None
    return outward, area


def nearest_postcode_outcode(
    lon: float,
    lat: float,
    session: requests.Session,
    widesearch: bool = False,
) -> Optional[Tuple[str, str]]:
    try:
        params: Dict = {"lon": lon, "lat": lat, "limit": 1}
        if widesearch:
            params["widesearch"] = "true"
        r = session.get(POSTCODES_IO, params=params, timeout=15)
        r.raise_for_status()
        data = r.json()
        if data.get("status") != 200 or not data.get("result"):
            return None
        first = data["result"][0]
        outcode = first.get("outcode")
        if not outcode:
            return None
        outcode = str(outcode).strip().upper()
        m = re.match(r"^([A-Z]+)", outcode)
        area = m.group(1) if m else ""
        if not area:
            return None
        return outcode, area
    except Exception as e:
        print(f"  reverse geocode error: {e}", file=sys.stderr)
        return None


def fetch_pubs_by_ids(supabase, pub_ids: List[str]) -> Dict[str, dict]:
    if not pub_ids:
        return {}
    out: Dict[str, dict] = {}
    # .in_ chunk size (URL length); stay conservative
    chunk = 120
    for i in range(0, len(pub_ids), chunk):
        part = pub_ids[i : i + chunk]
        res = (
            supabase.table("pubs_all")
            .select("id, address, lat, lon")
            .in_("id", part)
            .execute()
        )
        for row in res.data or []:
            out[str(row["id"])] = row
    return out


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill pub_spatial_assignments postcodes via address + lat/lon",
    )
    parser.add_argument("--dry-run", action="store_true", help="Do not write to Supabase")
    parser.add_argument("--limit", type=int, default=0, help="Max pubs to update (0 = all)")
    parser.add_argument(
        "--delay",
        type=float,
        default=0.12,
        help="Seconds after each postcodes.io request (rate limiting)",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Print each update")
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Set SUPABASE_URL and SUPABASE_KEY in .env", file=sys.stderr)
        sys.exit(1)

    if "service_role" not in (SUPABASE_KEY or "") and "eyJ" in (SUPABASE_KEY or ""):
        # Heuristic: anon keys often fail updates under RLS
        print(
            "Note: If updates fail with permission errors, use the **service_role** "
            "key from Supabase Dashboard → Settings → API (not the anon key).\n",
            file=sys.stderr,
        )

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    session = requests.Session()

    processed = 0
    updated = 0
    from_addr = 0
    from_geo = 0
    skipped_no_latlon = 0
    skipped_no_pub = 0
    failed_update = 0
    start = 0

    while True:
        res = (
            supabase.table("pub_spatial_assignments")
            .select("pub_id, postcode_district, postcode_area")
            .order("pub_id")
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break

        todo = [r for r in rows if row_needs_postcode(r)]
        pub_ids = [str(r["pub_id"]) for r in todo]
        pubs_by_id = fetch_pubs_by_ids(supabase, pub_ids)

        for row in todo:
            if args.limit and updated >= args.limit:
                break

            pub_id = str(row["pub_id"])
            processed += 1
            pub = pubs_by_id.get(pub_id)
            if not pub:
                skipped_no_pub += 1
                continue

            district: Optional[str] = None
            area: Optional[str] = None
            addr = pub.get("address") or ""

            full_pc = extract_postcode_from_address(addr)
            if full_pc:
                parsed = outward_and_area_from_full_postcode(full_pc)
                if parsed:
                    district, area = parsed
                    from_addr += 1

            if (not district or not area) and pub.get("lat") is not None and pub.get("lon") is not None:
                try:
                    lat = float(pub["lat"])
                    lon = float(pub["lon"])
                except (TypeError, ValueError):
                    lat = lon = None
                if lat is not None and lon is not None:
                    geo = nearest_postcode_outcode(lon, lat, session, widesearch=False)
                    time.sleep(max(0, args.delay))
                    if not geo:
                        geo = nearest_postcode_outcode(lon, lat, session, widesearch=True)
                        time.sleep(max(0, args.delay))
                    if geo:
                        district, area = geo
                        from_geo += 1
            elif not district or not area:
                skipped_no_latlon += 1

            if not district or not area:
                if args.verbose:
                    print(f"[skip] {pub_id} no postcode from address and no usable lat/lon")
                continue

            if args.verbose or args.dry_run:
                print(f"{'[dry-run] ' if args.dry_run else ''}{pub_id} -> {district} / {area}")

            if args.dry_run:
                updated += 1
                continue

            try:
                ur = (
                    supabase.table("pub_spatial_assignments")
                    .update({"postcode_district": district, "postcode_area": area})
                    .eq("pub_id", pub_id)
                    .execute()
                )
                if not ur.data:
                    print(
                        f"  No row updated for {pub_id} (RLS or wrong key? use service_role).",
                        file=sys.stderr,
                    )
                    failed_update += 1
                    continue
                updated += 1
            except Exception as e:
                print(f"  Update failed {pub_id}: {e}", file=sys.stderr)
                failed_update += 1

        if args.limit and updated >= args.limit:
            break
        if len(rows) < PAGE_SIZE:
            break
        start += PAGE_SIZE

    print(
        f"Done. assignment_rows_seen={processed} updated={updated} "
        f"from_address={from_addr} from_reverse_geocode={from_geo} "
        f"failed_updates={failed_update} missing_pub_row={skipped_no_pub} "
        f"no_latlon_for_geocode={skipped_no_latlon}"
    )


if __name__ == "__main__":
    main()
