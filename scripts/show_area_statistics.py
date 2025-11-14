"""
Show area and borough statistics

This script displays statistics about pubs grouped by borough and area,
showing the number of pubs in each area within each borough.

Usage:
    python scripts/show_area_statistics.py
    python scripts/show_area_statistics.py --sort-by count
    python scripts/show_area_statistics.py --min-pubs 3
"""

import os
import sys
from collections import defaultdict
from typing import Dict, List
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

# Valid London boroughs (32 boroughs + City of London)
VALID_LONDON_BOROUGHS = {
    'Barking and Dagenham',
    'Barnet',
    'Bexley',
    'Brent',
    'Bromley',
    'Camden',
    'City of London',
    'Croydon',
    'Ealing',
    'Enfield',
    'Greenwich',
    'Hackney',
    'Hammersmith and Fulham',
    'Haringey',
    'Harrow',
    'Havering',
    'Hillingdon',
    'Hounslow',
    'Islington',
    'Kensington and Chelsea',
    'Kingston upon Thames',
    'Lambeth',
    'Lewisham',
    'Merton',
    'Newham',
    'Redbridge',
    'Richmond upon Thames',
    'Southwark',
    'Sutton',
    'Tower Hamlets',
    'Waltham Forest',
    'Wandsworth',
    'Westminster',
    # Common variations/abbreviations
    'City of Westminster',
    'Westminster',
    'Kensington and Chelsea',
    'Hammersmith & Fulham',
    'Hammersmith and Fulham',
}


def is_valid_london_borough(borough: str) -> bool:
    """Check if a borough name is a valid London borough."""
    if not borough:
        return False
    
    borough_normalized = borough.strip()
    
    # Direct match
    if borough_normalized in VALID_LONDON_BOROUGHS:
        return True
    
    # Case-insensitive match
    borough_lower = borough_normalized.lower()
    valid_lower = {b.lower() for b in VALID_LONDON_BOROUGHS}
    
    if borough_lower in valid_lower:
        return True
    
    # Check for partial matches (e.g., "London Borough of X")
    if "london borough of" in borough_lower:
        borough_name = borough_lower.replace("london borough of", "").strip()
        if borough_name in valid_lower:
            return True
    
    return False


def fetch_pubs(columns: str) -> list:
    """Retrieve ALL pubs using pagination."""
    rows = []
    start = 0
    while True:
        try:
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
        except Exception as e:
            print(f"⚠️  Error fetching pubs: {e}")
            break
    return rows


def show_statistics(min_pubs: int = 0, sort_by: str = "name"):
    """
    Display statistics grouped by borough and area.
    
    Args:
        min_pubs: Minimum number of pubs to show an area (default: 0 = show all)
        sort_by: How to sort areas - "name" (alphabetical) or "count" (by pub count)
    """
    print(f"📋 Fetching ALL pubs from table '{TABLE_NAME}'...")
    
    pubs = fetch_pubs("id,name,area,borough")
    
    print(f"✅ Found {len(pubs)} total pubs\n")
    
    if len(pubs) == 0:
        print("No pubs found. Exiting.")
        return
    
    # Group by borough, then by area
    borough_stats = defaultdict(lambda: defaultdict(int))
    pubs_without_borough = []
    pubs_without_area = []
    invalid_boroughs = set()
    
    for pub in pubs:
        borough = pub.get('borough', '').strip() if pub.get('borough') else None
        area = pub.get('area', '').strip() if pub.get('area') else None
        
        if not borough or borough.lower() == 'none':
            pubs_without_borough.append(pub)
            continue
        
        if not area or area.lower() == 'none':
            pubs_without_area.append(pub)
            continue
        
        # Check if borough is valid London borough
        if not is_valid_london_borough(borough):
            invalid_boroughs.add(borough)
        
        borough_stats[borough][area] += 1
    
    # Sort boroughs alphabetically
    sorted_boroughs = sorted(borough_stats.keys())
    
    # Display statistics
    print("=" * 80)
    print("📊 AREA STATISTICS BY BOROUGH")
    print("=" * 80)
    print()
    
    total_areas = 0
    total_pubs = 0
    
    for borough in sorted_boroughs:
        areas = borough_stats[borough]
        
        # Filter by min_pubs if specified
        filtered_areas = {
            area: count 
            for area, count in areas.items() 
            if count >= min_pubs
        }
        
        if not filtered_areas:
            continue
        
        # Sort areas
        if sort_by == "count":
            sorted_areas = sorted(
                filtered_areas.items(), 
                key=lambda x: (-x[1], x[0])  # Sort by count descending, then name
            )
        else:
            sorted_areas = sorted(filtered_areas.items())
        
        borough_total = sum(count for count in filtered_areas.values())
        total_areas += len(filtered_areas)
        total_pubs += borough_total
        
        # Check if borough is valid
        is_valid = is_valid_london_borough(borough)
        invalid_marker = " ⚠️  [NOT A LONDON BOROUGH]" if not is_valid else ""
        
        print(f"🏛️  {borough}{invalid_marker}")
        print(f"   Total pubs: {borough_total}")
        print(f"   Areas: {len(filtered_areas)}")
        print()
        
        for area, count in sorted_areas:
            print(f"   • {area}: {count} pub{'s' if count != 1 else ''}")
        
        print()
    
    # Summary
    print("=" * 80)
    print("📊 SUMMARY")
    print("=" * 80)
    print(f"Total boroughs: {len(sorted_boroughs)}")
    print(f"Total areas: {total_areas}")
    print(f"Total pubs: {total_pubs}")
    
    if min_pubs > 0:
        print(f"\n(Only showing areas with ≥{min_pubs} pubs)")
    
    # Show invalid boroughs
    if invalid_boroughs:
        print("\n" + "=" * 80)
        print("⚠️  INVALID LONDON BOROUGHS DETECTED")
        print("=" * 80)
        for invalid_borough in sorted(invalid_boroughs):
            count = sum(borough_stats[invalid_borough].values())
            print(f"   • {invalid_borough}: {count} pub{'s' if count != 1 else ''}")
        print(f"\n   Total invalid boroughs: {len(invalid_boroughs)}")
        print(f"   These may need to be corrected in the database.")
    
    # Show pubs without borough/area
    if pubs_without_borough:
        print(f"\n⚠️  Pubs without borough: {len(pubs_without_borough)}")
        if len(pubs_without_borough) <= 10:
            for pub in pubs_without_borough[:10]:
                print(f"   • {pub.get('name', 'Unknown')} (ID: {pub.get('id')})")
        else:
            for pub in pubs_without_borough[:10]:
                print(f"   • {pub.get('name', 'Unknown')} (ID: {pub.get('id')})")
            print(f"   ... and {len(pubs_without_borough) - 10} more")
    
    if pubs_without_area:
        print(f"\n⚠️  Pubs without area: {len(pubs_without_area)}")
        if len(pubs_without_area) <= 10:
            for pub in pubs_without_area[:10]:
                print(f"   • {pub.get('name', 'Unknown')} (ID: {pub.get('id')})")
        else:
            for pub in pubs_without_area[:10]:
                print(f"   • {pub.get('name', 'Unknown')} (ID: {pub.get('id')})")
            print(f"   ... and {len(pubs_without_area) - 10} more")
    
    # Show small areas (1-2 pubs) if min_pubs is 0
    if min_pubs == 0:
        print("\n" + "=" * 80)
        print("📊 SMALL AREAS (1-2 pubs)")
        print("=" * 80)
        
        small_areas = []
        for borough in sorted_boroughs:
            for area, count in borough_stats[borough].items():
                if count < 3:
                    small_areas.append((borough, area, count))
        
        if small_areas:
            # Sort by count, then borough, then area
            small_areas.sort(key=lambda x: (x[2], x[0], x[1]))
            
            for borough, area, count in small_areas:
                print(f"   • {borough} / {area}: {count} pub{'s' if count != 1 else ''}")
        else:
            print("   ✅ No small areas found (all areas have 3+ pubs)")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(
        description=f"Show statistics about pubs grouped by borough and area in '{TABLE_NAME}' table."
    )
    parser.add_argument(
        "--min-pubs",
        type=int,
        default=0,
        help="Minimum number of pubs to show an area (default: 0 = show all)"
    )
    parser.add_argument(
        "--sort-by",
        type=str,
        choices=["name", "count"],
        default="name",
        help="How to sort areas: 'name' (alphabetical) or 'count' (by pub count, descending)"
    )
    args = parser.parse_args()
    
    show_statistics(min_pubs=args.min_pubs, sort_by=args.sort_by)


if __name__ == "__main__":
    main()

