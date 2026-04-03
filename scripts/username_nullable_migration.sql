-- Run once in Supabase SQL Editor.
-- Allows public.users.username to be NULL until the user completes ChooseUsernameScreen.
-- Postgres: multiple NULLs are allowed under a UNIQUE(username) constraint.
--
-- If you have a trigger on auth.users that INSERTs public.users with a non-NULL
-- username (common in Supabase templates), the app clears username after email
-- sign-up and for brand-new Google accounts (see SecureAuthService). Optionally
-- change that trigger to insert username NULL so the DB matches the product model.

ALTER TABLE public.users
  ALTER COLUMN username DROP NOT NULL;

-- Optional: wipe test users if old NOT NULL / bad rows block you:
-- TRUNCATE public.user_stats CASCADE; -- careful: adjust to your FK graph
-- DELETE FROM auth.users;             -- only if you intend to reset all auth
