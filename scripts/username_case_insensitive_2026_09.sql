-- =============================================================================
-- Case-insensitive unique usernames — audit Batch 6a (2026-09-26)
-- =============================================================================
-- Run once in the Supabase SQL editor (paste the WHOLE file, nothing highlighted).
-- Rollback: scripts/username_case_insensitive_2026_09_rollback.sql
--
-- WHY: users_username_key is case-sensitive, so "Fintan" and "fintan" could both
-- exist and look identical on leaderboards, requests and notifications.
--
-- EFFECT: usernames keep the capitals people chose for display, but a second user
-- can no longer register the same name in different case. No existing data
-- changes (checked 2026-09-26: no usernames currently differ only by case).
-- NULL usernames (not chosen yet) are unaffected.
-- =============================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key
  ON public.users (lower(username));

COMMIT;
