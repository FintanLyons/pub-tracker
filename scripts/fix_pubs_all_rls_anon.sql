-- ============================================================================
-- QUICK FIX: Allow anonymous access to pubs_all
-- ============================================================================
-- Run this to fix the issue where pubs stopped appearing after RLS was enabled.
-- The app uses the anon key, so we need to allow anonymous users to read.
-- ============================================================================

-- Drop the existing authenticated-only policy
DROP POLICY IF EXISTS "pubs_all_select_all" ON public.pubs_all;

-- Create a new policy that allows both anonymous and authenticated users
CREATE POLICY "pubs_all_select_all"
ON public.pubs_all FOR SELECT
TO anon, authenticated
USING (true);

-- Verify the policy was created
SELECT 
  tablename,
  policyname,
  cmd as operation,
  roles as for_roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'pubs_all'
  AND cmd = 'SELECT';

