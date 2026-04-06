-- Optional profile image for leaderboard (public HTTPS URL, e.g. R2 avatars/{userId}/...)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS avatar_url text;

COMMENT ON COLUMN public.users.avatar_url IS 'Public URL of profile photo; null means show default outline on leaderboard';
