"""
Pub Data Enrichment Script

This script uses Google Gemini AI to enrich pub data from Supabase:
- Finds founding date
- Generates 100-200 word history/interesting features summary
- Determines pub ownership
- Detects pub features (garden, live music, food, dog friendly, pool/darts, parking, accommodation, real ale)
- Updates Supabase with the enriched data

Setup:
1. Install dependencies: pip install supabase google-generativeai python-dotenv
2. Get Google API key: https://aistudio.google.com/app/apikey (FREE!)
   (Same key works for both Gemini AI and Custom Search)
3. Create .env file in scripts/ directory or project root with:
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your_service_role_key (for writes)
   GOOGLE_API_KEY=your_google_api_key

Usage:
- python enrich_pub_data.py                  # Enrich pubs with missing data (default)
- python enrich_pub_data.py --all            # Re-enrich all pubs
- python enrich_pub_data.py --features-only  # Only detect and update features (all pubs)

⚠️  SECURITY: Never commit API keys to git! The .env file is in .gitignore.
"""

import os
import sys
from dotenv import load_dotenv
from supabase import create_client, Client
from google import genai
import time

# Load environment variables from .env file
load_dotenv()

# ============================================================================
# API CONFIGURATION - Load from environment variables only
# ============================================================================
# ⚠️  SECURITY: Never hardcode API keys in this file!
#     Create a .env file in the scripts/ directory or project root with:
#     SUPABASE_URL=https://your-project.supabase.co
#     SUPABASE_KEY=your_service_role_key
#     GOOGLE_API_KEY=your_google_api_key (same key used for Gemini AI and Custom Search)

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY')

# Validate that all required environment variables are set
missing_keys = []
if not SUPABASE_URL:
    missing_keys.append('SUPABASE_URL')
if not SUPABASE_KEY:
    missing_keys.append('SUPABASE_KEY')
if not GOOGLE_API_KEY:
    missing_keys.append('GOOGLE_API_KEY')

if missing_keys:
    print("❌ Error: Missing required environment variables!")
    print(f"   Missing: {', '.join(missing_keys)}")
    print("\n   Please create a .env file in the scripts/ directory or project root with:")
    print("   SUPABASE_URL=https://your-project.supabase.co")
    print("   SUPABASE_KEY=your_service_role_key")
    print("   GOOGLE_API_KEY=your_google_api_key")
    print("   Get Google API key: https://aistudio.google.com/app/apikey")
    print("\n   Note: The .env file is already in .gitignore and will not be committed.")
    sys.exit(1)

# Initialize clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
gemini_client = genai.Client(api_key=GOOGLE_API_KEY)

def get_pub_features(pub_name: str, area: str, description: str = "", history: str = "") -> dict:
    """
    Use AI to detect which features a pub has based on its description.
    Returns: dict with boolean values for each feature
    """
    context = f"Pub name: {pub_name}\nArea: {area}"
    if description:
        context += f"\nDescription: {description}"
    if history:
        context += f"\nHistory: {history}"
    
    prompt = f"""Analyze this London pub and determine which of these features it has. Only answer YES if you are confident based on the description. If unsure or no information, answer NO.

Pub information:
{context}

For each feature below, answer ONLY with YES or NO:

PUB_GARDEN: Does it have a pub garden, beer garden, outdoor seating area, or patio?
LIVE_MUSIC: Does it have live music, bands, performances, or entertainment?
FOOD_AVAILABLE: Does it serve food, meals, or have a restaurant/kitchen?
DOG_FRIENDLY: Is it dog-friendly or allows dogs?
POOL_DARTS: Does it have pool tables, darts, or pub games?
PARKING: Does it mention parking availability?
ACCOMMODATION: Does it offer rooms, hotel, or accommodation?
CASK_REAL_ALE: Does it serve cask ale, real ale, or traditional hand-pulled beer?

Format your response EXACTLY as:
PUB_GARDEN: [YES/NO]
LIVE_MUSIC: [YES/NO]
FOOD_AVAILABLE: [YES/NO]
DOG_FRIENDLY: [YES/NO]
POOL_DARTS: [YES/NO]
PARKING: [YES/NO]
ACCOMMODATION: [YES/NO]
CASK_REAL_ALE: [YES/NO]

Remember: Only say YES if there is clear evidence. If uncertain, say NO."""

    try:
        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        
        content = response.text
        
        # Parse response
        features = {
            'has_pub_garden': False,
            'has_live_music': False,
            'has_food_available': False,
            'has_dog_friendly': False,
            'has_pool_darts': False,
            'has_parking': False,
            'has_accommodation': False,
            'has_cask_real_ale': False,
        }
        
        lines = content.split('\n')
        for line in lines:
            line = line.strip()
            if 'PUB_GARDEN:' in line:
                features['has_pub_garden'] = 'YES' in line.upper()
            elif 'LIVE_MUSIC:' in line:
                features['has_live_music'] = 'YES' in line.upper()
            elif 'FOOD_AVAILABLE:' in line:
                features['has_food_available'] = 'YES' in line.upper()
            elif 'DOG_FRIENDLY:' in line:
                features['has_dog_friendly'] = 'YES' in line.upper()
            elif 'POOL_DARTS:' in line or 'POOL/DARTS:' in line:
                features['has_pool_darts'] = 'YES' in line.upper()
            elif 'PARKING:' in line:
                features['has_parking'] = 'YES' in line.upper()
            elif 'ACCOMMODATION:' in line:
                features['has_accommodation'] = 'YES' in line.upper()
            elif 'CASK_REAL_ALE:' in line or 'REAL_ALE:' in line:
                features['has_cask_real_ale'] = 'YES' in line.upper()
        
        return features
        
    except Exception as e:
        print(f"   ❌ AI Error detecting features: {e}")
        # Return all False on error
        return {
            'has_pub_garden': False,
            'has_live_music': False,
            'has_food_available': False,
            'has_dog_friendly': False,
            'has_pool_darts': False,
            'has_parking': False,
            'has_accommodation': False,
            'has_cask_real_ale': False,
        }

def get_pub_enrichment(pub_name: str, area: str, address: str = "") -> tuple:
    """
    Use AI to find founding date, generate history, and determine ownership.
    Returns: (founded_year, history_text, ownership)
    """
    # Build context for the AI
    context = f"Pub name: {pub_name}\nArea: {area}"
    if address:
        context += f"\nAddress: {address}"
    
    prompt = f"""You are a pub historian filling out a database. Do not add any fluff, just the data. If you are unsure say Not Known. For the following pub in London, provide:
1. The founding year (or approximate founding year if exact date unknown). Format as 4-digit year (e.g., "1860" or "circa 1820" if approximate).
2. A 100 to 200 word summary of the pub's history, interesting features, architectural details, notable events, or local significance. As few words as possible.
3. The ownership/operator of the pub. Be as accurate as possible. Common ownership chains include: Greene King, Stonegate, Wetherspoon, Mitchells & Butlers, Fuller's, Young's, Shepherd Neame, or smaller chains. If it's independently owned, say "Independent". If you cannot determine the ownership, say "Independent". Do not say Stonegate Company, for example (apply to all companies), just say Stonegate unless the company in question lists company explicitly in their name..

Pub information:
{context}

Please format your response as:
FOUNDED: [year]
HISTORY: [100-200 word summary]
OWNERSHIP: [ownership name]

Be accurate and factual. If you cannot find specific information, use reasonable estimates based on the area's history."""

    try:
        # Use Google Gemini API (free tier available) - simple format like example
        full_prompt = f"You are a helpful pub historian specializing in London pubs.\n\n{prompt}"
        
        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=full_prompt,
        )
        
        # Get text directly (as shown in example)
        content = response.text
        
        # Parse response
        founded = None
        history = None
        ownership = None
        lines = content.split('\n')
        for line in lines:
            if line.startswith('FOUNDED:'):
                founded = line.replace('FOUNDED:', '').strip()
                # Extract just the year if there's extra text
                import re
                year_match = re.search(r'\d{4}', founded)
                if year_match:
                    founded = year_match.group(0)
            elif line.startswith('HISTORY:'):
                history = line.replace('HISTORY:', '').strip()
            elif line.startswith('OWNERSHIP:'):
                ownership = line.replace('OWNERSHIP:', '').strip()
            elif history is None and ':' not in line and line.strip():
                # If we haven't found history yet, this might be it
                if not founded:
                    history = line.strip()
        
        # If history wasn't found separately, try to extract from content
        if not history:
            # Look for text after "HISTORY:" or after the founded line
            history_start = content.find('HISTORY:')
            if history_start != -1:
                history = content[history_start + 8:].strip()
                # Remove ownership if it appears after history
                ownership_start = history.find('OWNERSHIP:')
                if ownership_start != -1:
                    history = history[:ownership_start].strip()
            else:
                # Fallback: take everything after the first line
                history = '\n'.join(lines[1:]).strip()
        
        # If ownership wasn't found, try to extract from content
        if not ownership:
            ownership_start = content.find('OWNERSHIP:')
            if ownership_start != -1:
                ownership = content[ownership_start + 10:].strip()
                # Take only the first line (in case there's more text)
                ownership = ownership.split('\n')[0].strip()
        
        # Default to "Independent" if ownership is not found or is "Not Known"
        if not ownership or ownership.lower() in ['not known', 'unknown', 'n/a']:
            ownership = 'Independent'
        
        return founded, history, ownership
        
    except Exception as e:
        print(f"   ❌ AI Error: {e}")
        return None, None, None

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
    
    founded, history, ownership = get_pub_enrichment(pub_name, area, address)
    
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
    
    # Check command line arguments
    only_missing = '--all' not in sys.argv
    features_only = '--features-only' in sys.argv
    
    if features_only:
        print("📋 Fetching all pubs for feature detection...")
        # Get all pubs for feature detection
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
    
    print(f"✅ Found {len(pubs)} pubs to enrich\n")
    
    enriched = 0
    failed = 0
    
    for i, pub in enumerate(pubs, 1):
        print(f"\n[{i}/{len(pubs)}]")
        
        if features_only:
            # Only detect and update features
            success = enrich_pub_features_only(
                pub['id'],
                pub['name'],
                pub.get('area', ''),
                pub.get('description', ''),
                pub.get('history', '')
            )
        else:
            # Full enrichment (history, founded, ownership, and features)
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
        
        # Rate limiting - wait between requests
        if i < len(pubs):
            time.sleep(0.5)  # Wait 0.5 seconds between pubs (increased for feature detection)
    
    print(f"\n📊 Summary:")
    print(f"   ✅ Enriched: {enriched}")
    print(f"   ❌ Failed: {failed}")
    print(f"   📝 Total: {len(pubs)}")

if __name__ == "__main__":
    main()

