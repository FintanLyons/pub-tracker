#!/usr/bin/env python3
"""
Tier A: fetch each pub ``website`` over HTTPS/HTTP and extract main text using
``trafilatura`` (boilerplate stripped). Intended as the cheap first stage before
a hosted browser (Tier B) for hard pages.

Install once::

  scripts/bootstrap_tier_a_env.sh

If ``python3 -m venv`` fails with “ensurepip is not available”, you need either
``sudo apt install python3.12-venv`` **or** install `uv` (no root): see
``scripts/bootstrap_tier_a_env.sh``. Then::

  .venv/bin/python scripts/fetch_pub_websites_tier_a.py --sample 100 --seed 42

Typical run (100 random rows with a non-empty website)::

  python3 scripts/fetch_pub_websites_tier_a.py --sample 100 --seed 42

By default ``trafilatura`` uses ``favor_precision=True``, which often **drops
footers** (navigation, copyright blocks) where **phone numbers** sometimes live.
If phones are missing from ``.txt`` files, re-run with ``--favor-recall`` to
prefer keeping more boilerplate (more noise, but better contact recovery).

Output columns (appended to every written row)
----------------------------------------------
- ``tier_fetch_tier`` — always ``A`` for this script (so later you can merge
  with Tier B runs where this becomes ``B``).
- ``tier_a_success`` — ``1`` if we got extracted text at least ``--min-chars``
  long, else ``0``.
- ``tier_a_http_status`` — HTTP status when available, else empty.
- ``tier_a_final_url`` — URL after redirects.
- ``tier_a_error`` — short error class / message when Tier A fails.
- ``tier_a_text_chars`` — character length of extracted plain text.
- ``tier_a_text_relpath`` — repo-relative path to a ``.txt`` file (**only** when
  ``--text-storage files``).
- ``tier_a_excerpt`` — full extracted text stored **in the CSV** (default
  ``--text-storage inline``). Avoids thousands of sidecar ``.txt`` files; use
  ``files`` only if you want on-disk copies for debugging.

**HTTP status:** responses with status **≥ 400** (e.g. 403) are treated as
failure — we no longer count tiny error-page HTML as a successful extract.

By default only the sampled rows are written to ``-o``. Use ``--full-output``
to write the entire input table: sampled rows get Tier A fields; others get
empty Tier A columns.

Next step: ``scripts/enrich_data_list_from_website_text.py`` reads ``tier_a_excerpt``
first, then ``tier_a_text_relpath`` if the excerpt column is empty.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import random
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import trafilatura
except ImportError:  # pragma: no cover
    print(
        "Missing dependency: trafilatura\n"
        "  pip install -r scripts/requirements_tier_a.txt",
        file=sys.stderr,
    )
    sys.exit(1)

DEFAULT_UA = (
    "PubTracker-tier-a-fetch/1.0 (+https://github.com/; "
    "pub data enrichment)"
)

TIER_A_COLUMNS = [
    "tier_fetch_tier",
    "tier_a_success",
    "tier_a_http_status",
    "tier_a_final_url",
    "tier_a_error",
    "tier_a_text_chars",
    "tier_a_text_relpath",
    "tier_a_excerpt",  # inline storage (default); empty when --text-storage files only
]


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def is_empty(val: Any) -> bool:
    if val is None:
        return True
    if isinstance(val, str):
        return len(val.strip()) == 0
    return False


def normalize_website(raw: str) -> Optional[str]:
    if is_empty(raw):
        return None
    s = raw.strip()
    if not re.match(r"^https?://", s, re.I):
        s = "https://" + s
    return s


def safe_slug(row_id: str, url: str, max_len: int = 80) -> str:
    h = hashlib.sha256(f"{row_id}|{url}".encode("utf-8")).hexdigest()[:16]
    base = re.sub(r"[^\w\-]+", "_", row_id, flags=re.ASCII)[:40].strip("_") or "row"
    return f"{base}_{h}"[:max_len]


def fetch_bytes(
    url: str,
    user_agent: str,
    timeout_s: float,
    max_bytes: int,
) -> Tuple[Optional[int], Optional[str], Optional[bytes], str]:
    """
    Returns (http_status, final_url, body_bytes, error_message).
    On success error_message is "".
    """
    # Browser-like headers: some chains (e.g. Greene King) return 403 to “bare” clients.
    # This is not guaranteed to bypass WAFs; Tier B (real browser) may still be required.
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9",
            "Accept-Encoding": "gzip, deflate",
            "Cache-Control": "max-age=0",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            status = resp.getcode()
            final = resp.geturl() or url
            chunks: List[bytes] = []
            total = 0
            while total < max_bytes:
                chunk = resp.read(min(65536, max_bytes - total))
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
            return status, final, b"".join(chunks), ""
    except urllib.error.HTTPError as e:
        body = e.read(max_bytes) if e.fp else b""
        return e.code, e.url or url, body, f"HTTPError:{e.code}"
    except urllib.error.URLError as e:
        return None, url, None, f"URLError:{e.__class__.__name__}:{e.reason}"
    except TimeoutError:
        return None, url, None, "TimeoutError"
    except OSError as e:
        return None, url, None, f"OSError:{e.__class__.__name__}"


def extract_text(html_bytes: bytes, url: str, *, favor_recall: bool = False) -> str:
    if not html_bytes:
        return ""
    html = html_bytes.decode("utf-8", errors="replace")
    if favor_recall:
        text = trafilatura.extract(
            html,
            url=url,
            include_comments=False,
            include_tables=True,
            favor_recall=True,
            favor_precision=False,
        )
    else:
        text = trafilatura.extract(
            html,
            url=url,
            include_comments=False,
            include_tables=True,
            favor_precision=True,
        )
    if not text:
        return ""
    return text.strip()


def read_csv(path: Path) -> Tuple[List[str], List[Dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        if not fieldnames:
            raise SystemExit("CSV has no header row")
        if "website" not in fieldnames:
            raise SystemExit("CSV must contain a 'website' column")
        rows = [dict(r) for r in reader]
    return list(fieldnames), rows


def write_csv(path: Path, fieldnames: List[str], rows: List[Dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def blank_tier_fields() -> Dict[str, str]:
    return {c: "" for c in TIER_A_COLUMNS}


def process_row(
    row: Dict[str, str],
    *,
    user_agent: str,
    timeout_s: float,
    max_bytes: int,
    min_chars: int,
    pause_s: float,
    favor_recall: bool,
    text_storage: str,
    max_excerpt_csv_chars: int,
) -> Dict[str, str]:
    out = dict(row)
    base = blank_tier_fields()
    out.update(base)
    out["tier_fetch_tier"] = "A"

    url = normalize_website(out.get("website", "") or "")
    if not url:
        out["tier_a_success"] = "0"
        out["tier_a_error"] = "no_website"
        return out

    status, final_url, body, err = fetch_bytes(url, user_agent, timeout_s, max_bytes)
    if body is None:
        out["tier_a_success"] = "0"
        out["tier_a_error"] = err or "fetch_failed"
        if status is not None:
            out["tier_a_http_status"] = str(status)
        out["tier_a_final_url"] = final_url or ""
        time.sleep(pause_s)
        return out

    out["tier_a_http_status"] = str(status) if status is not None else ""
    out["tier_a_final_url"] = final_url or ""

    # Do not treat error pages (403/5xx HTML) as successful extracts.
    if status is None or status >= 400:
        out["tier_a_success"] = "0"
        out["tier_a_error"] = err or f"HTTP_{status}"
        out["tier_a_text_chars"] = "0"
        out["tier_a_text_relpath"] = ""
        out["tier_a_excerpt"] = ""
        time.sleep(pause_s)
        return out

    text = extract_text(body, final_url or url, favor_recall=favor_recall)
    n = len(text)
    out["tier_a_text_chars"] = str(n)

    if n < min_chars:
        out["tier_a_success"] = "0"
        out["tier_a_error"] = err or ("short_extract" if n == 0 else "below_min_chars")
        out["tier_a_text_relpath"] = ""
        out["tier_a_excerpt"] = ""
        time.sleep(pause_s)
        return out

    out["tier_a_success"] = "1"
    out["tier_a_error"] = err or ""

    if text_storage == "inline":
        out["tier_a_text_relpath"] = ""
        stored = text if len(text) <= max_excerpt_csv_chars else (
            text[: max_excerpt_csv_chars - 80] + "\n\n[truncated for CSV cell tier_a_excerpt]"
        )
        out["tier_a_excerpt"] = stored
    else:
        out["tier_a_excerpt"] = ""
        slug = safe_slug(out.get("id", "") or out.get("osm_id", "") or "unknown", final_url or url)
        rel = Path("data") / "tier_a_extractions" / f"{slug}.txt"
        abs_path = repo_root() / rel
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_text(text, encoding="utf-8")
        out["tier_a_text_relpath"] = str(rel).replace("\\", "/")

    time.sleep(pause_s)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Tier A: HTTP fetch + trafilatura extract for pub websites.")
    parser.add_argument(
        "--input",
        type=Path,
        default=repo_root() / "data" / "data_list.csv",
        help="Input CSV (default: data/data_list.csv)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output CSV (default: data/data_list_tier_a_sample.csv or _full if --full-output)",
    )
    parser.add_argument(
        "--sample",
        type=int,
        default=100,
        help="Number of rows with websites to sample (default: 100)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="RNG seed for reproducible sampling",
    )
    parser.add_argument(
        "--full-output",
        action="store_true",
        help="Write all input rows; only sampled rows get Tier A fields filled.",
    )
    parser.add_argument(
        "--min-chars",
        type=int,
        default=150,
        help="Minimum extracted text length to count as tier_a_success (default: 150)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=25.0,
        help="Per-request timeout in seconds (default: 25)",
    )
    parser.add_argument(
        "--max-bytes",
        type=int,
        default=2_000_000,
        help="Max HTML bytes to read per URL (default: 2000000)",
    )
    parser.add_argument(
        "--pause",
        type=float,
        default=0.35,
        help="Pause between requests in seconds (default: 0.35)",
    )
    parser.add_argument(
        "--user-agent",
        default=DEFAULT_UA,
        help="HTTP User-Agent string",
    )
    parser.add_argument(
        "--favor-recall",
        action="store_true",
        help="Keep more boilerplate (e.g. footer with phone). Uses trafilatura favor_recall; noisier text.",
    )
    parser.add_argument(
        "--text-storage",
        choices=("inline", "files"),
        default="inline",
        help="inline: store extract in CSV column tier_a_excerpt (default). files: write data/tier_a_extractions/*.txt",
    )
    parser.add_argument(
        "--max-excerpt-csv-chars",
        type=int,
        default=32_000,
        help="Max chars written to tier_a_excerpt (default: 32000; Excel-safe-ish). Raise for long menus.",
    )
    args = parser.parse_args()
    inp = args.input
    if not inp.is_file():
        print(f"Input not found: {inp}", file=sys.stderr)
        sys.exit(1)

    fieldnames, rows = read_csv(inp)
    pool = [i for i, r in enumerate(rows) if normalize_website(r.get("website", "") or "")]
    if not pool:
        print("No rows with a usable website URL.", file=sys.stderr)
        sys.exit(1)

    n = min(args.sample, len(pool))
    rng = random.Random(args.seed)
    chosen = set(rng.sample(pool, n))

    if args.full_output:
        out_rows: List[Dict[str, str]] = []
        for i, row in enumerate(rows):
            extended = dict(row)
            for c in TIER_A_COLUMNS:
                if c not in extended:
                    extended[c] = ""
            if i in chosen:
                out_rows.append(
                    process_row(
                        extended,
                        user_agent=args.user_agent,
                        timeout_s=args.timeout,
                        max_bytes=args.max_bytes,
                        min_chars=args.min_chars,
                        pause_s=args.pause,
                        favor_recall=args.favor_recall,
                        text_storage=args.text_storage,
                        max_excerpt_csv_chars=args.max_excerpt_csv_chars,
                    )
                )
            else:
                for k, v in blank_tier_fields().items():
                    extended[k] = v
                out_rows.append(extended)
        out_path = args.output or (repo_root() / "data" / "data_list_tier_a_full.csv")
        out_fieldnames = list(dict.fromkeys([*fieldnames, *TIER_A_COLUMNS]))
    else:
        out_rows = []
        for i in sorted(chosen):
            row = dict(rows[i])
            for c in TIER_A_COLUMNS:
                if c not in row:
                    row[c] = ""
            out_rows.append(
                process_row(
                    row,
                    user_agent=args.user_agent,
                    timeout_s=args.timeout,
                    max_bytes=args.max_bytes,
                    min_chars=args.min_chars,
                    pause_s=args.pause,
                    favor_recall=args.favor_recall,
                    text_storage=args.text_storage,
                    max_excerpt_csv_chars=args.max_excerpt_csv_chars,
                )
            )
        out_path = args.output or (repo_root() / "data" / "data_list_tier_a_sample.csv")
        out_fieldnames = list(dict.fromkeys([*fieldnames, *TIER_A_COLUMNS]))

    write_csv(out_path, out_fieldnames, out_rows)
    ok = sum(1 for r in out_rows if r.get("tier_a_success") == "1")
    print(f"Wrote {len(out_rows)} rows to {out_path}")
    print(f"tier_a_success=1: {ok} / {len(out_rows)}")


if __name__ == "__main__":
    main()
