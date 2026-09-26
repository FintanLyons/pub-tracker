-- ROLLBACK for scripts/username_case_insensitive_2026_09.sql
BEGIN;
DROP INDEX IF EXISTS public.users_username_lower_key;
COMMIT;
