#!/usr/bin/env python3
"""
Pub data enrichment: Firecrawl website fetch → OpenAI structured extraction.

Replaces the two-step Tier A pipeline (fetch_pub_websites_tier_a.py +
enrich_data_list_from_website_text.py) with a single script that fetches
each pub website via Firecrawl (handles JS-heavy pages, avoids most 403s)
and immediately feeds the rendered markdown to OpenAI for structured
extraction.  No raw text files are saved.

Prerequisites
-------------
  pip install -r scripts/requirements_firecrawl.txt

  Add to .env:
    FIRECRAWL_API_KEY=fc-...     (get from https://firecrawl.dev)
    OPENAI_API_KEY=sk-...        (already set)

Quick test (20 random pubs with websites):
  python3 scripts/enrich_pub_data_firecrawl.py --sample 20 --seed 42

Cap a run (e.g. 450 pubs — fits many free-tier monthly scrape limits):
  python3 scripts/enrich_pub_data_firecrawl.py \\
    -i data/data_list_wikidata_enriched.csv \\
    -o data/data_list_firecrawl_enriched.csv \\
    --limit 450 --seed 1

Next batch on the same file (skip rows already fc_status=ok):
  python3 scripts/enrich_pub_data_firecrawl.py \\
    -i data/data_list_firecrawl_enriched.csv \\
    -o data/data_list_firecrawl_enriched.csv \\
    --limit 450 --seed 2 --exclude-fc-ok

Full run (all pubs with websites):
  python3 scripts/enrich_pub_data_firecrawl.py \\
    --input data/data_list_wikidata_enriched.csv \\
    -o data/data_list_firecrawl_enriched.csv

Output columns added / updated
-------------------------------
- All existing fields in the input CSV (untouched or filled if empty).
- Confidence columns: conf_description, conf_phone, conf_founded,
  conf_operator, conf_has_pub_garden, conf_has_live_music,
  conf_has_live_sport_tv, conf_has_food_available, conf_has_dog_friendly,
  conf_has_pool_darts, conf_has_accommodation.
- fc_status   : "ok" | "no_website" | "scrape_failed" | "openai_failed"
- fc_error    : short error string when fc_status != "ok"
- fc_quality_flags : semicolon-separated review tokens (model + script); empty if fine
- fc_quality_note  : short reason for human review

Values are only written to cells that are currently empty — existing data
is never overwritten.  Confidence columns are always written (even when
the source cell already had a value) so you can audit model certainty.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    from dotenv import load_dotenv
    from openai import OpenAI
    from firecrawl import Firecrawl
except ImportError as exc:
    print(
        f"Missing dependency: {exc}\n"
        "  pip install -r scripts/requirements_firecrawl.txt",
        file=sys.stderr,
    )
    sys.exit(1)

# ---------------------------------------------------------------------------
# Fields to extract. App UI chips: see constants/pubFeatureChips.js.
# has_live_sport_tv is CSV-only until wired into the app.
# ---------------------------------------------------------------------------

FEATURE_SPECS: List[Tuple[str, str]] = [
    ("PUB_GARDEN", "has_pub_garden"),
    ("LIVE_MUSIC", "has_live_music"),
    ("LIVE_SPORT_TV", "has_live_sport_tv"),
    ("FOOD_AVAILABLE", "has_food_available"),
    ("DOG_FRIENDLY", "has_dog_friendly"),
    ("POOL_DARTS", "has_pool_darts"),
    ("ACCOMMODATION", "has_accommodation"),
]

SOFT_FIELDS: List[Tuple[str, str, str]] = [
    ("DESCRIPTION", "description", "conf_description"),
    ("PHONE", "phone", "conf_phone"),
    ("FOUNDED", "founded", "conf_founded"),
    ("OPERATOR", "operator", "conf_operator"),
]

FC_COLUMNS = ["fc_status", "fc_error", "fc_quality_flags", "fc_quality_note"]

# Model must use these exact strings inside DATA_QUALITY_FLAGS (JSON array).
DATA_QUALITY_FLAG_ALLOWLIST = frozenset(
    {
        "possible_wrong_website",
        "possibly_closed",
        "generic_chain_page",
        "name_or_location_mismatch",
        "other_concern",
    }
)
# Script-added token when Firecrawl returned very little text (unreliable extract).
THIN_SCRAPE_FLAG = "very_thin_scrape"
THIN_SCRAPE_CHARS = 450

SYSTEM_PROMPT = """
You are a strict information extractor for a British pub website. Your input is
rendered markdown from the pub's website (main page content). It may be
incomplete: SPAs sometimes render partially, and some boilerplate may remain.

Rules:
- Use ONLY the provided markdown. No outside knowledge or guessing.
- If the markdown does not clearly support a YES/NO field, answer UNKNOWN.
  Reserve NO for explicit negation (e.g. "no food served", "dogs not allowed").
- For each field output a confidence 0–1: how directly the markdown states it.
- DESCRIPTION: write a short pub-app listing (think Time Out or DesignMyNight
  style) — engaging, warm, and informative. Max 120 words / ~600 characters.
  Interpret the source content; do not copy sentences verbatim. Cover what
  makes the pub distinctive: vibe, setting, neighbourhood, food/drink offer,
  notable features. Do not start with the pub name. Do not mention URLs,
  sources, or phrases like "according to the website". Avoid hollow superlatives
  ("amazing", "incredible"). Empty string if the content is too thin to write
  anything meaningful.

Feature hints (still excerpt-only; lower confidence when implication is weak):
- FOOD_AVAILABLE: YES if menu headings, dish names, kitchen hours, or "order
  food" appear. UNKNOWN if only drinks are listed.
- PUB_GARDEN: YES for beer garden / patio / outdoor seating. UNKNOWN if not mentioned.
- LIVE_MUSIC: YES for gigs, DJs, open-mic listed as regular events. UNKNOWN if not mentioned.
- LIVE_SPORT_TV: YES for live sport on TV, big screens, Sky/BT/TNT sports, match-day
  showings, "watch the game", sports bar, multiple screens for football/rugby, etc.
  UNKNOWN if not mentioned. (Separate from LIVE_MUSIC — a pub can have both.)
- DOG_FRIENDLY: YES only if dogs explicitly welcomed; NO if explicitly banned; else UNKNOWN.
- POOL_DARTS: YES for pool table, darts, snooker, board games, or other table games as venue amenities. UNKNOWN if not mentioned.
- ACCOMMODATION: YES for rooms / B&B / hotel rooms. UNKNOWN if not mentioned.

Data quality (same markdown + pub name + URL as context only; flag only when the
markdown gives **clear** evidence — do not invent problems):
- **possible_wrong_website**: page is clearly about a different business, city, or venue than this pub.
- **possibly_closed**: "permanently closed", "ceased trading", "demolished", "no longer operating", etc.
- **generic_chain_page**: only national chain boilerplate with **no** venue-specific name, address, or detail matching this pub.
- **name_or_location_mismatch**: prominent title or hero text names a **different** pub or incompatible address vs the supplied pub name/URL.
- **other_concern**: something else materially wrong (say what in DATA_QUALITY_NOTE).
- If nothing is wrong, return an empty array and an empty note.

Output MUST be a single JSON object with exactly these keys:
{
  "DESCRIPTION": "string or empty",
  "DESCRIPTION_CONFIDENCE": 0.0,
  "PHONE": "UK number starting with 0 (local) or +44 (international), or empty string",
  "PHONE_CONFIDENCE": 0.0,
  "FOUNDED": "YYYY or Unknown",
  "FOUNDED_CONFIDENCE": 0.0,
  "OPERATOR": "string or empty",
  "OPERATOR_CONFIDENCE": 0.0,
  "PUB_GARDEN": "YES|NO|UNKNOWN",
  "PUB_GARDEN_CONFIDENCE": 0.0,
  "LIVE_MUSIC": "YES|NO|UNKNOWN",
  "LIVE_MUSIC_CONFIDENCE": 0.0,
  "LIVE_SPORT_TV": "YES|NO|UNKNOWN",
  "LIVE_SPORT_TV_CONFIDENCE": 0.0,
  "FOOD_AVAILABLE": "YES|NO|UNKNOWN",
  "FOOD_AVAILABLE_CONFIDENCE": 0.0,
  "DOG_FRIENDLY": "YES|NO|UNKNOWN",
  "DOG_FRIENDLY_CONFIDENCE": 0.0,
  "POOL_DARTS": "YES|NO|UNKNOWN",
  "POOL_DARTS_CONFIDENCE": 0.0,
  "ACCOMMODATION": "YES|NO|UNKNOWN",
  "ACCOMMODATION_CONFIDENCE": 0.0,
  "DATA_QUALITY_FLAGS": [],
  "DATA_QUALITY_NOTE": ""
}
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def is_empty(val: Any) -> bool:
    if val is None:
        return True
    return isinstance(val, str) and not val.strip()


def normalize_website(raw: str) -> Optional[str]:
    if is_empty(raw):
        return None
    s = raw.strip()
    if not re.match(r"^https?://", s, re.I):
        s = "https://" + s
    return s


def parse_confidence(data: Dict, key: str) -> float:
    try:
        v = float(data.get(key, 0))
        return max(0.0, min(1.0, v))
    except (TypeError, ValueError):
        return 0.0


def extract_data_quality(data: Dict[str, Any]) -> Tuple[List[str], str]:
    """Parse DATA_QUALITY_* from model JSON. Returns (flags, note)."""
    raw = data.get("DATA_QUALITY_FLAGS")
    out: List[str] = []
    if isinstance(raw, list):
        for x in raw:
            s = str(x).strip().lower().replace("-", "_").replace(" ", "_")
            if s in DATA_QUALITY_FLAG_ALLOWLIST and s not in out:
                out.append(s)
    elif isinstance(raw, str) and raw.strip():
        for part in re.split(r"[,;]", raw):
            s = part.strip().lower().replace("-", "_").replace(" ", "_")
            if s in DATA_QUALITY_FLAG_ALLOWLIST and s not in out:
                out.append(s)
    note = str(data.get("DATA_QUALITY_NOTE") or "").strip()
    if len(note) > 500:
        note = note[:499] + "…"
    return out, note


def merge_quality_flags(model_flags: List[str], *, thin_scrape: bool) -> List[str]:
    merged = list(model_flags)
    if thin_scrape and THIN_SCRAPE_FLAG not in merged:
        merged.append(THIN_SCRAPE_FLAG)
    return merged


def print_run_quality_report(all_rows: List[Dict[str, str]], chosen_idx: set) -> None:
    """Print pubs that need human review (this run)."""
    print("\n" + "=" * 72)
    print("Potential data issues — review recommended (this run only)")
    print("=" * 72)
    n = 0
    for i in sorted(chosen_idx):
        row = all_rows[i]
        st = (row.get("fc_status") or "").strip()
        qf = (row.get("fc_quality_flags") or "").strip()
        if st == "ok" and not qf:
            continue
        n += 1
        nm = row.get("name") or "?"
        rid = row.get("id") or "?"
        url = (row.get("website") or "").strip()
        print(f"\n  [{n}] {nm}")
        print(f"      id       : {rid}")
        print(f"      website  : {url}")
        print(f"      fc_status: {st or '(empty)'}")
        if qf:
            print(f"      flags    : {qf}")
        qn = (row.get("fc_quality_note") or "").strip()
        if qn:
            print(f"      note     : {qn}")
        if st != "ok":
            err = (row.get("fc_error") or "").strip()
            if err and err != qn:
                print(f"      fc_error : {err}")
    if n == 0:
        print("\n  (none — no failures and no quality flags on processed rows.)")
    print()


def normalize_phone_uk(raw: str) -> str:
    """
    Validate and fix common UK phone number extraction errors.

    Valid output either starts with 0 (local) or +44 (international).
    Common model errors fixed:
      - "20 7946 0123"   → "020 7946 0123"  (London 020 missing leading 0)
      - "44 20 7946 0123" → "+44 20 7946 0123" (international missing +)
      - "+44 (0)20 ..."  → "+44 20 ..."     (redundant (0) removed)

    Returns empty string if the number cannot be made valid.
    """
    if not raw or not raw.strip():
        return ""
    s = raw.strip()

    # Remove the redundant (0) that appears in +44 (0)20... style numbers
    s = re.sub(r"\(\s*0\s*\)", "", s).strip()

    # Extract only digits to reason about structure
    digits = re.sub(r"\D", "", s)

    # "44XXXXXXXXXX" (12 digits, international without +) → add +
    if len(digits) == 12 and digits.startswith("44") and not s.startswith("+"):
        s = "+" + s.lstrip()
        digits = re.sub(r"\D", "", s)

    # "20XXXXXXXX" (10 digits, London 020 missing leading 0) → prepend 0
    if len(digits) == 10 and digits.startswith("20"):
        digits = "0" + digits
        s = "0" + s.lstrip()

    # Final validation: must start with 0 (11 digits) or +44 (12 digits)
    if digits.startswith("0") and len(digits) == 11:
        return s
    if digits.startswith("44") and len(digits) == 12:
        return s

    return ""  # cannot be made valid — leave cell blank


def normalize_founded(value: str) -> str:
    if not value or not isinstance(value, str):
        return "Unknown"
    t = value.strip()
    if t.lower() == "unknown":
        return "Unknown"
    if len(t) == 4 and t.isdigit() and 1500 <= int(t) <= time.localtime().tm_year:
        return t
    return "Unknown"


def tri_to_bool(raw: str, conf: float, threshold: float) -> Optional[bool]:
    if conf < threshold:
        return None
    u = (raw or "").strip().upper()
    if u == "YES":
        return True
    if u == "NO":
        return False
    return None


def extract_json(content: str) -> Optional[Dict]:
    if not content:
        return None
    s = content.strip()
    if s.startswith("```"):
        lines = s.split("\n")
        if lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        s = "\n".join(lines).strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return None


# ---------------------------------------------------------------------------
# Firecrawl fetch
# ---------------------------------------------------------------------------

def firecrawl_scrape(
    fc: Firecrawl,
    url: str,
    max_chars: int,
) -> Tuple[str, str]:
    """
    Returns (markdown_text, error_string).
    error_string is empty on success.
    """
    try:
        result = fc.scrape(url, formats=["markdown"])
        md = getattr(result, "markdown", None) or (
            result.get("markdown") if isinstance(result, dict) else None
        )
        if not md:
            return "", "empty_markdown"
        md = md.strip()
        if len(md) < 100:
            return "", f"too_short:{len(md)}_chars"
        if len(md) > max_chars:
            md = md[:max_chars] + "\n\n[truncated]"
        return md, ""
    except Exception as exc:
        short = str(exc)[:120].replace("\n", " ")
        return "", f"firecrawl:{short}"


# ---------------------------------------------------------------------------
# OpenAI extraction
# ---------------------------------------------------------------------------

def call_openai(
    client: OpenAI,
    model: str,
    pub_name: str,
    website: str,
    markdown: str,
) -> Optional[Dict]:
    user = (
        f"Pub name (context only, do not override facts from markdown): {pub_name}\n"
        f"Website URL (context only): {website}\n\n"
        f"--- MARKDOWN START ---\n{markdown}\n--- MARKDOWN END ---"
    )
    try:
        completion = client.chat.completions.create(
            model=model,
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT.strip()},
                {"role": "user", "content": user},
            ],
        )
        content = completion.choices[0].message.content or ""
        return extract_json(content)
    except Exception as exc:
        raise RuntimeError(f"openai:{exc.__class__.__name__}:{exc}") from exc


# ---------------------------------------------------------------------------
# Enrichment — only fills empty cells
# ---------------------------------------------------------------------------

def apply_enrichment(
    row: Dict[str, str],
    data: Dict,
    threshold: float,
) -> Dict[str, str]:
    out = dict(row)

    for json_key, col, conf_col in SOFT_FIELDS:
        conf = parse_confidence(data, f"{json_key}_CONFIDENCE")
        out[conf_col] = f"{conf:.4f}"
        if not is_empty(out.get(col)):
            continue
        val = str(data.get(json_key) or "").strip()
        if conf < threshold or not val:
            continue
        if json_key == "FOUNDED":
            founded = normalize_founded(val)
            if founded != "Unknown":
                out[col] = founded
        elif json_key == "PHONE":
            phone = normalize_phone_uk(val)
            if phone:
                out[col] = phone
        else:
            out[col] = val

    for json_key, col in FEATURE_SPECS:
        conf_col = f"conf_{col}"
        conf = parse_confidence(data, f"{json_key}_CONFIDENCE")
        out[conf_col] = f"{conf:.4f}"
        if not is_empty(out.get(col)):
            continue
        raw = str(data.get(json_key) or "")
        b = tri_to_bool(raw, conf, threshold)
        if b is None:
            continue
        out[col] = "TRUE" if b else "FALSE"

    return out


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
    extra: List[str] = []
    for _, col, c in SOFT_FIELDS:
        if col not in base:
            extra.append(col)
        if c not in base:
            extra.append(c)
    for _, col in FEATURE_SPECS:
        if col not in base:
            extra.append(col)
        conf = f"conf_{col}"
        if conf not in base:
            extra.append(conf)
    for c in FC_COLUMNS:
        if c not in base:
            extra.append(c)
    return list(dict.fromkeys([*base, *extra]))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Enrich pub CSV: Firecrawl website fetch → OpenAI extraction.",
    )
    parser.add_argument(
        "--input", "-i",
        type=Path,
        default=repo_root() / "data" / "data_list_wikidata_enriched.csv",
        help="Input CSV (default: data/data_list_wikidata_enriched.csv)",
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=repo_root() / "data" / "data_list_firecrawl_enriched.csv",
        help="Output CSV (default: data/data_list_firecrawl_enriched.csv)",
    )
    parser.add_argument(
        "--sample",
        type=int,
        default=None,
        help="Randomly sample N pubs with websites (same as --limit; omit both to process all)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Max pubs to process this run (random sample of eligible; use with --seed). Same as --sample.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="RNG seed for reproducible sampling",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=float(os.getenv("PUB_CONFIDENCE_THRESHOLD", "0.75")),
        help="Min confidence to accept a field value (default: 0.75)",
    )
    parser.add_argument(
        "--model",
        default=os.getenv("OPENAI_FIRECRAWL_MODEL", "gpt-5.4-nano-2026-03-17"),
        help="OpenAI model (default: gpt-5.4-nano-2026-03-17)",
    )
    parser.add_argument(
        "--max-chars",
        type=int,
        default=24_000,
        help="Max markdown chars sent to OpenAI (default: 24000)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Seconds to pause between pubs (default: 1.0)",
    )
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Skip pubs that already have a description filled in",
    )
    parser.add_argument(
        "--exclude-fc-ok",
        action="store_true",
        help="When sampling, skip rows that already have fc_status=ok (different batch)",
    )
    args = parser.parse_args()
    if args.sample is not None and args.limit is not None:
        parser.error("Use only one of --sample and --limit (they mean the same thing).")
    sample_cap: Optional[int] = args.limit if args.limit is not None else args.sample

    # --- Load env ---
    load_dotenv(repo_root() / ".env")
    load_dotenv(repo_root() / "scripts" / ".env")

    fc_key = os.getenv("FIRECRAWL_API_KEY")
    if not fc_key:
        print(
            "FIRECRAWL_API_KEY not set.\n"
            "  1. Sign up at https://firecrawl.dev (free tier: 500 pages)\n"
            "  2. Add FIRECRAWL_API_KEY=fc-... to your .env",
            file=sys.stderr,
        )
        sys.exit(1)

    oai_key = os.getenv("OPENAI_API_KEY")
    if not oai_key:
        print("OPENAI_API_KEY not set in .env", file=sys.stderr)
        sys.exit(1)

    if not args.input.is_file():
        print(f"Input not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    # --- Read CSV ---
    fieldnames, all_rows = read_csv(args.input)
    out_fields = build_fieldnames(fieldnames)

    # Ensure new columns exist in every row
    for row in all_rows:
        for col in out_fields:
            row.setdefault(col, "")

    # --- Select pubs to process ---
    def fc_ok(r: Dict[str, str]) -> bool:
        return (r.get("fc_status") or "").strip().lower() == "ok"

    eligible_idx = [
        i
        for i, r in enumerate(all_rows)
        if normalize_website(r.get("website", "") or "")
        and (not args.only_missing or is_empty(r.get("description", "")))
        and (not args.exclude_fc_ok or not fc_ok(r))
    ]

    if sample_cap is not None:
        n = min(sample_cap, len(eligible_idx))
        rng = random.Random(args.seed)
        chosen_idx = set(rng.sample(eligible_idx, n))
    else:
        chosen_idx = set(eligible_idx)

    total_eligible = len(eligible_idx)
    total_chosen = len(chosen_idx)
    print(f"Input rows      : {len(all_rows)}")
    print(f"Have website    : {total_eligible}")
    print(f"Will process    : {total_chosen}")
    print(f"Model           : {args.model}")
    print(f"Threshold       : {args.threshold}")
    print()

    # --- Clients ---
    fc = Firecrawl(api_key=fc_key)
    client = OpenAI(api_key=oai_key)

    # --- Process ---
    ok = failed_scrape = failed_openai = skipped = 0

    for i, row in enumerate(all_rows):
        if i not in chosen_idx:
            continue

        name = row.get("name", "") or "?"
        url = normalize_website(row.get("website", "") or "")
        print(f"[{ok + failed_scrape + failed_openai + skipped + 1}/{total_chosen}] {name}")
        print(f"  URL: {url}")

        # Firecrawl fetch
        markdown, fc_err = firecrawl_scrape(fc, url, args.max_chars)
        if fc_err:
            print(f"  SCRAPE FAILED: {fc_err}")
            all_rows[i]["fc_status"] = "scrape_failed"
            all_rows[i]["fc_error"] = fc_err
            all_rows[i]["fc_quality_flags"] = "scrape_failed"
            all_rows[i]["fc_quality_note"] = (fc_err or "")[:500]
            failed_scrape += 1
            time.sleep(args.delay)
            continue

        print(f"  Scraped: {len(markdown):,} chars")

        # OpenAI extraction
        try:
            data = call_openai(client, args.model, name, url, markdown)
        except RuntimeError as exc:
            err_s = str(exc)[:500]
            print(f"  OPENAI FAILED: {exc}")
            all_rows[i]["fc_status"] = "openai_failed"
            all_rows[i]["fc_error"] = str(exc)[:200]
            all_rows[i]["fc_quality_flags"] = "openai_failed"
            all_rows[i]["fc_quality_note"] = err_s
            failed_openai += 1
            time.sleep(args.delay)
            continue

        if not data:
            print("  OPENAI: bad JSON response")
            all_rows[i]["fc_status"] = "openai_failed"
            all_rows[i]["fc_error"] = "bad_json"
            all_rows[i]["fc_quality_flags"] = "openai_failed"
            all_rows[i]["fc_quality_note"] = "bad_json"
            failed_openai += 1
            time.sleep(args.delay)
            continue

        # Apply enrichment
        all_rows[i] = apply_enrichment(all_rows[i], data, args.threshold)
        all_rows[i]["fc_status"] = "ok"
        all_rows[i]["fc_error"] = ""

        model_q_flags, qual_note = extract_data_quality(data)
        thin = len(markdown) < THIN_SCRAPE_CHARS
        merged_q = merge_quality_flags(model_q_flags, thin_scrape=thin)
        all_rows[i]["fc_quality_flags"] = ";".join(merged_q)
        all_rows[i]["fc_quality_note"] = qual_note
        if merged_q:
            print(f"  QUALITY     : {'; '.join(merged_q)}")
            if qual_note:
                qdisp = qual_note if len(qual_note) <= 120 else qual_note[:117] + "..."
                print(f"                 ({qdisp})")

        # Print what was extracted
        desc = all_rows[i].get("description", "")
        if desc:
            print(f"  Description : {desc[:80]}…" if len(desc) > 80 else f"  Description : {desc}")
        features = {col: all_rows[i].get(col, "") for _, col in FEATURE_SPECS if all_rows[i].get(col, "")}
        if features:
            print(f"  Features    : {features}")

        ok += 1
        time.sleep(args.delay)

    # --- Write output ---
    write_csv(args.output, out_fields, all_rows)

    print()
    print(f"--- Done ---")
    print(f"Wrote        : {args.output}")
    print(f"OK           : {ok}")
    print(f"Scrape failed: {failed_scrape}")
    print(f"OpenAI failed: {failed_openai}")
    print(f"Not chosen   : {len(all_rows) - total_chosen}")
    print_run_quality_report(all_rows, chosen_idx)


if __name__ == "__main__":
    main()
