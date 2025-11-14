"""
Merge small areas (1-2 pubs) into nearest larger areas (3+ pubs)

This script identifies areas with only 1 or 2 pubs and merges them into the nearest
area that has 3 or more pubs. Both area and borough fields are updated to ensure
areas are not split across different boroughs. This helps consolidate the area map 
for better usability.

Usage:
    python scripts/merge_small_areas.py
    python scripts/merge_small_areas.py --dry-run
    python scripts/merge_small_areas.py --min-pubs 3
"""

import math
import os
import sys
import time
from collections import defaultdict
from typing import Dict, List, Optional, Tuple
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


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great circle distance between two points on Earth (in kilometers).
    Uses the Haversine formula.
    """
    # Earth's radius in kilometers
    R = 6371.0
    
    # Convert latitude and longitude from degrees to radians
    lat1_rad = math.radians(lat1)
    lon1_rad = math.radians(lon1)
    lat2_rad = math.radians(lat2)
    lon2_rad = math.radians(lon2)
    
    # Haversine formula
    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad
    
    a = (
        math.sin(dlat / 2) ** 2 +
        math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    distance = R * c
    return distance


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
            time.sleep(0.1)
        except Exception as e:
            print(f"⚠️  Error fetching pubs: {e}")
            break
    return rows


def update_pub_area_and_borough(pub_id: str, new_area: str, new_borough: str) -> bool:
    """Update the area and borough fields for a pub."""
    try:
        payload = {"area": new_area}
        if new_borough:
            payload["borough"] = new_borough
        response = supabase.table(TABLE_NAME).update(payload).eq("id", pub_id).execute()
        return bool(response.data)
    except Exception as exc:
        print(f"   ❌ Supabase error updating {pub_id}: {exc}")
        return False


def group_pubs_by_area(pubs: List[Dict]) -> Dict[str, List[Dict]]:
    """Group pubs by their area."""
    area_groups = defaultdict(list)
    
    for pub in pubs:
        area = pub.get('area', '').strip() if pub.get('area') else None
        if not area or area.lower() == 'none':
            continue
        
        # Only include pubs with valid coordinates
        lat = pub.get('lat')
        lon = pub.get('lon')
        if lat and lon:
            try:
                float(lat)
                float(lon)
                area_groups[area].append(pub)
            except (ValueError, TypeError):
                continue
    
    return dict(area_groups)


def get_area_borough(area: str, area_groups: Dict[str, List[Dict]]) -> Optional[str]:
    """Get the borough for a given area. Returns the most common borough for that area."""
    if area not in area_groups:
        return None
    
    pubs = area_groups[area]
    borough_counts = defaultdict(int)
    
    for pub in pubs:
        borough = pub.get('borough', '').strip() if pub.get('borough') else None
        if borough and borough.lower() != 'none':
            borough_counts[borough] += 1
    
    if borough_counts:
        # Return the most common borough
        return max(borough_counts.items(), key=lambda x: x[1])[0]
    
    return None


def find_closest_large_area_pub(
    pub: Dict,
    large_area_pubs: List[Dict],
    exclude_area: str
) -> Optional[Tuple[Dict, float]]:
    """
    Find the closest pub in a large area (3+ pubs) to the given pub.
    Returns (closest_pub, distance_km) or None if no valid pub found.
    """
    pub_lat = float(pub.get('lat', 0))
    pub_lon = float(pub.get('lon', 0))
    
    closest_pub = None
    closest_distance = float('inf')
    
    for other_pub in large_area_pubs:
        # Skip if same pub or same area
        if other_pub.get('id') == pub.get('id'):
            continue
        
        other_area = other_pub.get('area', '').strip()
        if other_area == exclude_area:
            continue
        
        other_lat = other_pub.get('lat')
        other_lon = other_pub.get('lon')
        
        if not other_lat or not other_lon:
            continue
        
        try:
            other_lat = float(other_lat)
            other_lon = float(other_lon)
            
            distance = haversine_distance(pub_lat, pub_lon, other_lat, other_lon)
            
            if distance < closest_distance:
                closest_distance = distance
                closest_pub = other_pub
        except (ValueError, TypeError):
            continue
    
    if closest_pub:
        return (closest_pub, closest_distance)
    return None


def merge_small_areas(min_pubs: int = 3, max_range_km: Optional[float] = None, dry_run: bool = False):
    """
    Merge areas with fewer than min_pubs into the nearest larger area.
    
    Args:
        min_pubs: Minimum number of pubs required for an area to be considered "large"
        max_range_km: Maximum distance (in km) for automatic merging. If set, only merges
                     small areas that are within this distance of a large area. If None,
                     merges regardless of distance.
        dry_run: If True, only show what would be changed without updating the database
    """
    print(f"📋 Fetching ALL pubs from table '{TABLE_NAME}'...")
    
    pubs = fetch_pubs("id,name,address,area,borough,lat,lon")
    
    print(f"✅ Found {len(pubs)} total pubs\n")
    
    if len(pubs) == 0:
        print("No pubs found. Exiting.")
        return
    
    # Group pubs by area
    print("📊 Grouping pubs by area...")
    area_groups = group_pubs_by_area(pubs)
    
    print(f"✅ Found {len(area_groups)} distinct areas\n")
    
    # Separate into small and large areas
    small_areas = {}
    large_areas = {}
    
    for area, pubs_in_area in area_groups.items():
        if len(pubs_in_area) < min_pubs:
            small_areas[area] = pubs_in_area
        else:
            large_areas[area] = pubs_in_area
    
    print(f"📊 Area Statistics:")
    print(f"   • Large areas (≥{min_pubs} pubs): {len(large_areas)}")
    print(f"   • Small areas (<{min_pubs} pubs): {len(small_areas)}")
    
    total_small_pubs = sum(len(pubs) for pubs in small_areas.values())
    print(f"   • Pubs in small areas: {total_small_pubs}")
    
    if max_range_km is not None:
        print(f"   • Maximum merge range: {max_range_km} km")
    else:
        print(f"   • Maximum merge range: No limit (merge regardless of distance)")
    print()
    
    if len(small_areas) == 0:
        print("✅ No small areas to merge. All areas have at least {min_pubs} pubs.")
        return
    
    if len(large_areas) == 0:
        print("⚠️  No large areas found. Cannot merge small areas.")
        return
    
    # Create a flat list of all pubs in large areas for distance calculations
    all_large_area_pubs = []
    for pubs_list in large_areas.values():
        all_large_area_pubs.extend(pubs_list)
    
    print(f"🔍 Finding closest large areas for {len(small_areas)} small areas...\n")
    
    # Process each small area
    merges = []
    skipped = []
    
    for small_area, small_pubs in small_areas.items():
        print(f"📍 Area: '{small_area}' ({len(small_pubs)} pub{'s' if len(small_pubs) != 1 else ''})")
        
        # For each pub in the small area, find the closest pub in a large area
        closest_areas = {}
        
        for pub in small_pubs:
            pub_name = pub.get('name', 'Unknown')
            result = find_closest_large_area_pub(pub, all_large_area_pubs, small_area)
            
            if result:
                closest_pub, distance = result
                target_area = closest_pub.get('area', '').strip()
                closest_areas[target_area] = closest_areas.get(target_area, []) + [{
                    'pub': pub,
                    'distance': distance,
                    'closest_pub_name': closest_pub.get('name', 'Unknown')
                }]
                print(f"   • {pub_name}: closest to '{target_area}' ({distance:.2f} km)")
            else:
                print(f"   • {pub_name}: ⚠️  Could not find closest large area pub")
                skipped.append({
                    'area': small_area,
                    'pub': pub,
                    'reason': 'No valid large area pub found'
                })
        
        # Determine which large area to merge into (most common target)
        if closest_areas:
            # Find the area that most pubs are closest to
            target_area = max(closest_areas.keys(), key=lambda k: len(closest_areas[k]))
            pubs_to_merge = closest_areas[target_area]
            avg_distance = sum(p['distance'] for p in pubs_to_merge) / len(pubs_to_merge)
            max_distance = max(p['distance'] for p in pubs_to_merge)
            
            # Check if within range (if range is specified)
            if max_range_km is not None and max_distance > max_range_km:
                skipped.append({
                    'area': small_area,
                    'pubs': small_pubs,
                    'reason': f'Distance {max_distance:.2f} km exceeds range limit of {max_range_km} km'
                })
                print(f"   ⚠️  Skipped - distance {max_distance:.2f} km exceeds range limit of {max_range_km} km")
                continue
            
            # Get the borough for the target area
            target_borough = get_area_borough(target_area, area_groups)
            
            merges.append({
                'from_area': small_area,
                'to_area': target_area,
                'to_borough': target_borough,
                'pubs': [p['pub'] for p in pubs_to_merge],
                'avg_distance': avg_distance,
                'max_distance': max_distance,
                'count': len(pubs_to_merge)
            })
            
            borough_display = f" (borough: '{target_borough}')" if target_borough else ""
            range_status = f" [within {max_range_km} km range]" if max_range_km else ""
            print(f"   ✅ Will merge into '{target_area}'{borough_display} (avg: {avg_distance:.2f} km, max: {max_distance:.2f} km){range_status}")
        else:
            skipped.append({
                'area': small_area,
                'pubs': small_pubs,
                'reason': 'No valid target area found'
            })
            print(f"   ⚠️  Skipped - no valid target area")
        
        print()
    
    # Summary
    print("\n" + "="*60)
    print("📊 MERGE SUMMARY")
    print("="*60)
    print(f"✅ Areas to merge: {len(merges)}")
    print(f"⚠️  Areas skipped: {len(skipped)}")
    print(f"📝 Total pubs to update: {sum(m['count'] for m in merges)}\n")
    
    if dry_run:
        print("🔍 DRY RUN MODE - No changes will be made to the database\n")
    
    # Show detailed merge plan
    for merge in merges:
        borough_display = f" (borough: '{merge['to_borough']}')" if merge['to_borough'] else ""
        print(f"📍 '{merge['from_area']}' → '{merge['to_area']}'{borough_display}")
        print(f"   • {merge['count']} pub{'s' if merge['count'] != 1 else ''}")
        print(f"   • Average distance: {merge['avg_distance']:.2f} km")
        if 'max_distance' in merge:
            print(f"   • Maximum distance: {merge['max_distance']:.2f} km")
        print(f"   • Pubs:")
        for pub in merge['pubs']:
            print(f"      - {pub.get('name', 'Unknown')} (ID: {pub.get('id')})")
        print()
    
    if skipped:
        print("⚠️  Skipped areas:")
        for skip in skipped:
            if 'pubs' in skip:
                print(f"   • '{skip['area']}': {skip['reason']} ({len(skip['pubs'])} pubs)")
            else:
                print(f"   • '{skip['area']}': {skip['reason']} (pub: {skip['pub'].get('name', 'Unknown')})")
        print()
    
    # Apply changes if not dry run
    if not dry_run:
        print("💾 Applying changes to database...\n")
        
        updated = 0
        failed = 0
        
        for merge in merges:
            borough_display = f" (borough: '{merge['to_borough']}')" if merge['to_borough'] else ""
            print(f"🔄 Merging '{merge['from_area']}' → '{merge['to_area']}'{borough_display}")
            
            for pub in merge['pubs']:
                pub_id = pub.get('id')
                pub_name = pub.get('name', 'Unknown')
                current_borough = pub.get('borough', '').strip() if pub.get('borough') else None
                
                if update_pub_area_and_borough(pub_id, merge['to_area'], merge['to_borough']):
                    updated += 1
                    borough_change = ""
                    if merge['to_borough'] and current_borough != merge['to_borough']:
                        borough_change = f" (borough: '{current_borough or 'None'}' → '{merge['to_borough']}')"
                    print(f"   ✅ {pub_name}{borough_change}")
                else:
                    failed += 1
                    print(f"   ❌ {pub_name} - Update failed")
            
            print()
        
        print("\n" + "="*60)
        print("📊 FINAL SUMMARY")
        print("="*60)
        print(f"✅ Successfully updated: {updated}")
        print(f"❌ Failed: {failed}")
        print(f"📝 Total processed: {updated + failed}")
    else:
        print("💡 Run without --dry-run to apply these changes")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(
        description=f"Merge small areas (<3 pubs) into nearest larger areas (≥3 pubs) in '{TABLE_NAME}' table."
    )
    parser.add_argument(
        "--min-pubs",
        type=int,
        default=3,
        help="Minimum number of pubs required for an area to be considered 'large' (default: 3)"
    )
    parser.add_argument(
        "--range",
        type=float,
        default=None,
        help="Maximum distance in kilometers for automatic merging. Only merges small areas within this range of a large area. If not specified, merges regardless of distance."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be changed without updating the database"
    )
    args = parser.parse_args()
    
    merge_small_areas(min_pubs=args.min_pubs, max_range_km=args.range, dry_run=args.dry_run)


if __name__ == "__main__":
    main()

