-- Add a borough column to the pubs table if it does not already exist.
-- Run this script in Supabase (or psql) to extend the schema before
-- backfilling borough data via `enrich_pub_data.py`.

ALTER TABLE public.pubs
ADD COLUMN IF NOT EXISTS borough TEXT;

