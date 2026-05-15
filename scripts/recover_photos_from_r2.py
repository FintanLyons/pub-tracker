#!/usr/bin/env python3
"""
Recover photo URLs from R2 back into the CSV.

R2 key format:  pub_photos/{pub_id}/{slot}_{category}_{quality}.jpg
                e.g. pub_photos/node%2F858431027/1_exterior_0.85.jpg

For each pub in the CSV:
  - Lists all objects under pub_photos/{pub_id}/
  - Rebuilds photo_url1..5, photo_category1..5, photo_quality1..5
  - Sets photos_status=ok, photos_source=website (recovered)

Run:
  source .venv/bin/activate
  python3 scripts/recover_photos_from_r2.py
"""

from __future__ import annotations

import csv
import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    import boto3
    from dotenv import load_dotenv
except ImportError as exc:
    print(f"Missing dep: {exc}\n  pip install boto3 python-dotenv", file=sys.stderr)
    sys.exit(1)


BUCKET_PREFIX = "pub_photos/"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def r2_client(account_id: str, key_id: str, secret: str):
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        region_name="auto",
    )


def list_all_pub_photos(client, bucket: str) -> Dict[str, List[str]]:
    """
    Returns {pub_id_raw: [key, ...]} for every object under pub_photos/.
    Handles pagination automatically.
    """
    by_pub: Dict[str, List[str]] = {}
    paginator = client.get_paginator("list_objects_v2")
    pages = paginator.paginate(Bucket=bucket, Prefix=BUCKET_PREFIX)
    total = 0
    for page in pages:
        for obj in page.get("Contents", []):
            key = obj["Key"]
            # key = pub_photos/<pub_id>/<filename>
            # pub_id may itself contain slashes (e.g. node/858431027)
            # so split from the RIGHT: last segment = filename, everything else = pub_id
            after_prefix = key[len(BUCKET_PREFIX):]
            if "/" not in after_prefix:
                continue
            pub_id_raw, filename = after_prefix.rsplit("/", 1)
            if not filename:
                continue
            by_pub.setdefault(pub_id_raw, []).append(key)
            total += 1
    print(f"Found {total} objects across {len(by_pub)} pubs in R2")
    return by_pub


def parse_filename(filename: str) -> Tuple[Optional[int], str, float]:
    """
    Parse  '1_exterior_0.85.jpg'  →  (slot=1, category='exterior', quality=0.85)
    Returns (None, '', 0.0) on parse failure.
    """
    m = re.match(r"^(\d+)_([^_]+)_([\d.]+)\.jpg$", filename, re.I)
    if not m:
        return None, "", 0.0
    return int(m.group(1)), m.group(2), float(m.group(3))


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Recover photo URLs from R2 into CSV.")
    parser.add_argument("--input", "-i", type=Path,
        default=repo_root() / "data" / "data_list_photos_enriched.csv")
    parser.add_argument("--output", "-o", type=Path,
        default=None,
        help="Output path (defaults to same as input)")
    args = parser.parse_args()

    in_path  = args.input
    out_path = args.output or in_path

    load_dotenv(repo_root() / ".env")

    account_id  = os.getenv("R2_ACCOUNT_ID")
    key_id      = os.getenv("R2_ACCESS_KEY_ID")
    secret      = os.getenv("R2_SECRET_ACCESS_KEY")
    bucket      = os.getenv("R2_BUCKET_NAME", "pub-tracker")
    public_base = os.getenv("R2_PUBLIC_BASE_URL", "").rstrip("/")

    if not all([account_id, key_id, secret, public_base]):
        print("R2 env vars incomplete", file=sys.stderr)
        sys.exit(1)

    if not in_path.is_file():
        print(f"CSV not found: {in_path}", file=sys.stderr)
        sys.exit(1)

    print("Listing R2 bucket…")
    client = r2_client(account_id, key_id, secret)
    by_pub = list_all_pub_photos(client, bucket)

    if not by_pub:
        print("No pub_photos/ objects found in bucket — nothing to recover.")
        return

    print(f"\nLoading CSV: {in_path}")
    with in_path.open(encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = [dict(r) for r in reader]

    # Ensure photo columns exist
    for i in range(1, 6):
        for col in [f"photo_url{i}", f"photo_category{i}", f"photo_quality{i}"]:
            if col not in fieldnames:
                fieldnames.append(col)
    for col in ["photos_status", "photos_error", "photos_source", "photos_count"]:
        if col not in fieldnames:
            fieldnames.append(col)

    for row in rows:
        for col in fieldnames:
            row.setdefault(col, "")

    recovered = 0
    already_had = 0
    not_in_r2 = 0

    for row in rows:
        pub_id = (row.get("id") or "").strip()
        if not pub_id:
            continue

        # R2 keys use the raw pub_id (slashes preserved, NOT url-encoded by boto3 listing)
        keys = by_pub.get(pub_id, [])

        if not keys:
            not_in_r2 += 1
            continue

        if (row.get("photo_url1") or "").strip().startswith("https://pub_photos") or \
           (row.get("photo_url1") or "").strip().startswith(public_base + "/pub_photos"):
            already_had += 1
            # Still overwrite to ensure consistency
        
        # Parse and sort by slot number
        parsed: List[Tuple[int, str, float, str]] = []  # slot, category, quality, key
        for key in keys:
            filename = key.split("/")[-1]
            slot, category, quality = parse_filename(filename)
            if slot is None:
                continue
            parsed.append((slot, category, quality, key))

        parsed.sort(key=lambda x: x[0])

        # Clear existing photo columns
        for i in range(1, 6):
            row[f"photo_url{i}"] = ""
            row[f"photo_category{i}"] = ""
            row[f"photo_quality{i}"] = ""

        filled = 0
        for slot, category, quality, key in parsed[:5]:
            public_url = f"{public_base}/{key}"
            row[f"photo_url{slot}"] = public_url
            row[f"photo_category{slot}"] = category
            row[f"photo_quality{slot}"] = f"{quality:.2f}"
            filled += 1

        if filled:
            row["photos_status"] = "ok"
            row["photos_error"] = ""
            row["photos_source"] = "website_recovered_from_r2"
            row["photos_count"] = str(filled)
            recovered += 1

    print(f"\nResults:")
    print(f"  Recovered from R2 : {recovered}")
    print(f"  Not in R2         : {not_in_r2}")

    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nSaved → {out_path}")
    print(f"Now run Firecrawl retry for the remaining {not_in_r2} unrecovered pubs.")


if __name__ == "__main__":
    main()
