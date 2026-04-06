-- ============================================================================
-- Push notifications: tokens, outbox, monthly digest log, triggers
-- Run in Supabase SQL Editor (or via migration workflow).
--
-- Events:
--   1) friend_request  — new pending friendship row (recipient notified)
--   2) league_added    — league_members insert where added user <> JWT invoker
--   3) monthly_digest  — Edge Function monthly-friends-digest (not trigger-driven)
--
-- After apply: deploy Edge Functions and set secrets (see repo walkthrough).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  platform text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_push_tokens_token_unique UNIQUE (expo_push_token)
);

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_id
  ON public.user_push_tokens (user_id);

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_push_tokens_select_own" ON public.user_push_tokens;
CREATE POLICY "user_push_tokens_select_own"
  ON public.user_push_tokens FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_push_tokens_insert_own" ON public.user_push_tokens;
CREATE POLICY "user_push_tokens_insert_own"
  ON public.user_push_tokens FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_push_tokens_update_own" ON public.user_push_tokens;
CREATE POLICY "user_push_tokens_update_own"
  ON public.user_push_tokens FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_push_tokens_delete_own" ON public.user_push_tokens;
CREATE POLICY "user_push_tokens_delete_own"
  ON public.user_push_tokens FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));


CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id bigserial PRIMARY KEY,
  target_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending
  ON public.notification_outbox (created_at)
  WHERE sent_at IS NULL;

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
-- No policies: only service role / table owner (triggers) can access.


CREATE TABLE IF NOT EXISTS public.notification_monthly_digest_log (
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  year_month text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, year_month)
);

ALTER TABLE public.notification_monthly_digest_log ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated; Edge Function uses service role.

-- ---------------------------------------------------------------------------
-- Trigger helpers (SECURITY DEFINER: insert outbox regardless of RLS)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notification_jwt_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    auth.uid(),
    NULLIF(
      TRIM(BOTH '"' FROM current_setting('request.jwt.claim.sub', true)),
      ''
    )::uuid
  );
$$;

CREATE OR REPLACE FUNCTION public.tr_enqueue_friend_request_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.notification_outbox (target_user_id, kind, payload)
  VALUES (
    NEW.friend_id,
    'friend_request',
    jsonb_build_object(
      'friendship_id', NEW.id,
      'requester_id', NEW.user_id
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_friend_request_notification ON public.friendships;
CREATE TRIGGER tr_friend_request_notification
  AFTER INSERT ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_enqueue_friend_request_notification();

CREATE OR REPLACE FUNCTION public.tr_enqueue_league_added_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invoker uuid;
BEGIN
  invoker := public.notification_jwt_user_id();
  IF invoker IS NULL THEN
    RETURN NEW;
  END IF;
  -- Self-join (invite code): invoker is the new member — do not notify.
  IF NEW.user_id IS NOT DISTINCT FROM invoker THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.notification_outbox (target_user_id, kind, payload)
  VALUES (
    NEW.user_id,
    'league_added',
    jsonb_build_object(
      'league_id', NEW.league_id,
      'added_by_user_id', invoker
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_league_member_added_notification ON public.league_members;
CREATE TRIGGER tr_league_member_added_notification
  AFTER INSERT ON public.league_members
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_enqueue_league_added_notification();
