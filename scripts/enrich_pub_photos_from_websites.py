#!/usr/bin/env python3
"""
Pub photo enrichment: Website image scraping → OpenAI vision classification → R2 upload.

For each pub with a website but no photos:
1. Scrape website for image URLs using requests + BeautifulSoup
2. Download candidate images (up to max-images-per-pub)
3. Classify each image with OpenAI gpt-5-mini vision:
   - Category: exterior/interior/food_drink/people/other/irrelevant
   - Quality score: 0.0-1.0
   - Venue correctness check
4. Rank images: exterior (by quality) → interior → food/drink → other
5. Select top 5, resize to 800px max width
6. Upload to Cloudflare R2
7. Write R2 public URLs to CSV

Prerequisites
-------------
  pip install -r scripts/requirements_photo_scraping.txt

  Ensure .env has:
    OPENAI_API_KEY=sk-...
    R2_ACCOUNT_ID=...
    R2_ACCESS_KEY_ID=...
    R2_SECRET_ACCESS_KEY=...
    R2_BUCKET_NAME=...
    R2_PUBLIC_BASE_URL=https://....r2.dev

Quick test (10 pubs with websites):
  python3 scripts/enrich_pub_photos_from_websites.py --limit 10 --seed 1

Full run (all pubs with websites but no photos):
  python3 scripts/enrich_pub_photos_from_websites.py \\
    --input data/data_list_search_enriched.csv \\
    --output data/data_list_photos_enriched.csv \\
    --exclude-done

Output columns added / updated
-------------------------------
- photo_url1 through photo_url5: R2 public URLs
- photo_category_1 through photo_category_5: exterior/interior/food_drink/people/other
- photo_quality_1 through photo_quality_5: AI quality scores (0.00-1.00)
- photos_status: "ok" | "no_images_found" | "all_rejected" | "scrape_failed" | "ai_failed"
- photos_source: "website"
- photos_count: Number of photos saved (0-5)
- photos_error: Error message if failed
"""

from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import os
import random
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

try:
    import hashlib
    import boto3
    import requests
    from bs4 import BeautifulSoup
    from dotenv import load_dotenv
    from openai import OpenAI
    from PIL import Image
except ImportError as exc:
    print(
        f"Missing dependency: {exc}\n"
        "  pip install -r scripts/requirements_photo_scraping.txt",
        file=sys.stderr,
    )
    sys.exit(1)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MIN_IMAGE_SIZE_PX = 399  # Min width or height to consider
MAX_IMAGE_WIDTH_PX = 800  # Resize images to this max width for R2
AI_THUMBNAIL_SIZE_PX = 512  # Small thumbnail size for AI classification (cheap)
CHECKPOINT_EVERY = 25  # Save CSV progress every N processed pubs
JPEG_QUALITY = 85  # Compression quality
AI_THUMBNAIL_QUALITY = 70  # Lower quality for AI thumbnails (smaller payload)

VISION_MODEL = "gpt-5-mini-2025-08-07"

PHOTO_COLUMNS = ["photo_url", "photo_category", "photo_quality"]  # Will be suffixed with 1-5
METADATA_COLUMNS = ["photos_status", "photos_error", "photos_source", "photos_count"]

# Compact batch prompt - sends ALL candidate images in one AI call.
# We just need to know which image is the best exterior shot.
VISION_BATCH_PROMPT = """
You are classifying photos for a London pub app.

Pub: "{pub_name}" at {address}.

You will be shown {n_images} numbered images (1 through {n_images}).

Return JSON only:
{{
  "best_exterior_index": <1-{n_images} or 0 if none qualify>,
  "exterior_quality": <0.0-1.0>,
  "relevant_indices": [<list of 1-based indices that are relevant pub photos>]
}}

Definitions:
- "best_exterior_index": the ONE image that best shows the pub exterior (building facade, entrance, signage, outdoor seating). 0 if none qualify.
- "exterior_quality": 0.0-1.0 sharpness and composition of that exterior shot.
- "relevant_indices": ALL images that are genuinely useful pub photos — exterior, interior, food/drinks, events. Include the exterior index here too if set.

What to INCLUDE in relevant_indices:
- Pub exterior / building facade / street view
- Pub interior / bar area / seating
- Food or drinks served at this pub
- Events or atmosphere shots clearly inside/outside this venue

What to EXCLUDE from relevant_indices (set to empty list [] if all images fall into these):
- Pure stock photos or generic graphics unrelated to this specific pub
- Logos, icons, maps, text-only graphics
- Website hero banners with large overlaid UI text, "Book now" buttons, straplines
- Photos that are clearly a different venue or unrelated subject
- Social media profile pictures or avatars

Physical signage on the building is fine. Digital text/CTA layers baked into the image are not.
""".strip()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def is_empty(val: Any) -> bool:
    if val is None:
        return True
    return isinstance(val, str) and not val.strip()


def normalize_url(url: str, base_url: str) -> Optional[str]:
    """Convert relative URLs to absolute, validate."""
    if not url or not url.strip():
        return None
    url = url.strip()
    # Remove data URLs, javascript:, etc
    if url.startswith(("data:", "javascript:", "mailto:")):
        return None
    # Make absolute
    if url.startswith("//"):
        url = "https:" + url
    elif not url.startswith(("http://", "https://")):
        url = urljoin(base_url, url)
    return url


def is_likely_icon_or_logo(url: str, alt_text: str = "") -> bool:
    """Filter out icons, logos, tracking pixels."""
    url_lower = url.lower()
    alt_lower = alt_text.lower()
    
    # Filename patterns
    if any(pattern in url_lower for pattern in [
        "icon", "logo", "sprite", "pixel", "tracking", "analytics",
        "favicon", "avatar", "badge", "button", "arrow", "social"
    ]):
        return True
    
    # Alt text patterns
    if any(pattern in alt_lower for pattern in ["icon", "logo", "avatar"]):
        return True
    
    # File extensions to skip
    if any(url_lower.endswith(ext) for ext in [".svg", ".gif"]):
        return True
    
    return False


# ---------------------------------------------------------------------------
# Website scraping
# ---------------------------------------------------------------------------

def scrape_website_images(
    url: str,
    max_images: int,
    timeout: int = 10,
) -> Tuple[List[str], str]:
    """
    Scrape image URLs from a website using requests + BeautifulSoup.
    
    Returns (image_urls, error_string).
    error_string is empty on success.
    """
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        }
        
        response = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
        response.raise_for_status()
        
        if len(response.content) < 1000:
            return [], "page_too_small:<1kb"
        
        soup = BeautifulSoup(response.content, "html.parser")
        
        # Extract image URLs from <img> tags
        candidate_urls = []
        for img in soup.find_all("img"):
            src = img.get("src") or img.get("data-src") or img.get("data-lazy-src")
            if not src:
                continue
            
            alt_text = img.get("alt", "")
            
            # Normalize URL
            abs_url = normalize_url(src, url)
            if not abs_url:
                continue
            
            # Filter out icons/logos
            if is_likely_icon_or_logo(abs_url, alt_text):
                continue
            
            candidate_urls.append(abs_url)
        
        if not candidate_urls:
            return [], "no_images_found"
        
        # Deduplicate and limit
        unique_urls = list(dict.fromkeys(candidate_urls))  # Preserve order
        return unique_urls[:max_images], ""
        
    except requests.Timeout:
        return [], "timeout"
    except requests.HTTPError as e:
        return [], f"http_error:{e.response.status_code}"
    except Exception as exc:
        short = str(exc)[:100].replace("\n", " ")
        return [], f"scrape_error:{short}"


# ---------------------------------------------------------------------------
# Image download and validation
# ---------------------------------------------------------------------------

def download_and_validate_image(
    url: str,
    min_size: int = MIN_IMAGE_SIZE_PX,
    timeout: int = 10,
) -> Tuple[Optional[bytes], int, int, str]:
    """
    Download image and validate size.
    
    Returns (image_bytes, width, height, error_string).
    image_bytes is None on error.
    """
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        response = requests.get(url, headers=headers, timeout=timeout, stream=True)
        response.raise_for_status()
        
        # Check content type
        content_type = response.headers.get("content-type", "").lower()
        if "image" not in content_type:
            return None, 0, 0, f"not_image:{content_type}"
        
        # Read image
        image_bytes = response.content
        
        # Validate with Pillow
        try:
            img = Image.open(io.BytesIO(image_bytes))
            width, height = img.size
            
            # Check minimum size
            if width < min_size or height < min_size:
                return None, width, height, f"too_small:{width}x{height}"
            
            return image_bytes, width, height, ""
            
        except Exception as e:
            return None, 0, 0, f"invalid_image:{e}"
        
    except requests.Timeout:
        return None, 0, 0, "timeout"
    except requests.HTTPError as e:
        return None, 0, 0, f"http_error:{e.response.status_code}"
    except Exception as exc:
        return None, 0, 0, f"download_error:{str(exc)[:80]}"


# ---------------------------------------------------------------------------
# Image resizing
# ---------------------------------------------------------------------------

def resize_image(
    image_bytes: bytes,
    max_width: int = MAX_IMAGE_WIDTH_PX,
    quality: int = JPEG_QUALITY,
) -> bytes:
    """Resize image to max width, maintaining aspect ratio. Convert to JPEG."""
    img = Image.open(io.BytesIO(image_bytes))
    
    # Convert to RGB if needed (handles PNG with transparency, etc)
    if img.mode in ("RGBA", "LA", "P"):
        # Create white background
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")
    
    # Resize if needed
    width, height = img.size
    if width > max_width:
        new_width = max_width
        new_height = int(height * (max_width / width))
        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
    
    # Save as JPEG
    output = io.BytesIO()
    img.save(output, format="JPEG", quality=quality, optimize=True)
    return output.getvalue()


# ---------------------------------------------------------------------------
# Thumbnail generation for AI (cheap, fast)
# ---------------------------------------------------------------------------

def make_ai_thumbnail(
    image_bytes: bytes,
    size_px: int = AI_THUMBNAIL_SIZE_PX,
    quality: int = AI_THUMBNAIL_QUALITY,
) -> bytes:
    """Resize image to small thumbnail for AI classification. Always JPEG, low quality."""
    img = Image.open(io.BytesIO(image_bytes))

    # Convert to RGB
    if img.mode in ("RGBA", "LA", "P"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    # Fit within size_px x size_px box, preserving aspect ratio
    img.thumbnail((size_px, size_px), Image.Resampling.LANCZOS)

    output = io.BytesIO()
    img.save(output, format="JPEG", quality=quality, optimize=True)
    return output.getvalue()


# ---------------------------------------------------------------------------
# OpenAI batch vision classification (single call for all images)
# ---------------------------------------------------------------------------

def pick_best_exterior_batch(
    client: OpenAI,
    image_bytes_list: List[bytes],
    pub_name: str,
    address: str,
) -> Optional[Dict]:
    """
    Send ALL candidate images in one AI call.

    Returns dict with:
      best_exterior_index  (1-based, 0 = none)
      exterior_quality     (0.0-1.0)
      relevant_indices     (list of 1-based indices that are useful pub photos)
    Returns None on error.
    """
    if not image_bytes_list:
        return None

    try:
        n_images = len(image_bytes_list)
        prompt = VISION_BATCH_PROMPT.format(
            pub_name=pub_name,
            address=address,
            n_images=n_images,
        )

        content: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
        for i, img_bytes in enumerate(image_bytes_list, start=1):
            thumb_bytes = make_ai_thumbnail(img_bytes)
            base64_image = base64.b64encode(thumb_bytes).decode("utf-8")
            content.append({"type": "text", "text": f"Image {i}:"})
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{base64_image}",
                    "detail": "low",
                },
            })

        response = client.chat.completions.create(
            model=VISION_MODEL,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": content}],
        )

        raw = response.choices[0].message.content or ""
        data = json.loads(raw)

        idx = data.get("best_exterior_index")
        quality = data.get("exterior_quality", 0)
        relevant = data.get("relevant_indices", [])

        if idx is None:
            return None

        # Sanitise relevant_indices — must be ints in valid range
        if not isinstance(relevant, list):
            relevant = []
        relevant = [
            int(x) for x in relevant
            if isinstance(x, (int, float)) and 1 <= int(x) <= n_images
        ]

        return {
            "best_exterior_index": int(idx),
            "exterior_quality": float(quality),
            "relevant_indices": relevant,
        }

    except Exception as exc:
        print(f"  AI batch classification error: {exc}")
        return None


# ---------------------------------------------------------------------------
# R2 upload
# ---------------------------------------------------------------------------

def upload_to_r2(
    image_bytes: bytes,
    key: str,
    account_id: str,
    access_key_id: str,
    secret_access_key: str,
    bucket_name: str,
) -> bool:
    """Upload image to Cloudflare R2. Returns True on success."""
    try:
        # R2 uses S3-compatible API
        endpoint_url = f"https://{account_id}.r2.cloudflarestorage.com"
        
        s3_client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name="auto",
        )
        
        s3_client.put_object(
            Bucket=bucket_name,
            Key=key,
            Body=image_bytes,
            ContentType="image/jpeg",
        )
        
        return True
        
    except Exception as exc:
        print(f"  R2 upload error for {key}: {exc}")
        return False


# ---------------------------------------------------------------------------
# CSV helpers
# ---------------------------------------------------------------------------

def read_csv(path: Path) -> Tuple[List[str], List[Dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise SystemExit(f"CSV has no header: {path}")
        rows = [dict(r) for r in reader]
    return list(reader.fieldnames), rows


def write_csv(path: Path, fieldnames: List[str], rows: List[Dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def build_fieldnames(base: List[str]) -> List[str]:
    """Add photo columns if not present."""
    extra: List[str] = []
    
    # Add photo_url1-5, photo_category1-5, photo_quality1-5 (no underscore before number)
    for i in range(1, 6):
        for col_base in PHOTO_COLUMNS:
            col = f"{col_base}{i}"
            if col not in base:
                extra.append(col)
    
    # Add metadata columns
    for col in METADATA_COLUMNS:
        if col not in base:
            extra.append(col)
    
    return list(dict.fromkeys([*base, *extra]))


# ---------------------------------------------------------------------------
# Main enrichment logic
# ---------------------------------------------------------------------------

def process_pub(
    row: Dict[str, str],
    client: OpenAI,
    r2_config: Dict[str, str],
    max_images_per_pub: int,
    delay: float,
) -> Dict[str, str]:
    """
    Process a single pub: scrape website, classify images, upload to R2, update row.
    """
    pub_name = row.get("name", "Unknown")
    pub_id = row.get("id", "unknown")
    website = (row.get("website") or "").strip()
    
    address_parts = [
        row.get("addr_housenumber", ""),
        row.get("addr_street", ""),
        row.get("calc_postcode_district", ""),
    ]
    address = " ".join(filter(None, address_parts))
    
    print(f"  Pub: {pub_name} (ID: {pub_id})")
    print(f"  Website: {website}")
    
    # Step 1: Scrape website for image URLs
    image_urls, scrape_error = scrape_website_images(website, max_images_per_pub)
    
    if scrape_error:
        print(f"  ❌ Scrape failed: {scrape_error}")
        row["photos_status"] = "scrape_failed"
        row["photos_error"] = scrape_error
        row["photos_source"] = "website"
        row["photos_count"] = "0"
        return row
    
    print(f"  Found {len(image_urls)} candidate images")
    
    # Step 2: Download and validate images (with deduplication)
    valid_images: List[Tuple[str, bytes, int, int]] = []
    seen_hashes = set()
    
    for url in image_urls:
        img_bytes, width, height, download_error = download_and_validate_image(url)
        if download_error:
            print(f"    Skip: {url[:60]}... ({download_error})")
            continue
        
        # Check for duplicate images using hash
        img_hash = hashlib.md5(img_bytes).hexdigest()
        if img_hash in seen_hashes:
            print(f"    Skip: {url[:60]}... (duplicate_image)")
            continue
        
        seen_hashes.add(img_hash)
        valid_images.append((url, img_bytes, width, height))
        print(f"    ✓ Downloaded: {width}x{height}px")
    
    if not valid_images:
        print(f"  ❌ No valid images found")
        row["photos_status"] = "no_images_found"
        row["photos_error"] = "no_valid_images_after_download"
        row["photos_source"] = "website"
        row["photos_count"] = "0"
        return row
    
    # Step 3: Single batch AI call to pick best exterior shot from all candidates
    print(f"  Sending {len(valid_images)} images to AI in 1 batch call...")

    image_bytes_only = [b for (_, b, _, _) in valid_images]
    ai_result = pick_best_exterior_batch(client, image_bytes_only, pub_name, address)

    exterior_idx = 0
    exterior_quality = 0.0
    relevant_set: set = set()
    if ai_result:
        exterior_idx = ai_result.get("best_exterior_index", 0) or 0
        exterior_quality = ai_result.get("exterior_quality", 0.0) or 0.0
        relevant_set = set(ai_result.get("relevant_indices") or [])

    if exterior_idx < 1 or exterior_idx > len(valid_images):
        exterior_idx = 0

    # If AI returned no relevant_indices, fall back to all images (old behaviour)
    if not relevant_set:
        relevant_set = set(range(1, len(valid_images) + 1))

    selected: List[Tuple[str, bytes, Dict]] = []
    used_indices = set()

    if exterior_idx > 0:
        url, img_bytes, _, _ = valid_images[exterior_idx - 1]
        selected.append((url, img_bytes, {
            "category": "exterior",
            "quality_score": exterior_quality,
        }))
        used_indices.add(exterior_idx - 1)
        print(f"    → Exterior pick: image #{exterior_idx} (Q: {exterior_quality:.2f})")
    else:
        print(f"    → No exterior identified, skipping exterior slot")

    # Fill remaining slots with AI-approved relevant images only
    for i, (url, img_bytes, _, _) in enumerate(valid_images):
        one_based = i + 1
        if i in used_indices:
            continue
        if one_based not in relevant_set:
            print(f"    Skip (AI: not relevant): image #{one_based}")
            continue
        if len(selected) >= 5:
            break
        selected.append((url, img_bytes, {
            "category": "other",
            "quality_score": 0.5,
        }))

    if not selected:
        print(f"  ❌ No images selected")
        row["photos_status"] = "all_rejected"
        row["photos_error"] = "no_images_selected"
        row["photos_source"] = "website"
        row["photos_count"] = "0"
        return row

    exterior_count = sum(1 for _, _, c in selected if c["category"] == "exterior")
    print(f"  ✓ Selected {len(selected)} photos ({exterior_count} exterior, {len(selected) - exterior_count} other)")

    # Step 4: Resize and upload to R2
    uploaded_count = 0

    for idx, (url, img_bytes, classification) in enumerate(selected, start=1):
        # Resize image to 800px max width for R2
        resized_bytes = resize_image(img_bytes)

        # Generate R2 key
        category = classification["category"]
        quality = classification["quality_score"]
        r2_key = f"pub_photos/{pub_id}/{idx}_{category}_{quality:.2f}.jpg"

        # Upload to R2
        success = upload_to_r2(
            resized_bytes,
            r2_key,
            r2_config["account_id"],
            r2_config["access_key_id"],
            r2_config["secret_access_key"],
            r2_config["bucket_name"],
        )

        if not success:
            print(f"    ❌ R2 upload failed for photo {idx}")
            continue

        # Generate public URL
        public_url = f"{r2_config['public_base_url']}/{r2_key}"

        # Update row
        row[f"photo_url{idx}"] = public_url
        row[f"photo_category{idx}"] = category
        row[f"photo_quality{idx}"] = f"{quality:.2f}"

        uploaded_count += 1
        print(f"    ✓ Uploaded photo {idx}: {category} (Q: {quality:.2f})")

    # Update status
    row["photos_status"] = "ok"
    row["photos_error"] = ""
    row["photos_source"] = "website"
    row["photos_count"] = str(uploaded_count)

    print(f"  ✅ Complete: {uploaded_count} photos uploaded")

    time.sleep(delay)
    return row


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Enrich pub photos from websites: scrape → AI classify → R2 upload",
    )
    parser.add_argument(
        "--input", "-i",
        type=Path,
        default=repo_root() / "data" / "data_list_search_enriched.csv",
        help="Input CSV (default: data/data_list_search_enriched.csv)",
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=repo_root() / "data" / "data_list_photos_enriched.csv",
        help="Output CSV (default: data/data_list_photos_enriched.csv)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Max pubs to process this run (random sample)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="RNG seed for reproducible sampling",
    )
    parser.add_argument(
        "--max-images-per-pub",
        type=int,
        default=10,
        help="Max candidate images to scrape per pub (default: 10)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=2.0,
        help="Seconds between pubs (default: 2.0)",
    )
    parser.add_argument(
        "--exclude-done",
        action="store_true",
        help="Skip pubs with photos_status=ok",
    )
    args = parser.parse_args()
    
    # Load environment
    load_dotenv(repo_root() / ".env")
    
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        print("OPENAI_API_KEY not set in .env", file=sys.stderr)
        sys.exit(1)
    
    r2_config = {
        "account_id": os.getenv("R2_ACCOUNT_ID"),
        "access_key_id": os.getenv("R2_ACCESS_KEY_ID"),
        "secret_access_key": os.getenv("R2_SECRET_ACCESS_KEY"),
        "bucket_name": os.getenv("R2_BUCKET_NAME"),
        "public_base_url": os.getenv("R2_PUBLIC_BASE_URL"),
    }
    
    if not all(r2_config.values()):
        print("R2 configuration incomplete in .env", file=sys.stderr)
        print(f"Missing: {[k for k, v in r2_config.items() if not v]}", file=sys.stderr)
        sys.exit(1)
    
    if not args.input.is_file():
        print(f"Input not found: {args.input}", file=sys.stderr)
        sys.exit(1)
    
    # Read CSV
    fieldnames, all_rows = read_csv(args.input)
    out_fields = build_fieldnames(fieldnames)
    
    # Ensure new columns exist
    for row in all_rows:
        for col in out_fields:
            row.setdefault(col, "")
    
    # Select pubs to process: have website, no photo_url1 yet
    def already_done(r: Dict[str, str]) -> bool:
        return (r.get("photos_status") or "").strip().lower() == "ok"
    
    eligible_idx = [
        i for i, r in enumerate(all_rows)
        if (r.get("website") or "").strip()
        and not (r.get("photo_url1") or "").strip()  # No photos yet (column is photo_url1, not photo_url_1)
        and (not args.exclude_done or not already_done(r))
    ]
    
    if args.limit is not None:
        n = min(args.limit, len(eligible_idx))
        rng = random.Random(args.seed)
        chosen_idx = set(rng.sample(eligible_idx, n))
    else:
        chosen_idx = set(eligible_idx)
    
    total = len(chosen_idx)
    print(f"Input rows         : {len(all_rows)}")
    print(f"Have website       : {len(eligible_idx)}")
    print(f"Will process       : {total}")
    print(f"Vision model       : {VISION_MODEL}")
    print(f"Max images per pub : {args.max_images_per_pub}")
    print()
    
    # Initialize clients
    client = OpenAI(api_key=openai_key)
    
    # Process pubs
    ok = failed = 0
    counter = 0
    
    for i, row in enumerate(all_rows):
        if i not in chosen_idx:
            continue
        
        counter += 1
        print(f"\n[{counter}/{total}]")
        
        try:
            all_rows[i] = process_pub(
                row,
                client,
                r2_config,
                args.max_images_per_pub,
                args.delay,
            )
            
            if all_rows[i]["photos_status"] == "ok":
                ok += 1
            else:
                failed += 1

            # Periodic checkpoint save to avoid losing progress on long runs
            if counter % CHECKPOINT_EVERY == 0:
                write_csv(args.output, out_fields, all_rows)
                print(f"\n  [checkpoint] Saved progress at {counter}/{total} pubs -> {args.output}")
                
        except KeyboardInterrupt:
            if counter > 0:
                print("\n\nInterrupted by user. Saving progress...")
                write_csv(args.output, out_fields, all_rows)
            else:
                print("\n\nInterrupted before any pubs processed — output file NOT overwritten.")
            break
        except Exception as exc:
            print(f"  ❌ Unexpected error: {exc}")
            all_rows[i]["photos_status"] = "error"
            all_rows[i]["photos_error"] = str(exc)[:200]
            failed += 1

    if counter > 0:
        write_csv(args.output, out_fields, all_rows)
    else:
        print("No pubs processed — output file NOT overwritten.")

    print(f"\n{'='*60}")
    print(f"Wrote: {args.output}")
    print(f"Success: {ok}")
    print(f"Failed: {failed}")
    print(f"Not processed: {len(all_rows) - total}")


if __name__ == "__main__":
    main()
