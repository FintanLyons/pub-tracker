#!/usr/bin/env python3
"""
Build data/postcode_district_display_names.json for every district in london_postcode_districts.min.json.

Colloquial / primary locality names (not official boundaries). Edit NAMES below and re-run:
  python3 scripts/generate_postcode_district_display_names.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GEO = ROOT / "data/geo/london_postcode_districts.min.json"
OUT = ROOT / "data/postcode_district_display_names.json"

# Primary recognisable locality per outward code (London coverage only).
NAMES = {
    "E1": "Whitechapel & Stepney",
    "E1W": "Wapping",
    "E2": "Bethnal Green",
    "E3": "Bow & Bromley-by-Bow",
    "E4": "Chingford",
    "E5": "Upper Clapton",
    "E6": "East Ham",
    "E7": "Forest Gate",
    "E8": "Hackney & Dalston",
    "E9": "Homerton & Hackney Wick",
    "E10": "Leyton",
    "E11": "Leytonstone & Wanstead",
    "E12": "Manor Park",
    "E13": "Plaistow & West Ham",
    "E14": "Isle of Dogs & Canary Wharf",
    "E15": "Stratford",
    "E16": "Silvertown & Victoria Dock",
    "E17": "Walthamstow",
    "E18": "South Woodford",
    "E20": "Queen Elizabeth Olympic Park",
    "EC1A": "Clerkenwell",
    "EC1M": "Clerkenwell",
    "EC1N": "Clerkenwell",
    "EC1R": "Farringdon",
    "EC1V": "Finsbury",
    "EC1Y": "Barbican",
    "EC2A": "Shoreditch",
    "EC2M": "Bishopsgate",
    "EC2N": "Broadgate",
    "EC2R": "Bank",
    "EC2V": "Guildhall",
    "EC2Y": "Barbican",
    "EC3A": "Aldgate",
    "EC3M": "City of London",
    "EC3N": "Tower Hill",
    "EC3R": "Monument",
    "EC3V": "Cornhill",
    "EC4A": "Holborn",
    "EC4M": "St Paul's",
    "EC4N": "Cannon Street",
    "EC4R": "Cannon Street",
    "EC4V": "Blackfriars",
    "EC4Y": "Temple",
    "N1": "Islington & Hoxton",
    "N1C": "King's Cross",
    "N2": "East Finchley",
    "N3": "Finchley",
    "N4": "Finsbury Park",
    "N5": "Highbury",
    "N6": "Highgate",
    "N7": "Holloway",
    "N8": "Hornsey & Crouch End",
    "N9": "Edmonton",
    "N10": "Muswell Hill",
    "N11": "New Southgate",
    "N12": "North Finchley",
    "N13": "Palmers Green",
    "N14": "Southgate",
    "N15": "South Tottenham",
    "N16": "Stoke Newington",
    "N17": "Tottenham",
    "N18": "Upper Edmonton",
    "N19": "Archway",
    "N20": "Whetstone",
    "N21": "Winchmore Hill",
    "N22": "Wood Green",
    "NW1": "Camden & Regent's Park",
    "NW2": "Cricklewood & Dollis Hill",
    "NW3": "Hampstead",
    "NW4": "Hendon",
    "NW5": "Kentish Town",
    "NW6": "Kilburn & West Hampstead",
    "NW7": "Mill Hill",
    "NW8": "St John's Wood",
    "NW9": "Kingsbury & Colindale",
    "NW10": "Willesden & Harlesden",
    "NW11": "Golders Green",
    "SE1": "South Bank & Bermondsey",
    "SE2": "Abbey Wood",
    "SE3": "Blackheath",
    "SE4": "Brockley",
    "SE5": "Camberwell",
    "SE6": "Catford",
    "SE7": "Charlton",
    "SE8": "Deptford",
    "SE9": "Eltham",
    "SE10": "Greenwich",
    "SE11": "Kennington",
    "SE12": "Lee & Grove Park",
    "SE13": "Lewisham",
    "SE14": "New Cross",
    "SE15": "Peckham",
    "SE16": "Rotherhithe & Surrey Quays",
    "SE17": "Walworth",
    "SE18": "Woolwich",
    "SE19": "Crystal Palace",
    "SE20": "Anerley & Penge",
    "SE21": "Dulwich",
    "SE22": "East Dulwich",
    "SE23": "Forest Hill",
    "SE24": "Herne Hill",
    "SE25": "South Norwood",
    "SE26": "Sydenham",
    "SE27": "West Norwood",
    "SE28": "Thamesmead",
    "SW1A": "Westminster",
    "SW1E": "St James's",
    "SW1H": "Westminster",
    "SW1P": "Westminster",
    "SW1V": "Pimlico",
    "SW1W": "Knightsbridge",
    "SW1X": "Belgravia",
    "SW1Y": "St James's",
    "SW2": "Brixton",
    "SW3": "Chelsea",
    "SW4": "Clapham",
    "SW5": "Earl's Court",
    "SW6": "Fulham",
    "SW7": "South Kensington",
    "SW8": "Nine Elms & Vauxhall",
    "SW9": "Stockwell",
    "SW10": "West Brompton",
    "SW11": "Battersea",
    "SW12": "Balham",
    "SW13": "Barnes",
    "SW14": "Mortlake & East Sheen",
    "SW15": "Putney",
    "SW16": "Streatham",
    "SW17": "Tooting",
    "SW18": "Wandsworth",
    "SW19": "Wimbledon",
    "SW20": "Raynes Park",
    "W1A": "West End",
    "W1B": "Mayfair",
    "W1C": "Oxford Street",
    "W1D": "Soho",
    "W1F": "Soho",
    "W1G": "Fitzrovia",
    "W1H": "Marylebone",
    "W1J": "Mayfair",
    "W1K": "Mayfair",
    "W1S": "Mayfair",
    "W1T": "Fitzrovia",
    "W1U": "Marylebone",
    "W1W": "Fitzrovia",
    "W2": "Paddington & Bayswater",
    "W3": "Acton",
    "W4": "Chiswick",
    "W5": "Ealing",
    "W6": "Hammersmith",
    "W7": "Hanwell",
    "W8": "Kensington",
    "W9": "Maida Vale",
    "W10": "North Kensington",
    "W11": "Notting Hill",
    "W12": "Shepherd's Bush",
    "W13": "West Ealing",
    "W14": "West Kensington",
    "WC1A": "Bloomsbury",
    "WC1B": "Bloomsbury",
    "WC1E": "Bloomsbury",
    "WC1H": "Kings Cross",
    "WC1N": "Bloomsbury",
    "WC1R": "Holborn",
    "WC1V": "Holborn",
    "WC1X": "Clerkenwell",
    "WC2A": "Strand",
    "WC2B": "Holborn",
    "WC2E": "Covent Garden",
    "WC2H": "Leicester Square",
    "WC2N": "Trafalgar Square",
    "WC2R": "Embankment",
}


def main():
    geo = json.loads(GEO.read_text(encoding="utf-8"))
    codes = sorted({(f.get("properties") or {}).get("name", "").strip().upper() for f in geo.get("features") or []})
    codes = [c for c in codes if c]
    out = {}
    missing = []
    for c in codes:
        if c in NAMES:
            out[c] = NAMES[c]
        elif c == "UNKNOWN":
            out[c] = "Unknown"
        else:
            missing.append(c)
            out[c] = c  # fallback: show code
    if missing:
        print("WARN: add NAMES for:", ", ".join(missing))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {len(out)} entries to {OUT}")


if __name__ == "__main__":
    main()
