#!/usr/bin/env python3
"""
Check for duplicate websites across pubs before running photo enrichment.
Shows which websites are shared by multiple pubs.
"""

import csv
import sys
from collections import defaultdict
from pathlib import Path


def main():
    csv_path = Path(__file__).resolve().parents[1] / "data" / "data_list_search_enriched.csv"
    
    if not csv_path.exists():
        print(f"CSV not found: {csv_path}")
        sys.exit(1)
    
    # Read CSV and group pubs by website
    website_to_pubs = defaultdict(list)
    
    with csv_path.open('r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            website = (row.get('website') or '').strip()
            if not website:
                continue
            
            pub_name = row.get('name', 'Unknown')
            pub_id = row.get('id', '?')
            has_photo = bool((row.get('photo_url1') or '').strip())
            
            # Build address
            address_parts = [
                row.get('addr_housenumber', ''),
                row.get('addr_street', ''),
                row.get('calc_postcode_district', ''),
            ]
            address = ' '.join(filter(None, address_parts)).strip() or 'No address'
            
            website_to_pubs[website].append({
                'name': pub_name,
                'id': pub_id,
                'address': address,
                'has_photo': has_photo,
            })
    
    # Find duplicates
    duplicates = {url: pubs for url, pubs in website_to_pubs.items() if len(pubs) > 1}
    
    if not duplicates:
        print("✅ No duplicate websites found! Each pub has a unique website.")
        return
    
    print(f"⚠️  Found {len(duplicates)} websites shared by multiple pubs:\n")
    
    for website, pubs in sorted(duplicates.items(), key=lambda x: len(x[1]), reverse=True):
        print(f"Website: {website}")
        print(f"  Shared by {len(pubs)} pubs:")
        for pub in pubs:
            photo_status = "✓ has photos" if pub['has_photo'] else "✗ no photos"
            print(f"    - {pub['name']}")
            print(f"      Address: {pub['address']}")
            print(f"      ID: {pub['id']} [{photo_status}]")
        print()
    
    # Summary
    total_pubs_affected = sum(len(pubs) for pubs in duplicates.values())
    pubs_needing_photos = sum(1 for pubs in duplicates.values() for pub in pubs if not pub['has_photo'])
    
    print(f"{'='*60}")
    print(f"Summary:")
    print(f"  {len(duplicates)} duplicate websites")
    print(f"  {total_pubs_affected} total pubs affected")
    print(f"  {pubs_needing_photos} of these pubs still need photos")
    print()
    print(f"💡 Recommendation:")
    print(f"   These pubs share websites (likely chain pubs or same operator).")
    print(f"   Running the script will fetch the same images for each.")
    print(f"   This is OK - they may be different locations of the same chain.")


if __name__ == "__main__":
    main()
