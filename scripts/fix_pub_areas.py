"""
Fix pub area and borough from postcodes

This script queries the postcodes.io API to get area (admin_ward) and borough (admin_district)
information from UK postcodes found in pub addresses. It updates ALL pubs in the `pubs_all` table
to ensure consistency across the database.

Usage:
    python scripts/fix_pub_areas.py
    python scripts/fix_pub_areas.py --limit 100
    python scripts/fix_pub_areas.py --delay 0.2
"""

import re
import requests
import time
import os
import sys
from typing import Optional, Dict
from dotenv import load_dotenv
from supabase import Client, create_client

# --- Environment setup ---
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
TABLE_NAME = "pubs_all"

if not SUPABASE_URL or not SUPABASE_KEY:
    missing = [
        name
        for name, value in (
            ("SUPABASE_URL", SUPABASE_URL),
            ("SUPABASE_KEY", SUPABASE_KEY),
        )
        if not value
    ]
    print(f"❌ Missing required environment variables: {', '.join(missing)}")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

PAGE_SIZE = 750


def extract_postcode(address: str) -> Optional[str]:
    """Extract UK postcode from address string."""
    if not address:
        return None
    
    # UK postcode pattern: e.g., NW5 1LE, SE1 2EZ, W1D 5NA, EC1M 4AY
    # Format: 1-2 letters, 1-2 digits, optional letter, space, 1 digit, 2 letters
    pattern = r'\b([A-Z]{1,2}[0-9]{1,2}[A-Z]?\s?[0-9][A-Z]{2})\b'
    matches = re.findall(pattern, address.upper())
    
    if matches:
        # Take the last match (most likely the postcode)
        postcode = matches[-1].strip()
        # Normalize spacing: ensure space between outward and inward codes
        if ' ' not in postcode and len(postcode) > 5:
            postcode = postcode[:-3] + ' ' + postcode[-3:]
        return postcode
    
    return None


def get_area_and_borough_from_postcode(postcode: str) -> Optional[Dict[str, str]]:
    """Query postcodes.io API to get area (admin_ward) and borough (admin_district)."""
    try:
        # Remove spaces for API call
        clean_postcode = postcode.replace(' ', '').upper()
        url = f"https://api.postcodes.io/postcodes/{clean_postcode}"
        
        response = requests.get(url, timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            if data.get('status') == 200 and 'result' in data:
                result = data['result']
                
                # Get area (neighbourhood) from admin_ward
                area = result.get('admin_ward')
                
                # Get borough from admin_district
                borough = result.get('admin_district')
                
                if area or borough:
                    return {
                        'area': area,
                        'borough': borough,
                        'postcode': postcode
                    }
        
        return None
    except Exception as e:
        print(f"   ⚠️  Error querying postcode API: {e}")
        return None


def fetch_pubs(columns: str) -> list:
    """Retrieve ALL pubs using pagination."""
    rows = []
    start = 0
    while True:
        try:
            # Query for all pubs
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
        except Exception as e:
            print(f"⚠️  Error fetching pubs: {e}")
            break
    return rows


def update_pub(pub_id: str, payload: Dict[str, str]) -> bool:
    """Write the update payload back to Supabase."""
    try:
        response = supabase.table(TABLE_NAME).update(payload).eq("id", pub_id).execute()
        return bool(response.data)
    except Exception as exc:
        print(f"   ❌ Supabase error updating {pub_id}: {exc}")
        return False


def fix_pub_areas(limit: Optional[int] = None, delay: float = 0.1):
    """Fix area and borough for ALL pubs to ensure consistency."""
    
    print(f"📋 Fetching ALL pubs from table '{TABLE_NAME}'...")
    
    pubs = fetch_pubs("id,name,address,area,borough")
    
    if limit is not None:
        pubs = pubs[:limit]
    
    print(f"✅ Found {len(pubs)} pubs to process\n")
    
    if len(pubs) == 0:
        print("No pubs found. Exiting.")
        return
    
    fixed = 0
    failed = 0
    skipped = 0
    no_postcode = 0
    api_failed = 0
    
    for idx, pub in enumerate(pubs, start=1):
        pub_id = pub.get('id')
        pub_name = pub.get('name', 'Unknown')
        address = pub.get('address', '')
        current_area = pub.get('area', '') or None
        current_borough = pub.get('borough', '') or None
        
        print(f"[{idx}/{len(pubs)}] {pub_name}")
        
        # Truncate address for display
        address_display = address[:80] + "..." if len(address) > 80 else address
        print(f"   📍 Address: {address_display}")
        
        # Show current values
        print(f"   📊 Current: area='{current_area or 'None'}', borough='{current_borough or 'None'}'")
        
        # Extract postcode
        postcode = extract_postcode(address)
        
        if not postcode:
            print(f"   ⚠️  No postcode found in address - SKIPPED")
            no_postcode += 1
            skipped += 1
            continue
        
        print(f"   📮 Postcode: {postcode}")
        
        # Get area and borough from postcode
        location_data = get_area_and_borough_from_postcode(postcode)
        
        if not location_data:
            print(f"   ❌ Could not get location data from API for postcode - FAILED")
            api_failed += 1
            failed += 1
            continue
        
        new_area = location_data.get('area')
        new_borough = location_data.get('borough')
        
        # Show what API returned
        api_area_status = f"'{new_area}'" if new_area else "None (not available in API)"
        api_borough_status = f"'{new_borough}'" if new_borough else "None (not available in API)"
        print(f"   🔍 API returned: area={api_area_status}, borough={api_borough_status}")
        
        # Skip if we didn't get useful data
        if not new_area and not new_borough:
            print(f"   ⚠️  No area or borough data returned from API - SKIPPED")
            skipped += 1
            continue
        
        # Prepare update payload - always update if we have data from API
        payload = {}
        updates = []
        unchanged = []
        
        # Always update area if we got it from API (even if it matches, ensures consistency)
        if new_area:
            if new_area != current_area:
                updates.append(f"area: '{current_area or 'None'}' → '{new_area}'")
            else:
                unchanged.append(f"area: '{new_area}' (unchanged)")
            payload['area'] = new_area
        else:
            print(f"   ⚠️  Area not available from API - keeping current value '{current_area or 'None'}'")
        
        # Always update borough if we got it from API (even if it matches, ensures consistency)
        if new_borough:
            if new_borough != current_borough:
                updates.append(f"borough: '{current_borough or 'None'}' → '{new_borough}'")
            else:
                unchanged.append(f"borough: '{new_borough}' (unchanged)")
            payload['borough'] = new_borough
        else:
            print(f"   ⚠️  Borough not available from API - keeping current value '{current_borough or 'None'}'")
        
        if not payload:
            print(f"   ⚠️  No data to update - SKIPPED")
            skipped += 1
            continue
        
        # Show what's being updated
        if updates:
            print(f"   ✅ Changes:")
            for update in updates:
                print(f"      • {update}")
        if unchanged:
            print(f"   ℹ️  Unchanged (updating for consistency):")
            for item in unchanged:
                print(f"      • {item}")
        
        # Update database
        if update_pub(pub_id, payload):
            fixed += 1
            print(f"   ✅ Successfully updated in database")
        else:
            failed += 1
            print(f"   ❌ Database update failed")
        
        if delay > 0 and idx < len(pubs):
            time.sleep(delay)
    
    print("\n📊 Summary:")
    print(f"   ✅ Fixed: {fixed}")
    print(f"   ⚠️  Skipped: {skipped}")
    print(f"      - No postcode: {no_postcode}")
    print(f"      - No API data: {skipped - no_postcode}")
    print(f"   ❌ Failed: {failed}")
    print(f"      - API errors: {api_failed}")
    print(f"   📝 Total processed: {len(pubs)}")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(
        description=f"Fix pub areas and boroughs from postcodes using postcodes.io API. Updates ALL pubs in '{TABLE_NAME}' table for consistency."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional limit on number of pubs to process"
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.1,
        help="Delay between API calls (seconds)"
    )
    args = parser.parse_args()
    
    fix_pub_areas(limit=args.limit, delay=args.delay)


if __name__ == "__main__":
    main()

