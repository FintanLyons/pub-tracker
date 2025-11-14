"""
Pub Ownership Checker Script

This script checks pub names and postcodes against known lists of pubs from major owners
(Greene King, Young's, Fuller's, Wetherspoons, Nicholson's) and updates ownership if
the name and postcode match but the ownership is incorrect.

Usage:
    python scripts/check_pub_ownership.py [--dry-run]

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
from typing import Dict, List, Optional, Set, Tuple

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

# Known pub lists by owner
# Format: {owner_name: [(name, postcode), ...]}
KNOWN_PUBS: Dict[str, List[Tuple[str, str]]] = {
    "Greene King": [
        ("Albert Tavern", "SE25 4LX"),
        ("Ascott", "HA5 1RJ"),
        ("Bald Faced Stag", "N2 8AB"),
        ("Bell Inn", "KT8 0SS"),
        ("Breakspear Arms", "UB9 6LT"),
        ("Brockley Jack", "SE4 2DH"),
        ("Builders Arms", "EN4 9SH"),
        ("Coach And Horses", "WD3 1ER"),
        ("Colonies", "SW1E 6PR"),
        ("Druids Head", "KT1 1JT"),
        ("Duke Of Sussex", "W4 5LF"),
        ("Duke Of York", "W1T 1NW"),
        ("Duke", "KT6 4NQ"),
        ("Earl Beatty", "KT3 6JF"),
        ("George And Dragon", "W1T 6QF"),
        ("George", "SE1 1NH"),
        ("Globe", "NW1 5JY"),
        ("Golden Fleece", "E12 5DB"),
        ("Golden Lion", "RM1 1HR"),
        ("Grafton Arms", "W1T 5DU"),
        ("Greystoke", "W5 3HU"),
        ("Grove", "W5 5QX"),
        ("Hare And Billet", "SE3 0QJ"),
        ("King William", "UB7 0HT"),
        ("King's Stores", "E1 7HP"),
        ("Kings Head", "W1G 8PJ"),
        ("Kingsfield Arms", "HA1 3DF"),
        ("Lucas Arms", "WC1X 8QZ"),
        ("Lullingstone Castle", "BR8 8BE"),
        ("Masons Arms", "NW10 5NU"),
        ("Masons Arms", "W1S 1PY"),  # Note: duplicate name, different postcode
        ("Molly O'Grady's", "SW1W 9SJ"),
        ("North London Tavern", "NW6 7QB"),
        ("Old Dairy", "N4 4AP"),
        ("Old Eagle", "NW1 9LU"),
        ("Old Red Lion", "WC1V 6LS"),
        ("Old Salt Quay", "SE16 5QU"),
        ("Phoenix", "EC2N 2AN"),
        ("Pinner Arms", "HA5 5JS"),
        ("Prince Bonaparte", "W2 5BE"),
        ("Prince Frederick", "BR1 4DE"),
        ("Railway Arms", "WD19 4AB"),
        ("Red Lion And Sun", "N6 4BE"),
        ("Red Lion", "BR1 3LG"),
        ("Rifleman", "KT17 1BB"),
        ("Rye", "SE15 3NX"),
        ("Sherlock Holmes", "WC2N 5DB"),
        ("Skinners Arms", "WC1H 9NT"),
        ("Soldiers Return", "UB10 8LG"),
        ("Tankard", "SE17 1JL"),
        ("Tipperary", "EC4Y 1HT"),
        ("Trinity", "SE1 1JX"),
        ("Tulse Hill Hotel", "SE24 9AY"),
        ("Victoria Inn", "SE15 4AR"),
        ("Williams Ale And Cider House", "E1 7LS"),
        ("Ye Olde Swan", "KT7 0QQ"),
    ],
    "Young's": [
        ("Albert", "KT2 7PX"),
        ("Albion", "EC4V 6AA"),
        ("Alma", "SW18 1TF"),
        ("Angel", "SW15 4HL"),
        ("Bickley Arms", "BR7 5NP"),
        ("Black Cat", "SE6 4JU"),
        ("Black Lion", "KT6 5PL"),
        ("Bridge Hotel", "UB6 8ST"),
        ("Britannia", "W8 6UX"),
        ("Buckingham Arms", "SW1H 9EU"),
        ("Bull And Gate", "NW5 2TJ"),
        ("Bull's Head", "BR7 6NR"),
        ("Bull", "SW16 3QB"),
        ("Bunch Of Grapes", "SE1 9RS"),
        ("Calthorpe Arms", "WC1X 8JR"),
        ("Castle", "SW17 0RG"),
        ("Clock House", "SE22 9QA"),
        ("Coach And Horses Hotel", "TW9 3BH"),
        ("Crane", "SW18 1EZ"),
        ("Crooked Billet", "SW19 4RQ"),
        ("Cutty Sark", "SE10 9PD"),
        ("Devonshire", "SW12 9AN"),
        ("Dial Arch", "SE18 6GH"),
        ("Dirty Dick's", "EC2M 4NR"),
        ("Dog And Bull", "CR0 1RG"),
        ("Dog And Fox", "SW19 5EA"),
        ("Duke Of Wellington", "W11 2ED"),
        ("Duke's Head Hotel", "SM6 0AA"),
        ("Finch's", "EC2A 1AN"),
        ("Flask", "NW3 1HG"),
        ("Founders Arms", "SE1 9JH"),
        ("Fox And Anchor", "EC1M 6AA"),
        ("Fox And Hounds", "SW1W 8HR"),
        ("Gardeners", "SW18 5JL"),
        ("Grand Junction Arms", "NW10 7AD"),
        ("Grange", "W5 3XH"),
        ("Grapes", "SW18 1DX"),
        ("Green Man", "SW15 3NG"),
        ("Greyhound Hotel", "SM5 3PE"),
        ("Greyhound", "NW4 4JT"),
        ("Hammersmith Ram", "W6 9HW"),
        ("Hand In Hand", "SW19 4RQ"),
        ("Hare And Hounds", "SW14 8AH"),
        ("Hope", "SE27 9JS"),
        ("Lamb Tavern", "EC3V 1LR"),
        ("Lamb", "WC1N 3LZ"),
        ("Leather Bottle", "SW17 0NY"),
        ("Lord Nelson", "SM1 4QP"),
        ("Malt Shovel", "DA1 1LP"),
        ("Manor Arms", "SW16 6LQ"),
        ("Mitre", "W2 3QH"),
        ("Morpeth Arms", "SW1P 4RW"),
        ("Mulberry Bush", "SE1 9PP"),
        ("Nightingale", "SW12 8NX"),
        ("Old Brewery", "SE10 9LW"),
        ("Old Sergeant", "SW18 4DJ"),
        ("Old Ship", "TW9 1ND"),
        ("One Tun", "W1T 4LZ"),
        ("Orange Tree", "TW9 2NQ"),
        ("Paternoster", "EC4M 7DZ"),
        ("Princess Of Wales", "E5 9RB"),
        ("Railway Bell", "SE19 1PF"),
        ("Red Cow", "TW9 1YJ"),
        ("Richard I", "SE10 8RT"),
        ("Rising Sun", "KT18 5DX"),
        ("Robin Hood", "SM1 1SH"),
        ("Roebuck", "NW3 2PN"),
        ("Rose And Crown", "SW19 5BA"),
        ("Royal Oak", "SW1P 4BZ"),
        ("Shaftesbury", "TW9 2PN"),
        ("Ship", "SE16 4JE"),
        ("Ship", "SW18 1TB"),  # Note: duplicate name, different postcode
        ("Spotted Horse", "SW15 1RG"),
        ("Spread Eagle", "NW1 7BN"),
        ("Spring Grove", "KT1 2SF"),
        ("Square Tavern", "NW1 2PE"),
        ("Surprise", "SW8 2PP"),
        ("Trinity Arms", "SW9 8DR"),
        ("Two Doves", "BR2 8HD"),
        ("Wheatsheaf", "SE1 9AA"),
        ("White Cross", "TW9 1TJ"),
        ("Windmill", "W1S 2AZ"),
        ("Wood House", "SE26 6RS"),
        ("Woolpack", "SE1 3UB"),
    ],
    "Fuller's": [
        ("Admiral Nelson", "TW2 7BB"),
        ("Anchor And Hope", "E5 9HG"),
        ("Andover Arms", "W6 0DL"),
        ("Antelope", "SW1W 8EZ"),
        ("Artillery Arms", "EC1Y 8ND"),
        ("Banker", "EC4R 3TE"),
        ("Barley Mow", "KT17 4EA"),
        ("Barrel And Horn", "BR1 1PW"),
        ("Barrowboy And Banker", "SE1 9QQ"),
        ("Beehive", "SW11 1TH"),
        ("Beehive", "TW14 9HF"),  # Note: duplicate name, different postcode
        ("Bell And Crown", "W4 3PF"),
        ("Black Horse", "UB6 0AS"),
        ("Blackbird", "SW5 9AN"),
        ("Blacksmiths Arms", "SE16 5EJ"),
        ("Brewery Tap", "TW8 8BD"),
        ("Builders Arms", "CR0 6TP"),
        ("Butchers Hook And Cleaver", "EC1A 9DY"),
        ("Cabbage Patch", "TW1 3SZ"),
        ("Castle Inn", "W5 5EU"),
        ("Castle", "HA1 3EF"),
        ("Chamberlain", "EC3N 1NU"),
        ("Churchill Arms", "W8 7LN"),
        ("Coach And Horses", "W1D 5DH"),
        ("Cock And Bull", "SM1 1HF"),
        ("Counting House", "EC3V 3PD"),
        ("Crown And Sceptre", "CR2 6RB"),
        ("Crown", "N1 0EB"),
        ("Distillers", "W6 9PH"),
        ("Doric Arch", "NW1 2DN"),
        ("Dove", "W6 9TA"),
        ("Drayton Court Hotel", "W13 8PH"),
        ("Elephant Inn", "N12 8NR"),
        ("Euston Flyer", "NW1 2RA"),
        ("Flask", "N6 6BU"),
        ("Fox And Goose", "W5 1DP"),
        ("George And Devonshire", "W4 2QE"),
        ("George IV", "W4 2DR"),
        ("Great Northern Railway Tavern", "N8 7QB"),
        ("Gun", "E14 9NS"),
        ("Half Moon", "SE24 9HU"),
        ("Harp", "WC2N 4HS"),
        ("Holly Bush", "NW3 6SG"),
        ("Hung Drawn And Quartered", "EC3R 5AQ"),
        ("Jack Horner", "W1T 7QN"),
        ("Jugged Hare", "SW1V 1DX"),
        ("King And Queen", "CR3 5UA"),
        ("King's Head", "SW5 0QT"),
        ("Kingswood Arms", "KT20 6EB"),
        ("Lamb And Flag", "WC2E 9EB"),
        ("Leather Exchange", "SE1 3HN"),
        ("Little Windsor", "SM1 4BY"),
        ("Mad Bishop And Bear", "W2 1HB"),
        ("Mad Hatter", "SE1 9NY"),
        ("Masons Arms", "SW8 4BT"),
        ("Moby Dick", "SE16 7PL"),
        ("Old Mitre", "EC1N 6SJ"),
        ("Old Pack Horse", "W4 5TF"),
        ("Parcel Yard", "N1C 4AH"),
        ("Partridge", "BR1 1HE"),
        ("Pilot", "SE10 0BE"),
        ("Plough", "UB2 4LG"),
        ("Plough", "W5 4XB"),  # Note: duplicate name, different postcode
        ("Prince Albert", "TW2 5QB"),
        ("Prince Blucher", "TW2 5AG"),
        ("Prince Of Wales", "KT6 6AL"),
        ("Prince's Head", "TW9 1LX"),
        ("Queen's Head", "KT2 5HA"),
        ("Queen's Head", "TW5 9PB"),  # Note: duplicate name, different postcode
        ("Queens Head", "HP5 1JD"),
        ("Railway Tavern", "SM5 2HG"),
        ("Red Lion", "SW13 9RU"),
        ("Red Lion", "SW1Y 6JP"),  # Note: duplicate name, different postcode
        ("Red Lion", "W5 5RA"),  # Note: duplicate name, different postcode
        ("Rose And Crown", "W5 4HN"),
        ("Royal Oak", "TW7 6EP"),
        ("Salutation", "W6 0QU"),
        ("Sanctuary House Hotel", "SW1H 9LA"),
        ("Scarsdale Tavern", "W8 6HE"),
        ("Seven Stars", "WC2A 2JB"),
        ("Ship", "SE1 1DX"),
        ("Ship", "W1F 0TT"),  # Note: duplicate name, different postcode
        ("Star Tavern", "SW1X 8HT"),
        ("Sun And Thirteen Cantons", "W1F 9NG"),
        ("Swan", "EC3V 1LY"),
        ("Tap On The Line", "TW9 3PZ"),
        ("Turk's Head", "TW1 1LF"),
        ("Union Tavern", "W9 2BA"),
        ("Viaduct", "W7 3TD"),
        ("Victoria", "W2 2NH"),
        ("Wellington", "SE1 8UD"),
        ("Wheatsheaf", "W5 2HZ"),
        ("White Hart", "KT1 4DA"),
        ("White Hart", "UB3 5DP"),  # Note: duplicate name, different postcode
        ("White Horse", "HA2 0HL"),
        ("Wych Elm", "KT2 6HT"),
    ],
    "Wetherspoon": [
        ("Assembly Rooms", "KT19 8EH"),
        ("Barking Dog", "IG11 8TU"),
        ("Beaten Docket", "NW2 3ET"),
        ("Beehive", "SW9 7DG"),
        ("Botwell Inn", "UB3 3EB"),
        ("Brockley Barge", "SE4 2RR"),
        ("Colley Rowe Inn", "RM5 3PA"),
        ("Coronation Hall", "KT6 4LQ"),
        ("Coronet", "N7 6NJ"),
        ("Crosse Keys", "EC3V 0DR"),
        ("Drum", "E10 7EQ"),
        ("Edward Rayne", "SW20 8ND"),
        ("Eva Hart", "RM6 4AH"),
        ("Fox On The Hill", "SE5 8EH"),
        ("Furze Wren", "DA6 7DY"),
        ("Gate Clock", "SE10 9RB"),
        ("George", "CR0 1LA"),
        ("George", "E11 2RL"),  # Note: duplicate name, different postcode
        ("Goldengrove", "E15 1NS"),
        ("Good Yarn", "UB8 1JX"),
        ("Goodman's Field", "E1 8AN"),
        ("Great Harry", "SE18 6NY"),
        ("Greenwood Hotel", "UB5 4LA"),
        ("Half Moon", "E1 4AA"),
        ("Hamilton Hall", "EC2M 7PY"),
        ("Harvest Moon", "BR6 0LQ"),
        ("J J Moons", "HA4 0AA"),
        ("J J Moons", "HA9 6AA"),  # Note: duplicate name, different postcode
        ("J J Moons", "NW9 9EL"),  # Note: duplicate name, different postcode
        ("J J Moons", "RM12 4UN"),  # Note: duplicate name, different postcode
        ("J J Moons", "SW17 0RN"),  # Note: duplicate name, different postcode
        ("Kentish Drovers", "SE15 5RS"),
        ("Kings Ford", "E4 8JL"),
        ("Kings Tun", "KT1 1QT"),
        ("Knights Templar", "WC2A 1DT"),
        ("Ledger Building", "E14 4AL"),
        ("Liberty Bounds", "EC3N 4AA"),
        ("London And Rye", "SE6 4AF"),
        ("Lord Moon Of The Mall", "SW1A 2DY"),
        ("Masque Haunt", "EC1V 9BP"),
        ("Metropolitan", "NW1 5LA"),
        ("Montagu Pyke", "WC2H 0DT"),
        ("Moon And Sixpence", "HA5 4HS"),
        ("Moon And Stars", "RM1 1NX"),
        ("Moon And Stars", "SE20 7QS"),  # Note: duplicate name, different postcode
        ("Moon On The Hill", "HA1 2AW"),
        ("Moon On The Hill", "SM1 1DZ"),  # Note: duplicate name, different postcode
        ("Moon On The Square", "TW13 4AU"),
        ("Moon Under Water", "EN2 6NN"),
        ("Moon Under Water", "NW9 6RR"),  # Note: duplicate name, different postcode
        ("Moon Under Water", "SW16 4AU"),  # Note: duplicate name, different postcode
        ("Moon Under Water", "TW3 3LF"),  # Note: duplicate name, different postcode
        ("Mossy Well", "N10 3SH"),
        ("New Cross Turnpike", "DA16 3PB"),
        ("New Crown", "N14 5PH"),
        ("New Fairlop Oak", "IG6 2JP"),
        ("Nonsuch Inn", "SM3 9AA"),
        ("Penderel's Oak", "WC1V 7HJ"),
        ("Pennsylvanian", "WD3 1AN"),
        ("Plough And Harrow", "W6 0QU"),
        ("Pommelers Rest", "SE1 2UN"),
        ("Railway Bell", "EN4 8RR"),
        ("Red Lion And Pineapple", "W3 9BP"),
        ("Richmal Crompton", "BR1 1DS"),
        ("Rochester Castle", "N16 0NY"),
        ("Rockingham Arms", "SE1 6BN"),
        ("Shakespeare's Head", "WC2B 6AH"),
        ("Sir John Hawkshaw", "EC4N 6AP"),
        ("Sir John Oldcastle", "EC1M 3JF"),
        ("Sir Julian Huxley", "CR2 8LB"),
        ("Sir Michael Balcon", "W5 3TJ"),
        ("Sovereign Of The Seas", "BR5 1DG"),
        ("Surrey Docks", "SE16 2LW"),
        ("Tailor's Chalk", "DA14 6ED"),
        ("Tichenham Inn", "UB10 8DF"),
        ("Village Inn", "HA5 5DY"),
        ("Walnut Tree", "E11 1HH"),
        ("Watch House", "SE13 6JP"),
        ("Wetherspoons", "SW1V 1JT"),
        ("Wetherspoons", "Terminal 4 Airside"),  # Note: special case - no postcode
        ("Whispering Moon", "SM6 8QF"),
        ("White Swan", "N1 1RY"),
        ("Wibbas Down Inn", "SW19 1QT"),
        ("William Morris", "W6 0QA"),
        ("William Webb Ellis", "TW1 3RR"),
        ("Willow Walk", "SW1V 1LW"),
        ("Wrong 'Un", "DA6 8AS"),
    ],
    "Nicholson's": [
        ("Argyll Arms", "W1F 7TP"),
        ("Black Friar", "EC4V 4EG"),
        ("Cambridge", "WC2H 0DP"),
        ("Clarence", "W1S 4LB"),
        ("Coal Hole", "WC2R 0DW"),
        ("Crown", "W1F 9TP"),
        ("De Hems", "W1D 5BW"),
        ("Dog And Duck", "W1D 3AJ"),
        ("Doggett's", "SE1 9UD"),
        ("Elephant And Castle", "W8 4LT"),
        ("Falcon", "SW11 1RU"),
        ("Flying Horse", "W1D 1AN"),
        ("Henry Addington", "E14 4PH"),
        ("Hoop And Grapes", "EC3N 1AL"),
        ("Horniman", "SE1 2HD"),
        ("Lord Aberconway", "EC2M 1QT"),
        ("Magpie", "EC2M 4TP"),
        ("Old Bell", "EC4Y 1DH"),
        ("Old Thameside Inn", "SE1 9DG"),
        ("Princess Of Wales", "WC2N 6ND"),
        ("Ship", "EC3V 0BP"),
        ("St George's Tavern", "SW1V 1QD"),
        ("Swan", "W6 0DZ"),
        ("Three Greyhounds", "W1D 5DD"),
        ("Walrus And The Carpenter", "EC3R 8BU"),
        ("White Horse", "W1F 7RY"),
        ("White Swan", "WC2N 4LF"),
        ("Williamson's Tavern", "EC4M 9EH"),
        ("Woodins Shades", "EC2M 4PT"),
        ("Ye Olde Watling", "EC4M 9BR"),
        ("York", "N1 8EQ"),
    ],
}


def normalize_name(name: str) -> str:
    """Normalize pub name for comparison (case-insensitive, handle common variations)."""
    if not name:
        return ""
    # Convert to lowercase for case-insensitive matching
    normalized = name.lower()
    # Remove extra whitespace
    normalized = " ".join(normalized.split())
    # Normalize common variations
    normalized = normalized.replace("&", "and")
    normalized = normalized.replace("'", "'")  # Normalize apostrophes
    normalized = normalized.replace("'", "'")  # Handle different apostrophe types
    # Remove common suffixes that might vary
    # (We'll keep them for now, but could strip "Pub", "Inn", etc. if needed)
    return normalized.strip()


def normalize_postcode(postcode: str) -> str:
    """Normalize UK postcode for comparison (uppercase, ensure space)."""
    if not postcode:
        return ""
    # Remove spaces, convert to uppercase, then add space before last 3 chars if needed
    clean = postcode.replace(" ", "").upper()
    if len(clean) > 3:
        # Format: ABC123 -> ABC 123
        return clean[:-3] + " " + clean[-3:]
    return clean


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
        return normalize_postcode(postcode)
    
    return None


def build_lookup_index() -> Dict[Tuple[str, str], str]:
    """
    Build a lookup index: (normalized_name, normalized_postcode) -> owner_name.
    Handles duplicate pub names by using postcode as part of the key.
    """
    index: Dict[Tuple[str, str], str] = {}
    
    for owner, pubs in KNOWN_PUBS.items():
        for pub_name, postcode in pubs:
            # Handle special case: "Wetherspoons" at "Terminal 4 Airside" has no postcode
            if postcode == "Terminal 4 Airside":
                # Skip this one for now - would need address matching
                continue
            
            normalized_name = normalize_name(pub_name)
            normalized_postcode = normalize_postcode(postcode)
            
            if normalized_name and normalized_postcode:
                key = (normalized_name, normalized_postcode)
                # If duplicate key, warn but use first occurrence
                if key in index:
                    print(f"⚠️  Warning: Duplicate key {key} for {owner} (already mapped to {index[key]})")
                index[key] = owner
    
    return index


def get_all_pubs():
    """Fetch all pubs with their name, address, and ownership from the database using pagination."""
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
                .select('id,name,address,ownership')
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


def update_pub_ownership(pub_id: str, new_ownership: str, dry_run: bool = False):
    """Update a pub's ownership in the database."""
    if dry_run:
        return True
    
    try:
        response = supabase.table('pubs_all').update({
            'ownership': new_ownership
        }).eq('id', pub_id).execute()
        return response.data is not None
    except Exception as e:
        print(f"   ❌ Error updating pub {pub_id}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Check pub names and postcodes against known owner lists and update ownership"
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be changed without actually updating the database'
    )
    args = parser.parse_args()
    
    print("🍺 Pub Ownership Checker Script\n")
    
    if args.dry_run:
        print("🔍 DRY RUN MODE - No changes will be made to the database\n")
    
    # Build lookup index
    print("📋 Building lookup index from known pub lists...")
    lookup_index = build_lookup_index()
    print(f"✅ Indexed {len(lookup_index)} known pubs from {len(KNOWN_PUBS)} owners\n")
    
    # Fetch all pubs
    print("📋 Fetching all pubs from database...")
    pubs = get_all_pubs()
    print(f"✅ Found {len(pubs)} pubs\n")
    
    # Process each pub
    updated_count = 0
    unchanged_count = 0
    no_postcode_count = 0
    no_match_count = 0
    already_correct_count = 0
    error_count = 0
    changes = []
    
    total_pubs = len(pubs)
    print(f"🔍 Processing {total_pubs} pubs...\n")
    
    for i, pub in enumerate(pubs, 1):
        pub_id = pub['id']
        pub_name = pub.get('name', '')
        address = pub.get('address', '')
        current_ownership = pub.get('ownership', '').strip() if pub.get('ownership') else None
        
        # Normalize pub name
        normalized_name = normalize_name(pub_name)
        
        # Extract postcode from address
        postcode = extract_postcode(address)
        
        if not postcode:
            no_postcode_count += 1
            unchanged_count += 1
            continue
        
        # Normalize postcode
        normalized_postcode = normalize_postcode(postcode)
        
        # Look up in index
        lookup_key = (normalized_name, normalized_postcode)
        expected_owner = lookup_index.get(lookup_key)
        
        if not expected_owner:
            no_match_count += 1
            unchanged_count += 1
            continue
        
        # Check if ownership already matches
        if current_ownership and expected_owner.lower() in current_ownership.lower():
            already_correct_count += 1
            unchanged_count += 1
            continue
        
        # We have a match and ownership needs updating
        changes.append({
            'id': pub_id,
            'name': pub_name,
            'postcode': normalized_postcode,
            'old': current_ownership or '(empty)',
            'new': expected_owner
        })
        
        # Update the database
        success = update_pub_ownership(pub_id, expected_owner, dry_run=args.dry_run)
        
        if success:
            updated_count += 1
            if not args.dry_run:
                print(f"✅ {pub_name} ({normalized_postcode}): '{current_ownership or '(empty)'}' → '{expected_owner}'")
        else:
            error_count += 1
        
        # Show progress every 100 pubs
        if i % 100 == 0:
            print(f"   📊 Processed {i}/{total_pubs} pubs... ({updated_count} matches found so far)")
    
    # Print summary
    print(f"\n📊 Summary:")
    print(f"   ✅ Updated: {updated_count}")
    print(f"   ✓ Already correct: {already_correct_count}")
    print(f"   ⏭️  Unchanged: {unchanged_count}")
    print(f"      - No postcode: {no_postcode_count}")
    print(f"      - No match: {no_match_count}")
    if error_count > 0:
        print(f"   ❌ Errors: {error_count}")
    print(f"   📝 Total: {len(pubs)}")
    
    if args.dry_run and changes:
        print(f"\n📋 Changes that would be made ({len(changes)} pubs):")
        print("=" * 100)
        print(f"{'#':<5} {'Pub Name':<40} {'Postcode':<12} {'Current Ownership':<25} {'→ New Ownership':<20}")
        print("=" * 100)
        for i, change in enumerate(changes, 1):
            print(f"{i:<5} {change['name']:<40} {change['postcode']:<12} {change['old']:<25} {change['new']:<20}")
        print("=" * 100)
    
    if not args.dry_run and updated_count > 0:
        print(f"\n✅ Successfully updated {updated_count} pub ownership records!")


if __name__ == "__main__":
    main()

