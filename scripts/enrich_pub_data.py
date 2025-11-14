"""
Pub Data Enrichment Script

This script uses OpenAI GPT models to enrich pub data from Supabase:
- Finds founding date
- Generates 100-200 word history/interesting features summary
- Determines pub ownership
- Detects pub features (garden, live music, food, dog friendly, pool/darts, parking, accommodation, real ale)
- Updates Supabase with the enriched data

Setup:
1. Install dependencies: pip install supabase openai python-dotenv
2. Create .env file in scripts/ directory or project root with:
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your_service_role_key (for writes)
   OPENAI_API_KEY=your_openai_api_key

Usage:
- python enrich_pub_data.py                  # Enrich pubs with missing data (default)
- python enrich_pub_data.py --all            # Re-enrich all pubs
- python enrich_pub_data.py --features-only  # Only detect and update features (all pubs)

⚠️  SECURITY: Never commit API keys to git! The .env file is in .gitignore.
"""

import argparse
import json
import os
import re
import sys
import time
from typing import Optional, Sequence

from dotenv import load_dotenv
from openai import OpenAI
from supabase import Client, create_client

# Load environment variables from .env file
load_dotenv()

# ============================================================================
# API CONFIGURATION - Load from environment variables only
# ============================================================================
# ⚠️  SECURITY: Never hardcode API keys in this file!
#     Create a .env file in the scripts/ directory or project root with:
#     SUPABASE_URL=https://your-project.supabase.co
#     SUPABASE_KEY=your_service_role_key
#     OPENAI_API_KEY=your_openai_api_key

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# Validate that all required environment variables are set
missing_keys = []
if not SUPABASE_URL:
    missing_keys.append('SUPABASE_URL')
if not SUPABASE_KEY:
    missing_keys.append('SUPABASE_KEY')
if not OPENAI_API_KEY:
    missing_keys.append('OPENAI_API_KEY')

if missing_keys:
    print("❌ Error: Missing required environment variables!")
    print(f"   Missing: {', '.join(missing_keys)}")
    print("\n   Please create a .env file in the scripts/ directory or project root with:")
    print("   SUPABASE_URL=https://your-project.supabase.co")
    print("   SUPABASE_KEY=your_service_role_key")
    print("   OPENAI_API_KEY=your_openai_api_key")
    print("\n   Note: The .env file is already in .gitignore and will not be committed.")
    sys.exit(1)

# Initialize clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
openai_client = OpenAI(api_key=OPENAI_API_KEY)


def extract_message_text(message) -> str:
    """Return the textual content from a chat completion message."""
    content = getattr(message, "content", None)
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        pieces = []
        for part in content:
            if isinstance(part, dict):
                text = part.get("text")
                if text:
                    pieces.append(str(text))
            elif isinstance(part, str):
                pieces.append(part)
        return "\n".join(pieces).strip()
    if content is None:
        return ""
    return str(content).strip()


def extract_year_from_text(text: str) -> Optional[str]:
    if not text:
        return None
    current_year = time.localtime().tm_year
    for match in re.finditer(r"(1[6-9]\d{2}|20\d{2})", text):
        year = int(match.group(0))
        if 1500 <= year <= current_year:
            return str(year)
    return None


def parse_arguments(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Enrich pub data and update Supabase records.")
    parser.add_argument('--features-only', action='store_true', help='Only detect and update feature flags.')
    parser.add_argument('--all', action='store_true', help='Re-enrich all pubs regardless of existing data.')
    parser.add_argument('--delay', type=float, default=0.2, help='Delay (in seconds) between AI requests when enriching.')
    parser.add_argument('--limit', type=int, default=None, help='Optional maximum number of pubs to process.')
    return parser.parse_args(argv)


def get_pub_features(pub_name: str, area: str, description: str = "", history: str = "") -> dict:
    """
    Use GPT to detect which features a pub has.
    The model must respond strictly in JSON.
    """
    context = f"Pub name: {pub_name}\nArea: {area}\nDescription: {description}\nHistory: {history}"
    prompt = f"""
You are a factual data extractor for a pub database. Use the text below only.
If a feature is not clearly mentioned, mark it as false. Never infer or guess.

Return valid JSON with keys:
{{
  "PUB_GARDEN": true/false,
  "LIVE_MUSIC": true/false,
  "FOOD_AVAILABLE": true/false,
  "DOG_FRIENDLY": true/false,
  "POOL_DARTS": true/false,
  "PARKING": true/false,
  "ACCOMMODATION": true/false,
  "CASK_REAL_ALE": true/false
}}

Text:
{context}
"""

    try:
        response = openai_client.chat.completions.create(
            model="gpt-5-mini",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=1,
        )
        raw_text = extract_message_text(response.choices[0].message)
        try:
            result = json.loads(raw_text)
        except json.JSONDecodeError as decode_error:
            print(f"❌ AI JSON parse error detecting features: {decode_error}")
            result = {}
        return {
            'has_pub_garden': result.get("PUB_GARDEN", False),
            'has_live_music': result.get("LIVE_MUSIC", False),
            'has_food_available': result.get("FOOD_AVAILABLE", False),
            'has_dog_friendly': result.get("DOG_FRIENDLY", False),
            'has_pool_darts': result.get("POOL_DARTS", False),
            'has_parking': result.get("PARKING", False),
            'has_accommodation': result.get("ACCOMMODATION", False),
            'has_cask_real_ale': result.get("CASK_REAL_ALE", False),
        }
    except Exception as e:
        print(f"❌ AI Error detecting features: {e}")
        return {k: False for k in [
            'has_pub_garden','has_live_music','has_food_available','has_dog_friendly',
            'has_pool_darts','has_parking','has_accommodation','has_cask_real_ale'
        ]}

def get_pub_enrichment(pub_name: str, area: str, address: str = "", description: str = "") -> tuple:
    """
    Get factual enrichment (founded year, narrative history, ownership, sources).
    The model must return strict JSON and never invent data.
    """
    context_parts = [
        f"Pub name: {pub_name}",
        f"Area: {area}",
        f"Address: {address}",
    ]
    if description:
        context_parts.append(f"Existing description: {description}")
    context = "\n".join(part for part in context_parts if part.strip())
    prompt = f"""
You are a fact verifier. Use only publicly verifiable information.
If data cannot be confirmed, set the value to "Unknown".

Return valid JSON:
{{
  "FOUNDED": "year or 'Unknown'",
  "HISTORY": "120-200 word factual narrative weaving verifiable history, notable features, atmosphere, and accurate details from any provided existing description. Do not mention street addresses, directions, or other location details. Use 'Unknown' only when nothing reliable is available.",
  "OWNERSHIP": "Company name or 'Independent' if unknown.",
  "SOURCES": ["Short evidence snippets or URLs supporting the data. Use titles only (no addresses or directions) and keep each entry under 80 characters."]
}}

Use authoritative UK pub resources whenever possible, especially CAMRA (https://camra.org.uk). If no reliable information is found, return 'Unknown'.
Never mention that you used the supplied description or context while writing the history.

Text:
{context}
"""

    try:
        response = openai_client.chat.completions.create(
            model="gpt-5-mini",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=1,
        )
        raw_text = extract_message_text(response.choices[0].message)
        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError as decode_error:
            print(f"❌ AI JSON parse error during enrichment: {decode_error}")
            data = {}

        founded = data.get("FOUNDED")
        if founded and re.match(r"^\d{4}$", founded):
            year = int(founded)
            if year < 500 or year > 2025:
                founded = "Unknown"
        else:
            founded = "Unknown" if not founded else founded

        history = data.get("HISTORY", "").strip()
        if len(history) > 800:
            history = history[:800].rsplit('.', 1)[0] + "."

        if (not founded or founded.lower() == "unknown") and history:
            inferred_year = extract_year_from_text(history)
            if inferred_year:
                founded = inferred_year

        ownership = data.get("OWNERSHIP") or "Independent"
        if ownership.strip().lower() in {"unknown", "not known", "n/a", "none", ""}:
            ownership = "Independent"
        raw_sources = data.get("SOURCES", [])
        sources = []
        if isinstance(raw_sources, list):
            sources = [str(item).strip() for item in raw_sources if str(item).strip()]

        return founded, history, ownership, sources

    except Exception as e:
        print(f"❌ AI Error: {e}")
        return None, None, "Independent", []

def enrich_pub_features_only(pub_id: str, pub_name: str, area: str, description: str = "", history: str = "") -> bool:
    """
    Enrich only the features for a pub (skip history/founded/ownership).
    Returns True if successful.
    """
    print(f"🔍 Detecting features for: {pub_name} ({area})")
    
    features = get_pub_features(pub_name, area, description, history)
    
    # Show which features were detected
    detected = [k.replace('has_', '').replace('_', ' ').title() for k, v in features.items() if v]
    if detected:
        print(f"   ✨ Features found: {', '.join(detected)}")
    else:
        print(f"   ℹ️  No features detected")
    
    # Update Supabase with just features
    try:
        response = supabase.table('pubs').update(features).eq('id', pub_id).execute()
        
        if response.data:
            print(f"   ✅ Updated in Supabase")
            return True
        else:
            print(f"   ❌ Update failed")
            return False
            
    except Exception as e:
        print(f"   ❌ Supabase Error: {e}")
        return False

def enrich_pub(pub_id: str, pub_name: str, area: str, address: str = "", description: str = "", detect_features: bool = True) -> bool:
    """
    Enrich a single pub with founding date, history, ownership, and features.
    Returns True if successful.
    """
    print(f"🔍 Enriching: {pub_name} ({area})")
    
    founded, history, ownership, sources = get_pub_enrichment(pub_name, area, address, description)
    
    if not founded and not history and not ownership:
        print(f"   ⚠️  Failed to get enrichment data")
        return False
    
    # Prepare update data
    update_data = {}
    if founded:
        update_data['founded'] = founded
        print(f"   📅 Founded: {founded}")
    if history:
        update_data['history'] = history
        print(f"   📖 History: {history[:80]}...")
    if ownership:
        update_data['ownership'] = ownership
        print(f"   🏢 Ownership: {ownership}")

    if sources:
        print(f"   📚 Evidence: {', '.join(sources[:3])}{'…' if len(sources) > 3 else ''}")
    
    # Detect features using AI
    if detect_features:
        print(f"   🔍 Detecting features...")
        features = get_pub_features(pub_name, area, description, history)
        
        # Add features to update data
        update_data.update(features)
        
        # Show which features were detected
        detected = [k.replace('has_', '').replace('_', ' ').title() for k, v in features.items() if v]
        if detected:
            print(f"   ✨ Features found: {', '.join(detected)}")
        else:
            print(f"   ℹ️  No features detected")
    
    # Update Supabase
    try:
        response = supabase.table('pubs').update(update_data).eq('id', pub_id).execute()
        
        if response.data:
            print(f"   ✅ Updated in Supabase")
            return True
        else:
            print(f"   ❌ Update failed")
            return False
            
    except Exception as e:
        print(f"   ❌ Supabase Error: {e}")
        return False

def get_pubs_to_enrich(only_missing: bool = True):
    """
    Get pubs from Supabase that need enrichment.
    If only_missing=True, only get pubs where founded, history, or ownership is NULL or empty.
    """
    query = supabase.table('pubs').select('id,name,area,address,description,founded,history,ownership')
    
    if only_missing:
        # Get pubs where founded, history, OR ownership is NULL or empty
        # Supabase doesn't support OR directly, so we'll filter in Python
        all_pubs = query.execute().data
        return [
            p for p in all_pubs 
            if (not p.get('founded') or p.get('founded') == '') 
            or (not p.get('history') or p.get('history') == '') 
            or (not p.get('ownership') or p.get('ownership') == '' or p.get('ownership') is None)
        ]
    else:
        return query.execute().data

def main():
    print("🍺 Pub Data Enrichment Script\n")
    args = parse_arguments(sys.argv[1:])

    features_only = args.features_only
    enrich_all = args.all
    only_missing = not features_only and not enrich_all
    delay_between_requests = max(0.0, args.delay)

    if features_only:
        print("📋 Fetching all pubs for feature detection...")
        pubs = supabase.table('pubs').select('id,name,area,address,description,history').execute().data
    elif only_missing:
        print("📋 Fetching pubs with missing data (founded, history, or ownership)...")
        pubs = get_pubs_to_enrich(only_missing=only_missing)
    else:
        print("📋 Fetching all pubs...")
        pubs = get_pubs_to_enrich(only_missing=only_missing)

    if not pubs:
        print("✅ No pubs need enrichment!")
        return

    if args.limit is not None:
        pubs = pubs[:args.limit]

    total = len(pubs)
    print(f"✅ Found {total} pubs to enrich\n")

    enriched = 0
    failed = 0

    for i, pub in enumerate(pubs, 1):
        print(f"\n[{i}/{total}]")

        if features_only:
            success = enrich_pub_features_only(
                pub['id'],
                pub['name'],
                pub.get('area', ''),
                pub.get('description', ''),
                pub.get('history', '')
            )
        else:
            success = enrich_pub(
                pub['id'],
                pub['name'],
                pub.get('area', ''),
                pub.get('address', ''),
                pub.get('description', ''),
                detect_features=True
            )

        if success:
            enriched += 1
        else:
            failed += 1

        if i < total and delay_between_requests > 0:
            time.sleep(delay_between_requests)

    summary_label = "Features updated" if features_only else "Enriched"
    print(f"\n📊 Summary:")
    print(f"   ✅ {summary_label}: {enriched}")
    print(f"   ❌ Failed: {failed}")
    print(f"   📝 Total: {total}")

if __name__ == "__main__":
    main()

