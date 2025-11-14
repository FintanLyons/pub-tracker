-- ============================================================================
-- QUICK FIX: Match pubs_all RLS policy to pubs table exactly
-- ============================================================================
-- This creates the exact same SELECT policy as the pubs table
-- Policy: "Allow public read access to pubs_all"
-- Operation: SELECT
-- Roles: public
-- Using: true
-- With Check: true
-- ============================================================================

-- Drop any existing SELECT policies
DROP POLICY IF EXISTS "pubs_all_select_all" ON public.pubs_all;
DROP POLICY IF EXISTS "Allow public read access to pubs_all" ON public.pubs_all;

-- Create the exact same policy as pubs table
CREATE POLICY "Allow public read access to pubs_all"
ON public.pubs_all FOR SELECT
TO public
USING (true);

-- Verify the policy was created
SELECT 
  policyname,
  cmd as operation,
  array_to_string(roles, ', ') as roles,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'pubs_all'
  AND cmd = 'SELECT';

