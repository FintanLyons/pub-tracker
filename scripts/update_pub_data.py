"""
Pub Data Enrichment Script for pubs_all

This script queries OpenAI once per pub to obtain:
- Founded year (YYYY or Unknown)
- Short factual description (≤60 words)
- Feature flags (YES/NO/Unknown)

Results are written back to the Supabase table `pubs_all`.
"""

import json
import os
import sys
import time
from typing import Dict, Optional

from dotenv import load_dotenv
from openai import OpenAI
from supabase import Client, create_client


# --- Environment setup ---
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
TABLE_NAME = "pubs_all"
PAGE_SIZE = 750

if not OPENAI_API_KEY or not SUPABASE_URL or not SUPABASE_KEY:
    missing = [
        name
        for name, value in (
            ("OPENAI_API_KEY", OPENAI_API_KEY),
            ("SUPABASE_URL", SUPABASE_URL),
            ("SUPABASE_KEY", SUPABASE_KEY),
        )
        if not value
    ]
    print(f"❌ Missing required environment variables: {', '.join(missing)}")
    sys.exit(1)

openai_client = OpenAI(api_key=OPENAI_API_KEY)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

CONFIDENCE_THRESHOLD = float(os.getenv("PUB_CONFIDENCE_THRESHOLD", "0.6"))


# --- Prompt templates ---
SYSTEM_PROMPT = """
You are a structured information extractor for British pubs.
You have accurate knowledge of UK pubs up to mid-2024, including
WhatPub, CAMRA, Tripadvisor, and other major public sources.

You may also use the supplied description as background context.
Provide the best supported value you can find for each field and rate
your confidence between 0 and 1 (0 = none, 1 = complete certainty).

Output MUST be valid JSON exactly in this format:
{
  "FOUNDED": "YYYY or Unknown",
  "FOUNDED_CONFIDENCE": 0-1,
  "HISTORY": "120-200 word factual narrative focusing on verifiable history, notable features, atmosphere, and accurate details from reliable sources. Do not mention street addresses, directions or other precise location details.",
  "HISTORY_CONFIDENCE": 0-1,
  "OWNERSHIP": "Ownership name or 'Independent'",
  "OWNERSHIP_CONFIDENCE": 0-1,
  "PUB_GARDEN": "YES",
  "PUB_GARDEN_CONFIDENCE": 0-1,
  "LIVE_MUSIC": "YES",
  "LIVE_MUSIC_CONFIDENCE": 0-1,
  "FOOD_AVAILABLE": "YES",
  "FOOD_AVAILABLE_CONFIDENCE": 0-1,
  "DOG_FRIENDLY": "YES",
  "DOG_FRIENDLY_CONFIDENCE": 0-1,
  "POOL_DARTS": "YES",
  "POOL_DARTS_CONFIDENCE": 0-1,
  "PARKING": "YES",
  "PARKING_CONFIDENCE": 0-1,
  "ACCOMMODATION": "YES",
  "ACCOMMODATION_CONFIDENCE": 0-1,
  "CASK_REAL_ALE": "YES",
  "CASK_REAL_ALE_CONFIDENCE": 0-1,
  "SOURCES": ["Evidence title or URL (≤50 chars)"]
}
"""

USER_PROMPT_TEMPLATE = """
Provide verified details about the following pub using your internal knowledge only
(including WhatPub, CAMRA and other reputable UK sources). Never invent facts.
Rate your confidence for each field between 0 and 1. Fields will be accepted only when
their confidence meets the threshold; otherwise they will be treated as "Unknown" downstream.

Pub name: {name}
Address: {address}
Area: {area}
Existing description: {description}

Answer concisely and factually in JSON.
"""


def fetch_pubs(columns: str) -> list:
    """Retrieve all rows from the Supabase table using pagination."""
    rows = []
    start = 0
    while True:
        response = (
            supabase
            .table(TABLE_NAME)
            .select(columns)
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        chunk = response.data if response else []
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < PAGE_SIZE:
            break
        start += PAGE_SIZE
        time.sleep(0.1)
    return rows


def normalize_founded(value: str) -> str:
    if not value:
        return "Unknown"
    text = value.strip()
    if text.lower() == "unknown":
        return "Unknown"
    if len(text) == 4 and text.isdigit() and 1500 <= int(text) <= time.localtime().tm_year:
        return text
    return "Unknown"


def normalize_history(value: str) -> str:
    if not value:
        return ""
    text = value.strip()
    if text.lower() == "unknown":
        return ""
    return text


def normalize_ownership(value: str) -> str:
    if not value:
        return "Independent"
    text = value.strip()
    if text.lower() in {"unknown", "not known", "n/a", "none", ""}:
        return "Independent"
    return text


def normalize_feature(value: str) -> bool:
    if not isinstance(value, str):
        return False
    text = value.strip().upper()
    if text == "YES":
        return True
    if text == "NO":
        return False
    return False


def parse_confidence(result: Dict, key: str) -> float:
    try:
        value = float(result.get(key, 0))
        if value < 0:
            return 0.0
        if value > 1:
            return 1.0
        return value
    except (TypeError, ValueError):
        return 0.0


def truncate_sources(sources):
    clean = []
    for item in sources or []:
        if not item:
            continue
        text = str(item).strip()
        if not text:
            continue
        if len(text) > 50:
            text = text[:47] + "..."
        clean.append(text)
    return clean


def enrich_pub(pub: Dict) -> Optional[Dict[str, str]]:
    """Call OpenAI and return the parsed JSON response for a single pub."""
    user_prompt = USER_PROMPT_TEMPLATE.format(
        name=pub.get("name", ""),
        address=pub.get("address", ""),
        area=pub.get("area", ""),
        description=pub.get("description", ""),
    )

    completion = openai_client.chat.completions.create(
        model="gpt-5-mini",
        temperature=1,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT.strip()},
            {"role": "user", "content": user_prompt.strip()},
        ],
    )

    try:
        data = json.loads(completion.choices[0].message.content)
        return data
    except (KeyError, json.JSONDecodeError) as exc:
        print(f"   ❌ Failed to parse model output for {pub.get('name')}: {exc}")
        return None


def update_pub(pub_id: str, payload: Dict[str, str]) -> bool:
    """Write the enrichment payload back to Supabase."""
    try:
        response = supabase.table(TABLE_NAME).update(payload).eq("id", pub_id).execute()
        return bool(response.data)
    except Exception as exc:  # pragma: no cover - just logging
        print(f"   ❌ Supabase error updating {pub_id}: {exc}")
        return False


def enrich_all_pubs(limit: Optional[int] = None, delay: float = 0.2, enrich_all: bool = False):
    pubs = fetch_pubs("id,name,address,area,description,founded,history,has_pub_garden,has_live_music,has_food_available,has_dog_friendly,has_pool_darts,has_parking,has_accommodation,has_cask_real_ale")
    if not enrich_all:
        pubs = [
            pub for pub in pubs
            if (not pub.get('founded') or pub.get('founded') == '' or pub.get('founded') == 'Unknown')
            or (not pub.get('history') or pub.get('history') == '')
        ]
    if limit is not None:
        pubs = pubs[:limit]

    print(f"✅ Found {len(pubs)} pubs to enrich\n")

    enriched = 0
    failed = 0

    for idx, pub in enumerate(pubs, start=1):
        print(f"[{idx}/{len(pubs)}] {pub.get('name', 'Unknown pub')} ({pub.get('area', 'Unknown area')})")

        result = enrich_pub(pub)
        if result is None:
            failed += 1
            continue

        founded = normalize_founded(result.get("FOUNDED"))
        founded_conf = parse_confidence(result, "FOUNDED_CONFIDENCE")
        if founded_conf < CONFIDENCE_THRESHOLD:
            founded = "Unknown"

        history = normalize_history(result.get("HISTORY"))
        history_conf = parse_confidence(result, "HISTORY_CONFIDENCE")
        if history_conf < CONFIDENCE_THRESHOLD:
            history = ""

        ownership = normalize_ownership(result.get("OWNERSHIP"))
        ownership_conf = parse_confidence(result, "OWNERSHIP_CONFIDENCE")
        if ownership_conf < CONFIDENCE_THRESHOLD:
            ownership = "Independent"

        payload = {
            "founded": founded,
            "history": history,
            "ownership": ownership,
        }

        print(f"   📅 Founded: {payload['founded']} (confidence {founded_conf:.2f})")
        history_preview = payload['history'][:140] + ("…" if len(payload['history']) > 140 else "")
        print(f"   📖 History (confidence {history_conf:.2f}): {history_preview or '[empty]'}")
        print(f"   🏢 Ownership: {payload['ownership']} (confidence {ownership_conf:.2f})")

        # Map feature flags
        feature_mapping = {
            "PUB_GARDEN": "has_pub_garden",
            "LIVE_MUSIC": "has_live_music",
            "FOOD_AVAILABLE": "has_food_available",
            "DOG_FRIENDLY": "has_dog_friendly",
            "POOL_DARTS": "has_pool_darts",
            "PARKING": "has_parking",
            "ACCOMMODATION": "has_accommodation",
            "CASK_REAL_ALE": "has_cask_real_ale",
        }
        for json_key, column in feature_mapping.items():
            conf = parse_confidence(result, f"{json_key}_CONFIDENCE")
            raw_value = (result.get(json_key, "") or "").strip().upper()

            if raw_value == "YES" and conf >= CONFIDENCE_THRESHOLD:
                payload[column] = True
                print(f"   ⚙️ {column}: YES (confidence {conf:.2f}, accepted)")
            else:
                payload[column] = False
                print(
                    f"   ⚙️ {column}: NO (model='{raw_value or 'NO'}', confidence {conf:.2f})"
                )

        sources = truncate_sources(result.get("SOURCES", []))
        if sources:
            print(f"   📚 Sources: {', '.join(sources[:3])}{'…' if len(sources) > 3 else ''}")

        if update_pub(pub["id"], payload):
            enriched += 1
            print("   ✅ Update written")
        else:
            failed += 1

        if delay > 0 and idx < len(pubs):
            time.sleep(delay)

    print("\n📊 Summary:")
    print(f"   ✅ Enriched: {enriched}")
    print(f"   ❌ Failed: {failed}")
    print(f"   📝 Total processed: {len(pubs)}")


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Enrich pub data for pubs_all table")
    parser.add_argument("--limit", type=int, default=None, help="Optional limit on number of pubs to enrich")
    parser.add_argument("--delay", type=float, default=0.2, help="Delay between API calls")
    parser.add_argument("--all", action="store_true", help="Re-enrich all pubs regardless of existing data")
    args = parser.parse_args()

    enrich_all_pubs(limit=args.limit, delay=args.delay, enrich_all=args.all)


if __name__ == "__main__":
    main()

