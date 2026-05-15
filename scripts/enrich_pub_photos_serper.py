#!/usr/bin/env python3
"""
Enrich pub photos using Serper image search → AI exterior pick → Cloudflare R2.

Targets rows that have no photo_url1 (regardless of whether they have a website).
Uses 1 Serper credit per pub.

Flow
----
1. Build a precise query: "{name}" pub "{postcode_district}" London
   Fallback: "{name}" pub "{addr_street}" London
2. POST to https://google.serper.dev/images — 1 credit, returns ~10 image URLs
3. Download + validate candidates (min 400px, dedupe hash)
4. Single AI batch call to pick best exterior (same prompt as website pipeline)
5. Resize to 800px, upload to R2 at pub_photos/{pub_id}/{slot}_serper_{quality}.jpg
6. Write photo_url1..5, photos_status=ok back to CSV

Prerequisites
-------------
  source .venv/bin/activate
  pip install -r scripts/requirements_photo_scraping.txt   # already includes all deps

  .env:
    SERPER_API_KEY=...
    OPENAI_API_KEY=...
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_BASE_URL

Usage
-----
  # Dry run: show queries + eligible count, no API calls
  python3 scripts/enrich_pub_photos_serper.py --dry-run

  # Test 10 pubs
  python3 scripts/enrich_pub_photos_serper.py --limit 10 --seed 1

  # Full run on all no-image pubs
  python3 scripts/enrich_pub_photos_serper.py

  # Skip pubs that already have any photo (default: already skipped; explicit flag for clarity)
  python3 scripts/enrich_pub_photos_serper.py --skip-with-photos
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import os
import random
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

try:
    import requests
    from dotenv import load_dotenv
    from openai import OpenAI
    import enrich_pub_photos_from_websites as pu
except ImportError as exc:
    print(
        f"Missing dependency: {exc}\n"
        "  source .venv/bin/activate\n"
        "  pip install -r scripts/requirements_photo_scraping.txt",
        file=sys.stderr,
    )
    sys.exit(1)

SERPER_IMAGES_URL = "https://google.serper.dev/images"
CHECKPOINT_EVERY = 25
MIN_IMAGE_SIZE_PX = 400
MAX_IMAGES_TO_DOWNLOAD = 10


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


# ---------------------------------------------------------------------------
# Query building
# ---------------------------------------------------------------------------

def build_query(row: Dict[str, str]) -> str:
    """
    Build the most specific possible image search query for a pub.
    Postcode district is the accuracy lever — it disambiguates pubs with identical names.
    """
    name = (row.get("name") or "").strip()
    district = (row.get("calc_postcode_district") or "").strip()
    street = (row.get("addr_street") or "").strip()

    if district:
        return f'"{name}" pub "{district}" London'
    elif street:
        return f'"{name}" pub "{street}" London'
    else:
        return f'"{name}" pub London'


# ---------------------------------------------------------------------------
# Serper image search
# ---------------------------------------------------------------------------

def serper_image_search(
    query: str,
    api_key: str,
    session: requests.Session,
    num: int = 10,
) -> Tuple[List[str], str]:
    """
    Call Serper /images endpoint. Returns (image_urls, error_string).
    1 credit per call.
    """
    headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}
    body = {"q": query, "num": num, "gl": "uk", "hl": "en"}
    try:
        resp = session.post(SERPER_IMAGES_URL, headers=headers, json=body, timeout=30)
        resp.raise_for_status()
        data = resp.json()
    except requests.Timeout:
        return [], "serper_timeout"
    except requests.HTTPError as exc:
        return [], f"serper_http:{exc.response.status_code}"
    except Exception as exc:
        return [], f"serper_error:{str(exc)[:100]}"

    images = data.get("images") or []
    urls = []
    for img in images:
        if not isinstance(img, dict):
            continue
        # Serper returns imageUrl (direct) and thumbnailUrl — prefer imageUrl
        url = (img.get("imageUrl") or img.get("thumbnailUrl") or "").strip()
        if url and url.startswith("http"):
            urls.append(url)

    if not urls:
        return [], "no_image_results"

    return urls, ""


# ---------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------

def eligible(row: Dict[str, str], skip_with_photos: bool) -> bool:
    if not (row.get("name") or "").strip():
        return False
    if skip_with_photos:
        if any((row.get(f"photo_url{i}") or "").strip() for i in range(1, 6)):
            return False
    else:
        # Default: only process rows with NO photos at all
        if any((row.get(f"photo_url{i}") or "").strip() for i in range(1, 6)):
            return False
    return True


# ---------------------------------------------------------------------------
# Per-pub processing
# ---------------------------------------------------------------------------

def process_pub(
    row: Dict[str, str],
    query: str,
    api_key: str,
    session: requests.Session,
    client: Any,
    r2_config: Dict[str, str],
    dry_run: bool,
    delay: float,
) -> Dict[str, str]:
    pub_id = (row.get("id") or "unknown").strip()
    pub_name = (row.get("name") or "?").strip()

    print(f"  Query: {query}")

    if dry_run:
        row["photos_status"] = "dry_run"
        row["photos_source"] = "serper"
        return row

    image_urls, search_err = serper_image_search(query, api_key, session)
    if search_err:
        print(f"  ❌ Search failed: {search_err}")
        row["photos_status"] = "scrape_failed"
        row["photos_error"] = search_err
        row["photos_source"] = "serper"
        row["photos_count"] = "0"
        return row

    print(f"  Found {len(image_urls)} image URLs from Serper")

    # Download and validate
    valid_images: List[Tuple[str, bytes, int, int]] = []
    seen_hashes = set()

    for url in image_urls[:MAX_IMAGES_TO_DOWNLOAD]:
        img_bytes, width, height, err = pu.download_and_validate_image(
            url, min_size=MIN_IMAGE_SIZE_PX
        )
        if err:
            print(f"    Skip: {url[:70]}... ({err})")
            continue
        h = hashlib.md5(img_bytes).hexdigest()
        if h in seen_hashes:
            print(f"    Skip: {url[:70]}... (duplicate)")
            continue
        seen_hashes.add(h)
        valid_images.append((url, img_bytes, width, height))
        print(f"    ✓ {width}x{height}px")

    if not valid_images:
        print("  ❌ No valid images after download")
        row["photos_status"] = "no_images_found"
        row["photos_error"] = "no_valid_images_after_download"
        row["photos_source"] = "serper"
        row["photos_count"] = "0"
        return row

    # AI: pick best exterior
    address_parts = [
        row.get("addr_housenumber", ""),
        row.get("addr_street", ""),
        row.get("calc_postcode_district", ""),
    ]
    address = " ".join(p for p in address_parts if p)

    print(f"  Sending {len(valid_images)} images to AI…")
    image_bytes_list = [b for (_, b, _, _) in valid_images]
    ai_result = pu.pick_best_exterior_batch(client, image_bytes_list, pub_name, address)

    exterior_idx = 0
    exterior_quality = 0.0
    relevant_set: set = set()
    if ai_result:
        exterior_idx = int(ai_result.get("best_exterior_index") or 0)
        exterior_quality = float(ai_result.get("exterior_quality") or 0.0)
        relevant_set = set(ai_result.get("relevant_indices") or [])

    if exterior_idx < 1 or exterior_idx > len(valid_images):
        exterior_idx = 0

    if not relevant_set:
        relevant_set = set(range(1, len(valid_images) + 1))

    selected: List[Tuple[str, bytes, str, float]] = []
    used: set = set()

    if exterior_idx > 0:
        url, img_bytes, _, _ = valid_images[exterior_idx - 1]
        selected.append((url, img_bytes, "exterior", exterior_quality))
        used.add(exterior_idx - 1)
        print(f"    → Exterior pick: #{exterior_idx} (Q: {exterior_quality:.2f})")
    else:
        print("    → No exterior identified")

    for i, (url, img_bytes, _, _) in enumerate(valid_images):
        one_based = i + 1
        if i in used:
            continue
        if one_based not in relevant_set:
            print(f"    Skip (AI: not relevant): image #{one_based}")
            continue
        if len(selected) >= 5:
            break
        selected.append((url, img_bytes, "other", 0.5))

    if not selected:
        row["photos_status"] = "all_rejected"
        row["photos_error"] = "no_images_selected"
        row["photos_source"] = "serper"
        row["photos_count"] = "0"
        return row

    # Upload to R2
    uploaded = 0
    for slot, (url, img_bytes, category, quality) in enumerate(selected, start=1):
        resized = pu.resize_image(img_bytes)
        r2_key = f"pub_photos/{pub_id}/{slot}_serper_{quality:.2f}.jpg"

        ok = pu.upload_to_r2(
            resized,
            r2_key,
            r2_config["account_id"],
            r2_config["access_key_id"],
            r2_config["secret_access_key"],
            r2_config["bucket_name"],
        )
        if not ok:
            print(f"    ❌ R2 upload failed slot {slot}")
            continue

        public_url = f"{r2_config['public_base_url']}/{r2_key}"
        row[f"photo_url{slot}"] = public_url
        row[f"photo_category{slot}"] = category
        row[f"photo_quality{slot}"] = f"{quality:.2f}"
        uploaded += 1
        print(f"    ✓ Slot {slot} uploaded ({category})")

    row["photos_status"] = "ok"
    row["photos_error"] = ""
    row["photos_source"] = "serper"
    row["photos_count"] = str(uploaded)
    print(f"  ✅ {uploaded} photos uploaded")

    time.sleep(delay)
    return row


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Enrich pub photos via Serper image search → AI pick → R2."
    )
    parser.add_argument(
        "--input", "-i",
        type=Path,
        default=repo_root() / "data" / "data_list_photos_enriched.csv",
        help="Input CSV (default: data/data_list_photos_enriched.csv)",
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=repo_root() / "data" / "data_list_photos_enriched.csv",
        help="Output CSV — overwrites in place by default",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Max pubs to process (random sample if set)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="RNG seed for reproducible sampling",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Seconds between pubs (default: 1.0)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show eligible count and queries; no Serper/OpenAI/R2 calls.",
    )
    parser.add_argument(
        "--skip-with-photos",
        action="store_true",
        help="Skip pubs that already have any photo_url set (default behaviour anyway).",
    )
    args = parser.parse_args()

    load_dotenv(repo_root() / ".env")

    serper_key = os.getenv("SERPER_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    r2_config = {
        "account_id":      os.getenv("R2_ACCOUNT_ID"),
        "access_key_id":   os.getenv("R2_ACCESS_KEY_ID"),
        "secret_access_key": os.getenv("R2_SECRET_ACCESS_KEY"),
        "bucket_name":     os.getenv("R2_BUCKET_NAME", "pub-tracker"),
        "public_base_url": (os.getenv("R2_PUBLIC_BASE_URL") or "").rstrip("/"),
    }

    if not args.dry_run:
        if not serper_key:
            print("SERPER_API_KEY not set in .env", file=sys.stderr)
            sys.exit(1)
        if not openai_key:
            print("OPENAI_API_KEY not set in .env", file=sys.stderr)
            sys.exit(1)
        if not all(r2_config.values()):
            missing = [k for k, v in r2_config.items() if not v]
            print(f"R2 config incomplete — missing: {missing}", file=sys.stderr)
            sys.exit(1)

    if not args.input.is_file():
        print(f"Input not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    fieldnames, all_rows = pu.read_csv(args.input)
    out_fields = pu.build_fieldnames(fieldnames)
    for row in all_rows:
        for col in out_fields:
            row.setdefault(col, "")

    eligible_idx = [
        i for i, r in enumerate(all_rows)
        if eligible(r, args.skip_with_photos)
    ]

    if args.limit is not None and len(eligible_idx) > args.limit:
        rng = random.Random(args.seed)
        eligible_idx = rng.sample(eligible_idx, args.limit)

    total = len(eligible_idx)
    chosen = set(eligible_idx)

    print(f"Input rows     : {len(all_rows)}")
    print(f"Eligible       : {total}")
    print(f"Serper credits : ~{total} (1 per pub)")
    print(f"Dry run        : {args.dry_run}")
    print()

    if total == 0:
        print("Nothing to process.")
        return

    if args.dry_run:
        print("Sample queries (first 10):")
        for i in list(eligible_idx)[:10]:
            r = all_rows[i]
            print(f"  {r.get('name','?')[:40]:40s} → {build_query(r)}")
        return

    client = OpenAI(api_key=openai_key)
    session = requests.Session()
    session.headers.update({"User-Agent": "pub-tracker-photo-serper/1.0"})

    ok = failed = counter = 0

    for i, row in enumerate(all_rows):
        if i not in chosen:
            continue
        counter += 1
        pub_name = (row.get("name") or "?")[:45]
        print(f"\n[{counter}/{total}] {pub_name}")

        query = build_query(row)

        try:
            all_rows[i] = process_pub(
                all_rows[i],
                query,
                serper_key,
                session,
                client,
                r2_config,
                args.dry_run,
                args.delay,
            )
            if all_rows[i].get("photos_status") == "ok":
                ok += 1
            else:
                failed += 1

            if counter % CHECKPOINT_EVERY == 0:
                pu.write_csv(args.output, out_fields, all_rows)
                print(f"  [checkpoint] Saved → {args.output}")

        except KeyboardInterrupt:
            if counter > 0:
                print("\nInterrupted — saving progress…")
                pu.write_csv(args.output, out_fields, all_rows)
            else:
                print("\nInterrupted before any pubs processed — file NOT overwritten.")
            break
        except Exception as exc:
            print(f"  ❌ Unexpected: {exc}")
            all_rows[i]["photos_status"] = "error"
            all_rows[i]["photos_error"] = str(exc)[:200]
            all_rows[i]["photos_source"] = "serper"
            failed += 1

    if counter > 0:
        pu.write_csv(args.output, out_fields, all_rows)

    print(f"\n{'=' * 60}")
    print(f"Wrote     : {args.output}")
    print(f"Processed : {counter}")
    print(f"Success   : {ok}")
    print(f"Failed    : {failed}")


if __name__ == "__main__":
    main()
