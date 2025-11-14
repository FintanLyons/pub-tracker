-- Quick check: Show all RLS policies on pubs table
SELECT 
  policyname,
  cmd as operation,
  array_to_string(roles, ', ') as roles,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'pubs'
ORDER BY cmd, policyname;

