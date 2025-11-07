"""
Pub Data Enrichment Script

This script uses Google Gemini AI to enrich pub data from Supabase:
- Finds founding date
- Generates 100-200 word history/interesting features summary
- Updates Supabase with the enriched data

Setup:
1. Install dependencies: pip install supabase google-generativeai python-dotenv
2. Get Google Gemini API key: https://aistudio.google.com/app/apikey (FREE!)
3. Set API keys (choose one):
   Option A: Edit this file and replace YOUR_GEMINI_API_KEY_HERE with your key
   Option B: Create .env file with:
     SUPABASE_URL=https://your-project.supabase.co
     SUPABASE_KEY=your_service_role_key (for writes)
     GEMINI_API_KEY=your_gemini_api_key
"""

import os
import sys
from dotenv import load_dotenv
from supabase import create_client, Client
from google import genai
import time

# Load environment variables (optional - you can also hardcode below)
load_dotenv()

# ============================================================================
# API CONFIGURATION - Set your keys here or in .env file
# ============================================================================
SUPABASE_URL = os.getenv('SUPABASE_URL') or 'https://ddfdwxrnouneqqzactus.supabase.co'
SUPABASE_KEY = os.getenv('SUPABASE_KEY') or 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkZmR3eHJub3VuZXFxemFjdHVzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjE4MDY4NSwiZXhwIjoyMDc3NzU2Njg1fQ.1gsFB_2bPoOUUMsOsH-XM74OjauXahlEBfBe8rQDgAY'  # Use service_role key for writes
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY') or 'AIzaSyC1apy-CNQb4LlHUFLqXOhl1ufpif0Ymt8'

# ⚠️  SECURITY NOTE: If hardcoding keys above, make sure this file is in .gitignore
#     Never commit API keys to version control!

if SUPABASE_KEY == 'YOUR_SERVICE_ROLE_KEY_HERE' or GEMINI_API_KEY == 'YOUR_GEMINI_API_KEY_HERE':
    print("❌ Error: Please set your API keys!")
    print("   Option 1: Edit this file and replace YOUR_*_KEY_HERE above")
    print("   Option 2: Create .env file with:")
    print("   SUPABASE_URL=https://your-project.supabase.co")
    print("   SUPABASE_KEY=your_service_role_key")
    print("   GEMINI_API_KEY=your_gemini_api_key")
    print("   Get Gemini API key: https://aistudio.google.com/app/apikey")
    sys.exit(1)

# Initialize clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
gemini_client = genai.Client(api_key=GEMINI_API_KEY)

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

def enrich_pub(pub_id: str, pub_name: str, area: str, address: str = "") -> bool:
    """
    Enrich a single pub with founding date, history, and ownership.
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
    query = supabase.table('pubs').select('id,name,area,address,founded,history,ownership')
    
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
    
    # Check if we should only enrich missing data
    only_missing = '--all' not in sys.argv
    
    if only_missing:
        print("📋 Fetching pubs with missing data (founded, history, or ownership)...")
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
        
        success = enrich_pub(
            pub['id'],
            pub['name'],
            pub.get('area', ''),
            pub.get('address', '')
        )
        
        if success:
            enriched += 1
        else:
            failed += 1
        
        # Rate limiting - wait between requests
        if i < len(pubs):
            time.sleep(0.2)  # Wait 0.2 seconds between pubs
    
    print(f"\n📊 Summary:")
    print(f"   ✅ Enriched: {enriched}")
    print(f"   ❌ Failed: {failed}")
    print(f"   📝 Total: {len(pubs)}")

if __name__ == "__main__":
    main()

