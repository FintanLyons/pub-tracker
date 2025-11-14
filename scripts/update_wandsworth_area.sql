-- Update area from "Wandsworth" to "Wandsworth Town"
-- Run this in Supabase SQL editor or psql

UPDATE pubs_all
SET area = 'Wandsworth Town'
WHERE area = 'Wandsworth';

-- Optional: Check how many rows will be affected first
-- SELECT COUNT(*) FROM pubs_all WHERE area = 'Wandsworth';

