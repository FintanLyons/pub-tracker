"""
Fix pub area/suburb from OpenStreetMap Nominatim API

This script uses OpenStreetMap's Nominatim API (reverse geocoding) to get suburb (area) 
information from coordinates or addresses. It updates ONLY the area field in the `pubs_all` 
table (borough is not changed). This ensures consistency for area/suburb data across the database.

The Nominatim API is free and doesn't require an API key, but please be respectful with rate limits.

Usage:
    python scripts/fix_pub_areas_nominatim.py
    python scripts/fix_pub_areas_nominatim.py --limit 100
    python scripts/fix_pub_areas_nominatim.py --delay 1.0
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

# Nominatim API base URL
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"


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


def get_area_and_borough_from_coordinates(lat: float, lon: float) -> Optional[Dict[str, str]]:
    """Query Nominatim API using coordinates to get suburb (area) and borough."""
    try:
        params = {
            'lat': lat,
            'lon': lon,
            'format': 'json',
            'addressdetails': 1,
            'zoom': 18,  # Higher zoom for more detailed results
        }
        
        headers = {
            'User-Agent': 'PubTracker/1.0 (contact@example.com)'  # Nominatim requires user agent
        }
        
        response = requests.get(NOMINATIM_URL, params=params, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            
            if 'address' in data:
                address_data = data['address']
                
                # Try to get suburb (area) - check multiple possible fields
                area = (
                    address_data.get('suburb') or
                    address_data.get('neighbourhood') or
                    address_data.get('city_district') or
                    address_data.get('district') or
                    address_data.get('village') or
                    None
                )
                
                # Try to get borough - check multiple possible fields
                borough = (
                    address_data.get('borough') or
                    address_data.get('city') or
                    address_data.get('county') or
                    address_data.get('state_district') or
                    None
                )
                
                # For London, try to get the London borough
                if not borough:
                    # Check if it's in Greater London
                    if address_data.get('state') == 'England':
                        # Try to extract from other fields
                        borough = (
                            address_data.get('municipality') or
                            address_data.get('region') or
                            None
                        )
                
                if area or borough:
                    return {
                        'area': area,
                        'borough': borough,
                        'lat': lat,
                        'lon': lon
                    }
        
        return None
    except Exception as e:
        print(f"   ⚠️  Error querying Nominatim API: {e}")
        return None


def get_area_and_borough_from_address(address: str) -> Optional[Dict[str, str]]:
    """Query Nominatim API using address/postcode to get suburb (area) and borough."""
    try:
        # Try to extract postcode first, otherwise use full address
        postcode = extract_postcode(address)
        query = postcode if postcode else address
        
        if not query:
            return None
        
        params = {
            'q': query,
            'format': 'json',
            'addressdetails': 1,
            'limit': 1,
            'countrycodes': 'gb',  # Limit to UK
        }
        
        headers = {
            'User-Agent': 'PubTracker/1.0 (contact@example.com)'  # Nominatim requires user agent
        }
        
        url = "https://nominatim.openstreetmap.org/search"
        response = requests.get(url, params=params, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            
            if data and len(data) > 0:
                result = data[0]
                
                if 'address' in result:
                    address_data = result['address']
                    
                    # Try to get suburb (area)
                    area = (
                        address_data.get('suburb') or
                        address_data.get('neighbourhood') or
                        address_data.get('city_district') or
                        address_data.get('district') or
                        address_data.get('village') or
                        None
                    )
                    
                    # Try to get borough
                    borough = (
                        address_data.get('borough') or
                        address_data.get('city') or
                        address_data.get('county') or
                        address_data.get('state_district') or
                        None
                    )
                    
                    if area or borough:
                        return {
                            'area': area,
                            'borough': borough,
                            'query': query
                        }
        
        return None
    except Exception as e:
        print(f"   ⚠️  Error querying Nominatim API: {e}")
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


def fix_pub_areas(limit: Optional[int] = None, delay: float = 1.0):
    """
    Fix area/suburb for ALL pubs to ensure consistency.
    
    Only updates the area field (suburb), does NOT change borough.
    Uses Nominatim reverse geocoding with coordinates (preferred) or forward geocoding
    with address/postcode as fallback.
    
    Note: Nominatim has a usage policy requiring max 1 request per second.
    Default delay is 1.0 seconds to comply with this.
    """
    
    print(f"📋 Fetching ALL pubs from table '{TABLE_NAME}'...")
    print(f"ℹ️  Note: Only updating area/suburb field, borough will not be changed\n")
    
    # Fetch pubs with coordinates if available, otherwise just address
    pubs = fetch_pubs("id,name,address,area,lat,lon")
    
    if limit is not None:
        pubs = pubs[:limit]
    
    print(f"✅ Found {len(pubs)} pubs to process\n")
    print(f"⏱️  Using {delay}s delay between API calls (Nominatim rate limit: 1 req/sec)\n")
    
    if len(pubs) == 0:
        print("No pubs found. Exiting.")
        return
    
    fixed = 0
    failed = 0
    skipped = 0
    no_coords_or_address = 0
    api_failed = 0
    
    for idx, pub in enumerate(pubs, start=1):
        pub_id = pub.get('id')
        pub_name = pub.get('name', 'Unknown')
        address = pub.get('address', '')
        current_area = pub.get('area', '') or None
        lat = pub.get('lat')
        lon = pub.get('lon')
        
        print(f"[{idx}/{len(pubs)}] {pub_name}")
        
        # Truncate address for display
        address_display = address[:80] + "..." if len(address) > 80 else address
        print(f"   📍 Address: {address_display}")
        
        # Show current area value
        print(f"   📊 Current area: '{current_area or 'None'}'")
        
        # Try to get location data - prefer coordinates, fallback to address
        location_data = None
        method_used = None
        
        if lat and lon:
            try:
                lat_float = float(lat)
                lon_float = float(lon)
                print(f"   📍 Coordinates: {lat_float}, {lon_float}")
                location_data = get_area_and_borough_from_coordinates(lat_float, lon_float)
                method_used = "coordinates"
            except (ValueError, TypeError):
                print(f"   ⚠️  Invalid coordinates: lat={lat}, lon={lon}")
        
        # Fallback to address/postcode if coordinates didn't work
        if not location_data and address:
            postcode = extract_postcode(address)
            if postcode:
                print(f"   📮 Postcode: {postcode} (using address lookup)")
            else:
                print(f"   📮 Using address for lookup")
            location_data = get_area_and_borough_from_address(address)
            method_used = "address"
        
        if not location_data:
            print(f"   ❌ Could not get location data from Nominatim API ({method_used or 'no method'}) - FAILED")
            api_failed += 1
            failed += 1
            if not lat and not lon and not address:
                no_coords_or_address += 1
            continue
        
        new_area = location_data.get('area')
        
        # Show what API returned
        api_area_status = f"'{new_area}'" if new_area else "None (not available in API)"
        print(f"   🔍 API returned ({method_used}): area={api_area_status}")
        
        # Skip if we didn't get area data
        if not new_area:
            print(f"   ⚠️  No area (suburb) data returned from API - SKIPPED")
            skipped += 1
            continue
        
        # Skip if area contains "London Borough of" - that's a borough name, not a suburb
        if new_area and "london borough of" in new_area.lower():
            print(f"   ⚠️  Area '{new_area}' is a borough name, not a suburb - SKIPPED (keeping current area)")
            skipped += 1
            continue
        
        # Prepare update payload - only update area, not borough
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
            print(f"   ⚠️  Area (suburb) not available from API - keeping current value '{current_area or 'None'}'")
        
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
        
        # Respect Nominatim rate limit (1 request per second)
        if delay > 0 and idx < len(pubs):
            time.sleep(delay)
    
    print("\n📊 Summary:")
    print(f"   ✅ Fixed: {fixed}")
    print(f"   ⚠️  Skipped: {skipped}")
    print(f"   ❌ Failed: {failed}")
    print(f"      - API errors: {api_failed}")
    print(f"      - No coordinates/address: {no_coords_or_address}")
    print(f"   📝 Total processed: {len(pubs)}")
    print(f"\n💡 Note: Nominatim is a free service. Please be respectful with usage.")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(
        description=f"Fix pub areas/suburbs using OpenStreetMap Nominatim API. Updates ONLY the area field (not borough) in '{TABLE_NAME}' table for consistency."
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
        default=1.0,
        help="Delay between API calls (seconds). Default 1.0 to respect Nominatim rate limit of 1 req/sec"
    )
    args = parser.parse_args()
    
    fix_pub_areas(limit=args.limit, delay=args.delay)


if __name__ == "__main__":
    main()

