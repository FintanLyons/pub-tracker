#!/usr/bin/env python3
"""
Download Wikidata/Wikimedia photos and re-host them on Cloudflare R2.

For every row where photo_url1..5 is a Wikimedia Commons URL:
  1. Download the image (follows Special:FilePath redirect to actual file).
  2. Resize to max 800px width (same as website pipeline).
  3. Upload to R2 at  pub_photos/{pub_id}/{slot}_wikidata_1.00.jpg
  4. Replace the column value with the R2 public URL.

If a Wikimedia URL is inaccessible (any HTTP/network error), the column
is cleared so the app does not show a broken link.

Run:
  source .venv/bin/activate
  python3 scripts/migrate_wikidata_photos_to_r2.py

Dry run (no uploads, no CSV write):
  python3 scripts/migrate_wikidata_photos_to_r2.py --dry-run
"""

from __future__ import annotations

import argparse
import csv
import io
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    import boto3
    import requests
    from dotenv import load_dotenv
    from PIL import Image
except ImportError as exc:
    print(
        f"Missing dependency: {exc}\n"
        "  source .venv/bin/activate\n"
        "  pip install -r scripts/requirements_photo_scraping.txt",
        file=sys.stderr,
    )
    sys.exit(1)


WIKIMEDIA_NETLOCS = {"commons.wikimedia.org", "upload.wikimedia.org"}
MAX_WIDTH = 800
JPEG_QUALITY = 85
REQUEST_TIMEOUT = 20
DELAY_BETWEEN_PUBS = 0.5
CHECKPOINT_EVERY = 25

HEADERS = {
    "User-Agent": "PubTrackerBot/1.0 (https://github.com/; pub-tracker data pipeline)",
}


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def is_wikimedia_url(url: str) -> bool:
    from urllib.parse import urlparse
    try:
        return urlparse(url).netloc in WIKIMEDIA_NETLOCS
    except Exception:
        return False


def download_image(url: str) -> Tuple[Optional[bytes], str]:
    """
    Download image from URL (follows redirects).
    Returns (bytes, "") on success or (None, error_string) on failure.
    """
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        if resp.status_code == 404:
            return None, "http_error:404"
        resp.raise_for_status()
        ct = resp.headers.get("content-type", "").lower()
        if "image" not in ct and not url.lower().split("?")[0].endswith(
            (".jpg", ".jpeg", ".png", ".webp")
        ):
            return None, f"not_image:{ct}"
        if len(resp.content) < 1000:
            return None, "file_too_small"
        return resp.content, ""
    except requests.Timeout:
        return None, "timeout"
    except requests.HTTPError as exc:
        return None, f"http_error:{exc.response.status_code}"
    except Exception as exc:
        return None, f"download_error:{str(exc)[:100]}"


def resize_image(image_bytes: bytes) -> bytes:
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode in ("RGBA", "LA", "P"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        bg.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
        img = bg
    elif img.mode != "RGB":
        img = img.convert("RGB")
    if img.width > MAX_WIDTH:
        ratio = MAX_WIDTH / img.width
        new_h = max(1, int(img.height * ratio))
        img = img.resize((MAX_WIDTH, new_h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buf.getvalue()


def r2_client(account_id: str, key_id: str, secret: str):
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        region_name="auto",
    )


def upload_to_r2(
    client,
    image_bytes: bytes,
    key: str,
    bucket: str,
) -> bool:
    try:
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=image_bytes,
            ContentType="image/jpeg",
        )
        return True
    except Exception as exc:
        print(f"    R2 upload error: {exc}")
        return False


def process_row(
    row: Dict[str, str],
    client,
    bucket: str,
    public_base: str,
    dry_run: bool,
) -> Tuple[Dict[str, str], int, int]:
    """
    Returns (updated_row, migrated_count, cleared_count).
    """
    pub_id = (row.get("id") or "").strip()
    migrated = cleared = 0

    for slot in range(1, 6):
        col = f"photo_url{slot}"
        url = (row.get(col) or "").strip()
        if not url or not is_wikimedia_url(url):
            continue

        print(f"    slot {slot}: {url[:80]}")

        img_bytes, err = download_image(url)
        if err:
            print(f"      ❌ {err} — clearing")
            row[col] = ""
            row[f"photo_category{slot}"] = ""
            row[f"photo_quality{slot}"] = ""
            cleared += 1
            continue

        resized = resize_image(img_bytes)
        r2_key = f"pub_photos/{pub_id}/{slot}_wikidata_1.00.jpg"
        public_url = f"{public_base}/{r2_key}"

        if dry_run:
            print(f"      [dry-run] would upload → {public_url}")
            row[col] = public_url
        else:
            ok = upload_to_r2(client, resized, r2_key, bucket)
            if ok:
                row[col] = public_url
                row[f"photo_category{slot}"] = "wikidata"
                row[f"photo_quality{slot}"] = "1.00"
                print(f"      ✓ → {public_url}")
                migrated += 1
            else:
                print(f"      ❌ R2 upload failed — leaving original URL")

    # If any slot was migrated, update source; if ALL wiki slots are now gone, note it
    wiki_remaining = sum(
        1 for s in range(1, 6) if is_wikimedia_url(row.get(f"photo_url{s}") or "")
    )
    r2_slots = sum(
        1 for s in range(1, 6) if "pub_photos/" in (row.get(f"photo_url{s}") or "")
    )

    if migrated > 0:
        row["photos_source"] = "wikidata_r2"
        row["photos_status"] = "ok"
        row["photos_count"] = str(r2_slots)

    return row, migrated, cleared


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Migrate Wikimedia photo URLs to Cloudflare R2."
    )
    parser.add_argument(
        "--input", "-i",
        type=Path,
        default=repo_root() / "data" / "data_list_photos_enriched.csv",
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=repo_root() / "data" / "data_list_photos_enriched.csv",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Download and resize but do NOT upload to R2 or write CSV.",
    )
    args = parser.parse_args()

    load_dotenv(repo_root() / ".env")

    account_id  = os.getenv("R2_ACCOUNT_ID")
    key_id      = os.getenv("R2_ACCESS_KEY_ID")
    secret      = os.getenv("R2_SECRET_ACCESS_KEY")
    bucket      = os.getenv("R2_BUCKET_NAME", "pub-tracker")
    public_base = os.getenv("R2_PUBLIC_BASE_URL", "").rstrip("/")

    if not all([account_id, key_id, secret, public_base]):
        print("R2 env vars incomplete", file=sys.stderr)
        sys.exit(1)

    if not args.input.is_file():
        print(f"Input not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    with args.input.open(encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = [dict(r) for r in reader]

    for col in ["photos_status", "photos_error", "photos_source", "photos_count"]:
        if col not in fieldnames:
            fieldnames.append(col)
    for i in range(1, 6):
        for col in [f"photo_url{i}", f"photo_category{i}", f"photo_quality{i}"]:
            if col not in fieldnames:
                fieldnames.append(col)
    for row in rows:
        for col in fieldnames:
            row.setdefault(col, "")

    # Find rows with at least one Wikimedia URL
    targets = [
        i for i, r in enumerate(rows)
        if any(is_wikimedia_url(r.get(f"photo_url{s}") or "") for s in range(1, 6))
    ]

    print(f"Total rows          : {len(rows)}")
    print(f"Rows with Wikimedia : {len(targets)}")
    print(f"Dry run             : {args.dry_run}")
    print()

    if not targets:
        print("Nothing to migrate.")
        return

    client = r2_client(account_id, key_id, secret)

    total_migrated = total_cleared = counter = 0

    for idx, i in enumerate(targets, start=1):
        row = rows[i]
        pub_name = (row.get("name") or "?")[:45]
        print(f"[{idx}/{len(targets)}] {pub_name}")

        rows[i], migrated, cleared = process_row(
            row, client, bucket, public_base, args.dry_run
        )
        total_migrated += migrated
        total_cleared += cleared
        counter += 1

        time.sleep(DELAY_BETWEEN_PUBS)

        if not args.dry_run and counter % CHECKPOINT_EVERY == 0:
            with args.output.open("w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
                w.writeheader()
                w.writerows(rows)
            print(f"  [checkpoint] Saved → {args.output}")

    if not args.dry_run and counter > 0:
        with args.output.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)

    print(f"\n{'=' * 60}")
    if not args.dry_run:
        print(f"Saved → {args.output}")
    print(f"Migrated to R2 : {total_migrated}")
    print(f"Cleared (dead) : {total_cleared}")


if __name__ == "__main__":
    main()
