-- ============================================================================
-- ADD RLS SECURITY TO PUBS_ALL TABLE
-- ============================================================================
-- This script adds Row Level Security to the pubs_all table,
-- similar to how it's set up for the pubs table.
-- ============================================================================

-- ============================================================================
-- STEP 1: DROP EXISTING POLICIES (IF ANY)
-- ============================================================================

DO $$
DECLARE
  policy_record RECORD;
BEGIN
  RAISE NOTICE '=== DROPPING EXISTING POLICIES FOR PUBS_ALL ===';
  
  FOR policy_record IN 
    SELECT schemaname, tablename, policyname
    FROM pg_policies 
    WHERE schemaname = 'public'
      AND tablename = 'pubs_all'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 
      policy_record.policyname, 
      policy_record.schemaname, 
      policy_record.tablename
    );
    RAISE NOTICE 'Dropped: %.% - %', policy_record.tablename, policy_record.policyname, '';
  END LOOP;
END $$;

-- ============================================================================
-- STEP 2: ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.pubs_all ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 3: CREATE POLICIES FOR PUBS_ALL
-- ============================================================================

-- Allow public read access to pubs_all (matches pubs table policy)
CREATE POLICY "Allow public read access to pubs_all"
ON public.pubs_all FOR SELECT
TO public
USING (true);

-- Service role can insert (for data management scripts)
CREATE POLICY "pubs_all_insert_service"
ON public.pubs_all FOR INSERT
TO service_role
WITH CHECK (true);

-- Service role can update (for data management scripts)
CREATE POLICY "pubs_all_update_service"
ON public.pubs_all FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

-- Service role can delete (for data management scripts)
CREATE POLICY "pubs_all_delete_service"
ON public.pubs_all FOR DELETE
TO service_role
USING (true);

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
  policy_count INTEGER;
  rls_enabled BOOLEAN;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== VERIFICATION ===';
  RAISE NOTICE '';
  
  -- Check if RLS is enabled
  SELECT relrowsecurity INTO rls_enabled
  FROM pg_class
  WHERE relname = 'pubs_all' AND relnamespace = 'public'::regnamespace;
  
  IF rls_enabled THEN
    RAISE NOTICE '✅ RLS is ENABLED on pubs_all';
  ELSE
    RAISE NOTICE '❌ RLS is NOT enabled on pubs_all';
  END IF;
  
  -- Count policies
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'pubs_all';
  
  RAISE NOTICE '✅ pubs_all has % policies', policy_count;
END $$;

-- Show all policies
SELECT 
  tablename,
  policyname,
  cmd as operation,
  roles as for_roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'pubs_all'
ORDER BY cmd, policyname;

-- ============================================================================
-- DONE!
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== COMPLETE ===';
  RAISE NOTICE '✅ RLS enabled on pubs_all';
  RAISE NOTICE '✅ Policies created:';
  RAISE NOTICE '   - SELECT: public (matches pubs table)';
  RAISE NOTICE '   - INSERT/UPDATE/DELETE: service_role only';
  RAISE NOTICE '';
  RAISE NOTICE '🔐 Security:';
  RAISE NOTICE '   - Public can read pub data (same as pubs table)';
  RAISE NOTICE '   - Only service role can modify data';
END $$;

