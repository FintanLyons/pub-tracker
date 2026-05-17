-- Normalize UK phone numbers in "Pubs_List"
-- Run in Supabase SQL Editor. Preview first, then uncomment the UPDATE block.
--
-- Fixes:
--   • Mobile 07… stored as 7XXXXXXXXX (CSV dropped leading 0)
--   • London 020… stored as 20XXXXXXXX (same issue)
--   • 03… / 08… non-geographic missing leading 0
--   • 44XXXXXXXXXX without "+"
--   • +44 0… / +44 (0)20… (redundant trunk 0 after country code)
--
-- Output: national display — (020) XXXX XXXX for London, 07XXX XXXXXX for mobile.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pub_phone_digits(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(COALESCE(raw, ''), '[^0-9]', '', 'g');
$$;

CREATE OR REPLACE FUNCTION format_uk_phone_national(d text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF length(d) <> 11 OR left(d, 1) <> '0' THEN
    RETURN d;
  END IF;

  IF d LIKE '020%' THEN
    RETURN '(020) ' || substring(d FROM 4 FOR 4) || ' ' || substring(d FROM 8);
  END IF;

  IF d LIKE '07%' THEN
    RETURN substring(d FROM 1 FOR 5) || ' ' || substring(d FROM 6);
  END IF;

  -- 01xxx, 02x (non-London), 03xx, 08xx, etc.
  RETURN substring(d FROM 1 FOR 5) || ' ' || substring(d FROM 6);
END;
$$;

CREATE OR REPLACE FUNCTION normalize_uk_phone(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
  d text;
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN NULL;
  END IF;

  s := btrim(raw);
  s := regexp_replace(s, '\(\s*0\s*\)', '', 'g');
  -- +44 020… or +44 07… → drop redundant trunk 0 after country code
  s := regexp_replace(s, '^\+44\s*0', '+44 ', 'i');

  d := pub_phone_digits(s);

  -- 10-digit national without trunk 0
  IF length(d) = 10 THEN
    IF d ~ '^(20|7|3|8)' THEN
      d := '0' || d;
    END IF;
  END IF;

  -- International 12-digit → national 11-digit
  IF length(d) = 12 AND d LIKE '44%' THEN
    d := '0' || substring(d FROM 3);
  END IF;

  IF length(d) = 11 AND d LIKE '0%' THEN
    RETURN format_uk_phone_national(d);
  END IF;

  -- Unchanged if we cannot validate
  RETURN raw;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. Preview: mobile numbers (07…) — including broken 7XXXXXXXXX
-- ---------------------------------------------------------------------------

SELECT
  id,
  name,
  phone AS before,
  normalize_uk_phone(phone) AS after,
  pub_phone_digits(phone) AS digits
FROM public."Pubs_List"
WHERE phone IS NOT NULL
  AND btrim(phone) <> ''
  AND (
    -- already OK national mobile
    (pub_phone_digits(phone) ~ '^07[0-9]{9}$')
    -- broken: leading 0 stripped
    OR (pub_phone_digits(phone) ~ '^7[0-9]{9}$')
    -- international mobile
    OR (pub_phone_digits(phone) ~ '^447[0-9]{9}$')
  )
ORDER BY name;

-- ---------------------------------------------------------------------------
-- 2. Preview: all rows that would change
-- ---------------------------------------------------------------------------

SELECT
  id,
  name,
  phone AS before,
  normalize_uk_phone(phone) AS after
FROM public."Pubs_List"
WHERE phone IS NOT NULL
  AND btrim(phone) <> ''
  AND normalize_uk_phone(phone) IS DISTINCT FROM phone
ORDER BY name;

-- ---------------------------------------------------------------------------
-- 3. Apply (review previews first)
-- ---------------------------------------------------------------------------

/*
BEGIN;

UPDATE public."Pubs_List"
SET phone = normalize_uk_phone(phone)
WHERE phone IS NOT NULL
  AND btrim(phone) <> ''
  AND normalize_uk_phone(phone) IS DISTINCT FROM phone;

COMMIT;
*/
