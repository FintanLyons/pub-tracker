#!/usr/bin/env python3
"""
Enrich pubs that have NO website using Tavily search + OpenAI.

For each pub without a website, builds a targeted search query
(e.g. '"The Anchor" Brixton SW9 London pub'), calls the Tavily basic search
endpoint (1 credit per call regardless of max_results) with include_raw_content=True
to get full page text, then feeds that to OpenAI for structured extraction.

Also tries to identify the pub's official website from the search results,
storing it as `fcs_website_guess` with a `fcs_website_conf` 0–1 score.

Prerequisites:
  .venv-firecrawl/bin/pip install tavily-python openai python-dotenv

Quick test (10 no-website pubs):
  .venv-firecrawl/bin/python scripts/enrich_search_pubs.py --limit 10 --seed 1

Continue from where you left off (skip already-ok rows):
  .venv-firecrawl/bin/python scripts/enrich_search_pubs.py --exclude-done

Output columns added (all prefixed fcs_ to distinguish from Firecrawl scrape run)
----------------------------------------------------------------------------------
fcs_status          : "ok" | "search_failed" | "no_results" | "openai_failed"
fcs_error           : short error string
fcs_query           : the search query used
fcs_source_url      : URL of the result whose markdown was extracted
fcs_source_title    : page title of that result
fcs_website_guess   : model's best guess at the pub's official website URL
fcs_website_conf    : confidence 0–1 for the website guess
fcs_quality_flags   : semicolon-separated review tokens (same set as fc_quality_flags)
fcs_quality_note    : short reason for review

Soft fields (description, phone, founded, operator) and feature chips are
shared with the main enrichment script — only written if the cell is empty
(same "never overwrite" rule applies).
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
from urllib.parse import urlparse

try:
    from dotenv import load_dotenv
    from openai import OpenAI
    from tavily import TavilyClient
except ImportError as exc:
    print(
        f"Missing dependency: {exc}\n"
        "  .venv-firecrawl/bin/pip install tavily-python",
        file=sys.stderr,
    )
    sys.exit(1)


# ---------------------------------------------------------------------------
# Shared field specs — keep in sync with enrich_pub_data_firecrawl.py
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

# New columns written by this script (fcs_ = firecrawl-search)
FCS_COLUMNS = [
    "fcs_status",
    "fcs_error",
    "fcs_query",
    "fcs_source_url",
    "fcs_source_title",
    "fcs_website_guess",
    "fcs_website_conf",
    "fcs_quality_flags",
    "fcs_quality_note",
]

DATA_QUALITY_FLAG_ALLOWLIST = frozenset(
    {
        "possible_wrong_pub",
        "possibly_closed",
        "generic_chain_page",
        "name_or_location_mismatch",
        "other_concern",
    }
)

THIN_CONTENT_FLAG = "very_thin_content"
THIN_CONTENT_CHARS = 400

# Domains that are aggregators — never the pub's own website
AGGREGATOR_DOMAINS = frozenset(
    {
        "designmynight.com", "timeout.com", "timeout.co.uk",
        "yelp.co.uk", "yelp.com", "tripadvisor.co.uk", "tripadvisor.com",
        "yell.com", "allinlondon.co.uk", "greatlocalpubs.co.uk",
        "beerintheevening.com", "pubsgalore.co.uk", "foursquare.com",
        "google.com", "google.co.uk", "maps.google.com",
        "visitlondon.com", "londonpubs.com", "squaremeal.co.uk",
        "5pm.co.uk", "bookatable.co.uk", "opentable.co.uk",
        "opentable.com", "zomato.com", "hiddencitylondon.com",
        "londonist.com", "thelondoneconomic.com", "standard.co.uk",
        "time-out.com", "whatpub.com", "camra.org.uk",
        "en.wikipedia.org", "wikidata.org",
    }
)

# ---------------------------------------------------------------------------
# System prompt — adapted for third-party search content
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """
You are a strict information extractor for a British pub. Your input is
markdown scraped from a **search result page** (could be a review site,
listing aggregator, blog, or chain website) — NOT the pub's own website.

Rules:
- Use ONLY the provided markdown. No outside knowledge or guessing.
- If the markdown does not clearly support a YES/NO field, answer UNKNOWN.
  Reserve NO for explicit negation (e.g. "no food", "dogs not allowed").
- For each field output a confidence 0–1 reflecting how directly the
  markdown states or implies it. Aggregator listings are often reliable
  for basic facts (food, garden) but less so for fine details.
- DESCRIPTION: write a short pub-app listing (think Time Out or DesignMyNight
  style) — engaging, warm, and informative. Max 120 words / ~600 characters.
  Interpret the source content; do not copy sentences verbatim. Cover what
  makes the pub distinctive: vibe, setting, neighbourhood, food/drink offer,
  notable features. Do not start with the pub name. Do not mention URLs,
  sources, or phrases like "according to the website". Avoid hollow superlatives
  ("amazing", "incredible"). Empty string if the content is too thin to write
  anything meaningful.
- OFFICIAL_WEBSITE: if the markdown or the source URL clearly mentions or
  links to the pub's own domain (not an aggregator), return that URL.
  Return empty string if not found. Return a confidence 0–1.

Feature hints:
- FOOD_AVAILABLE: YES for menu items, kitchen hours, "order food".
- PUB_GARDEN: YES for beer garden, patio, outdoor seating.
- LIVE_MUSIC: YES for gigs, DJs, open-mic listed as regular events.
- LIVE_SPORT_TV: YES for live sport on TV, big screens, Sky/BT/TNT, match
  showings, sports bar. UNKNOWN if not mentioned.
- DOG_FRIENDLY: YES if dogs explicitly welcomed; NO if explicitly banned.
- POOL_DARTS: YES for pool, darts, snooker, board games as venue amenities.
- ACCOMMODATION: YES for rooms / B&B / hotel.

Data quality (flag only on clear evidence — do not invent problems):
- possible_wrong_pub: content is clearly about a different venue.
- possibly_closed: "permanently closed", "ceased trading", "demolished".
- generic_chain_page: only chain homepage with nothing venue-specific.
- name_or_location_mismatch: title/content names a different pub.
- other_concern: something else materially wrong (explain in note).

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
  "OFFICIAL_WEBSITE": "https://... or empty string",
  "OFFICIAL_WEBSITE_CONFIDENCE": 0.0,
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


def parse_confidence(data: Dict, key: str) -> float:
    try:
        v = float(data.get(key, 0))
        return max(0.0, min(1.0, v))
    except (TypeError, ValueError):
        return 0.0


def normalize_phone_uk(raw: str) -> str:
    if not raw or not raw.strip():
        return ""
    s = raw.strip()
    s = re.sub(r"\(\s*0\s*\)", "", s).strip()
    digits = re.sub(r"\D", "", s)
    if len(digits) == 12 and digits.startswith("44") and not s.startswith("+"):
        s = "+" + s.lstrip()
        digits = re.sub(r"\D", "", s)
    if len(digits) == 10 and digits.startswith("20"):
        digits = "0" + digits
        s = "0" + s.lstrip()
    if digits.startswith("0") and len(digits) == 11:
        return s
    if digits.startswith("44") and len(digits) == 12:
        return s
    return ""


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


def is_aggregator(url: str) -> bool:
    try:
        host = urlparse(url).netloc.lower().lstrip("www.")
        return any(host == d or host.endswith("." + d) for d in AGGREGATOR_DOMAINS)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Search query builder
# ---------------------------------------------------------------------------

def build_query(row: Dict[str, str]) -> str:
    name = (row.get("name") or "").strip()
    street = (row.get("addr_street") or "").strip()
    housenumber = (row.get("addr_housenumber") or "").strip()
    district = (row.get("calc_postcode_district") or "").strip()

    parts = [f'"{name}"']
    if street:
        addr = f"{housenumber} {street}".strip() if housenumber else street
        parts.append(addr)
    elif district:
        parts.append(district)
    parts.append("London pub")
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Tavily search  (1 credit per call regardless of max_results)
# ---------------------------------------------------------------------------

def tavily_search(
    client: TavilyClient,
    query: str,
    max_chars: int,
    n_results: int = 3,
) -> Tuple[str, str, str, str]:
    """
    Returns (content, source_url, source_title, error).
    Calls Tavily basic search with include_raw_content=True (still 1 credit).
    Merges non-aggregator results first, up to max_chars.
    error is empty string on success.
    """
    try:
        response = client.search(
            query,
            search_depth="basic",
            include_raw_content=True,
            max_results=n_results,
        )

        results = response.get("results") or []
        if not results:
            return "", "", "", "no_results"

        # Prefer non-aggregator pages
        def score(item: Dict) -> int:
            return 0 if is_aggregator(item.get("url", "")) else 1

        sorted_results = sorted(results, key=score, reverse=True)

        merged_parts: List[str] = []
        first_url = ""
        first_title = ""
        total = 0

        for item in sorted_results:
            url = (item.get("url") or "").strip()
            title = (item.get("title") or "").strip()
            # raw_content is the full scraped page; content is a short snippet
            content = (item.get("raw_content") or item.get("content") or "").strip()

            if not content:
                continue

            if not first_url:
                first_url = url
                first_title = title

            remaining = max_chars - total
            if remaining <= 200:
                break

            chunk = content if len(content) <= remaining else content[:remaining] + "\n\n[truncated]"
            merged_parts.append(f"[SOURCE: {url}]\n{chunk}")
            total += len(chunk)

        if not merged_parts:
            return "", "", "", "no_content_in_results"

        return "\n\n---\n\n".join(merged_parts), first_url, first_title, ""

    except Exception as exc:
        short = str(exc)[:200].replace("\n", " ")
        return "", "", "", f"search_error:{short}"


# ---------------------------------------------------------------------------
# OpenAI extraction
# ---------------------------------------------------------------------------

def call_openai(
    client: OpenAI,
    model: str,
    pub_name: str,
    pub_address: str,
    query: str,
    markdown: str,
) -> Optional[Dict]:
    user = (
        f"Pub name: {pub_name}\n"
        f"Pub address (for context only): {pub_address}\n"
        f"Search query used: {query}\n\n"
        f"--- SEARCH RESULT CONTENT START ---\n{markdown}\n--- SEARCH RESULT CONTENT END ---"
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
# Quality flag helpers
# ---------------------------------------------------------------------------

def extract_data_quality(data: Dict[str, Any]) -> Tuple[List[str], str]:
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
    note = str(data.get("DATA_QUALITY_NOTE") or "").strip()[:500]
    return out, note


def print_quality_report(all_rows: List[Dict[str, str]], chosen_idx: set) -> None:
    print("\n" + "=" * 72)
    print("Potential data issues — review recommended (this run only)")
    print("=" * 72)
    n = 0
    for i in sorted(chosen_idx):
        row = all_rows[i]
        st = (row.get("fcs_status") or "").strip()
        qf = (row.get("fcs_quality_flags") or "").strip()
        if st == "ok" and not qf:
            continue
        n += 1
        print(f"\n  [{n}] {row.get('name','?')}")
        print(f"      id      : {row.get('id','')}")
        print(f"      query   : {row.get('fcs_query','')}")
        print(f"      source  : {row.get('fcs_source_url','')[:80]}")
        print(f"      status  : {st} | flags: {qf}")
        note = (row.get("fcs_quality_note") or "").strip()
        if note:
            print(f"      note    : {note[:160]}{'…' if len(note) > 160 else ''}")
    if n == 0:
        print("\n  (none — no failures or quality flags this run.)")
    print()


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
    for c in FCS_COLUMNS:
        if c not in base:
            extra.append(c)
    return list(dict.fromkeys([*base, *extra]))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Enrich no-website pubs via Tavily search + OpenAI.",
    )
    parser.add_argument(
        "--input", "-i",
        type=Path,
        default=repo_root() / "data" / "data_list_firecrawl_enriched.csv",
        help="Input CSV (default: data/data_list_firecrawl_enriched.csv)",
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=repo_root() / "data" / "data_list_firecrawl_enriched.csv",
        help="Output CSV (default: same as input — in-place update)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Max pubs to process this run (random sample of eligible)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="RNG seed for reproducible sampling (only used with --limit)",
    )
    parser.add_argument(
        "--exclude-done",
        action="store_true",
        help="Skip rows that already have fcs_status=ok",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=float(os.getenv("PUB_CONFIDENCE_THRESHOLD", "0.75")),
        help="Min confidence to write a field value (default: 0.75)",
    )
    parser.add_argument(
        "--model",
        default=os.getenv("OPENAI_SEARCH_MODEL", "gpt-5.4-nano-2026-03-17"),
        help="OpenAI model (default: gpt-5.4-nano-2026-03-17)",
    )
    parser.add_argument(
        "--max-chars",
        type=int,
        default=20_000,
        help="Max total markdown chars from search results sent to OpenAI (default: 20000)",
    )
    parser.add_argument(
        "--n-results",
        type=int,
        default=3,
        help="Tavily search: max results to request per pub (default: 3 — entire call costs 1 credit regardless)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.5,
        help="Seconds between pubs (default: 1.5 — search is slower than scrape)",
    )
    parser.add_argument(
        "--website-conf-threshold",
        type=float,
        default=0.7,
        help="Min confidence to write fcs_website_guess to the website column (default: 0.7)",
    )
    args = parser.parse_args()

    load_dotenv(repo_root() / ".env")
    load_dotenv(repo_root() / "scripts" / ".env")

    tavily_key = os.getenv("TAVILY_API_KEY")
    if not tavily_key:
        print("TAVILY_API_KEY not set in .env", file=sys.stderr)
        sys.exit(1)
    oai_key = os.getenv("OPENAI_API_KEY")
    if not oai_key:
        print("OPENAI_API_KEY not set in .env", file=sys.stderr)
        sys.exit(1)
    if not args.input.is_file():
        print(f"Input not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    fieldnames, all_rows = read_csv(args.input)
    out_fields = build_fieldnames(fieldnames)
    for row in all_rows:
        for col in out_fields:
            row.setdefault(col, "")

    # Eligible: no website, and optionally not already done
    def already_done(r: Dict[str, str]) -> bool:
        return (r.get("fcs_status") or "").strip().lower() == "ok"

    eligible_idx = [
        i for i, r in enumerate(all_rows)
        if is_empty(r.get("website"))
        and (not args.exclude_done or not already_done(r))
    ]

    if args.limit is not None:
        n = min(args.limit, len(eligible_idx))
        rng = random.Random(args.seed)
        chosen_idx = set(rng.sample(eligible_idx, n))
    else:
        chosen_idx = set(eligible_idx)

    total = len(chosen_idx)
    print(f"Input rows        : {len(all_rows)}")
    print(f"No website        : {len(eligible_idx)}")
    print(f"Will process      : {total}")
    print(f"Model             : {args.model}")
    print(f"Threshold         : {args.threshold}")
    print(f"Website conf min  : {args.website_conf_threshold}")
    print()

    tavily = TavilyClient(api_key=tavily_key)
    client = OpenAI(api_key=oai_key)

    ok = failed_search = failed_openai = 0
    counter = 0

    for i, row in enumerate(all_rows):
        if i not in chosen_idx:
            continue
        counter += 1

        name = row.get("name") or "?"
        address = " ".join(filter(None, [
            row.get("addr_housenumber", ""),
            row.get("addr_street", ""),
            row.get("calc_postcode_district", ""),
        ]))
        query = build_query(row)

        print(f"[{counter}/{total}] {name}")
        print(f"  Query : {query}")

        markdown, src_url, src_title, err = tavily_search(
            tavily, query, args.max_chars, args.n_results
        )

        if err:
            print(f"  SEARCH FAILED: {err}")
            all_rows[i]["fcs_status"] = "search_failed" if "no_results" not in err else "no_results"
            all_rows[i]["fcs_error"] = err[:500]
            all_rows[i]["fcs_query"] = query
            all_rows[i]["fcs_quality_flags"] = all_rows[i]["fcs_status"]
            all_rows[i]["fcs_quality_note"] = err[:500]
            failed_search += 1
            time.sleep(args.delay)
            continue

        print(f"  Source: {src_url[:80]}")
        print(f"  Content: {len(markdown):,} chars")

        try:
            data = call_openai(client, args.model, name, address, query, markdown)
        except RuntimeError as exc:
            print(f"  OPENAI FAILED: {exc}")
            all_rows[i]["fcs_status"] = "openai_failed"
            all_rows[i]["fcs_error"] = str(exc)[:200]
            all_rows[i]["fcs_query"] = query
            all_rows[i]["fcs_quality_flags"] = "openai_failed"
            failed_openai += 1
            time.sleep(args.delay)
            continue

        if not data:
            print("  OPENAI: bad JSON")
            all_rows[i]["fcs_status"] = "openai_failed"
            all_rows[i]["fcs_error"] = "bad_json"
            all_rows[i]["fcs_query"] = query
            all_rows[i]["fcs_quality_flags"] = "openai_failed"
            failed_openai += 1
            time.sleep(args.delay)
            continue

        # Apply shared enrichment
        all_rows[i] = apply_enrichment(all_rows[i], data, args.threshold)

        # Website guess
        raw_website = str(data.get("OFFICIAL_WEBSITE") or "").strip()
        website_conf = parse_confidence(data, "OFFICIAL_WEBSITE_CONFIDENCE")
        all_rows[i]["fcs_website_guess"] = raw_website
        all_rows[i]["fcs_website_conf"] = f"{website_conf:.4f}"
        # Write to `website` column only if confident and it's not an aggregator
        if (
            raw_website
            and website_conf >= args.website_conf_threshold
            and not is_aggregator(raw_website)
            and is_empty(all_rows[i].get("website"))
        ):
            all_rows[i]["website"] = raw_website
            print(f"  Website : {raw_website} (conf={website_conf:.2f})")

        # Quality flags
        thin = len(markdown) < THIN_CONTENT_CHARS
        model_flags, qual_note = extract_data_quality(data)
        merged = list(model_flags)
        if thin and THIN_CONTENT_FLAG not in merged:
            merged.append(THIN_CONTENT_FLAG)
        all_rows[i]["fcs_quality_flags"] = ";".join(merged)
        all_rows[i]["fcs_quality_note"] = qual_note
        if merged:
            print(f"  QUALITY : {'; '.join(merged)}")
            if qual_note:
                print(f"            ({qual_note[:120]}{'…' if len(qual_note) > 120 else ''})")

        all_rows[i]["fcs_status"] = "ok"
        all_rows[i]["fcs_error"] = ""
        all_rows[i]["fcs_query"] = query
        all_rows[i]["fcs_source_url"] = src_url
        all_rows[i]["fcs_source_title"] = src_title

        # Print extracted fields
        desc = all_rows[i].get("description", "")
        if desc:
            print(f"  Desc    : {desc[:90]}{'…' if len(desc) > 90 else ''}")
        features = {col: all_rows[i].get(col, "") for _, col in FEATURE_SPECS if all_rows[i].get(col, "") == "TRUE"}
        if features:
            print(f"  Features: {list(features.keys())}")

        ok += 1
        time.sleep(args.delay)

    write_csv(args.output, out_fields, all_rows)

    print()
    print("--- Done ---")
    print(f"Wrote          : {args.output}")
    print(f"OK             : {ok}")
    print(f"Search failed  : {failed_search}")
    print(f"OpenAI failed  : {failed_openai}")
    print_quality_report(all_rows, chosen_idx)


if __name__ == "__main__":
    main()
