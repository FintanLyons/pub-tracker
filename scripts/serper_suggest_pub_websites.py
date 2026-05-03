#!/usr/bin/env python3
"""
Suggest pub websites via Serper (Google) for rows missing `website`.

This script NEVER overwrites your master CSV. It writes a review CSV with:
- the Serper query used
- the chosen URL + a few alternates
- confidence: model 0..1 when OpenAI primary path wins, or when heuristic wins and
  optional single-URL AI verify + location gate pass (see notes column)
- HTTP validation status (similar spirit to earlier checks)

Env
---
  SERPER_API_KEY=...   (required)

Optional:
  Load `.env` from repo root if present (does not print secrets).

OpenAI reranking (default on):
  OPENAI_API_KEY=...   (required unless you pass --no-use-openai)
  OPENAI_MODEL=gpt-4.1-mini   (optional; also configurable via --openai-model)

Defaults match a typical London OSM review run: OpenAI on, geo off in Serper query,
Serper -site: negatives off, intelligent URL trim + location gate on. You still pass
--input, --output, and usually --limit / --only-osm-rows explicitly.

Example (20 pubs, OSM rows only):
  python3 scripts/serper_suggest_pub_websites.py \\
    --input data/osm_london_pubs_combined.csv \\
    --output data/serper_website_suggestions_test20.csv \\
    --limit 20 \\
    --only-osm-rows

Example (larger slice, same defaults):
  python3 scripts/serper_suggest_pub_websites.py \\
    --input data/osm_london_pubs_combined.csv \\
    --output data/serper_website_suggestions_osm_test100.csv \\
    --only-osm-rows \\
    --limit 100

Example (last 20 eligible rows in file order, use --tail):
  python3 scripts/serper_suggest_pub_websites.py \\
    --input data/osm_london_pubs_combined.csv \\
    --output data/serper_website_suggestions_tail20.csv \\
    --limit 20 \\
    --tail \\
    --only-osm-rows
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

_REPO_ROOT = Path(__file__).resolve().parents[1]
_SERPER_URL = "https://google.serper.dev/search"


def load_dotenv_simple(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def norm_tokens(s: str) -> List[str]:
    s = (s or "").lower()
    s = re.sub(r"['`’]", "", s)
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if s.startswith("the "):
        s = s[4:].strip()
    toks = [t for t in s.split() if t]
    # drop very short noise tokens
    return [t for t in toks if len(t) >= 3]


def is_directory_url(url: str) -> bool:
    u = (url or "").lower()
    needles = (
        "tripadvisor.",
        "facebook.",
        "instagram.",
        "tiktok.com",
        "youtube.com",
        "youtu.be",
        "reddit.com",
        "pinterest.",
        "linkedin.com",
        "yelp.",
        "timeout.com",
        "designmynight.",
        "squarespace.",
        "wikipedia.org",
        "wikidata.org",
        "google.com/maps",
        "goo.gl/maps",
        "maps.app.goo.gl",
        "booking.com",
        "airbnb.",
        "opentable.",
        "campra",  # user-requested penalization token (substring match)
        "camra",  # CAMRA / WhatPub style listings (substring match)
        "ratings.food.gov.uk",  # FSA hygiene listing, not venue website
        "maps.apple",  # Apple Maps place links, not pub-owned site
        "goingout.co.uk",  # listings / going out aggregator
        # Pub / listing aggregators (user list; substring match on full URL)
        "pubology.",
        "useyourlocal.com",
        "pubsgalore",
        "publocation.uk",
        "beerguideldn.com",
        "publove.",
        "inapub.co.uk",
        "platepic.co.uk",
        "travelxchange",
        "london-se1.co.uk",
        "theukhighstreet.com",
        "tumblr.com",
        "flickr.com",
        "foodhygienerating.co.uk",
        "://x.com",  # not bare "x.com" (avoids e.g. anthrax.com)
        "beerintheevening.com",
        "pubwiki.co.uk",
        "folkandhoney.co.uk",
        "desdemoor.co.uk",
        "barcrawl.co.uk",
    )
    return any(n in u for n in needles)


def is_bad_path(url: str) -> bool:
    p = (urllib.parse.urlparse(url).path or "").lower()
    needles = (
        "/contact",
        "/contact-us",
        "/contactus",
        "/privacy",
        "/cookies",
        "/terms",
        "/booking",
        "/book-",
        "/book/",
        "/menu",
        "/menus",
        "/careers",
        "/jobs",
        "/login",
        "/signin",
        "/signup",
        "/basket",
        "/cart",
        "/checkout",
        "/history",
    )
    return any(n in p for n in needles)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def parse_lat_lon(row: Dict[str, str]) -> Optional[Tuple[float, float]]:
    try:
        lat = float((row.get("lat") or "").strip())
        lon = float((row.get("lon") or "").strip())
    except Exception:
        return None
    if not (math.isfinite(lat) and math.isfinite(lon)):
        return None
    return lat, lon


def format_address_bits(row: Dict[str, str]) -> str:
    hn = (row.get("addr_housenumber") or "").strip()
    st = (row.get("addr_street") or "").strip()
    bits = [b for b in [hn, st] if b]
    return " ".join(bits).strip()


def prefer_https(url: str) -> str:
    u = (url or "").strip()
    if u.startswith("http://"):
        return "https://" + u[len("http://") :]
    return u


def unwrap_google_redirect(url: str) -> str:
    try:
        p = urllib.parse.urlparse(url)
    except Exception:
        return url
    host = (p.netloc or "").lower()
    if "google." in host and (p.path or "").startswith("/url"):
        qs = urllib.parse.parse_qs(p.query or "")
        for k in ("q", "url"):
            if k in qs and qs[k] and qs[k][0]:
                return qs[k][0]
    return url


def http_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(total=2, connect=2, read=2, status=0, backoff_factor=0.2, allowed_methods=["HEAD", "GET"])
    s.mount("http://", HTTPAdapter(max_retries=retry))
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.headers.update({"User-Agent": "pub-tracker-serper-suggest/1.0"})
    return s


def validate_url(sess: requests.Session, url: str) -> Tuple[str, str]:
    """
    Return (status_text, final_url_or_empty_on_hard_fail).
    Success if numeric status < 400.
    """
    u = prefer_https(unwrap_google_redirect(url))
    if not u.startswith("http"):
        return "invalid_url", ""

    status_text = "error"
    final_url = ""
    try:
        resp = sess.head(u, allow_redirects=True, timeout=8)
        code = resp.status_code
        final_url = resp.url or u
        status_text = str(code)

        if code in (403, 405, 406, 429):
            resp2 = sess.get(u, allow_redirects=True, timeout=12, stream=True)
            code2 = resp2.status_code
            final_url = resp2.url or u
            status_text = str(code2)
            resp2.close()
    except requests.exceptions.Timeout:
        status_text = "timeout"
    except requests.exceptions.SSLError:
        status_text = "ssl_error"
    except requests.exceptions.ConnectionError:
        status_text = "connection_error"
    except requests.exceptions.RequestError:
        status_text = "request_error"

    return status_text, final_url


# Last path segment stems we may strip upward (validated parent) — not venue slugs
# like /brand-directory/the-cross-keys or /pubs/foo.
_DISPOSABLE_LAST_SEGMENTS = frozenset(
    {
        "about",
        "about-us",
        "basket",
        "book",
        "booking",
        "bookings",
        "careers",
        "cart",
        "checkout",
        "contact",
        "contact-us",
        "contactus",
        "cookies",
        "drink",
        "drinks",
        "faq",
        "faqs",
        "food",
        "history",
        "jobs",
        "login",
        "menu",
        "menus",
        "privacy",
        "privacy-policy",
        "register",
        "signin",
        "signup",
        "sitemap",
        "terms",
        "terms-and-conditions",
        "terms-of-use",
    }
)


def _path_segment_stem(seg: str) -> str:
    s = (seg or "").strip().lower()
    s = re.sub(r"\.(html?|php|aspx|jsp)$", "", s, flags=re.I)
    return s


def trim_disposable_url_suffixes(sess: requests.Session, url: str, enabled: bool) -> str:
    """
    Walk upward only while the **last** path segment is a disposable utility page
    (contact, menu, privacy, …). Does **not** flatten arbitrary paths to the domain
    root, so /brand-directory/the-cross-keys stays intact.
    """
    if not enabled:
        return url
    u = prefer_https(unwrap_google_redirect((url or "").strip()))
    if not u.startswith("http"):
        return u
    for _ in range(8):
        try:
            p = urllib.parse.urlparse(u)
        except Exception:
            break
        if p.scheme not in ("http", "https") or not p.netloc:
            break
        parts = [s for s in (p.path or "").split("/") if s]
        if not parts:
            break
        stem = _path_segment_stem(parts[-1])
        if stem not in _DISPOSABLE_LAST_SEGMENTS:
            break
        parent_parts = parts[:-1]
        new_path = "/" + "/".join(parent_parts) if parent_parts else "/"
        candidate = urllib.parse.urlunparse((p.scheme, p.netloc, new_path, "", "", ""))
        st, fin = validate_url(sess, candidate)
        if not (st.isdigit() and int(st) < 400 and fin):
            break
        u = prefer_https(unwrap_google_redirect(fin)).strip()
    return u


def fetch_html_snippet(sess: requests.Session, url: str, max_bytes: int = 350_000) -> Tuple[str, str]:
    """
    Return (final_url, html_prefix). Empty html on failure.
    """
    u = prefer_https(unwrap_google_redirect(url))
    if not u.startswith("http"):
        return "", ""
    try:
        resp = sess.get(u, allow_redirects=True, timeout=12, stream=True)
        final = resp.url or u
        chunks: List[bytes] = []
        total = 0
        for chunk in resp.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            chunks.append(chunk)
            total += len(chunk)
            if total >= max_bytes:
                break
        resp.close()
        raw = b"".join(chunks)
        text = raw.decode("utf-8", errors="ignore")
        return final, text[:120_000]
    except Exception:
        return "", ""


def page_evidence_score(pub_name: str, addr_bits: str, district: str, html: str) -> float:
    if not html:
        return 0.0
    blob = re.sub(r"\s+", " ", html.lower())
    score = 0.0

    for t in norm_tokens(pub_name):
        if len(t) >= 4 and t in blob:
            score += 2.0

    pc = re.findall(r"\b([a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2})\b", blob)
    if pc:
        score += 1.0

    if district:
        d = district.strip().lower()
        if d and d in blob.replace(" ", ""):
            score += 2.0

    for t in norm_tokens(addr_bits):
        if len(t) >= 5 and t in blob:
            score += 1.0

    return score


def compact_uk_postcode(pc: str) -> str:
    """Normalize UK postcode for substring search (no spaces, lower)."""
    s = re.sub(r"\s+", "", (pc or "").strip().upper())
    return s.lower() if s else ""


def html_coords_within_m(html: str, ll: Optional[Tuple[float, float]], max_m: float) -> bool:
    if not html or not ll:
        return False
    lat_s, lon_s = ll
    m = re.search(r"(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)", html)
    if not m:
        return False
    try:
        plat = float(m.group(1))
        plon = float(m.group(2))
        return haversine_m(lat_s, lon_s, plat, plon) <= max_m
    except Exception:
        return False


def row_has_location_anchors(row: Dict[str, str]) -> bool:
    if compact_uk_postcode((row.get("calc_postcode") or "").strip()):
        return True
    if (row.get("calc_postcode_district") or "").strip():
        return True
    if (row.get("addr_housenumber") or "").strip():
        return True
    if (row.get("addr_street") or "").strip():
        return True
    return False


def page_location_matches_row(
    row: Dict[str, str],
    html: str,
    ll: Optional[Tuple[float, float]],
) -> Tuple[bool, str]:
    """
    Decide whether page text is plausibly the same pub as ``row`` using postcode,
    district, address tokens, or embedded coordinates near the known lat/lon.
    When the row has no postcode/district/street anchors, returns (True, no_anchors).
    """
    if not row_has_location_anchors(row):
        return True, "no_anchors"

    if not (html or "").strip():
        return False, "empty_html"

    blob = re.sub(r"\s+", " ", html.lower())
    blob_ns = re.sub(r"\s+", "", blob)

    full_pc = compact_uk_postcode((row.get("calc_postcode") or "").strip())
    district = (row.get("calc_postcode_district") or "").strip().lower()
    hn = (row.get("addr_housenumber") or "").strip().lower()
    street = (row.get("addr_street") or "").strip().lower()
    addr_bits = format_address_bits(row)

    if full_pc and full_pc in blob_ns:
        return True, "full_postcode"

    if html_coords_within_m(html, ll, max_m=750.0):
        return True, "near_coords"

    dist_ok = False
    if district:
        dist_ok = bool(re.search(rf"(?<![a-z0-9]){re.escape(district)}(?![a-z0-9])", blob, re.I))

    strong = [
        t
        for t in norm_tokens(f"{addr_bits} {street}")
        if len(t) >= 5
    ]
    addr_hits = sum(1 for t in strong if t in blob)

    hn_ok = False
    if hn:
        if hn.isdigit():
            hn_ok = bool(re.search(rf"(?<!\d){re.escape(hn)}(?!\d)", blob))
        else:
            hn_ok = hn in blob

    if dist_ok and (addr_hits >= 1 or hn_ok):
        return True, "district+address"

    if addr_hits >= 2:
        return True, "address_tokens"

    if hn_ok and addr_hits >= 1:
        return True, "houseno+street"

    # Full postcode expected on authoritative pages; allow district+addr if PC absent on page
    if full_pc and dist_ok and (addr_hits >= 1 or hn_ok):
        return True, "district+address_no_full_pc_on_page"

    # Only outward district on row (no full PC, no street/house): need geo or fail.
    if district and not full_pc and not hn and not (street or "").strip():
        if dist_ok and html_coords_within_m(html, ll, max_m=2000.0):
            return True, "district_only+geo"
        return False, "district_only_no_geo"

    return False, "no_location_match"


def openai_pick_best_candidate(
    *,
    api_key: str,
    model: str,
    pub: Dict[str, str],
    candidates: List[Dict[str, object]],
) -> Tuple[str, float, str]:
    """
    Returns (chosen_url, confidence_0_1, raw_json_notes)
    """
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You help pick the best website URL for a specific UK pub. "
                    "You will be given structured pub fields and a list of candidate URLs with metadata. "
                    "Return STRICT JSON with keys: chosen_url (string or empty), confidence (number 0..1), "
                    "reason (short string). "
                    "If none are clearly the pub's website (or its operator/brand site when appropriate), "
                    "return chosen_url as empty string. "
                    "Never choose social networks or obvious aggregators. "
                    "When postcode or address is given, prefer a candidate whose page mentions that postcode "
                    "or street (or coordinates very close to the pub) over a same-name venue elsewhere."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "pub": pub,
                        "candidates": candidates,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
    }
    r = requests.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload, timeout=60)
    r.raise_for_status()
    data = r.json()
    txt = data["choices"][0]["message"]["content"]
    obj = json.loads(txt)
    chosen = str(obj.get("chosen_url") or "").strip()
    conf = max(0.0, min(1.0, float(obj.get("confidence") or 0.0)))
    reason = str(obj.get("reason") or "").strip()
    return chosen, conf, reason


def html_text_excerpt(html: str, max_chars: int = 4500) -> str:
    """Lightweight de-tag for OpenAI context (not a full HTML parser)."""
    if not html:
        return ""
    t = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    t = re.sub(r"<style[\s\S]*?</style>", " ", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:max_chars]


def openai_verify_heuristic_pick(
    *,
    api_key: str,
    model: str,
    pub: Dict[str, str],
    verified_url: str,
    page_text_excerpt: str,
) -> Tuple[bool, float, str]:
    """
    Ask OpenAI to confirm the heuristic-chosen URL for this pub.
    Returns (accept, confidence_0_1, reason).
    """
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You verify whether ONE URL is an appropriate official web presence for a single UK pub "
                    "(the venue's own site, or an operator/chain page clearly for that venue — not a whole-area "
                    "tourism or BID homepage unless the excerpt is clearly about this named pub at this address). "
                    "Return STRICT JSON with keys: accept (boolean), confidence (number 0..1 meaningful only if "
                    "accept is true), reason (short string). If wrong venue, wrong city, or only generic area marketing, "
                    "set accept to false and confidence to 0."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "pub": pub,
                        "candidate_url": verified_url,
                        "page_text_excerpt": page_text_excerpt,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
    }
    r = requests.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload, timeout=60)
    r.raise_for_status()
    data = r.json()
    txt = data["choices"][0]["message"]["content"]
    obj = json.loads(txt)
    accept = bool(obj.get("accept"))
    conf = max(0.0, min(1.0, float(obj.get("confidence") or 0.0)))
    reason = str(obj.get("reason") or "").strip()
    if not accept:
        return False, 0.0, reason or "rejected"
    return True, conf, reason


def canonical_url_variants(url: str, max_variants: int = 4) -> List[str]:
    """
    Generate a small set of URLs to try, preferring less 'leafy' paths like /contact.
    """
    u = prefer_https(unwrap_google_redirect(url))
    try:
        p = urllib.parse.urlparse(u)
    except Exception:
        return [u]

    if p.scheme not in ("http", "https") or not p.netloc:
        return [u]

    out: List[str] = []
    seen = set()

    def add(x: str) -> None:
        x = prefer_https(unwrap_google_redirect(x)).strip()
        if x and x not in seen:
            seen.add(x)
            out.append(x)

    add(u)

    path = p.path or ""
    parts = [seg for seg in path.split("/") if seg]
    # progressively strip last segments (common for /contact etc.)
    for drop in (1, 2, 3):
        if len(parts) <= drop:
            break
        new_parts = parts[: len(parts) - drop]
        new_path = "/" + "/".join(new_parts) if new_parts else "/"
        rebuilt = urllib.parse.urlunparse((p.scheme, p.netloc, new_path, "", "", ""))
        add(rebuilt)
        if len(out) >= max_variants:
            break

    # root homepage as a strong fallback
    root = urllib.parse.urlunparse((p.scheme, p.netloc, "/", "", "", ""))
    add(root)

    return out[:max_variants]


def score_candidate(pub_name: str, url: str) -> float:
    """
    Higher is better. Directories should be heavily penalized (caller may discard).
    """
    u = unwrap_google_redirect(prefer_https(url))
    try:
        p = urllib.parse.urlparse(u)
    except Exception:
        return -1e9

    if p.scheme not in ("http", "https"):
        return -1e9

    host = (p.netloc or "").lower().replace("www.", "")
    if is_directory_url(u):
        return -1e6

    score = 0.0
    if p.scheme == "https":
        score += 5.0

    name_toks = set(norm_tokens(pub_name))
    dom = re.sub(r"^www\.", "", (p.netloc or "").lower())
    dom_body = dom.split(":")[0]
    dom_parts = re.split(r"[.\-]", dom_body)
    dom_toks = {t for t in dom_parts if len(t) >= 3}

    overlap = len(name_toks & dom_toks)
    score += 8.0 * overlap

    # partial token containment (weak)
    for t in name_toks:
        if len(t) >= 5 and t in dom_body:
            score += 3.0

    path = (p.path or "").lower()
    if is_bad_path(u):
        score -= 6.0

    # tiny preference for shorter paths (homepages) when names are generic
    depth = len([x for x in (p.path or "").split("/") if x])
    score += max(0.0, 3.0 - 0.6 * depth)

    return score


def build_queries(row: Dict[str, str], include_geo: bool, include_negatives: bool) -> List[str]:
    """
    Return a list of Serper queries to try in order (strict -> looser).
    """
    name = (row.get("name") or "").strip()
    district = (row.get("calc_postcode_district") or "").strip()
    city = (row.get("addr_city") or "").strip() or "London"
    addr = format_address_bits(row)
    neg = (
        "-site:tiktok.com -site:youtube.com -site:reddit.com -site:pinterest.com -site:linkedin.com "
        "-site:camra.org.uk -site:ratings.food.gov.uk -site:maps.apple.com -site:goingout.co.uk "
        "-site:pubology.co.uk -site:useyourlocal.com -site:pubsgalore.co.uk -site:publocation.uk "
        "-site:beerguideldn.com -site:inapub.co.uk -site:platepic.co.uk -site:travelxchange.com "
        "-site:london-se1.co.uk -site:theukhighstreet.com -site:tumblr.com -site:flickr.com "
        "-site:foodhygienerating.co.uk -site:x.com -site:beerintheevening.com -site:pubwiki.co.uk "
        "-site:folkandhoney.co.uk -site:desdemoor.co.uk -site:barcrawl.co.uk "
        "-site:publove.com -site:publove.co.uk"
    )
    neg_part = f" {neg}" if include_negatives else ""

    geo = ""
    if include_geo:
        ll = parse_lat_lon(row)
        if ll:
            lat, lon = ll
            geo = f" near {lat:.5f},{lon:.5f}"

    addr_part = f" {addr}" if addr else ""

    strict = f'"{name}" pub {city}{addr_part} {district}{geo}{neg_part}'.strip()
    mid = f"{name} pub {city} {district}{geo}{neg_part}".strip()
    loose = f"{name} {city} {district} pub{neg_part}".strip()
    bare = f"{name} {district} pub{neg_part}".strip()

    out: List[str] = []
    for q in (strict, mid, loose, bare):
        if q not in out:
            out.append(q)
    return out


def serper_search(sess: requests.Session, api_key: str, q: str) -> Tuple[List[dict], Dict[str, object]]:
    headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}
    body = {"q": q, "num": 10, "gl": "uk", "hl": "en"}
    r = sess.post(_SERPER_URL, headers=headers, json=body, timeout=30)
    r.raise_for_status()
    data = r.json()
    organic = data.get("organic") or []
    if not isinstance(organic, list):
        return [], data
    return [x for x in organic if isinstance(x, dict)], data


def pick_and_validate(
    http_sess: requests.Session,
    row: Dict[str, str],
    organic: Sequence[dict],
    max_validate: int,
    use_openai: bool,
    openai_key: str,
    openai_model: str,
    intelligent_url_trim: bool,
    require_openai_location: bool,
    verify_heuristic_with_openai: bool,
) -> Tuple[str, str, str, float, List[str], str]:
    """
    Returns:
      chosen_url, chosen_original, validation_status, confidence (0..1 from primary
      OpenAI pick, or from heuristic + single-URL verify when that passes), alternates, notes
    """
    candidates: List[Tuple[float, str, str]] = []
    notes: List[str] = []

    pub_name = (row.get("name") or "").strip()
    district = (row.get("calc_postcode_district") or "").strip()
    addr_bits = format_address_bits(row)
    ll = parse_lat_lon(row)

    for item in organic:
        link = (item.get("link") or "").strip()
        if not link:
            continue
        orig = link
        link = unwrap_google_redirect(prefer_https(link))
        if is_directory_url(link):
            continue
        sc = score_candidate(pub_name, link)
        title = (item.get("title") or "").strip()
        snippet = (item.get("snippet") or "").strip()
        blob = f"{title}\n{snippet}".lower()
        for t in norm_tokens(pub_name):
            if len(t) >= 4 and t in blob:
                sc += 1.5
        if district and district.lower() in blob.replace(" ", ""):
            sc += 1.5
        for t in norm_tokens(addr_bits):
            if len(t) >= 5 and t in blob:
                sc += 1.0
        candidates.append((sc, link, orig))

    candidates.sort(key=lambda t: t[0], reverse=True)
    if not candidates:
        return "", "", "no_serper_results", 0.0, [], "no_organic_links"

    # If top is heavily penalized directory score, still try next ones.
    alternates: List[str] = []
    for sc, link, orig in candidates[: max_validate * 3]:
        if sc < -1e5:
            continue
        alternates.append(link)

    # Optional: ask OpenAI to choose among top few distinct URLs (after light canonicalization)
    if use_openai and openai_key:
        top_for_ai: List[Tuple[float, str, str]] = []
        seen_urls = set()
        for sc, link, orig in candidates:
            if sc < -1e5:
                continue
            if link in seen_urls:
                continue
            seen_urls.add(link)
            top_for_ai.append((sc, link, orig))
            if len(top_for_ai) >= 6:
                break

        title_by_url: Dict[str, str] = {}
        snippet_by_url: Dict[str, str] = {}
        for item in organic:
            u0 = unwrap_google_redirect(prefer_https((item.get("link") or "").strip()))
            if not u0:
                continue
            title_by_url[u0] = (item.get("title") or "").strip()
            snippet_by_url[u0] = (item.get("snippet") or "").strip()

        ai_payload: List[Dict[str, object]] = []
        for rank, (sc, link, orig) in enumerate(top_for_ai, start=1):
            final_u, html = fetch_html_snippet(http_sess, link)
            ev = page_evidence_score(pub_name, addr_bits, district, html)
            geo_bonus = 0.0
            if ll and final_u:
                # If page contains geo coords near ours, boost heavily (rare but strong)
                lat_s, lon_s = ll
                m = re.search(r"(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)", html)
                if m:
                    try:
                        plat = float(m.group(1))
                        plon = float(m.group(2))
                        d = haversine_m(lat_s, lon_s, plat, plon)
                        if d <= 250:
                            geo_bonus += 8.0
                        elif d <= 1000:
                            geo_bonus += 3.0
                    except Exception:
                        pass

            ai_payload.append(
                {
                    "rank": rank,
                    "serper_score": sc,
                    "serper_link": orig,
                    "url": link,
                    "serper_title": title_by_url.get(link, ""),
                    "serper_snippet": snippet_by_url.get(link, ""),
                    "fetched_final_url": final_u,
                    "page_evidence_score": ev,
                    "geo_bonus": geo_bonus,
                }
            )

        try:
            chosen, conf01, reason = openai_pick_best_candidate(
                api_key=openai_key,
                model=openai_model,
                pub={
                    "id": (row.get("id") or "").strip(),
                    "name": pub_name,
                    "operator": (row.get("operator") or "").strip(),
                    "addr": addr_bits,
                    "city": (row.get("addr_city") or "").strip(),
                    "district": district,
                    "postcode": (row.get("calc_postcode") or "").strip(),
                    "postcode_area": (row.get("calc_postcode_area") or "").strip(),
                    "lat": (row.get("lat") or "").strip(),
                    "lon": (row.get("lon") or "").strip(),
                },
                candidates=ai_payload,
            )
            if chosen:
                st, final = validate_url(http_sess, chosen)
                if st.isdigit() and int(st) < 400 and final:
                    final = trim_disposable_url_suffixes(http_sess, final, bool(intelligent_url_trim))
                    _, html_final = fetch_html_snippet(http_sess, final)
                    alts = [u for (_, u, _) in top_for_ai if u and u.rstrip("/") != final.rstrip("/")][:5]
                    chosen_orig = ""
                    for _sc, u, o in top_for_ai:
                        if u.rstrip("/") == str(chosen).rstrip("/"):
                            chosen_orig = o
                            break
                    if require_openai_location:
                        loc_ok, loc_note = page_location_matches_row(row, html_final, ll)
                        if not loc_ok:
                            notes.append(f"openai_rejected_location={loc_note}")
                        else:
                            return (
                                final,
                                chosen_orig or chosen,
                                st,
                                float(conf01),
                                alts,
                                f"openai:{reason};loc_ok={loc_note}",
                            )
                    else:
                        return final, chosen_orig or chosen, st, float(conf01), alts, f"openai:{reason}"
        except Exception as e:
            notes.append(f"openai_failed={e}")

    tried = 0
    for sc, link, orig in candidates:
        if sc < -1e5:
            continue
        if tried >= max_validate:
            break

        best_final = ""
        best_status = ""
        best_evidence = -1.0
        best_url_try = ""

        for variant in canonical_url_variants(link):
            st, final = validate_url(http_sess, variant)
            if not (st.isdigit() and int(st) < 400 and final):
                notes.append(f"tried={variant} status={st}")
                continue
            _, html = fetch_html_snippet(http_sess, final)
            ev = page_evidence_score(pub_name, addr_bits, district, html)
            if ll:
                lat_s, lon_s = ll
                m = re.search(r"(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)", html)
                if m:
                    try:
                        plat = float(m.group(1))
                        plon = float(m.group(2))
                        d = haversine_m(lat_s, lon_s, plat, plon)
                        if d <= 250:
                            ev += 6.0
                    except Exception:
                        pass

            if ev > best_evidence:
                best_evidence = ev
                best_final = final
                best_status = st
                best_url_try = variant

        tried += 1

        if best_final:
            final_h = trim_disposable_url_suffixes(http_sess, best_final, bool(intelligent_url_trim))
            _, html_h = fetch_html_snippet(http_sess, final_h)
            conf_out = 0.0
            note_h = f"heuristic:{best_url_try}"
            if use_openai and openai_key and verify_heuristic_with_openai:
                try:
                    excerpt = html_text_excerpt(html_h)
                    pub_payload = {
                        "id": (row.get("id") or "").strip(),
                        "name": pub_name,
                        "operator": (row.get("operator") or "").strip(),
                        "addr": addr_bits,
                        "city": (row.get("addr_city") or "").strip(),
                        "district": district,
                        "postcode": (row.get("calc_postcode") or "").strip(),
                        "postcode_area": (row.get("calc_postcode_area") or "").strip(),
                        "lat": (row.get("lat") or "").strip(),
                        "lon": (row.get("lon") or "").strip(),
                    }
                    ok_ai, conf_ai, r_ai = openai_verify_heuristic_pick(
                        api_key=openai_key,
                        model=openai_model,
                        pub=pub_payload,
                        verified_url=final_h,
                        page_text_excerpt=excerpt,
                    )
                    if ok_ai:
                        if require_openai_location:
                            loc_ok, loc_note = page_location_matches_row(row, html_h, ll)
                            if loc_ok:
                                conf_out = float(conf_ai)
                                note_h += f";ai_confirmed={r_ai};loc_ok={loc_note}"
                            else:
                                note_h += f";ai_confirmed_loc_fail={loc_note}"
                        else:
                            conf_out = float(conf_ai)
                            note_h += f";ai_confirmed={r_ai}"
                    else:
                        note_h += f";ai_review={r_ai}"
                except Exception as e:
                    note_h += f";ai_review_error={e!s}"
            alts = [u for u in alternates if u and u.rstrip("/") != final_h.rstrip("/")][:5]
            return final_h, orig, best_status, conf_out, alts, note_h

    return "", "", "no_valid_candidate", 0.0, alternates[:5], "; ".join(notes[:3])


def main() -> int:
    load_dotenv_simple(_REPO_ROOT / ".env")

    p = argparse.ArgumentParser(description="Suggest pub websites via Serper for rows missing website.")
    p.add_argument(
        "--input",
        type=Path,
        required=True,
        help="Source CSV (e.g. data/osm_london_pubs_combined.csv)",
    )
    p.add_argument("--output", type=Path, required=True)
    p.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Max eligible rows to process (0 = no cap, process all eligible rows)",
    )
    p.add_argument("--offset", type=int, default=0, help="Skip first N eligible rows")
    p.add_argument(
        "--tail",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="With --limit, take the last N eligible rows (after --offset) instead of the first N",
    )
    p.add_argument("--serper-delay", type=float, default=0.15, help="Seconds between Serper calls")
    p.add_argument("--max-validate", type=int, default=5, help="Max candidates to HTTP-validate per pub")
    p.add_argument(
        "--include-geo-in-query",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Append lat/lon to the Serper query for disambiguation (default: off)",
    )
    p.add_argument(
        "--serper-negatives",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Append -site: filters to the Serper query (default: off; can zero-out results)",
    )
    p.add_argument(
        "--debug-serper",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Print Serper debug JSON snippets to stderr when organic results are empty",
    )
    p.add_argument(
        "--only-osm-rows",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Only process non-supabase rows (OSM-sourced rows in combined CSV)",
    )
    p.add_argument(
        "--intelligent-url-trim",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Strip disposable terminal path segments (/contact, /menu, …) when parent validates; "
        "do not force all URLs to domain root (default: on)",
    )
    p.add_argument(
        "--verify-heuristic-with-openai",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="When heuristic picks a URL and OpenAI is on, run a single-URL confirm for confidence (default: on)",
    )
    p.add_argument(
        "--require-openai-location-match",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="After OpenAI picks a URL, require fetched page to match row postcode/address or coords (default: on)",
    )
    p.add_argument(
        "--use-openai",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Use OPENAI_API_KEY to rerank top Serper candidates (default: on; use --no-use-openai to skip)",
    )
    p.add_argument(
        "--openai-model",
        default=os.environ.get("OPENAI_MODEL", "gpt-4.1-mini"),
        help="OpenAI model for reranking (default: gpt-4.1-mini or OPENAI_MODEL env)",
    )
    args = p.parse_args()

    api_key = (os.environ.get("SERPER_API_KEY") or "").strip()
    if not api_key:
        print("Missing SERPER_API_KEY in environment (.env)", file=sys.stderr)
        return 1

    openai_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if bool(args.use_openai) and not openai_key:
        print(
            "Missing OPENAI_API_KEY (OpenAI rerank is on by default). "
            "Set the key in the environment or pass --no-use-openai.",
            file=sys.stderr,
        )
        return 1

    if not args.input.is_file():
        print(f"Input not found: {args.input}", file=sys.stderr)
        return 1

    with args.input.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        in_fields = reader.fieldnames or []
        rows = list(reader)

    eligible: List[Dict[str, str]] = []
    for r in rows:
        if (r.get("website") or "").strip():
            continue
        if not (r.get("name") or "").strip():
            continue
        if bool(args.only_osm_rows) and (r.get("osm_type") or "").strip().lower() == "supabase":
            continue
        eligible.append(r)

    if args.offset:
        eligible = eligible[args.offset :]
    if args.limit and args.limit > 0:
        lim = int(args.limit)
        if bool(args.tail):
            eligible = eligible[-lim:]
        else:
            eligible = eligible[:lim]

    http_sess = http_session()
    serper_sess = http_session()

    out_fields = [
        "id",
        "name",
        "operator",
        "calc_postcode_district",
        "calc_postcode_area",
        "lat",
        "lon",
        "addr_housenumber",
        "addr_street",
        "addr_city",
        "serper_query",
        "confidence",
        "suggested_website",
        "suggested_website_original",
        "validation_status",
        "alternates_json",
        "notes",
    ]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with args.output.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=out_fields)
        w.writeheader()

        for r in eligible:
            queries = build_queries(
                r,
                include_geo=bool(args.include_geo_in_query),
                include_negatives=bool(args.serper_negatives),
            )
            organic: List[dict] = []
            used_query = ""
            serper_meta: Dict[str, object] = {}
            for q in queries:
                organic, serper_meta = serper_search(serper_sess, api_key, q)
                used_query = q
                time.sleep(max(0.0, float(args.serper_delay)))
                if organic:
                    break

            if not organic and bool(args.debug_serper):
                # Keep this compact; Serper payloads can be large.
                keys = sorted(list(serper_meta.keys()))
                print(f"[serper-debug] query={used_query!r} keys={keys}", file=sys.stderr)

            chosen, chosen_orig, vstat, conf, alts, note = pick_and_validate(
                http_sess,
                r,
                organic,
                max_validate=int(args.max_validate),
                use_openai=bool(args.use_openai),
                openai_key=openai_key,
                openai_model=str(args.openai_model),
                intelligent_url_trim=bool(args.intelligent_url_trim),
                require_openai_location=bool(args.require_openai_location_match),
                verify_heuristic_with_openai=bool(args.verify_heuristic_with_openai),
            )

            w.writerow(
                {
                    "id": (r.get("id") or "").strip(),
                    "name": (r.get("name") or "").strip(),
                    "operator": (r.get("operator") or "").strip(),
                    "calc_postcode_district": (r.get("calc_postcode_district") or "").strip(),
                    "calc_postcode_area": (r.get("calc_postcode_area") or "").strip(),
                    "lat": (r.get("lat") or "").strip(),
                    "lon": (r.get("lon") or "").strip(),
                    "addr_housenumber": (r.get("addr_housenumber") or "").strip(),
                    "addr_street": (r.get("addr_street") or "").strip(),
                    "addr_city": (r.get("addr_city") or "").strip(),
                    "serper_query": used_query,
                    "confidence": f"{conf:.3f}",
                    "suggested_website": chosen,
                    "suggested_website_original": chosen_orig,
                    "validation_status": vstat,
                    "alternates_json": json.dumps(alts, ensure_ascii=False),
                    "notes": note,
                }
            )
            written += 1

    print(f"eligible_input_rows={len(rows)}")
    print(f"wrote_suggestions={written}")
    print(f"output={args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
