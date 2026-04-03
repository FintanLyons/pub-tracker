-- Run in Supabase SQL editor. Exposes aggregated drink counts for leaderboard UIs.
-- Without this, clients cannot read other users' pub_drinks rows under RLS.

CREATE OR REPLACE FUNCTION public.get_user_drink_totals(p_user_ids UUID[])
RETURNS TABLE (user_id UUID, total_drinks BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT d.user_id, SUM(d.count)::BIGINT AS total_drinks
  FROM public.pub_drinks d
  WHERE p_user_ids IS NOT NULL
    AND array_length(p_user_ids, 1) IS NOT NULL
    AND d.user_id = ANY (p_user_ids)
  GROUP BY d.user_id;
$$;

REVOKE ALL ON FUNCTION public.get_user_drink_totals(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_drink_totals(UUID[]) TO authenticated;
