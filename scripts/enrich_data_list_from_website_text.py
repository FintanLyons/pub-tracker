#!/usr/bin/env python3
"""
Fill ``data_list`` columns from **Tier A** plain text: prefer CSV column ``tier_a_excerpt``,
else fall back to ``tier_a_text_relpath`` files (legacy).

This is the CSV counterpart to ``scripts/update_pub_data.py``, which enriches
``pubs_all`` in Supabase using OpenAI **without** website text (name/address/description
context only). The older ``scripts/enrich_pub_data.py`` targeted the legacy ``pubs``
table with similar ideas but **no per-feature confidence**.

**Where original Supabase pub rows came from:** bulk SQL seeds
``scripts/pub_insert_1.sql``, ``pub_insert_2.sql``, ``pub_insert_3.sql`` (large
``INSERT INTO pubs_all (...)`` batches). Later enrichment used
``enrich_pub_data.py`` / ``update_pub_data.py``.

This script:
- Reads a CSV produced by ``fetch_pub_websites_tier_a.py`` (``tier_a_excerpt`` and/or
  ``tier_a_text_relpath``; ``tier_a_success`` is advisory only).
- Uses ``tier_a_excerpt`` when non-empty; otherwise loads ``.txt`` from ``tier_a_text_relpath``.
- Calls OpenAI with **website excerpt only** (no outside knowledge); structured
  JSON with confidences 0–1.
- **Only fills empty** target cells; never overwrites existing CSV values.
- Writes **confidence columns** (``conf_description``, ``conf_phone``, …) as
  decimal strings; empty if that field was not inferred this run.
- Default model: **``gpt-5.4-nano``** (override with ``OPENAI_WEBSITE_ENRICH_MODEL`` or ``--model``).

The model sees **only the Tier A text excerpt** (main-body extraction), not the raw HTML page
and not other URLs unless their text was merged into that excerpt. Larger / menu-heavy pages
may need Tier B fetch or a second crawl that appends ``/menu`` text into Tier A.

Feature booleans in ``data_list`` (six chips only — no parking/cask columns):
``has_pub_garden``, ``has_live_music``, ``has_food_available``, ``has_dog_friendly``,
``has_pool_darts``, ``has_accommodation``. Values written as ``TRUE`` / ``FALSE``
only when the model says YES/NO **and** confidence ≥ ``--threshold``; otherwise
the cell stays empty (unknown).

Setup::

  .venv/bin/pip install -r scripts/requirements_website_enrich.txt
  # .env at repo root or scripts/: OPENAI_API_KEY=...

Usage::

  python3 scripts/enrich_data_list_from_website_text.py \\
    --input data/data_list_tier_a_sample.csv \\
    -o data/data_list_website_enriched.csv \\
    --threshold 0.6
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    from dotenv import load_dotenv
    from openai import OpenAI
except ImportError:
    print("Install: pip install openai python-dotenv", file=sys.stderr)
    sys.exit(1)

# --- Same feature semantics as constants/pubFeatureChips.js (CSV has these six only)
FEATURE_SPECS: List[Tuple[str, str]] = [
    ("PUB_GARDEN", "has_pub_garden"),
    ("LIVE_MUSIC", "has_live_music"),
    ("FOOD_AVAILABLE", "has_food_available"),
    ("DOG_FRIENDLY", "has_dog_friendly"),
    ("POOL_DARTS", "has_pool_darts"),
    ("ACCOMMODATION", "has_accommodation"),
]

SOFT_FIELDS = [
    ("DESCRIPTION", "description", "conf_description"),
    ("PHONE", "phone", "conf_phone"),
    ("FOUNDED", "founded", "conf_founded"),
    ("OPERATOR", "operator", "conf_operator"),
]

SYSTEM_PROMPT = """
You are a strict information extractor for a British pub website. Your input is a **plain-text
excerpt** produced upstream (main readable content). It is **not** guaranteed to be the full
site: boilerplate may be removed, **other pages** (e.g. full menu PDF, separate /menu URL) may
be missing, and the excerpt may be **truncated**. Do not assume facts beyond the excerpt.

Rules:
- Use ONLY the excerpt. No outside knowledge, no visiting URLs, no guessing hidden pages.
- If the excerpt does not support a YES/NO field, answer **UNKNOWN** (not NO). Reserve **NO**
  for clear negation in the excerpt (e.g. "no food", "drinks only").
- For each field output a **confidence** 0–1 = how directly the excerpt states or implies it.

Feature hints (still excerpt-only; lower confidence when implication is weak):
- **FOOD_AVAILABLE**: YES if the excerpt clearly indicates food service — e.g. menu headings,
  dish lists, roast / kitchen hours, "order food", **or** prominent nav/button text like
  "Menu", "Food", "Eat" **together** with a pub context (use **lower** confidence for link text
  alone with no dishes). UNKNOWN if only drinks are mentioned.
- **PUB_GARDEN**: YES for beer garden / patio / outdoor seating clearly for customers; UNKNOWN if not mentioned.
- **LIVE_MUSIC**: YES for gigs, DJs listed as regular entertainment, "live music"; UNKNOWN if not mentioned.
- **DOG_FRIENDLY**: YES only if dogs welcomed / dog-friendly stated; NO if dogs explicitly not allowed; else UNKNOWN.
- **POOL_DARTS**: YES for pool table, darts, snooker, skittles as venue amenities; UNKNOWN if not mentioned.
- **ACCOMMODATION**: YES for rooms / B&B / stay overnight; UNKNOWN if not mentioned.

Output MUST be a single JSON object with exactly these keys (use UNKNOWN in uppercase where noted):
{
  "DESCRIPTION": "short factual summary from excerpt only, max 120 words, or empty string",
  "DESCRIPTION_CONFIDENCE": 0.0,
  "PHONE": "one canonical phone string as shown in excerpt, or empty string",
  "PHONE_CONFIDENCE": 0.0,
  "FOUNDED": "YYYY or Unknown",
  "FOUNDED_CONFIDENCE": 0.0,
  "OPERATOR": "operator / pub company name if stated in excerpt, else empty string",
  "OPERATOR_CONFIDENCE": 0.0,
  "PUB_GARDEN": "YES|NO|UNKNOWN",
  "PUB_GARDEN_CONFIDENCE": 0.0,
  "LIVE_MUSIC": "YES|NO|UNKNOWN",
  "LIVE_MUSIC_CONFIDENCE": 0.0,
  "FOOD_AVAILABLE": "YES|NO|UNKNOWN",
  "FOOD_AVAILABLE_CONFIDENCE": 0.0,
  "DOG_FRIENDLY": "YES|NO|UNKNOWN",
  "DOG_FRIENDLY_CONFIDENCE": 0.0,
  "POOL_DARTS": "YES|NO|UNKNOWN",
  "POOL_DARTS_CONFIDENCE": 0.0,
  "ACCOMMODATION": "YES|NO|UNKNOWN",
  "ACCOMMODATION_CONFIDENCE": 0.0
}
"""


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def is_empty(val: Any) -> bool:
    if val is None:
        return True
    if isinstance(val, str):
        return len(val.strip()) == 0
    return False


def parse_confidence(result: Dict, key: str) -> float:
    try:
        v = float(result.get(key, 0))
        if v < 0:
            return 0.0
        if v > 1:
            return 1.0
        return v
    except (TypeError, ValueError):
        return 0.0


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
    """Return True/False if decisive; None = leave CSV cell unchanged (unknown)."""
    if conf < threshold:
        return None
    u = (raw or "").strip().upper()
    if u == "YES":
        return True
    if u == "NO":
        return False
    return None


def bool_to_csv(b: bool) -> str:
    return "TRUE" if b else "FALSE"


def extract_message_text(message: Any) -> str:
    """Normalize chat completion message content (str or list of parts)."""
    content = getattr(message, "content", None)
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        pieces: List[str] = []
        for part in content:
            if isinstance(part, dict):
                t = part.get("text")
                if t:
                    pieces.append(str(t))
            elif isinstance(part, str):
                pieces.append(part)
        return "\n".join(pieces).strip()
    if content is None:
        return ""
    return str(content).strip()


def extract_json(content: Optional[str]) -> Optional[Dict]:
    if not content:
        return None
    s = content.strip()
    if s.startswith("```"):
        lines = s.split("\n")
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        s = "\n".join(lines).strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return None


def call_model(
    client: OpenAI,
    *,
    model: str,
    pub_name: str,
    website: str,
    excerpt: str,
) -> Optional[Dict]:
    user = (
        f"Pub name (context only, do not override excerpt facts): {pub_name}\n"
        f"Website URL (context only): {website}\n\n"
        f"--- EXCERPT START ---\n{excerpt}\n--- EXCERPT END ---"
    )
    completion = client.chat.completions.create(
        model=model,
        temperature=0.2,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT.strip()},
            {"role": "user", "content": user},
        ],
    )
    msg = completion.choices[0].message
    raw = extract_message_text(msg)
    return extract_json(raw)


def apply_enrichment(
    row: Dict[str, str],
    data: Dict,
    threshold: float,
) -> Dict[str, str]:
    out = dict(row)

    for json_key, col, conf_col in SOFT_FIELDS:
        if not is_empty(out.get(col)):
            continue
        raw_val = data.get(json_key)
        val = (raw_val or "").strip() if isinstance(raw_val, str) else ("" if raw_val is None else str(raw_val).strip())
        conf = parse_confidence(data, f"{json_key}_CONFIDENCE")
        out[conf_col] = f"{conf:.4f}"
        if conf < threshold:
            continue
        if json_key == "FOUNDED":
            founded = normalize_founded(val)
            if founded != "Unknown":
                out[col] = founded
        elif json_key == "PHONE":
            if val:
                out[col] = val
        elif json_key == "OPERATOR":
            if val:
                out[col] = val
        elif json_key == "DESCRIPTION":
            if val:
                out[col] = val

    for json_key, col in FEATURE_SPECS:
        conf_col = f"conf_{col}"
        if not is_empty(out.get(col)):
            continue
        raw = (data.get(json_key) or "") or ""
        if isinstance(raw, bool):
            raw = "YES" if raw else "NO"
        conf = parse_confidence(data, f"{json_key}_CONFIDENCE")
        out[conf_col] = f"{conf:.4f}"
        b = tri_to_bool(str(raw), conf, threshold)
        if b is None:
            continue
        out[col] = bool_to_csv(b)

    return out


def read_csv(path: Path) -> Tuple[List[str], List[Dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        fn = r.fieldnames
        if not fn:
            raise SystemExit("CSV has no header")
        rows = [dict(x) for x in r]
    return list(fn), rows


def write_csv(path: Path, fieldnames: List[str], rows: List[Dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def ensure_conf_columns(fieldnames: List[str]) -> List[str]:
    extra: List[str] = []
    for _, _, c in SOFT_FIELDS:
        if c not in fieldnames:
            extra.append(c)
    for _, col in FEATURE_SPECS:
        c = f"conf_{col}"
        if c not in fieldnames:
            extra.append(c)
    if "enc_website_text_skip" not in fieldnames:
        extra.append("enc_website_text_skip")
    return list(dict.fromkeys([*fieldnames, *extra]))


def load_excerpt(row: Dict[str, str], root: Path, max_chars: int) -> Tuple[str, str]:
    """Returns (excerpt, skip_reason). skip_reason empty if ok."""
    inline = (row.get("tier_a_excerpt") or "").strip()
    if inline:
        text = inline
        if len(text) > max_chars:
            text = text[:max_chars] + "\n\n[truncated for model context limit]"
        return text, ""

    rel = (row.get("tier_a_text_relpath") or "").strip()
    if not rel:
        return "", "no_tier_a_excerpt_or_relpath"
    path = root / rel.replace("/", os.sep)
    if not path.is_file():
        return "", f"missing_file:{rel}"
    text = path.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        return "", "empty_file"
    if len(text) > max_chars:
        text = text[:max_chars] + "\n\n[truncated for model context limit]"
    return text, ""


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Enrich data_list CSV from Tier A website text files via OpenAI.",
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=repo_root() / "data" / "data_list_tier_a_sample.csv",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=repo_root() / "data" / "data_list_website_enriched.csv",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=float(os.getenv("PUB_CONFIDENCE_THRESHOLD", "0.6")),
        help="Min confidence to accept a fill (default: 0.6 or env PUB_CONFIDENCE_THRESHOLD)",
    )
    parser.add_argument(
        "--model",
        default=os.getenv("OPENAI_WEBSITE_ENRICH_MODEL", "gpt-5.4-nano"),
        help="OpenAI model id (default: gpt-5.4-nano or OPENAI_WEBSITE_ENRICH_MODEL)",
    )
    parser.add_argument(
        "--max-chars",
        type=int,
        default=28000,
        help="Max excerpt characters sent to the model (default: 28000)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.25,
        help="Seconds between API calls (default: 0.25)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process at most N rows (for testing)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse CSV and print counts only; no API calls.",
    )
    args = parser.parse_args()

    load_dotenv(repo_root() / ".env")
    load_dotenv(repo_root() / "scripts" / ".env")
    key = os.getenv("OPENAI_API_KEY")
    if not key and not args.dry_run:
        print("Set OPENAI_API_KEY in .env", file=sys.stderr)
        sys.exit(1)

    inp = args.input
    if not inp.is_file():
        print(f"Input not found: {inp}", file=sys.stderr)
        sys.exit(1)

    fieldnames, rows = read_csv(inp)
    out_fields = ensure_conf_columns(fieldnames)
    root = repo_root()

    eligible = 0
    for row in rows:
        excerpt, reason = load_excerpt(row, root, args.max_chars)
        if excerpt and reason == "":
            eligible += 1

    print(f"Rows in CSV: {len(rows)}")
    print(f"Rows with loadable Tier A text: {eligible}")

    if args.dry_run:
        return

    client = OpenAI(api_key=key)
    out_rows: List[Dict[str, str]] = []
    api_ok = 0
    skipped = 0
    failed = 0
    api_calls = 0

    for i, row in enumerate(rows):
        out_row: Dict[str, str] = {k: row.get(k, "") for k in out_fields}
        out_row["enc_website_text_skip"] = out_row.get("enc_website_text_skip", "")

        excerpt, skip = load_excerpt(row, root, args.max_chars)
        if skip:
            out_row["enc_website_text_skip"] = skip
            out_rows.append(out_row)
            skipped += 1
            continue

        if args.limit is not None and args.limit > 0 and api_calls >= args.limit:
            out_row["enc_website_text_skip"] = "not_processed_api_limit"
            out_rows.append(out_row)
            continue

        name = row.get("name", "") or ""
        website = row.get("website", "") or ""
        api_calls += 1
        try:
            data = call_model(
                client,
                model=args.model,
                pub_name=name,
                website=website,
                excerpt=excerpt,
            )
        except Exception as e:
            print(f"[{i}] API error {name!r}: {e}", file=sys.stderr)
            out_row["enc_website_text_skip"] = f"api_error:{e.__class__.__name__}"
            out_rows.append(out_row)
            failed += 1
            if args.delay:
                time.sleep(args.delay)
            continue

        if not data:
            out_row["enc_website_text_skip"] = "bad_json"
            out_rows.append(out_row)
            failed += 1
        else:
            merged = apply_enrichment(out_row, data, args.threshold)
            merged["enc_website_text_skip"] = ""
            out_rows.append(merged)
            api_ok += 1

        if args.delay:
            time.sleep(args.delay)

    write_csv(args.output, out_fields, out_rows)
    print(f"Wrote {args.output}")
    print(f"API OK rows: {api_ok}, skipped (no tier_a_excerpt / no file): {skipped}, failed (API/JSON): {failed}")
    if args.limit is not None and args.limit > 0:
        print(f"API call budget (--limit): {args.limit}, calls used: {api_calls}")


if __name__ == "__main__":
    main()
