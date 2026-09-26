-- =============================================================================
-- ROLLBACK for scripts/social_security_phase_a_2026_09.sql
-- =============================================================================
-- Restores friendships / league_members policies, grants and the summon function
-- exactly as captured on 2026-09-26, and drops the two new functions.
-- NOTE: the new app build calls join_league_by_code / claim_push_token — rolling
-- back breaks those two features in the new build (old builds are unaffected).
-- =============================================================================

BEGIN;

-- 1. Friendships
DROP POLICY IF EXISTS friendships_insert_own_pending ON public.friendships;
CREATE POLICY friendships_insert ON public.friendships
  FOR INSERT TO authenticated
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS friendships_recipient_accepts ON public.friendships;
CREATE POLICY friendships_update ON public.friendships
  FOR UPDATE TO authenticated
  USING (((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = friend_id)))
  WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = friend_id)));

REVOKE UPDATE (status) ON public.friendships FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friendships TO anon, authenticated;

-- 2. Pair index
DROP INDEX IF EXISTS public.friendships_pair_unique;

-- 3. League members insert
DROP POLICY IF EXISTS league_members_insert ON public.league_members;
CREATE POLICY league_members_insert ON public.league_members
  FOR INSERT TO authenticated
  WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) OR (league_id IN ( SELECT leagues.id
   FROM leagues
  WHERE (leagues.created_by = ( SELECT auth.uid() AS uid))))));

-- 4/5. New functions
DROP FUNCTION IF EXISTS public.join_league_by_code(text);
DROP FUNCTION IF EXISTS public.claim_push_token(text, text);

-- 6. Original summon function
CREATE OR REPLACE FUNCTION public.enqueue_pub_summon_notifications(p_pub_id text, p_friend_ids uuid[], p_pub_area_label text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_summoner_id uuid;
  v_pub_name text;
  v_pub_lat double precision;
  v_pub_lon double precision;
  v_friend_id uuid;
  v_enqueued integer := 0;
BEGIN
  v_summoner_id := auth.uid();
  IF v_summoner_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_pub_id IS NULL OR TRIM(p_pub_id) = '' THEN
    RAISE EXCEPTION 'pub_id required' USING ERRCODE = '22023';
  END IF;

  IF p_friend_ids IS NULL OR cardinality(p_friend_ids) = 0 THEN
    RAISE EXCEPTION 'select at least one friend' USING ERRCODE = '22023';
  END IF;

  IF cardinality(p_friend_ids) > 50 THEN
    RAISE EXCEPTION 'too many friends selected' USING ERRCODE = '22023';
  END IF;

  SELECT pl.name, pl.lat::double precision, pl.lon::double precision
    INTO v_pub_name, v_pub_lat, v_pub_lon
    FROM public."Pubs_List" pl
   WHERE pl.id = TRIM(p_pub_id)
   LIMIT 1;

  IF v_pub_name IS NULL THEN
    RAISE EXCEPTION 'pub not found' USING ERRCODE = '22023';
  END IF;

  IF v_pub_lat IS NULL OR v_pub_lon IS NULL THEN
    RAISE EXCEPTION 'pub has no location' USING ERRCODE = '22023';
  END IF;

  FOREACH v_friend_id IN ARRAY p_friend_ids
  LOOP
    IF v_friend_id IS NULL OR v_friend_id = v_summoner_id THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM public.friendships f
       WHERE f.status = 'accepted'
         AND (
           (f.user_id = v_summoner_id AND f.friend_id = v_friend_id)
           OR (f.user_id = v_friend_id AND f.friend_id = v_summoner_id)
         )
    ) THEN
      RAISE EXCEPTION 'invalid friend selection' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.notification_outbox (target_user_id, kind, payload)
    VALUES (
      v_friend_id,
      'pub_summon',
      jsonb_build_object(
        'summoner_id', v_summoner_id,
        'pub_id', TRIM(p_pub_id),
        'pub_name', v_pub_name,
        'pub_area', NULLIF(TRIM(p_pub_area_label), ''),
        'lat', v_pub_lat,
        'lon', v_pub_lon
      )
    );

    v_enqueued := v_enqueued + 1;
  END LOOP;

  IF v_enqueued = 0 THEN
    RAISE EXCEPTION 'no valid friends to notify' USING ERRCODE = '22023';
  END IF;

  RETURN v_enqueued;
END;
$function$
;

COMMIT;
