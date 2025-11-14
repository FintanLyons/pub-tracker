-- ============================================================================
-- CHECK RLS POLICIES ON PUBS TABLE
-- ============================================================================
-- Run this query in Supabase SQL Editor to see the RLS policies on the pubs table
-- Copy the results and share them so we can replicate for pubs_all
-- ============================================================================

-- Check if RLS is enabled on pubs
SELECT 
  schemaname,
  tablename,
  relrowsecurity as rls_enabled
FROM pg_tables t
JOIN pg_class c ON c.relname = t.tablename AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = t.schemaname)
WHERE schemaname = 'public' 
  AND tablename = 'pubs';

-- Get all RLS policies on pubs table
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd as operation,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'pubs'
ORDER BY cmd, policyname;

-- Also show the policy definitions in a readable format
SELECT 
  'Policy: ' || policyname || E'\n' ||
  '  Operation: ' || cmd || E'\n' ||
  '  Roles: ' || array_to_string(roles, ', ') || E'\n' ||
  '  Using: ' || COALESCE(qual::text, 'true') || E'\n' ||
  '  With Check: ' || COALESCE(with_check::text, 'true') || E'\n'
  as policy_details
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'pubs'
ORDER BY cmd, policyname;

