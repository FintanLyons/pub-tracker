-- =============================================================================
-- New sign-ups start with no username — audit Batch 2 (2026-09-26)
-- =============================================================================
-- Run once in the Supabase SQL editor. Rollback:
--   scripts/signup_username_null_2026_09_rollback.sql
--
-- WHY: handle_new_user() filled public.users.username with the email local-part
-- (e.g. "jane.smith" for jane.smith@gmail.com). For email sign-ups that need
-- confirmation the app never cleared it, so 22 users skipped "Choose your
-- username" and show part of their email address publicly. Two people with the
-- same local-part (alex@gmail / alex@yahoo) also collided on users_username_key,
-- failing the second sign-up with "Database error saving new user".
--
-- EFFECT: only rows created AFTER this runs. Existing usernames are untouched.
-- A NULL username sends the user to ChooseUsernameScreen (App.js needsUsername),
-- for every sign-in method, in both old and new app builds. Multiple NULLs are
-- allowed by the UNIQUE (username) constraint.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Username is chosen in the app (ChooseUsernameScreen); never derive it from the email.
  INSERT INTO public.users (id, email, username, created_at, updated_at)
  VALUES (NEW.id, NEW.email, NULL, NOW(), NOW())
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = NOW();

  RETURN NEW;
END;
$function$;

-- Trigger function: not callable by app users.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Verification (Claude re-checks via MCP):
-- SELECT prosrc FROM pg_proc WHERE proname = 'handle_new_user';   -- no split_part
