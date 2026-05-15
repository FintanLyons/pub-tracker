#!/usr/bin/env python3
"""
Fill empty cells in ``data/data_list.csv`` using Wikidata entities referenced
by the ``wikidata`` column (Q-ids).

For each row with a parsable Q-id, the script calls the Wikidata Action API
(``wbgetentities``), maps a small set of well-known properties to your CSV
columns, and **only writes into cells that are currently empty** (after
strip); existing OSM / manual values are never overwritten.

Policy (confirmed for this project)
-----------------------------------
- **Website**: P856 is used **only** when ``website`` is empty; an existing URL
  is never replaced.
- **Description**: English Wikidata **description** (short sentence) fills an
  empty ``description``; you can supplement with longer copy later. Use
  ``--no-fill-description`` to skip.
- **Operator**: map from Wikidata only into ``operator`` (not ``ownership``).
- **Photos**: **P18 only** → ``photo_url1`` (a single Commons image). Other
  photo columns stay free for additional sources later; P18 is skipped if any
  of ``photo_url1``..``photo_url5`` is already set.
- **Address**: **P6375** (*street address*) splits into ``addr_housenumber``
  and ``addr_street`` only when **both** are empty; heuristic may put the full
  line in ``addr_street`` if no leading number range is detected.
- **Coordinates**: ``lat`` / ``lon`` are never filled from Wikidata.

Other fills when the target field is empty: ``phone`` (P1329), ``founded``
(P571), ``name`` (English label). Not attempted: feature booleans, opening
hours, postcode columns.

Usage (from repo root)
----------------------
  python3 scripts/enrich_data_list_from_wikidata.py --dry-run
  python3 scripts/enrich_data_list_from_wikidata.py -o data/data_list_enriched.csv
  python3 scripts/enrich_data_list_from_wikidata.py --in-place

Requirements: stdlib only. Needs outbound HTTPS to ``www.wikidata.org``.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

# Identifying User-Agent is required by Wikidata; include contact or repo URL.
DEFAULT_UA = "PubTracker-enrich-data-list/1.0 (https://github.com/; data pipeline)"

WB_API = "https://www.wikidata.org/w/api.php"
BATCH_SIZE = 45  # stay under API limits; URL length grows with many Q-ids
REQUEST_PAUSE_S = 0.35

QID_RE = re.compile(r"(?:wiki/)?(Q\d+)\s*$", re.IGNORECASE)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def parse_qid(raw: str) -> Optional[str]:
    if not raw or not isinstance(raw, str):
        return None
    s = raw.strip()
    if not s:
        return None
    if re.fullmatch(r"Q\d+", s, re.I):
        return s.upper()
    m = QID_RE.search(s)
    if m:
        return m.group(1).upper()
    return None


def is_empty(val: Any) -> bool:
    if val is None:
        return True
    if isinstance(val, str):
        return len(val.strip()) == 0
    return False


def all_photos_empty(row: Dict[str, str], photo_cols: List[str]) -> bool:
    return all(is_empty(row.get(c)) for c in photo_cols)


def address_parts_empty(row: Dict[str, str]) -> bool:
    """True when both split address columns are empty."""
    return is_empty(row.get("addr_housenumber")) and is_empty(row.get("addr_street"))


def p6375_street_address(claims: dict) -> Optional[str]:
    """First P6375 monolingual value, preferring English."""
    texts: List[Tuple[str, str]] = []
    for claim in ranked_claims(claims.get("P6375", [])):
        dv = mainsnak_value(claim)
        if not dv or dv.get("type") != "monolingualtext":
            continue
        val = dv.get("value") or {}
        text = (val.get("text") or "").strip()
        lang = (val.get("language") or "").strip().lower()
        if text:
            texts.append((lang, text))
    if not texts:
        return None
    for lang, text in texts:
        if lang == "en":
            return text
    return texts[0][1]


def split_housenumber_street(line: str) -> Tuple[str, str]:
    """
    Best-effort split for UK-style lines (e.g. '40 Leman Street', '87-91, Foo Road').
    If no leading number range is found, returns ('', full_line_without_postcode).
    """
    line = line.strip()
    if not line:
        return "", ""
    s = re.sub(r",?\s*[A-Z]{1,2}\d[A-Z0-9]?\s*\d[A-Z]{2}\s*$", "", line, flags=re.I).strip()
    s = re.sub(r",\s*London\s*$", "", s, flags=re.I).strip()
    if not s:
        return "", ""
    m = re.match(r"^(\d+(?:\s*[-–/]\s*\d+)?)\s*,\s*(.+)$", s)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    m2 = re.match(r"^((?:\d+(?:\s*[-–/]\s*\d+)?)(?:[A-Za-z])?)\s+(.+)$", s)
    if m2:
        num, rest = m2.group(1).strip(), m2.group(2).strip()
        if re.match(r"^\d", num):
            return num, rest
    return "", s


def ranked_claims(statements: List[dict]) -> Iterable[dict]:
    """Preferred rank first, then normal; skip deprecated and novalue."""
    preferred: List[dict] = []
    normal: List[dict] = []
    for st in statements or []:
        rank = st.get("rank")
        if rank == "deprecated":
            continue
        snak = st.get("mainsnak") or {}
        if snak.get("snaktype") != "value":
            continue
        if rank == "preferred":
            preferred.append(st)
        elif rank == "normal":
            normal.append(st)
    yield from preferred
    yield from normal


def mainsnak_value(claim: dict) -> Optional[dict]:
    snak = claim.get("mainsnak") or {}
    if snak.get("snaktype") != "value":
        return None
    return snak.get("datavalue")


def first_string_claim(claims: dict, prop: str) -> Optional[str]:
    for claim in ranked_claims(claims.get(prop, [])):
        dv = mainsnak_value(claim)
        if not dv:
            continue
        if dv.get("type") == "string":
            v = (dv.get("value") or "").strip()
            if v:
                return v
    return None


def first_item_id_claim(claims: dict, prop: str) -> Optional[str]:
    for claim in ranked_claims(claims.get(prop, [])):
        dv = mainsnak_value(claim)
        if not dv or dv.get("type") != "wikibase-entityid":
            continue
        vid = (dv.get("value") or {}).get("id")
        if isinstance(vid, str) and vid.startswith("Q"):
            return vid
    return None


def year_from_p571(claims: dict) -> Optional[str]:
    for claim in ranked_claims(claims.get("P571", [])):
        dv = mainsnak_value(claim)
        if not dv or dv.get("type") != "time":
            continue
        val = dv.get("value") or {}
        t = val.get("time")
        prec = val.get("precision")
        if not isinstance(t, str):
            continue
        # precision: 9 = year, 10 = month, 11 = day
        if prec is not None and prec < 9:
            continue
        m = re.match(r"^\+(\d{1,4})-", t)
        if m:
            return m.group(1)
    return None


def commons_file_url(filename: str) -> str:
    """HTTPS URL for a Commons file title (P18 value is usually like 'Foo.jpg')."""
    name = filename.strip()
    if name.lower().startswith("file:"):
        name = name[5:].strip()
    path = name.replace(" ", "_")
    return "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(
        path,
        safe="/()'%!-._~*:",
    )


def first_commons_image_url(claims: dict) -> Optional[str]:
    for claim in ranked_claims(claims.get("P18", [])):
        dv = mainsnak_value(claim)
        if not dv or dv.get("type") != "string":
            continue
        fn = (dv.get("value") or "").strip()
        if fn:
            return commons_file_url(fn)
    return None


def en_label(entity: dict) -> Optional[str]:
    lab = (entity.get("labels") or {}).get("en") or {}
    v = (lab.get("value") or "").strip()
    return v or None


def en_description(entity: dict) -> Optional[str]:
    d = (entity.get("descriptions") or {}).get("en") or {}
    v = (d.get("value") or "").strip()
    return v or None


def wbgetentities(
    qids: List[str],
    user_agent: str,
) -> Dict[str, dict]:
    """Returns entities dict qid -> entity (may be 'missing')."""
    ids = "|".join(qids)
    qs = urllib.parse.urlencode(
        {
            "action": "wbgetentities",
            "ids": ids,
            "format": "json",
            "props": "labels|descriptions|claims",
            "languages": "en",
            "languagefallback": "1",
        }
    )
    url = f"{WB_API}?{qs}"
    req = urllib.request.Request(url, headers={"User-Agent": user_agent})
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if "error" in payload:
        raise RuntimeError(str(payload["error"]))
    return payload.get("entities") or {}


def fetch_entities_batched(
    qids: Set[str],
    user_agent: str,
) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    ids_sorted = sorted(qids)
    for i in range(0, len(ids_sorted), BATCH_SIZE):
        chunk = ids_sorted[i : i + BATCH_SIZE]
        batch = wbgetentities(chunk, user_agent)
        out.update(batch)
        time.sleep(REQUEST_PAUSE_S)
    return out


def enrich_row(
    row: Dict[str, str],
    entities: Dict[str, dict],
    *,
    fill_description: bool,
    photo_cols: List[str],
) -> Tuple[Dict[str, str], List[str]]:
    """
    Return (new_row, list of 'col: reason' change notes).
    """
    qid = parse_qid(row.get("wikidata", "") or "")
    notes: List[str] = []
    if not qid:
        return row, notes
    ent = entities.get(qid)
    if not ent or ent.get("type") == "missing" or "missing" in ent:
        notes.append("_wikidata:missing_entity")
        return row, notes

    claims = ent.get("claims") or {}
    out = dict(row)

    # P856 only when there is no existing website (never replace).
    if is_empty(out.get("website")):
        url = first_string_claim(claims, "P856")
        if url:
            out["website"] = url
            notes.append("website:P856")

    if is_empty(out.get("phone")):
        phone = first_string_claim(claims, "P1329")
        if phone:
            out["phone"] = phone
            notes.append("phone:P1329")

    if is_empty(out.get("founded")):
        y = year_from_p571(claims)
        if y:
            out["founded"] = y
            notes.append("founded:P571")

    if fill_description and is_empty(out.get("description")):
        desc = en_description(ent)
        if desc:
            out["description"] = desc
            notes.append("description:wikidata_en")

    if is_empty(out.get("name")):
        label = en_label(ent)
        if label:
            out["name"] = label
            notes.append("name:label_en")

    # P18 only → photo_url1; leave photo_url2–5 for other sources.
    if all_photos_empty(out, photo_cols):
        img = first_commons_image_url(claims)
        if img:
            out["photo_url1"] = img
            notes.append("photo_url1:P18")

    if address_parts_empty(out):
        full = p6375_street_address(claims)
        if full:
            hn, st = split_housenumber_street(full)
            out["addr_housenumber"] = hn
            out["addr_street"] = st
            notes.append("addr:P6375")

    if is_empty(out.get("operator")):
        oid127 = first_item_id_claim(claims, "P127")
        oid749 = first_item_id_claim(claims, "P749")
        oid = oid127 or oid749
        if oid:
            owner_ent = entities.get(oid)
            if owner_ent and owner_ent.get("type") != "missing":
                label = en_label(owner_ent)
                if label:
                    out["operator"] = label
                    notes.append(f"operator:{'P127' if oid127 else 'P749'}")

    return out, notes


def read_csv(path: Path) -> Tuple[List[str], List[Dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        if not fieldnames:
            raise SystemExit("CSV has no header row")
        rows = [dict(r) for r in reader]
    return list(fieldnames), rows


def write_csv(path: Path, fieldnames: List[str], rows: List[Dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fill empty data_list columns from Wikidata (wikidata Q-id column).",
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=repo_root() / "data" / "data_list.csv",
        help="Input CSV path (default: data/data_list.csv)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output CSV path (default: stdout-only with --dry-run; else data/data_list_wikidata_enriched.csv)",
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Overwrite --input (use with care).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not write; print summary and sample changes.",
    )
    parser.add_argument(
        "--no-fill-description",
        action="store_true",
        help="Do not copy the English Wikidata description into description.",
    )
    parser.add_argument(
        "--user-agent",
        default=DEFAULT_UA,
        help="HTTP User-Agent (Wikidata requires a descriptive UA).",
    )
    parser.add_argument(
        "--limit-rows",
        type=int,
        default=None,
        help="Process only the first N data rows (for testing).",
    )
    args = parser.parse_args()
    inp = args.input
    if not inp.is_file():
        print(f"Input not found: {inp}", file=sys.stderr)
        sys.exit(1)

    fill_description = not args.no_fill_description
    photo_cols = [f"photo_url{i}" for i in range(1, 6)]

    fieldnames, rows = read_csv(inp)
    for col in (
        "wikidata",
        "website",
        "phone",
        "founded",
        "description",
        "name",
        "operator",
        "addr_housenumber",
        "addr_street",
        *photo_cols,
    ):
        if col not in fieldnames:
            print(f"Warning: column {col!r} not in CSV header — enrich may skip related logic.", file=sys.stderr)

    if args.limit_rows is not None:
        rows = rows[: max(0, args.limit_rows)]

    row_qids: Set[str] = set()
    for row in rows:
        q = parse_qid(row.get("wikidata", "") or "")
        if q:
            row_qids.add(q)

    if not row_qids:
        print("No Wikidata Q-ids found in wikidata column; nothing to do.")
        sys.exit(0)

    print(f"Fetching {len(row_qids)} Wikidata entities…")
    try:
        entities = fetch_entities_batched(row_qids, args.user_agent)
    except urllib.error.HTTPError as e:
        print(f"HTTP error from Wikidata: {e}", file=sys.stderr)
        sys.exit(2)
    except urllib.error.URLError as e:
        print(f"Network error (is DNS/HTTPS available?): {e}", file=sys.stderr)
        sys.exit(2)

    # Second pass: item ids referenced by P127 / P749 on those entities
    ref_ids: Set[str] = set()
    for qid in row_qids:
        ent = entities.get(qid) or {}
        if ent.get("type") == "missing":
            continue
        claims = ent.get("claims") or {}
        for prop in ("P127", "P749"):
            rid = first_item_id_claim(claims, prop)
            if rid and rid not in entities:
                ref_ids.add(rid)

    extra = ref_ids - row_qids
    if extra:
        print(f"Fetching {len(extra)} referenced owner/org entities…")
        ref_entities = fetch_entities_batched(extra, args.user_agent)
        entities.update(ref_entities)

    enriched: List[Dict[str, str]] = []
    total_notes = 0
    sample: List[str] = []
    for row in rows:
        new_row, notes = enrich_row(
            row,
            entities,
            fill_description=fill_description,
            photo_cols=photo_cols,
        )
        enriched.append(new_row)
        if notes:
            total_notes += len(notes)
            if len(sample) < 15 and not str(notes[0]).startswith("_wikidata:"):
                name = row.get("name", "")
                sample.append(f"  {name!r} ({parse_qid(row.get('wikidata',''))}): {', '.join(notes)}")

    print(f"Rows with a Q-id: {sum(1 for r in rows if parse_qid(r.get('wikidata','') or ''))}")
    print(f"Fill operations applied: {total_notes}")
    if sample:
        print("Sample fills (first few):")
        print("\n".join(sample))

    if args.dry_run:
        print("--dry-run: no file written.")
        return

    out_path = inp if args.in_place else (args.output or (repo_root() / "data" / "data_list_wikidata_enriched.csv"))
    if args.in_place:
        print(f"Overwriting {inp}")
    else:
        print(f"Writing {out_path}")
    write_csv(out_path, fieldnames, enriched)


if __name__ == "__main__":
    main()
