#!/usr/bin/env python3
"""
Generate scripts/import_cambridge_pubs.sql from data_list_cambridge_photos_enriched.csv.

Run:
  python3 scripts/generate_cambridge_pub_import_sql.py

Idempotent: ON CONFLICT (id) DO UPDATE refreshes enrichment fields without
touching user-linked data (visited_pubs, favorite_pubs, etc.).
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INPUT_CSV = ROOT / "data" / "data_list_cambridge_photos_enriched.csv"
OUTPUT_SQL = ROOT / "scripts" / "import_cambridge_pubs.sql"


def sql_literal(value: str | None) -> str:
    if value is None:
        return "NULL"
    text = str(value).strip()
    if not text:
        return "NULL"
    return "E'" + text.replace("\\", "\\\\").replace("'", "''") + "'"


def sql_bool(value: str | None) -> str:
    if value is None:
        return "NULL"
    text = str(value).strip().upper()
    if text == "TRUE":
        return "TRUE"
    if text == "FALSE":
        return "FALSE"
    return "NULL"


def sql_float(value: str | None) -> str:
    if value is None or not str(value).strip():
        return "NULL"
    return str(float(value))


def main() -> int:
    if not INPUT_CSV.is_file():
        print(f"Missing {INPUT_CSV}", file=sys.stderr)
        return 1

    rows = list(csv.DictReader(INPUT_CSV.open(encoding="utf-8")))
    if not rows:
        print("CSV is empty", file=sys.stderr)
        return 1

    value_rows: list[str] = []
    for row in rows:
        pub_id = (row.get("id") or "").strip()
        if not pub_id:
            print("Row missing id — skipped", file=sys.stderr)
            continue

        value_rows.append(
            "  (\n"
            f"    {sql_literal(pub_id)},\n"
            f"    {sql_literal(row.get('name'))},\n"
            f"    {sql_float(row.get('lat'))},\n"
            f"    {sql_float(row.get('lon'))},\n"
            f"    {sql_literal(row.get('calc_postcode_district'))},\n"
            f"    {sql_literal(row.get('calc_postcode_area'))},\n"
            f"    {sql_literal(row.get('operator'))},\n"
            f"    {sql_literal(row.get('description'))},\n"
            f"    {sql_literal(row.get('addr_housenumber'))},\n"
            f"    {sql_literal(row.get('addr_street'))},\n"
            f"    {sql_literal(row.get('phone'))},\n"
            f"    {sql_literal(row.get('website'))},\n"
            f"    {sql_literal(row.get('opening_hours'))},\n"
            f"    {sql_literal(row.get('founded'))},\n"
            f"    {sql_bool(row.get('has_pub_garden'))},\n"
            f"    {sql_bool(row.get('has_live_music'))},\n"
            f"    {sql_bool(row.get('has_food_available'))},\n"
            f"    {sql_bool(row.get('has_dog_friendly'))},\n"
            f"    {sql_bool(row.get('has_pool_darts'))},\n"
            f"    {sql_bool(row.get('has_accommodation'))},\n"
            f"    {sql_bool(row.get('has_live_sport_tv'))},\n"
            f"    {sql_literal(row.get('photo_url1'))},\n"
            f"    {sql_literal(row.get('photo_url2'))},\n"
            f"    {sql_literal(row.get('photo_url3'))},\n"
            f"    {sql_literal(row.get('photo_url4'))},\n"
            f"    {sql_literal(row.get('photo_url5'))}\n"
            "  )"
        )

    sql = f"""-- ============================================================================
-- Import Cambridge (CB) pubs into Pubs_List
-- ============================================================================
-- Source: data/data_list_cambridge_photos_enriched.csv ({len(value_rows)} pubs)
-- Generated: scripts/generate_cambridge_pub_import_sql.py
--
-- Run in Supabase SQL Editor after pub_list_migration.
-- Safe to re-run: upserts on id (OSM node/… or way/…).
--
-- Post-import check:
--   SELECT postcode_area, COUNT(*) FROM public."Pubs_List"
--    WHERE postcode_area = 'CB' GROUP BY 1;
-- ============================================================================

INSERT INTO public."Pubs_List" (
  id,
  name,
  lat,
  lon,
  postcode_district,
  postcode_area,
  ownership,
  description,
  addr_housenumber,
  addr_street,
  phone,
  website,
  opening_hours,
  founded,
  has_pub_garden,
  has_live_music,
  has_food_available,
  has_dog_friendly,
  has_pool_darts,
  has_accommodation,
  has_live_sport,
  photo_url1,
  photo_url2,
  photo_url3,
  photo_url4,
  photo_url5,
  is_active
)
SELECT
  v.id,
  v.name,
  v.lat,
  v.lon,
  v.postcode_district,
  v.postcode_area,
  v.ownership,
  v.description,
  v.addr_housenumber,
  v.addr_street,
  v.phone,
  v.website,
  v.opening_hours,
  v.founded,
  v.has_pub_garden,
  v.has_live_music,
  v.has_food_available,
  v.has_dog_friendly,
  v.has_pool_darts,
  v.has_accommodation,
  v.has_live_sport,
  v.photo_url1,
  v.photo_url2,
  v.photo_url3,
  v.photo_url4,
  v.photo_url5,
  TRUE
FROM (
  VALUES
{",\n".join(value_rows)}
) AS v(
  id,
  name,
  lat,
  lon,
  postcode_district,
  postcode_area,
  ownership,
  description,
  addr_housenumber,
  addr_street,
  phone,
  website,
  opening_hours,
  founded,
  has_pub_garden,
  has_live_music,
  has_food_available,
  has_dog_friendly,
  has_pool_darts,
  has_accommodation,
  has_live_sport,
  photo_url1,
  photo_url2,
  photo_url3,
  photo_url4,
  photo_url5
)
ON CONFLICT (id) DO UPDATE SET
  name              = EXCLUDED.name,
  lat               = EXCLUDED.lat,
  lon               = EXCLUDED.lon,
  postcode_district = EXCLUDED.postcode_district,
  postcode_area     = EXCLUDED.postcode_area,
  ownership         = EXCLUDED.ownership,
  description       = EXCLUDED.description,
  addr_housenumber  = EXCLUDED.addr_housenumber,
  addr_street       = EXCLUDED.addr_street,
  phone             = EXCLUDED.phone,
  website           = EXCLUDED.website,
  opening_hours     = EXCLUDED.opening_hours,
  founded           = EXCLUDED.founded,
  has_pub_garden    = EXCLUDED.has_pub_garden,
  has_live_music    = EXCLUDED.has_live_music,
  has_food_available = EXCLUDED.has_food_available,
  has_dog_friendly  = EXCLUDED.has_dog_friendly,
  has_pool_darts    = EXCLUDED.has_pool_darts,
  has_accommodation = EXCLUDED.has_accommodation,
  has_live_sport    = EXCLUDED.has_live_sport,
  photo_url1        = EXCLUDED.photo_url1,
  photo_url2        = EXCLUDED.photo_url2,
  photo_url3        = EXCLUDED.photo_url3,
  photo_url4        = EXCLUDED.photo_url4,
  photo_url5        = EXCLUDED.photo_url5,
  is_active         = TRUE;

-- Summary
SELECT
  COUNT(*) AS cb_pubs,
  COUNT(*) FILTER (WHERE photo_url1 IS NOT NULL AND TRIM(photo_url1) <> '') AS with_photo,
  COUNT(*) FILTER (WHERE website IS NOT NULL AND TRIM(website) <> '') AS with_website
FROM public."Pubs_List"
WHERE postcode_area = 'CB';
"""

    OUTPUT_SQL.write_text(sql, encoding="utf-8")
    print(f"Wrote {len(value_rows)} pubs → {OUTPUT_SQL}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
