-- =============================================================================
-- Social security, PHASE A — audit Batch 4 (2026-09-26)
-- =============================================================================
-- Run once in the Supabase SQL editor. Rollback:
--   scripts/social_security_phase_a_2026_09_rollback.sql
--
-- Safe for BOTH the current Play Store build and the new build: nothing here
-- removes anything the app legitimately does. (Phase B — hiding leagues from
-- non-members — is separate: scripts/social_security_phase_b_2026_09.sql.)
--
--  1. Friendships: requests can only be created as 'pending' by the sender; only
--     the recipient can accept, and only the status column can change. Stops
--     self-accepted / forged friendships that exposed visit history.
--  2. One friendship row per pair of users (no A→B + B→A duplicates; none exist).
--  3. League members: a creator can add only their accepted friends (the Create
--     League screen only offers friends). Self-join stays until Phase B.
--  4. join_league_by_code(code): server-side join, used by the new build.
--  5. claim_push_token(token, platform): moves a device's token to the account
--     now signed in on it (previously blocked by RLS, so the old account kept
--     receiving notifications on that device).
--  6. enqueue_pub_summon_notifications: max 10 summons per hour per user; the
--     sender-supplied area label is trimmed to 60 chars with no control chars.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Friendships
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS friendships_insert ON public.friendships;
CREATE POLICY friendships_insert_own_pending ON public.friendships
  FOR INSERT TO authenticated
  WITH CHECK (
        user_id = (SELECT auth.uid())
    AND friend_id <> (SELECT auth.uid())
    AND status = 'pending'
  );

DROP POLICY IF EXISTS friendships_update ON public.friendships;
CREATE POLICY friendships_recipient_accepts ON public.friendships
  FOR UPDATE TO authenticated
  USING (friend_id = (SELECT auth.uid()) AND status = 'pending')
  WITH CHECK (friend_id = (SELECT auth.uid()) AND status = 'accepted');

-- Only `status` may change (the recipient could otherwise rewrite user_id and
-- forge a friendship with anyone).
REVOKE UPDATE ON public.friendships FROM anon, authenticated;
GRANT UPDATE (status) ON public.friendships TO authenticated;
REVOKE ALL ON public.friendships FROM anon;

-- -----------------------------------------------------------------------------
-- 2. One row per pair
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_unique
  ON public.friendships (LEAST(user_id, friend_id), GREATEST(user_id, friend_id));

-- -----------------------------------------------------------------------------
-- 3. League members: creator may add accepted friends only
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS league_members_insert ON public.league_members;
CREATE POLICY league_members_insert ON public.league_members
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Self-join by league id: kept for the current Play Store build; removed in Phase B.
    user_id = (SELECT auth.uid())
    OR (
      league_id IN (SELECT l.id FROM public.leagues l WHERE l.created_by = (SELECT auth.uid()))
      AND EXISTS (
        SELECT 1 FROM public.friendships f
         WHERE f.status = 'accepted'
           AND (
             (f.user_id = (SELECT auth.uid()) AND f.friend_id = league_members.user_id)
             OR (f.friend_id = (SELECT auth.uid()) AND f.user_id = league_members.user_id)
           )
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 4. Join a league by its invite code
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_league_by_code(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_league public.leagues%ROWTYPE;
  v_inserted integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_league
    FROM public.leagues
   WHERE code = upper(btrim(coalesce(p_code, '')));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'League not found. Check the code and try again.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.league_members (league_id, user_id)
  VALUES (v_league.id, v_uid)
  ON CONFLICT (league_id, user_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'league', to_jsonb(v_league),
    'already_member', v_inserted = 0
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.join_league_by_code(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_league_by_code(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Claim this device's push token for the signed-in account
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_push_token(p_token text, p_platform text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_token text := btrim(coalesce(p_token, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_token !~ '^Expo(nent)?PushToken\[[^\]]+\]$' THEN
    RAISE EXCEPTION 'invalid push token' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_push_tokens (user_id, expo_push_token, platform, updated_at)
  VALUES (v_uid, v_token, left(p_platform, 20), now())
  ON CONFLICT (expo_push_token) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    updated_at = EXCLUDED.updated_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_push_token(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_token(text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. Summons: rate limit + sanitised area label (signature unchanged)
-- -----------------------------------------------------------------------------
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
  v_recent_summons integer;
  v_area_label text;
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

  -- One summon = one call; its rows share the transaction timestamp.
  SELECT COUNT(DISTINCT o.created_at)
    INTO v_recent_summons
    FROM public.notification_outbox o
   WHERE o.kind = 'pub_summon'
     AND o.payload->>'summoner_id' = v_summoner_id::text
     AND o.created_at > now() - interval '1 hour';

  IF v_recent_summons >= 10 THEN
    RAISE EXCEPTION 'You''ve summoned friends 10 times in the last hour. Try again later.'
      USING ERRCODE = 'P0001';
  END IF;

  v_area_label := NULLIF(
    left(btrim(regexp_replace(coalesce(p_pub_area_label, ''), '[[:cntrl:]]+', ' ', 'g')), 60),
    ''
  );

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
        'pub_area', v_area_label,
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
$function$;

COMMIT;
