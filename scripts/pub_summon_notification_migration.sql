-- ============================================================================
-- Pub summon ("Summon the Troops") push notifications
-- Run in Supabase SQL Editor after notification_push_migration.sql
--
-- Pubs_List.id is TEXT (e.g. OSM "node/12345", legacy numeric ids) — not UUID.
-- ============================================================================

DROP FUNCTION IF EXISTS public.enqueue_pub_summon_notifications(uuid, uuid[], text);

CREATE OR REPLACE FUNCTION public.enqueue_pub_summon_notifications(
  p_pub_id text,
  p_friend_ids uuid[],
  p_pub_area_label text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.enqueue_pub_summon_notifications(text, uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_pub_summon_notifications(text, uuid[], text) TO authenticated;
