-- Pub Ownership Standardization SQL Script
--
-- This script standardizes pub ownership names by mapping various spellings
-- and variations to master owner names.
--
-- Usage:
--   Run this script against your Supabase/PostgreSQL database
--   Review the changes before committing (this script uses UPDATE statements)
--
-- Note: This script uses CASE statements with ILIKE for case-insensitive matching
-- and pattern matching. For more complex patterns, consider using the Python script.

BEGIN;

-- Wetherspoon variations
UPDATE pubs
SET ownership = 'Wetherspoon'
WHERE ownership IS NOT NULL
  AND ownership != ''
  AND (
    ownership ILIKE '%wetherspoon%'
    OR ownership ILIKE '%j d wetherspoon%'
    OR ownership ILIKE '%jd wetherspoon%'
  )
  AND ownership != 'Wetherspoon';

-- Fuller's variations
UPDATE pubs
SET ownership = 'Fuller''s'
WHERE ownership IS NOT NULL
  AND ownership != ''
  AND (
    ownership ILIKE '%fuller%'
  )
  AND ownership NOT IN ('Fuller''s', 'Wetherspoon');

-- Greene King variations
UPDATE pubs
SET ownership = 'Greene King'
WHERE ownership IS NOT NULL
  AND ownership != ''
  AND (
    ownership ILIKE '%greene king%'
    OR ownership ILIKE '%greeneking%'
  )
  AND ownership != 'Greene King';

-- Nicholson's variations (including Mitchells & Butlers)
UPDATE pubs
SET ownership = 'Nicholson''s'
WHERE ownership IS NOT NULL
  AND ownership != ''
  AND (
    ownership ILIKE '%nicholson%'
    OR ownership ILIKE '%mitchells%butler%'
    OR ownership ILIKE '%mitchell%butler%'
    OR ownership ILIKE '%m & b%'
    OR ownership ILIKE '%m&b%'
  )
  AND ownership != 'Nicholson''s';

-- Young's variations (be careful - only match if it's clearly Young's, not other pubs with "young" in name)
UPDATE pubs
SET ownership = 'Young''s'
WHERE ownership IS NOT NULL
  AND ownership != ''
  AND (
    ownership ILIKE 'young''s'
    OR ownership ILIKE 'youngs'
    OR ownership ILIKE 'young''s%'
    OR ownership ILIKE 'youngs%'
  )
  AND ownership NOT IN ('Young''s', 'Wetherspoon', 'Fuller''s', 'Greene King', 'Nicholson''s', 'Stonegate', 'Craft Beer Co', 'Stanley Pubs', 'Three Cheers Pub Co', 'Antic', 'Berkeley Inns', 'Grace Land', 'Inda Pubs', 'Ineos', 'McMullen', 'Remarkable Pubs');

-- Stonegate
UPDATE pubs
SET ownership = 'Stonegate'
WHERE ownership IS NOT NULL
  AND ownership != ''
  AND ownership ILIKE '%stonegate%'
  AND ownership != 'Stonegate';

-- Craft Beer Co variations
UPDATE pubs
SET ownership = 'Craft Beer Co'
WHERE ownership IS NOT NULL
  AND ownership != ''
  AND (
    ownership ILIKE '%craft beer co%'
    OR ownership ILIKE '%craft beer company%'
  )
  AND ownership != 'Craft Beer Co';

-- Stanley Pubs variations
UPDATE pubs
SET ownership = 'Stanley Pubs'
WHERE ownership IS NOT NULL
  AND ownership != ''
  AND ownership ILIKE '%stanley pub%'
  AND ownership != 'Stanley Pubs';

-- Three Cheers Pub Co variations
UPDATE pubs
SET ownership = 'Three Cheers Pub Co'
WHERE ownership IS NOT NULL
  AND ownership != ''
  AND (
    ownership ILIKE '%three cheers pub co%'
    OR ownership ILIKE '%three cheers pub company%'
  )
  AND ownership != 'Three Cheers Pub Co';

-- Antic
UPDATE pubs
SET ownership = 'Antic'
WHERE ownership IS NOT NULL
  AND ownership != ''
  AND ownership ILIKE '%antic%'
  AND ownership != 'Antic';

-- Berkeley Inns variations
UPDATE pubs
SET ownership = 'Berkeley Inns'
WHERE ownership IS NOT NULL
  AND ownership != ''
  AND ownership ILIKE '%berkeley inn%'
  AND ownership != 'Berkeley Inns';

-- Grace Land variations
UPDATE pubs
SET ownership = 'Grace Land'
WHERE ownership IS NOT NULL
  AND ownership != ''
  AND ownership ILIKE '%grace land%'
  AND ownership != 'Grace Land';

-- Inda Pubs variations
UPDATE pubs
SET ownership = 'Inda Pubs'
WHERE ownership IS NOT NULL
  AND ownership != ''
  AND ownership ILIKE '%inda pub%'
  AND ownership != 'Inda Pubs';

-- Ineos
UPDATE pubs
SET ownership = 'Ineos'
WHERE ownership IS NOT NULL
  AND ownership != ''
  AND ownership ILIKE '%ineos%'
  AND ownership != 'Ineos';

-- McMullen variations
UPDATE pubs
SET ownership = 'McMullen'
WHERE ownership IS NOT NULL
  AND ownership != ''
  AND (
    ownership ILIKE '%mcmullen%'
    OR ownership ILIKE '%m''cmullen%'
  )
  AND ownership != 'McMullen';

-- Remarkable Pubs variations
UPDATE pubs
SET ownership = 'Remarkable Pubs'
WHERE ownership IS NOT NULL
  AND ownership != ''
  AND ownership ILIKE '%remarkable pub%'
  AND ownership != 'Remarkable Pubs';

-- Show summary of changes
SELECT 
    ownership,
    COUNT(*) as count
FROM pubs
WHERE ownership IS NOT NULL
  AND ownership != ''
GROUP BY ownership
ORDER BY count DESC;

COMMIT;

-- Note: If you want to review changes before committing, replace COMMIT with ROLLBACK
-- and run the SELECT query to see what would change, then run again with COMMIT.

