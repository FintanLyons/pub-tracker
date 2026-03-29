-- Add website column to pubs_all
-- Run once against Supabase.
ALTER TABLE pubs_all ADD COLUMN IF NOT EXISTS website TEXT;
