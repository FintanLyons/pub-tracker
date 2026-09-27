#!/usr/bin/env python3
"""
Upload the app pub photo placeholder to Cloudflare R2 (static asset, not tied to any pub).

Does NOT modify pubs_list / pubs_all or any CSV.

Object key: static/pub-photo-placeholder.jpg

Run from repo root (requires .env with R2_*):
  source .venv/bin/activate
  python3 scripts/upload_pub_photo_placeholder_to_r2.py

After upload, set in .env / EAS:
  EXPO_PUBLIC_PUB_PHOTO_PLACEHOLDER_URL=<printed public URL>
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import boto3
    from dotenv import load_dotenv
except ImportError as exc:
    print(f"Missing dependency: {exc}", file=sys.stderr)
    sys.exit(1)

R2_OBJECT_KEY = "static/pub-photo-placeholder.jpg"
SOURCE = Path(__file__).resolve().parents[1] / "assets" / "pub-photo-placeholder.jpg"


def main() -> None:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")

    account_id = os.getenv("R2_ACCOUNT_ID", "").strip()
    access_key = os.getenv("R2_ACCESS_KEY_ID", "").strip()
    secret = os.getenv("R2_SECRET_ACCESS_KEY", "").strip()
    bucket = os.getenv("R2_BUCKET_NAME", "").strip()
    public_base = os.getenv("R2_PUBLIC_BASE_URL", "").rstrip("/")

    missing = [
        k
        for k, v in [
            ("R2_ACCOUNT_ID", account_id),
            ("R2_ACCESS_KEY_ID", access_key),
            ("R2_SECRET_ACCESS_KEY", secret),
            ("R2_BUCKET_NAME", bucket),
            ("R2_PUBLIC_BASE_URL", public_base),
        ]
        if not v
    ]
    if missing:
        print(f"Missing env: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    if not SOURCE.is_file():
        print(f"Source image not found: {SOURCE}", file=sys.stderr)
        sys.exit(1)

    image_bytes = SOURCE.read_bytes()
    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret,
        region_name="auto",
    )

    client.put_object(
        Bucket=bucket,
        Key=R2_OBJECT_KEY,
        Body=image_bytes,
        ContentType="image/jpeg",
        CacheControl="public, max-age=31536000, immutable",
    )

    public_url = f"{public_base}/{R2_OBJECT_KEY}"
    print(f"Uploaded {len(image_bytes)} bytes → {R2_OBJECT_KEY}")
    print(f"Public URL: {public_url}")
    print()
    print("Add to .env and EAS secrets:")
    print(f"EXPO_PUBLIC_PUB_PHOTO_PLACEHOLDER_URL={public_url}")


if __name__ == "__main__":
    main()
