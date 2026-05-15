#!/usr/bin/env python3
"""
Discover website domain/host → operator patterns from labeled pubs.

Uses rows where both ``operator`` and ``website`` are set to learn rules,
then reports what operator could be inferred for pubs missing ``operator``.

Does NOT update the CSV unless you pass ``--write`` (off by default).

Usage
-----
  python3 scripts/discover_operator_website_patterns.py

  python3 scripts/discover_operator_website_patterns.py \\
    -i data/data_list_photos_enriched.csv \\
    -o data/operator_website_patterns_report.csv

  # After you agree with suggestions:
  python3 scripts/discover_operator_website_patterns.py --write
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def norm_host(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return ""
    if not u.startswith(("http://", "https://")):
        u = "https://" + u
    try:
        h = urlparse(u).netloc.lower()
        if h.startswith("www."):
            h = h[4:]
        return h
    except Exception:
        return ""


def registrable_domain(host: str) -> str:
    """
    Best-effort registrable domain (e.g. greeneking.co.uk, co.uk second-level).
  """
    if not host:
        return ""
    parts = host.split(".")
    if len(parts) <= 2:
        return host
    # co.uk, org.uk, com.au, etc.
    if len(parts) >= 3 and parts[-2] in ("co", "org", "ac", "gov", "ltd") and parts[-1] == "uk":
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def host_matches(h: str, domain: str) -> bool:
    return h == domain or h.endswith("." + domain)


# Known chain hosts (from normalize_operator_from_chain_website.py) — always include in report
KNOWN_CHAIN_HOSTS: Dict[str, str] = {
    "jdwetherspoon.com": "Wetherspoon",
    "greeneking.co.uk": "Greene King",
    "greeneking.com": "Greene King",
    "youngs.co.uk": "Young's",
    "nicholsonspubs.co.uk": "Nicholson's",
    "nicholsons.co.uk": "Nicholson's",
    "urbanpubsandbars.com": "Urban Pubs & Bars",
    "fullers.co.uk": "Fuller's",
    "fuller.co.uk": "Fuller's",
    "stonegatepubs.co.uk": "Stonegate",
    "stonegatepubcompany.com": "Stonegate",
    "mitchellsbutlers.com": "Mitchells & Butlers",
    "mbplc.com": "Mitchells & Butlers",
    "shepherdneame.co.uk": "Shepherd Neame",
    "brewdog.com": "BrewDog",
    "emberinns.co.uk": "Ember Inns",
    "oneills.co.uk": "O'Neill's",
    "hall-woodhouse.co.uk": "Hall & Woodhouse",
    "hallandwoodhouse.co.uk": "Hall & Woodhouse",
    "samuelsmithsbrewery.co.uk": "Samuel Smith",
    "remarkablepubs.com": "Remarkable Pubs",
    "electricstarbars.com": "Electric Star Pubs",
    "anticlondon.com": "Antic London",
    "davy.co.uk": "Davy's",
    "taylor-walker.co.uk": "Taylor Walker",
    "taylorwalker.co.uk": "Taylor Walker",
    "marstons.co.uk": "Marston's",
    "mcmullens.co.uk": "McMullen's",
    "mcmullenspubs.co.uk": "McMullen's",
    # User-confirmed groups
    "cubitthouse.co.uk": "Cubitt House",
    "bellepubsandrestaurants.co.uk": "Belle Pubs & Restaurants",
    "locipubs.com": "Loci Pubs",
    "thechaptercollection.co.uk": "The Chapter Collection",
    "butcombe.com": "Butcombe Pubs",
    "craftunionpubs.com": "Stonegate",
    "socialpubandkitchen.co.uk": "Stonegate",
    "greatlocalpubs.co.uk": "Stonegate",
    "stonegatepubpartners.co.uk": "Stonegate",
}

# Not real pub websites — flag for cleanup (do not infer operator)
INVALID_WEBSITE_DOMAINS = frozenset({
    "lemonrock.com",
    "facebook.com",
    "edan.io",
    "weeblyte.com",
    "bloomsburylondon.com",
    "weebly.com",
    "wixsite.com",
    "business.site",
    "wordpress.com",
})


def operator_for_known_host(host: str) -> Optional[str]:
    for domain, op in KNOWN_CHAIN_HOSTS.items():
        if host_matches(host, domain):
            return op
    return None


def learn_patterns(
    labeled: List[Dict[str, str]],
    min_labeled: int = 3,
    min_purity: float = 0.85,
) -> Tuple[List[Dict], List[Dict]]:
    """
    Learn host-level and domain-level patterns from labeled rows.
    Returns (patterns, conflicts).
    """
    by_host: Dict[str, Counter] = defaultdict(Counter)
    by_domain: Dict[str, Counter] = defaultdict(Counter)

    for row in labeled:
        op = (row.get("operator") or "").strip()
        host = norm_host(row.get("website") or "")
        if not op or not host:
            continue
        by_host[host][op] += 1
        dom = registrable_domain(host)
        if dom:
            by_domain[dom][op] += 1

    patterns: List[Dict] = []
    conflicts: List[Dict] = []

    def add_pattern(kind: str, key: str, counts: Counter) -> None:
        total = sum(counts.values())
        if total < min_labeled:
            return
        top_op, top_n = counts.most_common(1)[0]
        purity = top_n / total
        if purity < min_purity:
            if len(counts) > 1:
                conflicts.append({
                    "pattern_type": kind,
                    "pattern_key": key,
                    "total_labeled": total,
                    "top_operator": top_op,
                    "purity": f"{purity:.2f}",
                    "operators": "; ".join(f"{o}({n})" for o, n in counts.most_common(5)),
                })
            return
        patterns.append({
            "pattern_type": kind,
            "pattern_key": key,
            "operator": top_op,
            "labeled_count": total,
            "purity": f"{purity:.2f}",
            "source": "learned",
        })

    for host, counts in sorted(by_host.items(), key=lambda x: -sum(x[1].values())):
        add_pattern("host", host, counts)

    for dom, counts in sorted(by_domain.items(), key=lambda x: -sum(x[1].values())):
        add_pattern("domain", dom, counts)

    # Inject known chain rules (override / supplement)
    seen_keys = {(p["pattern_type"], p["pattern_key"]) for p in patterns}
    for domain, op in KNOWN_CHAIN_HOSTS.items():
        key = ("domain", domain)
        if key in seen_keys:
            continue
        # Count how many labeled rows match this known domain
        n = sum(
            1
            for row in labeled
            if host_matches(norm_host(row.get("website") or ""), domain)
            and (row.get("operator") or "").strip() == op
        )
        n_any = sum(
            1
            for row in labeled
            if host_matches(norm_host(row.get("website") or ""), domain)
        )
        if n_any >= 1:
            patterns.append({
                "pattern_type": "domain",
                "pattern_key": domain,
                "operator": op,
                "labeled_count": n_any,
                "purity": f"{(n / n_any):.2f}" if n_any else "0",
                "source": "known_rule",
            })

    # Dedupe: prefer host over domain when both exist for same operator match
    patterns.sort(key=lambda p: (-int(p["labeled_count"]), p["pattern_type"], p["pattern_key"]))
    return patterns, conflicts


def match_operator(
    website: str,
    patterns: List[Dict],
) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Return (operator, pattern_type, pattern_key) for a website URL.
    Prefer exact host match, then domain, then known rules.
    """
    host = norm_host(website)
    if not host:
        return None, None, None

    known = operator_for_known_host(host)
    if known:
        dom = registrable_domain(host)
        for d, op in KNOWN_CHAIN_HOSTS.items():
            if host_matches(host, d) and op == known:
                return known, "domain", d
        return known, "known_host", host

    host_patterns = {p["pattern_key"]: p for p in patterns if p["pattern_type"] == "host"}
    if host in host_patterns:
        p = host_patterns[host]
        return p["operator"], "host", host

    dom = registrable_domain(host)
    domain_patterns = {p["pattern_key"]: p for p in patterns if p["pattern_type"] == "domain"}
    if dom in domain_patterns:
        p = domain_patterns[dom]
        return p["operator"], "domain", dom

    return None, None, None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "-i", "--input",
        type=Path,
        default=repo_root() / "data" / "data_list_photos_enriched.csv",
    )
    parser.add_argument(
        "-o", "--patterns-output",
        type=Path,
        default=repo_root() / "data" / "operator_website_patterns.csv",
        help="Learned patterns table",
    )
    parser.add_argument(
        "--suggestions-output",
        type=Path,
        default=repo_root() / "data" / "operator_website_suggestions.csv",
        help="Per-pub suggestions for empty operator",
    )
    parser.add_argument("--min-labeled", type=int, default=3, help="Min pubs to learn a pattern")
    parser.add_argument("--min-purity", type=float, default=0.85, help="Min share for one operator")
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write suggested operator into input CSV (only where operator is empty)",
    )
    args = parser.parse_args()

    if not args.input.is_file():
        print(f"Input not found: {args.input}", file=sys.stderr)
        return 1

    with args.input.open(encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = [dict(r) for r in reader]

    labeled = [
        r for r in rows
        if (r.get("operator") or "").strip() and (r.get("website") or "").strip()
    ]
    missing_op = [
        r for r in rows
        if not (r.get("operator") or "").strip() and (r.get("website") or "").strip()
    ]

    patterns, conflicts = learn_patterns(
        labeled, min_labeled=args.min_labeled, min_purity=args.min_purity
    )

    # Suggestions for pubs without operator
    suggestions: List[Dict[str, str]] = []
    for row in missing_op:
        op, ptype, pkey = match_operator(row.get("website") or "", patterns)
        if not op:
            continue
        suggestions.append({
            "id": row.get("id", ""),
            "name": row.get("name", ""),
            "website": row.get("website", ""),
            "calc_postcode_district": row.get("calc_postcode_district", ""),
            "suggested_operator": op,
            "match_pattern_type": ptype or "",
            "match_pattern_key": pkey or "",
            "current_operator": row.get("operator", ""),
        })

    # Validate suggestions against labeled data (would we disagree?)
    disagreements = 0
    for row in labeled:
        sug_op, _, _ = match_operator(row.get("website") or "", patterns)
        actual = (row.get("operator") or "").strip()
        if sug_op and actual and sug_op != actual:
            disagreements += 1

    # Write pattern files
    args.patterns_output.parent.mkdir(parents=True, exist_ok=True)
    pat_fields = ["pattern_type", "pattern_key", "operator", "labeled_count", "purity", "source"]
    with args.patterns_output.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=pat_fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(patterns)

    sug_fields = [
        "id", "name", "website", "calc_postcode_district",
        "suggested_operator", "match_pattern_type", "match_pattern_key", "current_operator",
    ]
    with args.suggestions_output.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=sug_fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(suggestions)

    # Console report
    print(f"Input: {args.input}")
    print(f"Total pubs: {len(rows)}")
    print(f"Labeled (operator + website): {len(labeled)}")
    print(f"Missing operator but has website: {len(missing_op)}")
    print()
    print(f"Learned patterns (≥{args.min_labeled} pubs, ≥{args.min_purity:.0%} purity): {len(patterns)}")
    print(f"Ambiguous domains/hosts (below purity): {len(conflicts)}")
    print(f"Suggestions for empty operator: {len(suggestions)}")
    print(f"Labeled rows where pattern disagrees with actual operator: {disagreements}")
    print()
    print("Top learned patterns by labeled_count:")
    for p in patterns[:25]:
        if p.get("source") == "learned":
            print(
                f"  [{p['pattern_type']}] {p['pattern_key']:<40} → {p['operator']:<22} "
                f"n={p['labeled_count']} purity={p['purity']}"
            )
    print()
    print("Known chain domain rules in catalog:", len(KNOWN_CHAIN_HOSTS))
    print()
    by_op = Counter(s["suggested_operator"] for s in suggestions)
    print("Suggestions by operator:")
    for op, n in by_op.most_common(20):
        print(f"  {n:4}  {op}")
    print()
    print(f"Wrote patterns  → {args.patterns_output}")
    print(f"Wrote suggestions → {args.suggestions_output}")

    if conflicts:
        print("\nSample ambiguous patterns (review before trusting):")
        for c in conflicts[:10]:
            print(f"  [{c['pattern_type']}] {c['pattern_key']}: {c['operators']}")

    if args.write:
        written = 0
        for row in rows:
            if (row.get("operator") or "").strip():
                continue
            op, _, _ = match_operator(row.get("website") or "", patterns)
            if op:
                row["operator"] = op
                written += 1
        with args.input.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
        print(f"\n--write: updated operator on {written} rows in {args.input}")
    else:
        print("\n(No CSV changes — run with --write after you agree.)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
