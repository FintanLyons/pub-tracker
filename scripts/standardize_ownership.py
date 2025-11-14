"""
Pub Ownership Standardization Script

This script standardizes pub ownership names in the database by mapping
various spellings and variations to master owner names.

For example:
- "J D Wetherspoons" → "Wetherspoon"
- "Mitchells & Butlers" → "Nicholson's"
- "Fuller's" → "Fuller's" (already correct)

Usage:
    python standardize_ownership.py [--dry-run]

Setup:
    Create .env file in scripts/ directory or project root with:
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_KEY=your_service_role_key
"""

import argparse
import os
import re
import sys
import time
from typing import Dict, Optional

from dotenv import load_dotenv
from supabase import Client, create_client

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: Missing required environment variables!")
    print("   Please create a .env file with SUPABASE_URL and SUPABASE_KEY")
    sys.exit(1)

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Pagination settings
PAGE_SIZE = 1000  # Supabase default limit per request

# Ownership standardization mappings
# Key: master name, Value: list of patterns to match (case-insensitive)
OWNERSHIP_MAPPINGS: Dict[str, list] = {
    "Wetherspoon": [
        r"wetherspoon",  # Matches "wetherspoon" anywhere in the string (case-insensitive)
    ],
    "Fuller's": [
        r"fuller",  # Matches "fuller" anywhere in the string (case-insensitive)
    ],
    "Greene King": [
        r"(?=.*greene)(?=.*king)",  # Requires BOTH "greene" AND "king" to be present (case-insensitive, order-independent)
    ],
    "Nicholson's": [
        r"nicholson",  # Matches "nicholson" anywhere in the string (case-insensitive)
        r"(?=.*mitchell)(?=.*butler)",  # Requires BOTH "mitchell" AND "butler" to be present (case-insensitive, order-independent)
        r"m\s*&\s*b",  # Matches "M & B" or "M&B" anywhere in the string (case-insensitive)
    ],
    "Young's": [
        r"young",  # Matches "young" anywhere in the string (case-insensitive)
    ],
    "Stonegate": [
        r"stonegate",  # Matches "stonegate" anywhere in the string (case-insensitive)
    ],
    "Craft Beer Co": [
        r"(?=.*craft)(?=.*beer)",  # Requires BOTH "craft" AND "beer" to be present (case-insensitive, order-independent)
    ],
    "Stanley Pubs": [
        r"stanley",  # Matches "stanley" anywhere in the string (case-insensitive)
    ],
    "Three Cheers Pub Co": [
        r"(?=.*three)(?=.*cheers)",  # Requires BOTH "three" AND "cheers" to be present (case-insensitive, order-independent)
    ],
    "Antic": [
        r"antic",  # Matches "antic" anywhere in the string (case-insensitive)
    ],
    "Berkeley Inns": [
        r"berkeley",  # Matches "berkeley" anywhere in the string (case-insensitive)
    ],
    "Grace Land": [
        r"(?=.*grace)(?=.*land)",  # Requires BOTH "grace" AND "land" to be present (case-insensitive, order-independent)
    ],
    "Inda Pubs": [
        r"inda",  # Matches "inda" anywhere in the string (case-insensitive)
    ],
    "Ineos": [
        r"ineos",  # Matches "ineos" anywhere in the string (case-insensitive)
    ],
    "McMullen": [
        r"mcmullen",  # Matches "mcmullen" anywhere in the string (case-insensitive)
    ],
    "Remarkable Pubs": [
        r"remarkable",  # Matches "remarkable" anywhere in the string (case-insensitive)
    ],
    "Samuel Smith's": [
        r"(?=.*samuel)(?=.*smith)",  # Requires BOTH "samuel" AND "smith" to be present (case-insensitive, order-independent)
    ],
    "Shepherd Neame": [
        r"(?=.*shepherd)(?=.*neame)",  # Requires BOTH "shepherd" AND "neame" to be present (case-insensitive, order-independent)
    ],
    "Urban Pubs & Bars": [
        r"(?=.*urban)(?=.*pub)",  # Requires BOTH "urban" AND "pub" to be present (case-insensitive, order-independent)
    ],
    "Market Taverns": [
        r"(?=.*market)(?=.*tavern)",  # Requires BOTH "market" AND "tavern" to be present (case-insensitive, order-independent)
    ],
    "Ember Inns": [
        r"(?=.*ember)(?=.*inn)",  # Requires BOTH "ember" AND "inn" to be present (case-insensitive, order-independent)
    ],
    "Geronimo Inns": [
        r"(?=.*geronimo)(?=.*inn)",  # Requires BOTH "geronimo" AND "inn" to be present (case-insensitive, order-independent)
    ],
    "BrewDog": [
        r"brewdog",  # Matches "brewdog" anywhere in the string (case-insensitive)
    ],
    "Cubitt House": [
        r"(?=.*cubitt)(?=.*house)",  # Requires BOTH "cubitt" AND "house" to be present (case-insensitive, order-independent)
    ],
    "Craft Union": [
        r"(?=.*craft)(?=.*union)",  # Requires BOTH "craft" AND "union" to be present (case-insensitive, order-independent)
    ],
    "Glendola Leisure": [
        r"(?=.*glendola)(?=.*leisure)",  # Requires BOTH "glendola" AND "leisure" to be present (case-insensitive, order-independent)
    ],
    "Royal British Legion": [
        r"(?=.*royal)(?=.*british)",  # Requires BOTH "royal" AND "british" to be present (case-insensitive, order-independent)
    ],
    "Five Points Brewing Co": [
        r"(?=.*five)(?=.*point)",  # Requires BOTH "five" AND "point" to be present (case-insensitive, order-independent)
    ],
    "Hall & Woodhouse": [
        r"(?=.*hall)(?=.*woodhous)",  # Requires BOTH "hall" AND "woodhous" to be present (case-insensitive, order-independent)
    ],
    "Portobello": [
        r"portobello",  # Matches "portobello" anywhere in the string (case-insensitive)
    ],
    "Punch Pubs": [
        r"punch",  # Matches "punch" anywhere in the string (case-insensitive)
        r"(?=.*punch)(?=.*tavern)",  # Requires BOTH "punch" AND "tavern" to be present (case-insensitive, order-independent)
    ],
    "London Village Inns": [
        r"(?=.*london)(?=.*village)",  # Requires BOTH "london" AND "village" to be present (case-insensitive, order-independent)
    ],
    "Big Smoke Brewery": [
        r"(?=.*big)(?=.*smoke)",  # Requires BOTH "big" AND "smoke" to be present (case-insensitive, order-independent)
    ],
    "Laine Pub Co": [
        r"laines?",  # Matches "laine" or "laines" anywhere in the string (case-insensitive)
        r"(?=.*laine)(?=.*pub)",  # Requires BOTH "laine" AND "pub" to be present (case-insensitive, order-independent)
    ],
    "Twenty6": [
        r"twenty6|twenty\s*6",  # Matches "twenty6" or "twenty 6" anywhere in the string (case-insensitive)
    ],
    "Davy's": [
        r"davy",  # Matches "davy" anywhere in the string (case-insensitive)
    ],
    "Gipsy Hill": [
        r"(?=.*gipsy)(?=.*hill)",  # Requires BOTH "gipsy" AND "hill" to be present (case-insensitive, order-independent)
    ],
    "Allsopp's Brewer": [
        r"allsopp",  # Matches "allsopp" anywhere in the string (case-insensitive)
    ],
    "Bullfinch Brewery": [
        r"(?=.*bullfinch)(?=.*brewer)",  # Requires BOTH "bullfinch" AND "brewer" to be present (case-insensitive, order-independent)
    ],
    "Pearmain": [
        r"pearmain",  # Matches "pearmain" anywhere in the string (case-insensitive)
    ],
    "Moor Beer Company": [
        r"(?=.*moor)(?=.*beer)",  # Requires BOTH "moor" AND "beer" to be present (case-insensitive, order-independent)
    ],
    "Gladwin Brothers": [
        r"(?=.*gladwin)(?=.*brother)",  # Requires BOTH "gladwin" AND "brother" to be present (case-insensitive, order-independent)
    ],
    "Mondo Brewing": [
        r"(?=.*mondo)(?=.*brewing)",  # Requires BOTH "mondo" AND "brewing" to be present (case-insensitive, order-independent)
    ],
    "Porterhouse Brewing Co": [
        r"(?=.*porterhouse)(?=.*brewing)",  # Requires BOTH "porterhouse" AND "brewing" to be present (case-insensitive, order-independent)
    ],
    "Barworks": [
        r"barworks",  # Matches "barworks" anywhere in the string (case-insensitive)
    ],
    "Bloomsbury Leisure": [
        r"(?=.*bloomsbury)(?=.*leisure)",  # Requires BOTH "bloomsbury" AND "leisure" to be present (case-insensitive, order-independent)
    ],
    "Brasserie Blanc": [
        r"(?=.*brasserie)(?=.*blanc)",  # Requires BOTH "brasserie" AND "blanc" to be present (case-insensitive, order-independent)
    ],
    "Electric Star": [
        r"(?=.*electric)(?=.*star)",  # Requires BOTH "electric" AND "star" to be present (case-insensitive, order-independent)
    ],
    "Enterprise Inns": [
        r"(?=.*enterprise)(?=.*inn)",  # Requires BOTH "enterprise" AND "inn" to be present (case-insensitive, order-independent)
    ],
    "Loci Pubs": [
        r"(?=.*loci)(?=.*pub)",  # Requires BOTH "loci" AND "pub" to be present (case-insensitive, order-independent)
    ],
    "London School of Economics": [
        r"lse",  # Matches "lse" anywhere in the string (case-insensitive)
        r"(?=.*london)(?=.*economics)",  # Requires BOTH "london" AND "economics" to be present (case-insensitive, order-independent)
    ],
    "Morton Scott": [
        r"(?=.*morton)(?=.*scott)",  # Requires BOTH "morton" AND "scott" to be present (case-insensitive, order-independent)
    ],
    "Parched Pub Co": [
        r"parched",  # Matches "parched" anywhere in the string (case-insensitive)
        r"(?=.*parched)(?=.*pub)",  # Requires BOTH "parched" AND "pub" to be present (case-insensitive, order-independent)
    ],
    "PubLove": [
        r"(?=.*pub)(?=.*love)",  # Requires BOTH "pub" AND "love" to be present (case-insensitive, order-independent)
    ],
    "Rarebreed": [
        r"rarebreed",  # Matches "rarebreed" anywhere in the string (case-insensitive)
    ],
    "Star Pubs & Bars": [
        r"(?=.*star)(?=.*pub)",  # Requires BOTH "star" AND "pub" to be present (case-insensitive, order-independent)
    ],
    "True Pub Co": [
        r"(?=.*true)(?=.*pub)",  # Requires BOTH "true" AND "pub" to be present (case-insensitive, order-independent)
    ],
    "Whitbread": [
        r"whitbread",  # Matches "whitbread" anywhere in the string (case-insensitive)
    ],
    "Wren Pubs": [
        r"(?=.*wren)(?=.*pub)",  # Requires BOTH "wren" AND "pub" to be present (case-insensitive, order-independent)
    ],
    "Independent": [
        r"independent",  # Matches "independent" anywhere in the string (case-insensitive)
        r"member",  # Matches "member" anywhere in the string (case-insensitive)
        r"private",  # Matches "private" anywhere in the string (case-insensitive)
    ],
}


def standardize_ownership(ownership: Optional[str], return_match_status: bool = False):
    """
    Standardize an ownership name based on the mappings.
    
    Args:
        ownership: The current ownership string (can be None or empty)
        return_match_status: If True, returns (standardized_name, matched_pattern) tuple
    
    Returns:
        The standardized ownership name, or None if no match found.
        If return_match_status=True, returns (standardized_name, matched) tuple where
        matched is True if a pattern matched, False otherwise.
    """
    if not ownership or not ownership.strip():
        if return_match_status:
            return None, False
        return None
    
    ownership_clean = ownership.strip()
    
    # Try to match against each master name's patterns
    for master_name, patterns in OWNERSHIP_MAPPINGS.items():
        for pattern in patterns:
            # Use case-insensitive regex matching
            if re.search(pattern, ownership_clean, re.IGNORECASE):
                if return_match_status:
                    return master_name, True
                return master_name
    
    # No match found, return original (or None if empty)
    if return_match_status:
        return ownership_clean if ownership_clean else None, False
    return ownership_clean if ownership_clean else None


def get_all_pubs():
    """Fetch all pubs with their ownership values from the database using pagination."""
    all_pubs = []
    start = 0
    batch_num = 0
    
    print("   📥 Fetching pubs in batches...")
    
    while True:
        try:
            batch_num += 1
            response = (
                supabase
                .table('pubs_all')
                .select('id,name,ownership')
                .range(start, start + PAGE_SIZE - 1)
                .execute()
            )
            
            chunk = response.data if response else []
            if not chunk:
                print(f"   ✅ No more pubs to fetch (batch {batch_num} returned empty)")
                break
            
            all_pubs.extend(chunk)
            print(f"   📥 Batch {batch_num}: Fetched {len(chunk)} pubs (total: {len(all_pubs)})")
            
            # If we got fewer results than PAGE_SIZE, we've reached the end
            if len(chunk) < PAGE_SIZE:
                print(f"   ✅ Reached end of data (got {len(chunk)} < {PAGE_SIZE} pubs in last batch)")
                break
            
            start += PAGE_SIZE
            time.sleep(0.1)  # Small delay to avoid overwhelming the API
            
        except Exception as e:
            print(f"   ⚠️  Error fetching pubs (batch {batch_num}, offset {start}): {e}")
            break
    
    return all_pubs


def update_pub_ownership(pub_id: str, standardized_ownership: str, dry_run: bool = False):
    """Update a pub's ownership in the database."""
    if dry_run:
        return True
    
    try:
        response = supabase.table('pubs_all').update({
            'ownership': standardized_ownership
        }).eq('id', pub_id).execute()
        return response.data is not None
    except Exception as e:
        print(f"   ❌ Error updating pub {pub_id}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Standardize pub ownership names in the database"
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be changed without actually updating the database'
    )
    parser.add_argument(
        '--debug',
        action='store_true',
        help='Show sample ownership values being checked (first 50 non-matching)'
    )
    args = parser.parse_args()
    
    print("🍺 Pub Ownership Standardization Script\n")
    
    if args.dry_run:
        print("🔍 DRY RUN MODE - No changes will be made to the database\n")
    
    # Fetch all pubs
    print("📋 Fetching all pubs from database...")
    pubs = get_all_pubs()
    print(f"✅ Found {len(pubs)} pubs\n")
    
    # Process each pub
    updated_count = 0
    unchanged_count = 0
    error_count = 0
    changes = []
    
    total_pubs = len(pubs)
    print(f"🔍 Processing {total_pubs} pubs...\n")
    
    # For debug mode: track potential matches and non-matches
    debug_matches = []  # Ownerships that matched patterns (limited to 100 for display)
    debug_non_matches = []  # Ownerships that didn't match (no limit - show all)
    debug_all_ownerships = []  # All ownership values for summary
    debug_sample_limit = 100
    
    for i, pub in enumerate(pubs, 1):
        pub_id = pub['id']
        pub_name = pub['name']
        current_ownership = pub.get('ownership')
        
        # Standardize the ownership (with match status for debug mode)
        if args.debug:
            standardized, pattern_matched = standardize_ownership(current_ownership, return_match_status=True)
        else:
            standardized = standardize_ownership(current_ownership)
            pattern_matched = None
        
        # Skip if ownership is None/empty and standardized is also None
        if not current_ownership and not standardized:
            unchanged_count += 1
            continue
        
        # For debug: collect potential matches and non-matches
        if args.debug and current_ownership:
            # Track all ownerships for summary
            debug_all_ownerships.append(current_ownership)
            
            if pattern_matched:
                # Only show matches that will actually change (ignore already correct ones)
                will_change = standardized != current_ownership
                if will_change and len(debug_matches) < debug_sample_limit:
                    debug_matches.append({
                        'pub_name': pub_name,
                        'current': current_ownership,
                        'standardized': standardized,
                        'will_change': True
                    })
            else:
                # This ownership didn't match any pattern - collect all of them
                debug_non_matches.append(current_ownership)
        
        # Check if a change is needed
        # Note: standardized will be None if no pattern matched, or the master name if it matched
        if standardized and standardized != current_ownership:
            changes.append({
                'id': pub_id,
                'name': pub_name,
                'old': current_ownership or '(empty)',
                'new': standardized
            })
            
            # Update the database
            success = update_pub_ownership(pub_id, standardized, dry_run=args.dry_run)
            
            if success:
                updated_count += 1
                if not args.dry_run:
                    print(f"✅ {pub_name}: '{current_ownership or '(empty)'}' → '{standardized}'")
            else:
                error_count += 1
        else:
            unchanged_count += 1
        
        # Show progress every 100 pubs
        if i % 100 == 0:
            print(f"   📊 Processed {i}/{total_pubs} pubs... ({updated_count} matches found so far)")
    
    # Final verification - ensure we processed all pubs
    total_processed = updated_count + unchanged_count + error_count
    if total_processed != total_pubs:
        print(f"\n⚠️  WARNING: Processed {total_processed} pubs but fetched {total_pubs} pubs!")
    else:
        print(f"\n✅ Verified: Processed all {total_pubs} pubs")
    
    # Debug: show potential matches for review (only pubs that will change)
    if args.debug:
        # Show summary of all ownerships
        if debug_all_ownerships:
            print(f"\n📊 Debug: All pub owners and counts (sorted alphabetically):")
            from collections import Counter
            all_ownership_counts = Counter(debug_all_ownerships)
            print("=" * 80)
            print(f"{'Ownership':<60} {'Count':<10}")
            print("=" * 80)
            for ownership in sorted(all_ownership_counts.keys(), key=str.lower):
                count = all_ownership_counts[ownership]
                print(f"{ownership:<60} {count:<10}")
            print("=" * 80)
            print(f"Total unique ownerships: {len(all_ownership_counts)}")
            print(f"Total pubs with ownership data: {sum(all_ownership_counts.values())}")
        
        if debug_matches:
            print(f"\n🔍 Debug: Potential matches that will change ({len(debug_matches)} shown, {updated_count} total will change):")
            print("=" * 100)
            print(f"{'#':<5} {'Pub Name':<50} {'Current Ownership':<30} {'→ Standardized':<20}")
            print("=" * 100)
            for i, match in enumerate(debug_matches, 1):
                print(f"{i:<5} {match['pub_name']:<50} {match['current']:<30} {match['standardized']:<20}")
            print("=" * 100)
            print(f"\n💡 Review the matches above. If any are incorrect, let me know and I'll adjust the patterns.")
            print(f"   (Pubs that already have correct standardized names are excluded from this list)")
        
        if debug_non_matches:
            print(f"\n🔍 Debug: Ownership values that didn't match any pattern (showing all {len(debug_non_matches)} unique values, sorted alphabetically):")
            from collections import Counter
            non_match_counts = Counter(debug_non_matches)
            # Sort alphabetically by ownership name
            for ownership in sorted(non_match_counts.keys(), key=str.lower):
                count = non_match_counts[ownership]
                print(f"   • '{ownership}' ({count} pubs)")
    
    # Print summary
    print(f"\n📊 Summary:")
    print(f"   ✅ Updated: {updated_count}")
    print(f"   ⏭️  Unchanged: {unchanged_count}")
    if error_count > 0:
        print(f"   ❌ Errors: {error_count}")
    print(f"   📝 Total: {len(pubs)}")
    
    if args.dry_run and changes:
        print(f"\n📋 Changes that would be made ({len(changes)} pubs):")
        print("=" * 80)
        for i, change in enumerate(changes, 1):
            print(f"{i:4}. {change['name']:50} | '{change['old']}' → '{change['new']}'")
        print("=" * 80)
    
    if not args.dry_run and updated_count > 0:
        print(f"\n✅ Successfully standardized {updated_count} pub ownership names!")


if __name__ == "__main__":
    main()

