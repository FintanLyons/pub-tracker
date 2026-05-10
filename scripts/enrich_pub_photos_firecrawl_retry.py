#!/usr/bin/env python3
"""
Retry pub photo enrichment using **one Firecrawl scrape per pub** (1 credit each).

Use after `enrich_pub_photos_from_websites.py` for rows where `requests` scraping failed
(403, SPA shell, no_images_found, etc.).

Flow
----
1. Select rows: have `website`, empty `photo_url1`, and either a **failed** `photos_status`
   from the websites script, **or** `--include-unattempted` (empty status / never ran websites pass).
   Optional: skip `http_error:404`, prioritise Firecrawl-friendly errors.
2. **Single** `Firecrawl.scrape(url, formats=["markdown","html"])` — 1 credit / pub.
3. Extract image URLs from returned HTML + markdown (+ markdown image syntax).
4. Same pipeline as website script: download → dedupe hash → AI batch exterior pick → R2.

Prerequisites
-------------
  Use a venv (Ubuntu/Debian block system pip — PEP 668):
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r scripts/requirements_photo_scraping.txt

  .env: FIRECRAWL_API_KEY, OPENAI_API_KEY, R2_*

Recommended (stay within ~500 credits)
-------------------------------------
  python3 scripts/enrich_pub_photos_firecrawl_retry.py --limit 500

If **Eligible … : 0** but you have websites with no photo_url1, either run
`enrich_pub_photos_from_websites.py` first, or pass `--include-unattempted`
(empty photos_status counts as eligible).

Test 10 pubs (after `source .venv/bin/activate`, or `.venv/bin/python` …):
  python3 scripts/enrich_pub_photos_firecrawl_retry.py --limit 10 --seed 1

Exclude dead URLs (recommended to save credits):
  python3 scripts/enrich_pub_photos_firecrawl_retry.py --limit 500 --skip-404
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

# Import shared pipeline from sibling module
_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

try:
    from dotenv import load_dotenv
    from firecrawl import Firecrawl
except ImportError as exc:
    print(
        f"Missing dependency: {exc}\n"
        "  python3 -m venv .venv && source .venv/bin/activate   # if pip is blocked (PEP 668)\n"
        "  pip install -r scripts/requirements_photo_scraping.txt",
        file=sys.stderr,
    )
    sys.exit(1)

import enrich_pub_photos_from_websites as pu


CHECKPOINT_EVERY = 25
DEFAULT_CREDIT_LIMIT = 500


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def normalize_website(raw: str) -> Optional[str]:
    if not raw or not str(raw).strip():
        return None
    s = raw.strip()
    if not s.startswith(("http://", "https://")):
        s = "https://" + s
    return s


def _markdown_image_urls(markdown: str, base_url: str) -> List[str]:
    out: List[str] = []
    if not markdown:
        return out
    # ![alt](url)
    for m in re.finditer(r"!\[[^\]]*\]\(([^)]+)\)", markdown):
        u = (m.group(1) or "").strip().strip('"').strip("'").split()[0]
        nu = pu.normalize_url(u, base_url)
        if nu:
            out.append(nu)
    # loose http(s) ending in common image extensions
    for m in re.finditer(
        r"(https?://[^\s\)\]\'\"]+\.(?:jpe?g|png|webp)(?:\?[^\s\)\]\'\"]*)?)",
        markdown,
        re.I,
    ):
        nu = pu.normalize_url(m.group(1), base_url)
        if nu:
            out.append(nu)
    return out


def _soup_image_urls(html: str, base_url: str, max_collect: int) -> List[str]:
    from bs4 import BeautifulSoup

    out: List[str] = []
    if not html or len(html) < 50:
        return out
    soup = BeautifulSoup(html, "html.parser")

    def add_from_src(src: Optional[str], alt: str = "") -> None:
        if not src or len(out) >= max_collect:
            return
        nu = pu.normalize_url(src.strip(), base_url)
        if not nu or pu.is_likely_icon_or_logo(nu, alt):
            return
        out.append(nu)

    for img in soup.find_all("img"):
        if len(out) >= max_collect:
            break
        alt = img.get("alt") or ""
        add_from_src(img.get("src"), alt)
        add_from_src(img.get("data-src"), alt)
        add_from_src(img.get("data-lazy-src"), alt)
        ss = img.get("srcset")
        if ss:
            first = ss.split(",")[0].strip().split()[0]
            add_from_src(first, alt)

    og = soup.find("meta", property="og:image")
    if og and og.get("content"):
        add_from_src(og["content"], "")

    tw = soup.find("meta", attrs={"name": "twitter:image"})
    if tw and tw.get("content"):
        add_from_src(tw["content"], "")

    return out


def extract_image_urls_firecrawl(
    markdown: str,
    html: Optional[str],
    base_url: str,
    max_images: int,
) -> List[str]:
    """Merge URLs from HTML (preferred) and markdown."""
    seen: Dict[str, None] = {}
    ordered: List[str] = []

    def push(u: str) -> None:
        if len(ordered) >= max_images:
            return
        if u not in seen:
            seen[u] = None
            ordered.append(u)

    if html:
        for u in _soup_image_urls(html, base_url, max_collect=max_images * 3):
            push(u)

    for u in _markdown_image_urls(markdown or "", base_url):
        push(u)

    return ordered[:max_images]


def firecrawl_fetch_once(
    fc: Firecrawl,
    url: str,
) -> Tuple[Optional[str], Optional[str], str]:
    """
    One Firecrawl scrape. Returns (markdown, html, error_empty_if_ok).

    Requests both markdown + html where supported; falls back to markdown-only.
    """
    result = None
    try:
        result = fc.scrape(url, formats=["markdown", "html"])
    except Exception:
        try:
            result = fc.scrape(url, formats=["markdown"])
        except Exception as exc2:
            return None, None, f"firecrawl:{exc2.__class__.__name__}:{str(exc2)[:160]}"

    md = getattr(result, "markdown", None) or (
        result.get("markdown") if isinstance(result, dict) else None
    )
    html = getattr(result, "html", None) or (
        result.get("html") if isinstance(result, dict) else None
    )

    if not md and not html:
        return None, None, "firecrawl:empty_document"

    if isinstance(md, str) and md.strip():
        md = md.strip()
    else:
        md = None

    if isinstance(html, str) and html.strip():
        html = html.strip()
    else:
        html = None

    # If API returned markdown-only, html may be missing — OK
    if not md and not html:
        return None, None, "firecrawl:empty_document"

    return md or "", html, ""


def process_pub_firecrawl(
    row: Dict[str, str],
    fc: Firecrawl,
    client: Any,
    r2_config: Dict[str, str],
    max_images_per_pub: int,
    delay: float,
) -> Dict[str, str]:
    pub_name = row.get("name", "Unknown")
    pub_id = row.get("id", "unknown")
    website = normalize_website((row.get("website") or "").strip())
    if not website:
        row["photos_status"] = "scrape_failed"
        row["photos_error"] = "no_website"
        row["photos_source"] = "website_firecrawl"
        row["photos_count"] = "0"
        return row

    address_parts = [
        row.get("addr_housenumber", ""),
        row.get("addr_street", ""),
        row.get("calc_postcode_district", ""),
    ]
    address = " ".join(filter(None, address_parts))

    print(f"  Pub: {pub_name} (ID: {pub_id})")
    print(f"  Website: {website}")

    md, html, fc_err = firecrawl_fetch_once(fc, website)
    if fc_err:
        print(f"  ❌ Firecrawl: {fc_err}")
        row["photos_status"] = "scrape_failed"
        row["photos_error"] = fc_err
        row["photos_source"] = "website_firecrawl"
        row["photos_count"] = "0"
        return row

    image_urls = extract_image_urls_firecrawl(
        md or "",
        html,
        website,
        max_images_per_pub,
    )

    if not image_urls:
        print("  ❌ No image URLs extracted from Firecrawl document")
        row["photos_status"] = "no_images_found"
        row["photos_error"] = "fc_no_image_urls_extracted"
        row["photos_source"] = "website_firecrawl"
        row["photos_count"] = "0"
        return row

    print(f"  Found {len(image_urls)} candidate image URLs")

    valid_images: List[Tuple[str, bytes, int, int]] = []
    seen_hashes = set()

    for img_url in image_urls:
        img_bytes, width, height, download_error = pu.download_and_validate_image(img_url)
        if download_error:
            print(f"    Skip: {img_url[:60]}... ({download_error})")
            continue
        h = hashlib.md5(img_bytes).hexdigest()
        if h in seen_hashes:
            print(f"    Skip: {img_url[:60]}... (duplicate_image)")
            continue
        seen_hashes.add(h)
        valid_images.append((img_url, img_bytes, width, height))
        print(f"    ✓ Downloaded: {width}x{height}px")

    if not valid_images:
        print("  ❌ No valid images after download")
        row["photos_status"] = "no_images_found"
        row["photos_error"] = "fc_no_valid_images_after_download"
        row["photos_source"] = "website_firecrawl"
        row["photos_count"] = "0"
        return row

    print(f"  Sending {len(valid_images)} images to AI in 1 batch call...")
    image_bytes_only = [b for (_, b, _, _) in valid_images]
    ai_result = pu.pick_best_exterior_batch(client, image_bytes_only, pub_name, address)

    exterior_idx = 0
    exterior_quality = 0.0
    if ai_result:
        exterior_idx = ai_result.get("best_exterior_index", 0) or 0
        exterior_quality = ai_result.get("exterior_quality", 0.0) or 0.0

    if exterior_idx < 1 or exterior_idx > len(valid_images):
        exterior_idx = 0

    selected: List[Tuple[str, bytes, Dict[str, Any]]] = []
    used = set()

    if exterior_idx > 0:
        url, ib, _, _ = valid_images[exterior_idx - 1]
        selected.append((url, ib, {"category": "exterior", "quality_score": exterior_quality}))
        used.add(exterior_idx - 1)
        print(f"    → Exterior pick: image #{exterior_idx} (Q: {exterior_quality:.2f})")
    else:
        print("    → No exterior identified, skipping exterior slot")

    for i, (url, ib, _, _) in enumerate(valid_images):
        if i in used or len(selected) >= 5:
            break
        selected.append((url, ib, {"category": "other", "quality_score": 0.5}))

    uploaded_count = 0
    for idx, (url, img_bytes, classification) in enumerate(selected, start=1):
        resized = pu.resize_image(img_bytes)
        cat = classification["category"]
        q = classification["quality_score"]
        r2_key = f"pub_photos/{pub_id}/{idx}_{cat}_{q:.2f}.jpg"

        if not pu.upload_to_r2(
            resized,
            r2_key,
            r2_config["account_id"],
            r2_config["access_key_id"],
            r2_config["secret_access_key"],
            r2_config["bucket_name"],
        ):
            print(f"    ❌ R2 upload failed for photo {idx}")
            continue

        public_url = f"{r2_config['public_base_url']}/{r2_key}"
        row[f"photo_url{idx}"] = public_url
        row[f"photo_category{idx}"] = cat
        row[f"photo_quality{idx}"] = f"{q:.2f}"
        uploaded_count += 1
        print(f"    ✓ Uploaded photo {idx}: {cat} (Q: {q:.2f})")

    row["photos_status"] = "ok"
    row["photos_error"] = ""
    row["photos_source"] = "website_firecrawl"
    row["photos_count"] = str(uploaded_count)
    print(f"  ✅ Complete: {uploaded_count} photos (Firecrawl)")

    time.sleep(delay)
    return row


def _looks_like_prior_http_404(err: str) -> bool:
    """
    Matches how enrich_pub_photos_from_websites stores failed page/image GETs:

        http_error:404

    Many real dead sites never produce this exact string (see eligible_for_fc_retry doc).
    """
    e = (err or "").strip().lstrip("\ufeff").lower()
    if e.startswith("http_error:404"):
        return True
    # Rare CSV / upstream variants
    if e.startswith("http_error: 404"):
        return True
    return False


def eligible_for_fc_retry(
    row: Dict[str, str],
    skip_404: bool,
    include_unattempted: bool,
) -> bool:
    """
    Rows with a website and no photo_url1.

    By default, only **retries** the websites pipeline: `photos_status` must be set and
    not `ok` (empty status means the row never went through `enrich_pub_photos_from_websites`
    — use `--include-unattempted` to queue those for Firecrawl).
    """
    if not (row.get("website") or "").strip():
        return False
    if (row.get("photo_url1") or "").strip():
        return False
    st = (row.get("photos_status") or "").strip().lower()
    if st == "ok":
        return False
    if not st:
        if not include_unattempted:
            return False

    err = (row.get("photos_error") or "").strip()
    # Only skips rows whose *recorded* error is an HTTP 404 from our scraper/download.
    # Sites that load but show a soft "404" page (HTTP 200) look like no_images_found /
    # page_too_small / no_valid_images_after_download — those are NOT skipped here.
    if skip_404 and _looks_like_prior_http_404(err):
        return False

    return True


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Retry pub photos with ONE Firecrawl scrape per pub (1 credit each).",
    )
    parser.add_argument(
        "--input",
        "-i",
        type=Path,
        default=repo_root() / "data" / "data_list_photos_enriched.csv",
        help="CSV with prior photo run results (default: data_list_photos_enriched.csv)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=repo_root() / "data" / "data_list_photos_enriched.csv",
        help="Same file in place by default — overwrites eligible rows.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_CREDIT_LIMIT,
        help=f"Max pubs / Firecrawl credits to use this run (default: {DEFAULT_CREDIT_LIMIT})",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Random seed when sampling (--limit)",
    )
    parser.add_argument(
        "--max-images-per-pub",
        type=int,
        default=10,
        help="Max image URLs extracted per Firecrawl page (default: 10)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=2.0,
        help="Seconds between pubs after success path (default: 2)",
    )
    parser.add_argument(
        "--skip-404",
        action="store_true",
        help=(
            "Skip rows where photos_error is http_error:404 from the websites script "
            "(true HTTP 404 on page or image GET). Does not skip soft 404s / 403 / "
            "no_valid_images_after_download etc."
        ),
    )
    parser.add_argument(
        "--prioritize-firecrawl-errors",
        action="store_true",
        help=(
            "Process rows whose photos_error suggests Firecrawl may help "
            "(403, page_too_small, no_images_found*, scrape_failed) first "
            "within the shuffle before random fill."
        ),
    )
    parser.add_argument(
        "--include-unattempted",
        action="store_true",
        help=(
            "Include rows where photos_status is blank (never processed by "
            "enrich_pub_photos_from_websites.py, or CSV export dropped that column)."
        ),
    )
    args = parser.parse_args()

    load_dotenv(repo_root() / ".env")
    load_dotenv(repo_root() / "scripts" / ".env")

    import os
    from openai import OpenAI

    fc_key = os.getenv("FIRECRAWL_API_KEY")
    if not fc_key:
        print("FIRECRAWL_API_KEY not set in .env", file=sys.stderr)
        sys.exit(1)
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
        print("R2 configuration incomplete", file=sys.stderr)
        sys.exit(1)

    if not args.input.is_file():
        print(f"Input not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    fieldnames, all_rows = pu.read_csv(args.input)
    out_fields = pu.build_fieldnames(fieldnames)
    for row in all_rows:
        for col in out_fields:
            row.setdefault(col, "")

    fc_eligible_indices = [
        i
        for i, r in enumerate(all_rows)
        if eligible_for_fc_retry(r, args.skip_404, args.include_unattempted)
    ]

    def prioritize_index(i: int) -> Tuple[int, int]:
        r = all_rows[i]
        err = (r.get("photos_error") or "").lower()
        st = (r.get("photos_status") or "").lower()
        pref = 0
        if args.prioritize_firecrawl_errors:
            if "403" in err or err.startswith("http_error:403"):
                pref -= 10
            if "page_too_small" in err:
                pref -= 9
            if "no_images_found" in st or err.startswith("no_images_found"):
                pref -= 8
            if err.startswith("scrape_error:") or st == "scrape_failed":
                pref -= 7
            if err == "no_valid_images_after_download":
                pref -= 5
        return (pref, i)

    if args.prioritize_firecrawl_errors:
        fc_eligible_indices.sort(key=prioritize_index)
        if args.limit is not None:
            fc_eligible_indices = fc_eligible_indices[: args.limit]
    else:
        import random

        if args.limit is not None and len(fc_eligible_indices) > args.limit:
            rng = random.Random(args.seed)
            fc_eligible_indices = rng.sample(fc_eligible_indices, args.limit)

    chosen_idx = set(fc_eligible_indices)
    total = len(chosen_idx)

    print(f"Input rows              : {len(all_rows)}")
    n_elig = sum(
        1 for r in all_rows if eligible_for_fc_retry(r, args.skip_404, args.include_unattempted)
    )
    print(f"Eligible for FC retry    : {n_elig}")
    print(f"Will scrape (credit use) : {total}")
    print(f"Credit budget            : {args.limit} pubs (1 scrape each)")
    print(f"Checkpoint every         : {CHECKPOINT_EVERY} pubs")

    if n_elig == 0 and not args.include_unattempted:
        web_no_p1 = [
            r
            for r in all_rows
            if (r.get("website") or "").strip() and not (r.get("photo_url1") or "").strip()
        ]
        empty_st = sum(1 for r in web_no_p1 if not (r.get("photos_status") or "").strip())
        failed_st = sum(
            1
            for r in web_no_p1
            if (r.get("photos_status") or "").strip()
            and (r.get("photos_status") or "").strip().lower() != "ok"
        )
        print()
        print("Note: eligibility needs non-empty photos_status from a websites photo run.")
        print(f"  website + no photo_url1 rows: {len(web_no_p1)}")
        print(f"    photos_status empty: {empty_st}  (these are NOT queued without --include-unattempted)")
        print(f"    photos_status failed (not ok): {failed_st}")
        print(
            "  Recover: use the CSV saved during/after enrich_pub_photos_from_websites.py, "
            "or run that script once so failures get statuses, then re-run Firecrawl without "
            "--include-unattempted."
        )

    print()

    fc = Firecrawl(api_key=fc_key)
    client = OpenAI(api_key=openai_key)

    ok = failed = counter = 0
    for i, row in enumerate(all_rows):
        if i not in chosen_idx:
            continue
        counter += 1
        print(f"\n[{counter}/{total}] FC credit #{counter}")

        try:
            prev_err = (all_rows[i].get("photos_error") or "")[:80]
            if prev_err:
                print(f"  Prior failure: {prev_err}")

            all_rows[i] = process_pub_firecrawl(
                all_rows[i],
                fc,
                client,
                r2_config,
                args.max_images_per_pub,
                args.delay,
            )
            if all_rows[i]["photos_status"] == "ok":
                ok += 1
            else:
                failed += 1

            if counter % CHECKPOINT_EVERY == 0:
                pu.write_csv(args.output, out_fields, all_rows)
                print(f"\n  [checkpoint] Saved -> {args.output}")

        except KeyboardInterrupt:
            if counter > 0:
                print("\nInterrupted. Saving...")
                pu.write_csv(args.output, out_fields, all_rows)
            else:
                print("\nInterrupted before any pubs processed — output file NOT overwritten.")
            break
        except Exception as exc:
            print(f"  ❌ Unexpected: {exc}")
            all_rows[i]["photos_status"] = "error"
            all_rows[i]["photos_error"] = str(exc)[:200]
            failed += 1

    if counter > 0:
        pu.write_csv(args.output, out_fields, all_rows)
    else:
        print("No pubs processed — output file NOT overwritten.")

    print(f"\n{'=' * 60}")
    print(f"Wrote     : {args.output}")
    print(f"Firecrawl scrape calls : {counter} (budget was {total})")
    print(f"Success (ok): {ok}")
    print(f"Failed      : {failed}")


if __name__ == "__main__":
    main()
