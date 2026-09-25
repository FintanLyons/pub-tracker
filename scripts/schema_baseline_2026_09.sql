-- =============================================================================
-- Pub Tracker — live database schema baseline (captured 2026-09-25)
-- =============================================================================
-- Source of truth for the Supabase `public` schema as it exists in project
-- ddfdwxrnouneqqzactus AFTER scripts/security_lockdown_2026_09.sql was applied.
-- Generated from the Postgres catalogs (pg_get_functiondef, pg_policies, etc.),
-- so function bodies and policy expressions are exactly what is deployed.
--
-- This replaces ~60 historical migration scripts (deleted in the same commit;
-- they remain in git history). New DB changes go in NEW dated migration files
-- in scripts/; regenerate this baseline after significant changes.
--
-- Written to be replayable on an empty Supabase project, in dependency order.
-- Do NOT run it against the live project (objects already exist).
--
-- Conventions (see also CLAUDE.md):
--   * Supabase auto-grants new public objects to anon/authenticated. Every new
--     function needs: REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;
--     plus GRANT EXECUTE ... TO authenticated only if the app calls it.
--   * The app requires login for every screen; `anon` needs no access.
--
-- Legacy objects still present but unused by the app (cleanup candidates):
--   tables pubs, pubs_all, pub_spatial_assignments; functions pubs_in_bounds,
--   uk_postcode_from_address (its regex needs a literal backslash, so it never
--   matches), approve_report / reject_report (dashboard edits are used instead).
-- =============================================================================


-- =============================================================================
-- 0. Extensions, types, sequences
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;                -- v1.6 (geocoding for missing-pub reports)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;              -- v0.19.5
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;  -- v1.11
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;            -- v1.3
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;           -- v0.3.1
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;         -- v1.1

CREATE TYPE public.report_status AS ENUM ('pending', 'approved', 'rejected', 'auto_applied', 'apply_failed');

CREATE SEQUENCE IF NOT EXISTS public.notification_outbox_id_seq;


-- =============================================================================
-- 1. Tables (dependency order)
-- =============================================================================

-- --- Core: users & pubs -------------------------------------------------------

CREATE TABLE public.users (
  id uuid NOT NULL,
  email text NOT NULL,
  username text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  avatar_url text,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_username_key UNIQUE (username)
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- The live pub catalogue (London + Cambridge). `id` is an OSM-style or
-- 'submission/<uuid>' text key.
CREATE TABLE public."Pubs_List" (
  postcode_district text,
  postcode_area text,
  osm_type text,
  osm_id bigint,
  id text NOT NULL,
  lat double precision,
  lon double precision,
  name text,
  ownership text,
  photo_url1 text,
  photo_url2 text,
  photo_url3 text,
  photo_url4 text,
  photo_url5 text,
  founded text,
  description text,
  has_pub_garden boolean,
  has_live_music boolean,
  has_food_available boolean,
  has_dog_friendly boolean,
  has_pool_darts boolean,
  has_accommodation boolean,
  has_live_sport boolean,
  addr_housenumber text,
  addr_street text,
  phone text,
  website text,
  wikidata text,
  opening_hours text,
  is_active boolean DEFAULT true NOT NULL,
  CONSTRAINT "Pubs_List_pkey" PRIMARY KEY (id)
);
ALTER TABLE public."Pubs_List" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.leagues (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  code text NOT NULL,
  CONSTRAINT leagues_pkey PRIMARY KEY (id),
  CONSTRAINT leagues_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;

-- --- User activity ------------------------------------------------------------

CREATE TABLE public.visited_pubs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  pub_id text NOT NULL,
  visited_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT visited_pubs_pkey PRIMARY KEY (id),
  CONSTRAINT visited_pubs_user_id_pub_id_key UNIQUE (user_id, pub_id),
  CONSTRAINT visited_pubs_pub_id_fkey FOREIGN KEY (pub_id) REFERENCES "Pubs_List"(id) ON DELETE CASCADE,
  CONSTRAINT visited_pubs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.visited_pubs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.favorite_pubs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  pub_id text NOT NULL,
  favorited_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT favorite_pubs_pkey PRIMARY KEY (id),
  CONSTRAINT favorite_pubs_user_id_pub_id_key UNIQUE (user_id, pub_id),
  CONSTRAINT favorite_pubs_pub_id_fkey FOREIGN KEY (pub_id) REFERENCES "Pubs_List"(id) ON DELETE CASCADE,
  CONSTRAINT favorite_pubs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.favorite_pubs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.pub_drinks (
  user_id uuid NOT NULL,
  pub_id text NOT NULL,
  count integer DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT pub_drinks_pkey PRIMARY KEY (user_id, pub_id),
  CONSTRAINT pub_drinks_count_check CHECK ((count >= 0)),
  CONSTRAINT pub_drinks_pub_id_fkey FOREIGN KEY (pub_id) REFERENCES "Pubs_List"(id) ON DELETE CASCADE,
  CONSTRAINT pub_drinks_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE public.pub_drinks ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.pub_reviews (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  pub_id text NOT NULL,
  rating smallint NOT NULL,
  body text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT pub_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT pub_reviews_user_id_pub_id_key UNIQUE (user_id, pub_id),
  CONSTRAINT pub_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
  CONSTRAINT pub_reviews_pub_id_fkey FOREIGN KEY (pub_id) REFERENCES "Pubs_List"(id) ON DELETE CASCADE,
  CONSTRAINT pub_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE public.pub_reviews ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.pub_achievements (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  pub_id text NOT NULL,
  title text NOT NULL,
  description text,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  points integer DEFAULT 0 NOT NULL,
  CONSTRAINT pub_achievements_pkey PRIMARY KEY (id),
  CONSTRAINT pub_achievements_points_nonneg CHECK ((points >= 0)),
  CONSTRAINT pub_achievements_title_nonempty CHECK ((TRIM(BOTH FROM title) <> ''::text)),
  CONSTRAINT pub_achievements_pub_id_fkey FOREIGN KEY (pub_id) REFERENCES "Pubs_List"(id) ON DELETE CASCADE
);
ALTER TABLE public.pub_achievements ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.pub_achievements IS 'Optional pub milestones (CAMRA awards, etc.). One row per award; most pubs have no rows.';

-- Denormalised per-user score; maintained ONLY by compute_user_stats (triggers).
CREATE TABLE public.user_stats (
  user_id uuid NOT NULL,
  pubs_visited integer DEFAULT 0,
  total_score integer DEFAULT 0,
  level integer DEFAULT 1,
  last_synced_at timestamp with time zone DEFAULT now(),
  total_drinks integer DEFAULT 0 NOT NULL,
  CONSTRAINT user_stats_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;

-- --- Social -------------------------------------------------------------------

CREATE TABLE public.friendships (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  friend_id uuid NOT NULL,
  status text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT friendships_pkey PRIMARY KEY (id),
  CONSTRAINT friendships_user_id_friend_id_key UNIQUE (user_id, friend_id),
  CONSTRAINT friendships_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text]))),
  CONSTRAINT friendships_friend_id_fkey FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT friendships_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.league_members (
  league_id uuid NOT NULL,
  user_id uuid NOT NULL,
  joined_at timestamp with time zone DEFAULT now(),
  CONSTRAINT league_members_pkey PRIMARY KEY (league_id, user_id),
  CONSTRAINT league_members_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
  CONSTRAINT league_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE public.league_members ENABLE ROW LEVEL SECURITY;

-- --- Reports (user-submitted pub corrections / missing pubs) -----------------

CREATE TABLE public.reports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  pub_id text,
  pub_name text,
  pub_area text,
  report_text text,
  reporter_id uuid,
  report_type text,
  chain_or_independent text,
  pub_address text,
  website text,
  phone text,
  reporter_description text,
  history text,
  features_snapshot jsonb,
  photo_urls text[],
  closing_time text,
  founded text,
  reporter_username text,
  submitted_at timestamp with time zone DEFAULT now(),
  still_operating boolean,
  addr_housenumber text,
  addr_street text,
  postcode text,
  postcode_district text,
  postcode_area text,
  status report_status DEFAULT 'pending'::report_status NOT NULL,
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  applied_at timestamp with time zone,
  apply_error text,
  CONSTRAINT reports_pkey PRIMARY KEY (id),
  CONSTRAINT reports_report_type_check CHECK (((report_type IS NULL) OR (report_type = ANY (ARRAY['missing_pub'::text, 'pub_correction'::text])))),
  CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT reports_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- --- Push notifications (server-only; no client policies) ---------------------

CREATE TABLE public.user_push_tokens (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  expo_push_token text NOT NULL,
  platform text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT user_push_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT user_push_tokens_token_unique UNIQUE (expo_push_token),
  CONSTRAINT user_push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.notification_outbox (
  id bigint DEFAULT nextval('notification_outbox_id_seq'::regclass) NOT NULL,
  target_user_id uuid NOT NULL,
  kind text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  sent_at timestamp with time zone,
  last_error text,
  CONSTRAINT notification_outbox_pkey PRIMARY KEY (id),
  CONSTRAINT notification_outbox_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.notification_monthly_digest_log (
  user_id uuid NOT NULL,
  year_month text NOT NULL,
  sent_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT notification_monthly_digest_log_pkey PRIMARY KEY (user_id, year_month),
  CONSTRAINT notification_monthly_digest_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE public.notification_monthly_digest_log ENABLE ROW LEVEL SECURITY;

-- --- LEGACY (pre-Pubs_List; unused by the app) --------------------------------

CREATE TABLE public.pubs (
  id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
  name text NOT NULL,
  lat numeric(10,8) NOT NULL,
  lon numeric(11,8) NOT NULL,
  address text,
  phone text,
  description text,
  founded text,
  history text,
  area text NOT NULL,
  ownership text,
  photo_url text,
  points integer DEFAULT 10,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  has_pub_garden boolean DEFAULT false,
  has_live_music boolean DEFAULT false,
  has_food_available boolean DEFAULT false,
  has_dog_friendly boolean DEFAULT false,
  has_pool_darts boolean DEFAULT false,
  has_parking boolean DEFAULT false,
  has_accommodation boolean DEFAULT false,
  has_cask_real_ale boolean DEFAULT false,
  achievement text,
  borough text,
  legacy_id text,
  CONSTRAINT pubs_pkey PRIMARY KEY (id),
  CONSTRAINT pubs_id_key UNIQUE (id)
);
ALTER TABLE public.pubs ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.pubs IS 'Main table storing pub information';

CREATE TABLE public.pubs_all (
  id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
  name text NOT NULL,
  lat numeric(10,8) NOT NULL,
  lon numeric(11,8) NOT NULL,
  address text,
  phone text,
  description text,
  founded text,
  history text,
  area text NOT NULL,
  ownership text,
  photo_url text,
  points integer DEFAULT 10,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  has_pub_garden boolean DEFAULT false,
  has_live_music boolean DEFAULT false,
  has_food_available boolean DEFAULT false,
  has_dog_friendly boolean DEFAULT false,
  has_pool_darts boolean DEFAULT false,
  has_parking boolean DEFAULT false,
  has_accommodation boolean DEFAULT false,
  has_cask_real_ale boolean DEFAULT false,
  achievement text,
  borough text,
  legacy_id text,
  website text,
  CONSTRAINT pubs_all_pkey PRIMARY KEY (id),
  CONSTRAINT pubs_all_id_key UNIQUE (id)
);
ALTER TABLE public.pubs_all ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.pub_spatial_assignments (
  pub_id uuid NOT NULL,
  pub_name text NOT NULL,
  lat double precision,
  lon double precision,
  current_area text,
  current_borough text,
  corrected_ward_name text,
  corrected_ward_id text,
  corrected_borough_name text,
  corrected_borough_id text,
  assignment_status text NOT NULL,
  borough_changed boolean DEFAULT false NOT NULL,
  ward_name_matches_existing_area boolean DEFAULT false NOT NULL,
  assignment_method text DEFAULT 'point_in_polygon'::text NOT NULL,
  geometry_source text DEFAULT 'data/geo/london_wards.min.json + data/geo/london_boroughs.min.json'::text NOT NULL,
  computed_at timestamp with time zone DEFAULT now() NOT NULL,
  postcode_district text,
  postcode_area text,
  CONSTRAINT pub_spatial_assignments_pkey PRIMARY KEY (pub_id),
  CONSTRAINT pub_spatial_assignments_assignment_status_check CHECK ((assignment_status = ANY (ARRAY['inside_supported_polygons'::text, 'outside_supported_polygons'::text]))),
  CONSTRAINT pub_spatial_assignments_pub_id_fkey FOREIGN KEY (pub_id) REFERENCES pubs_all(id) ON DELETE CASCADE
);
ALTER TABLE public.pub_spatial_assignments ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.pub_spatial_assignments IS 'Polygon-based ward and borough assignments for pubs, generated from pub lat/lon against the bundled London ward and borough GeoJSON files.';


-- =============================================================================
-- 2. Indexes (excluding those backing PK/UNIQUE constraints)
-- =============================================================================
CREATE INDEX idx_pubs_list_is_active_true ON public."Pubs_List" USING btree (is_active) WHERE (is_active = true);
CREATE INDEX idx_favorite_pubs_user_id ON public.favorite_pubs USING btree (user_id);
CREATE INDEX idx_friendships_friend_id ON public.friendships USING btree (friend_id);
CREATE INDEX idx_friendships_status ON public.friendships USING btree (status);
CREATE INDEX idx_friendships_user_id ON public.friendships USING btree (user_id);
CREATE INDEX idx_league_members_league_id ON public.league_members USING btree (league_id);
CREATE INDEX idx_league_members_user_id ON public.league_members USING btree (user_id);
CREATE INDEX idx_leagues_created_by ON public.leagues USING btree (created_by);
CREATE UNIQUE INDEX leagues_code_key ON public.leagues USING btree (code);
CREATE INDEX idx_notification_outbox_pending ON public.notification_outbox USING btree (created_at) WHERE (sent_at IS NULL);
CREATE INDEX idx_pub_achievements_pub_id ON public.pub_achievements USING btree (pub_id);
CREATE UNIQUE INDEX idx_pub_achievements_pub_title ON public.pub_achievements USING btree (pub_id, lower(TRIM(BOTH FROM title)));
CREATE INDEX idx_user_push_tokens_user_id ON public.user_push_tokens USING btree (user_id);
CREATE INDEX idx_user_stats_score ON public.user_stats USING btree (total_score DESC);
CREATE UNIQUE INDEX idx_user_stats_user_id_unique ON public.user_stats USING btree (user_id);  -- duplicate of PK
CREATE INDEX idx_users_email ON public.users USING btree (email);
CREATE INDEX idx_users_username ON public.users USING btree (username);
CREATE INDEX idx_visited_pubs_pub_id ON public.visited_pubs USING btree (pub_id);
CREATE INDEX idx_visited_pubs_user_id ON public.visited_pubs USING btree (user_id);
-- Legacy tables
CREATE INDEX idx_pub_spatial_assignments_assignment_status ON public.pub_spatial_assignments USING btree (assignment_status);
CREATE INDEX idx_pub_spatial_assignments_corrected_borough_id ON public.pub_spatial_assignments USING btree (corrected_borough_id);
CREATE INDEX idx_pub_spatial_assignments_corrected_ward_id ON public.pub_spatial_assignments USING btree (corrected_ward_id);
CREATE INDEX idx_pub_spatial_assignments_postcode_area ON public.pub_spatial_assignments USING btree (postcode_area);
CREATE INDEX idx_pub_spatial_assignments_postcode_district ON public.pub_spatial_assignments USING btree (postcode_district);
CREATE INDEX idx_pubs_area ON public.pubs USING btree (area);
CREATE INDEX idx_pubs_area_ownership ON public.pubs USING btree (area, ownership);
CREATE INDEX idx_pubs_location ON public.pubs USING btree (lat, lon);
CREATE INDEX idx_pubs_name ON public.pubs USING btree (name);
CREATE INDEX idx_pubs_ownership ON public.pubs USING btree (ownership);
CREATE UNIQUE INDEX pubs_legacy_id_key ON public.pubs USING btree (legacy_id);
CREATE INDEX pubs_all_area_idx ON public.pubs_all USING btree (area);
CREATE INDEX pubs_all_area_ownership_idx ON public.pubs_all USING btree (area, ownership);
CREATE INDEX pubs_all_lat_lon_idx ON public.pubs_all USING btree (lat, lon);
CREATE UNIQUE INDEX pubs_all_legacy_id_idx ON public.pubs_all USING btree (legacy_id);
CREATE INDEX pubs_all_name_idx ON public.pubs_all USING btree (name);
CREATE INDEX pubs_all_ownership_idx ON public.pubs_all USING btree (ownership);


-- =============================================================================
-- 3. Functions
-- =============================================================================

-- --- 3a. App RPCs (EXECUTE granted to authenticated in section 6) -------------

CREATE OR REPLACE FUNCTION public.get_area_stats(p_user_id uuid)
 RETURNS TABLE(district text, postcode_area text, total bigint, visited bigint, percentage integer, center_lat double precision, center_lon double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH visited_ids AS (
    SELECT pub_id FROM public.visited_pubs WHERE user_id = p_user_id
  ),
  effective_pubs AS (
    SELECT
      pl.id,
      pl.lat,
      pl.lon,
      COALESCE(NULLIF(TRIM(pl.postcode_district), ''), 'Unknown') AS effective_district,
      COALESCE(NULLIF(TRIM(pl.postcode_area), ''), 'Unknown') AS effective_area
    FROM public."Pubs_List" pl
    WHERE pl.is_active = true
  )
  SELECT
    ep.effective_district AS district,
    MAX(ep.effective_area) AS postcode_area,
    COUNT(*)::BIGINT AS total,
    COUNT(v.pub_id)::BIGINT AS visited,
    CASE WHEN COUNT(*) > 0
      THEN ROUND((COUNT(v.pub_id)::NUMERIC / COUNT(*)) * 100)::INT
      ELSE 0
    END AS percentage,
    AVG(ep.lat::DOUBLE PRECISION) AS center_lat,
    AVG(ep.lon::DOUBLE PRECISION) AS center_lon
  FROM effective_pubs ep
  LEFT JOIN visited_ids v ON v.pub_id = ep.id
  GROUP BY ep.effective_district
  ORDER BY ep.effective_district;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_borough_stats(p_user_id uuid)
 RETURNS TABLE(postcode_area text, total_pubs bigint, visited_pubs bigint, percentage integer, total_districts bigint, completed_districts bigint, center_lat double precision, center_lon double precision, min_lat double precision, max_lat double precision, min_lon double precision, max_lon double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH visited_ids AS (
    SELECT pub_id FROM public.visited_pubs WHERE user_id = p_user_id
  ),
  effective_pubs AS (
    SELECT
      pl.id,
      pl.lat,
      pl.lon,
      COALESCE(NULLIF(TRIM(pl.postcode_district), ''), 'Unknown') AS effective_district,
      COALESCE(NULLIF(TRIM(pl.postcode_area), ''), 'Unknown') AS effective_area
    FROM public."Pubs_List" pl
    WHERE pl.is_active = true
  ),
  district_completion AS (
    SELECT
      ep.effective_area AS area_name,
      ep.effective_district AS district_name,
      COUNT(*) AS district_total,
      COUNT(v.pub_id) AS district_visited
    FROM effective_pubs ep
    LEFT JOIN visited_ids v ON v.pub_id = ep.id
    WHERE ep.effective_district IS NOT NULL
      AND TRIM(ep.effective_district) <> ''
      AND ep.effective_district <> 'Unknown'
    GROUP BY 1, 2
  ),
  area_district_agg AS (
    SELECT
      area_name,
      COUNT(*)::BIGINT AS total_districts,
      COUNT(*) FILTER (
        WHERE district_visited = district_total AND district_total > 0
      )::BIGINT AS completed_districts
    FROM district_completion
    GROUP BY area_name
  )
  SELECT
    ep.effective_area AS postcode_area,
    COUNT(*)::BIGINT AS total_pubs,
    COUNT(v.pub_id)::BIGINT AS visited_pubs,
    CASE WHEN COUNT(*) > 0
      THEN ROUND((COUNT(v.pub_id)::NUMERIC / COUNT(*)) * 100)::INT
      ELSE 0
    END AS percentage,
    COALESCE(ada.total_districts, 0)::BIGINT AS total_districts,
    COALESCE(ada.completed_districts, 0)::BIGINT AS completed_districts,
    AVG(ep.lat::DOUBLE PRECISION) AS center_lat,
    AVG(ep.lon::DOUBLE PRECISION) AS center_lon,
    MIN(ep.lat::DOUBLE PRECISION) AS min_lat,
    MAX(ep.lat::DOUBLE PRECISION) AS max_lat,
    MIN(ep.lon::DOUBLE PRECISION) AS min_lon,
    MAX(ep.lon::DOUBLE PRECISION) AS max_lon
  FROM effective_pubs ep
  LEFT JOIN visited_ids v ON v.pub_id = ep.id
  LEFT JOIN area_district_agg ada ON ada.area_name = ep.effective_area
  WHERE ep.effective_area IS NOT NULL
    AND TRIM(ep.effective_area) <> ''
    AND ep.effective_area <> 'Unknown'
  GROUP BY ep.effective_area, ada.total_districts, ada.completed_districts
  ORDER BY ep.effective_area;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_achievements(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_score             INT;
  v_level                   INT;
  v_pubs_visited            INT;
  v_district_trophies       JSONB;
  v_postcode_area_trophies  JSONB;
  v_pub_achievements        JSONB;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT s.total_score, s.level, s.pubs_visited
    INTO v_total_score, v_level, v_pubs_visited
    FROM public.user_stats s
   WHERE s.user_id = p_user_id;

  IF NOT FOUND THEN
    PERFORM public.compute_user_stats(p_user_id);
    SELECT s.total_score, s.level, s.pubs_visited
      INTO v_total_score, v_level, v_pubs_visited
      FROM public.user_stats s
     WHERE s.user_id = p_user_id;
  END IF;

  v_total_score := COALESCE(v_total_score, 0);
  v_level := COALESCE(v_level, 1);
  v_pubs_visited := COALESCE(v_pubs_visited, 0);

  WITH effective_pubs AS (
    SELECT
      pl.id,
      COALESCE(NULLIF(TRIM(pl.postcode_district), ''), 'Unknown') AS effective_district
    FROM public."Pubs_List" pl
    WHERE pl.is_active = true
  ),
  district_counts AS (
    SELECT
      ep.effective_district AS district_name,
      COUNT(*) AS total,
      COUNT(vp.pub_id) AS visited
    FROM effective_pubs ep
    LEFT JOIN public.visited_pubs vp
      ON vp.pub_id = ep.id AND vp.user_id = p_user_id
    WHERE ep.effective_district IS NOT NULL
      AND TRIM(ep.effective_district) <> ''
      AND ep.effective_district <> 'Unknown'
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',          'district-' || district_name,
        'type',        'district',
        'title',       district_name || ' Complete',
        'description', ROUND((visited::NUMERIC / GREATEST(total, 1)) * 100)::TEXT || '%',
        'isAchieved',  (visited = total AND total > 0),
        'total',       total,
        'visited',     visited
      ) ORDER BY (visited = total AND total > 0) DESC, district_name
    ), '[]'::JSONB)
  INTO v_district_trophies
  FROM district_counts;

  WITH effective_pubs AS (
    SELECT
      pl.id,
      COALESCE(NULLIF(TRIM(pl.postcode_area), ''), 'Unknown') AS effective_area
    FROM public."Pubs_List" pl
    WHERE pl.is_active = true
  ),
  area_counts AS (
    SELECT
      ep.effective_area AS area_name,
      COUNT(*) AS total,
      COUNT(vp.pub_id) AS visited
    FROM effective_pubs ep
    LEFT JOIN public.visited_pubs vp
      ON vp.pub_id = ep.id AND vp.user_id = p_user_id
    WHERE ep.effective_area IS NOT NULL
      AND TRIM(ep.effective_area) <> ''
      AND ep.effective_area <> 'Unknown'
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',          'postcode-area-' || area_name,
        'type',        'postcode_area',
        'title',       area_name || ' Champion',
        'description', ROUND((visited::NUMERIC / GREATEST(total, 1)) * 100)::TEXT || '%',
        'isAchieved',  (visited = total AND total > 0),
        'total',       total,
        'visited',     visited
      ) ORDER BY (visited = total AND total > 0) DESC, area_name
    ), '[]'::JSONB)
  INTO v_postcode_area_trophies
  FROM area_counts;

  SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',          'achievement-' || a.id::TEXT,
        'type',        'achievement',
        'title',       a.title,
        'description', COALESCE(NULLIF(TRIM(a.description), ''), pl.name),
        'points',      a.points,
        'isAchieved',  (vp.pub_id IS NOT NULL)
      ) ORDER BY (vp.pub_id IS NOT NULL) DESC, a.sort_order, a.title
    ), '[]'::JSONB)
  INTO v_pub_achievements
  FROM public.pub_achievements a
  JOIN public."Pubs_List" pl ON pl.id = a.pub_id
  LEFT JOIN public.visited_pubs vp
    ON vp.pub_id = a.pub_id AND vp.user_id = p_user_id;

  RETURN jsonb_build_object(
    'totalScore',           v_total_score,
    'level',                v_level,
    'pubsVisited',          v_pubs_visited,
    'districtTrophies',     v_district_trophies,
    'postcodeAreaTrophies', v_postcode_area_trophies,
    'pubAchievements',      v_pub_achievements
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_pubs(p_query text, p_limit integer DEFAULT 20)
 RETURNS TABLE(id text, name text, lat double precision, lon double precision, area text, borough text, postcode_district text, postcode_area text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    pl.id,
    pl.name,
    pl.lat::DOUBLE PRECISION,
    pl.lon::DOUBLE PRECISION,
    pl.postcode_district AS area,
    pl.postcode_area     AS borough,
    pl.postcode_district,
    pl.postcode_area
  FROM public."Pubs_List" pl
  WHERE pl.is_active = true
    AND pl.name ILIKE '%' || p_query || '%'
  ORDER BY
    CASE
      WHEN LOWER(pl.name) = LOWER(p_query)           THEN 0
      WHEN LOWER(pl.name) LIKE LOWER(p_query) || '%' THEN 1
      ELSE 2
    END,
    pl.name
  LIMIT LEAST(p_limit, 50);
$function$
;

CREATE OR REPLACE FUNCTION public.delete_my_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  DELETE FROM public.pub_reviews WHERE user_id = uid;
  DELETE FROM public.pub_drinks WHERE user_id = uid;
  DELETE FROM public.visited_pubs WHERE user_id = uid;
  DELETE FROM public.favorite_pubs WHERE user_id = uid;
  DELETE FROM public.friendships WHERE user_id = uid OR friend_id = uid;

  DELETE FROM public.league_members
  WHERE league_id IN (SELECT id FROM public.leagues WHERE created_by = uid);

  DELETE FROM public.leagues WHERE created_by = uid;

  DELETE FROM public.league_members WHERE user_id = uid;

  DELETE FROM public.user_stats WHERE user_id = uid;

  DELETE FROM public.users WHERE id = uid;

  DELETE FROM auth.users WHERE id = uid;
END;
$function$
;

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

-- --- 3b. Scoring (server-only) ------------------------------------------------
-- Score = 10 per visited pub + pub_achievements.points for visited pubs
--       + 1 per drink + report contributions (missing_pub 20, correction 5)
--       + tiered district completion bonus (40/60/80/100 by district size)
--       + 1000 per completed postcode area.  Level = floor(score/50) + 1.
-- Client mirror: utils/levelSystem.js

CREATE OR REPLACE FUNCTION public.postcode_district_completion_bonus(p_pub_count integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN COALESCE(p_pub_count, 0) < 10 THEN 40
    WHEN p_pub_count < 20 THEN 60
    WHEN p_pub_count < 30 THEN 80
    ELSE 100
  END;
$function$
;

CREATE OR REPLACE FUNCTION public.compute_user_stats(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pubs_visited              INT;
  v_pub_points                  INT;
  v_achievement_points          INT;
  v_district_completion_points  INT;
  v_completed_regions           INT;
  v_data_contribution_pts       INT;
  v_total_score                 INT;
  v_level                       INT;
  v_total_drinks                INT;
  v_system_recompute            boolean;
BEGIN
  v_system_recompute :=
    COALESCE(current_setting('app.system_stats_recompute', true), '') = 'true';

  IF NOT v_system_recompute
     AND auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)
    INTO v_pubs_visited
    FROM public.visited_pubs
   WHERE user_id = p_user_id;

  SELECT COALESCE(COUNT(*) * 10, 0)::INT
    INTO v_pub_points
    FROM public.visited_pubs vp
    JOIN public."Pubs_List" pl ON pl.id = vp.pub_id
   WHERE vp.user_id = p_user_id;

  SELECT COALESCE(SUM(a.points), 0)::INT
    INTO v_achievement_points
    FROM public.pub_achievements a
    JOIN public.visited_pubs vp
      ON vp.pub_id = a.pub_id AND vp.user_id = p_user_id
   WHERE a.points > 0;

  WITH effective_pubs AS (
    SELECT
      pl.id,
      COALESCE(NULLIF(TRIM(pl.postcode_district), ''), 'Unknown') AS effective_district,
      COALESCE(NULLIF(TRIM(pl.postcode_area), ''), 'Unknown') AS effective_area
    FROM public."Pubs_List" pl
    WHERE pl.is_active = true
  ),
  district_counts AS (
    SELECT ep.effective_district AS district_name,
           COUNT(*)::INT AS total,
           COUNT(vp.pub_id)::INT AS visited
      FROM effective_pubs ep
      LEFT JOIN public.visited_pubs vp
        ON vp.pub_id = ep.id AND vp.user_id = p_user_id
     WHERE ep.effective_district IS NOT NULL
       AND TRIM(ep.effective_district) <> ''
       AND ep.effective_district <> 'Unknown'
     GROUP BY ep.effective_district
  )
  SELECT COALESCE(SUM(public.postcode_district_completion_bonus(total)), 0)::INT
    INTO v_district_completion_points
    FROM district_counts
   WHERE visited = total AND total > 0;

  WITH effective_pubs AS (
    SELECT
      pl.id,
      COALESCE(NULLIF(TRIM(pl.postcode_area), ''), 'Unknown') AS effective_area
    FROM public."Pubs_List" pl
    WHERE pl.is_active = true
  ),
  region_counts AS (
    SELECT ep.effective_area AS area_name,
           COUNT(*)::INT AS total,
           COUNT(vp.pub_id)::INT AS visited
      FROM effective_pubs ep
      LEFT JOIN public.visited_pubs vp
        ON vp.pub_id = ep.id AND vp.user_id = p_user_id
     WHERE ep.effective_area IS NOT NULL
       AND TRIM(ep.effective_area) <> ''
       AND ep.effective_area <> 'Unknown'
     GROUP BY ep.effective_area
  )
  SELECT COUNT(*)::INT
    INTO v_completed_regions
    FROM region_counts
   WHERE visited = total AND total > 0;

  SELECT COALESCE(SUM(count), 0)::INT
    INTO v_total_drinks
    FROM public.pub_drinks
   WHERE user_id = p_user_id;

  SELECT COALESCE(
           SUM(
             CASE
               WHEN r.report_type = 'missing_pub' THEN 20
               WHEN r.report_type = 'pub_correction' THEN 5
               ELSE 0
             END
           ),
           0
         )::INT
    INTO v_data_contribution_pts
    FROM public.reports r
   WHERE r.reporter_id = p_user_id
     AND r.status IN ('approved', 'auto_applied');

  v_total_score := v_pub_points
                 + v_achievement_points
                 + v_total_drinks
                 + v_data_contribution_pts
                 + v_district_completion_points
                 + (v_completed_regions * 1000);
  v_level := FLOOR(v_total_score / 50.0)::INT + 1;

  INSERT INTO public.user_stats (user_id, pubs_visited, total_score, level, total_drinks, last_synced_at)
  VALUES (p_user_id, v_pubs_visited, v_total_score, v_level, v_total_drinks, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    pubs_visited   = EXCLUDED.pubs_visited,
    total_score    = EXCLUDED.total_score,
    level          = EXCLUDED.level,
    total_drinks   = EXCLUDED.total_drinks,
    last_synced_at = EXCLUDED.last_synced_at;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_user_total_drinks(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.compute_user_stats(p_user_id);
END;
$function$
;

-- --- 3c. Trigger functions ----------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Create user profile in public.users table
  INSERT INTO public.users (id, email, username, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'username',  -- Try to get username from metadata
      split_part(NEW.email, '@', 1)         -- Fallback to email prefix
    ),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = NOW();
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.seed_user_stats_on_create()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.user_stats (user_id, pubs_visited, total_score, level, last_synced_at)
  VALUES (NEW.id, 0, 0, 1, NOW())
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recompute_user_stats()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.compute_user_stats(OLD.user_id);
  ELSE
    PERFORM public.compute_user_stats(NEW.user_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_pub_drinks_sync_total_drinks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_user_total_drinks(OLD.user_id);
    RETURN OLD;
  END IF;
  PERFORM public.sync_user_total_drinks(NEW.user_id);
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.tr_delete_league_if_empty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.league_members
    WHERE league_id = OLD.league_id
  ) THEN
    DELETE FROM public.leagues
    WHERE id = OLD.league_id;
  END IF;
  RETURN OLD;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notification_jwt_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    auth.uid(),
    NULLIF(
      TRIM(BOTH '"' FROM current_setting('request.jwt.claim.sub', true)),
      ''
    )::uuid
  );
$function$
;

CREATE OR REPLACE FUNCTION public.tr_enqueue_friend_request_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.tr_enqueue_league_added_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- --- 3d. Reports: review + apply to Pubs_List (server-only) -------------------
-- Workflow: set reports.status = 'approved' in the dashboard →
-- trg_reports_after_status_change → apply_report_to_pub (geocodes missing pubs
-- via http_get_text) → compute_user_stats for the reporter.

CREATE OR REPLACE FUNCTION public.report_feature_bool(p_features jsonb, p_label text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_features IS NULL THEN NULL
    WHEN NOT (p_features ? p_label) THEN NULL
    ELSE COALESCE((p_features->>p_label)::boolean, false)
  END;
$function$
;

CREATE OR REPLACE FUNCTION public.uri_component(p text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c text;
  result text := '';
  b bytea;
  i int;
BEGIN
  IF p IS NULL THEN
    RETURN '';
  END IF;

  FOR c IN SELECT regexp_split_to_table(p, '') LOOP
    IF c ~ '^[-_.~0-9A-Za-z]$' THEN
      result := result || c;
    ELSIF c = ' ' THEN
      result := result || '+';
    ELSE
      b := convert_to(c, 'UTF8');
      FOR i IN 0 .. octet_length(b) - 1 LOOP
        result := result || '%' || upper(lpad(to_hex(get_byte(b, i)), 2, '0'));
      END LOOP;
    END IF;
  END LOOP;

  RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.http_get_text(p_url text, p_user_agent text DEFAULT 'PubTracker/1.0 (missing-pub geocode)'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_status int;
  v_content text;
BEGIN
  SELECT r.status, r.content
    INTO v_status, v_content
    FROM extensions.http((
      'GET',
      p_url,
      ARRAY[
        extensions.http_header('User-Agent', p_user_agent),
        extensions.http_header('Accept', 'application/json')
      ],
      NULL::text,
      NULL::text
    )::extensions.http_request) AS r;

  IF v_status IS NULL OR v_status < 200 OR v_status >= 300 THEN
    RAISE EXCEPTION 'HTTP status % from %', COALESCE(v_status::text, 'null'), p_url;
  END IF;

  RETURN v_content;
END;
$function$
;

-- Unused alternative to http_get_text (pg_net based).
CREATE OR REPLACE FUNCTION public.net_http_get_text(p_url text, p_timeout_ms integer DEFAULT 10000)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net', 'pg_temp'
AS $function$
DECLARE
  v_request_id bigint;
  v_response record;
  v_elapsed int := 0;
  v_headers jsonb := jsonb_build_object(
    'User-Agent', 'PubTracker/1.0 (missing-pub geocode; contact: admin@pubtracker.app)',
    'Accept', 'application/json'
  );
BEGIN
  SELECT net.http_get(url := p_url, headers := v_headers)
    INTO v_request_id;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'pg_net failed to enqueue HTTP GET';
  END IF;

  LOOP
    SELECT id, status_code, content, error_msg, timed_out
      INTO v_response
      FROM net._http_response
     WHERE id = v_request_id;

    IF FOUND THEN
      IF COALESCE(v_response.timed_out, false) THEN
        RAISE EXCEPTION 'HTTP timeout (pg_net)';
      END IF;
      IF v_response.error_msg IS NOT NULL AND trim(v_response.error_msg) <> '' THEN
        RAISE EXCEPTION 'HTTP error: %', v_response.error_msg;
      END IF;
      IF v_response.status_code IS NULL OR v_response.status_code < 200 OR v_response.status_code >= 300 THEN
        RAISE EXCEPTION 'HTTP status % from %', COALESCE(v_response.status_code::text, 'null'), p_url;
      END IF;
      RETURN v_response.content;
    END IF;

    PERFORM pg_sleep(0.05);
    v_elapsed := v_elapsed + 50;
    IF v_elapsed >= p_timeout_ms THEN
      RAISE EXCEPTION 'HTTP timeout after % ms', p_timeout_ms;
    END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.geocode_uk_address(p_housenumber text, p_street text, p_postcode text)
 RETURNS TABLE(lat double precision, lon double precision, source text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_hn text := NULLIF(trim(p_housenumber), '');
  v_street text := NULLIF(trim(p_street), '');
  v_postcode text := NULLIF(trim(p_postcode), '');
  v_street_line text;
  v_url text;
  v_body text;
  v_json jsonb;
  v_lat double precision;
  v_lon double precision;
BEGIN
  IF v_hn IS NULL THEN
    RAISE EXCEPTION 'house number is required for geocoding';
  END IF;
  IF v_street IS NULL THEN
    RAISE EXCEPTION 'street is required for geocoding';
  END IF;
  IF v_postcode IS NULL THEN
    RAISE EXCEPTION 'postcode is required for geocoding';
  END IF;

  v_street_line := v_hn || ' ' || v_street;

  v_url :=
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb'
    || '&street=' || public.uri_component(v_street_line)
    || '&postalcode=' || public.uri_component(v_postcode);

  BEGIN
    v_body := public.http_get_text(v_url);
    v_json := v_body::jsonb;

    IF jsonb_typeof(v_json) = 'array' AND jsonb_array_length(v_json) > 0 THEN
      v_lat := (v_json->0->>'lat')::double precision;
      v_lon := (v_json->0->>'lon')::double precision;
      IF v_lat IS NOT NULL AND v_lon IS NOT NULL THEN
        lat := v_lat;
        lon := v_lon;
        source := 'nominatim';
        RETURN NEXT;
        RETURN;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  v_url :=
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb'
    || '&q=' || public.uri_component(v_street_line || ', ' || v_postcode || ', UK');

  BEGIN
    v_body := public.http_get_text(v_url);
    v_json := v_body::jsonb;

    IF jsonb_typeof(v_json) = 'array' AND jsonb_array_length(v_json) > 0 THEN
      v_lat := (v_json->0->>'lat')::double precision;
      v_lon := (v_json->0->>'lon')::double precision;
      IF v_lat IS NOT NULL AND v_lon IS NOT NULL THEN
        lat := v_lat;
        lon := v_lon;
        source := 'nominatim_q';
        RETURN NEXT;
        RETURN;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  v_url := 'https://api.postcodes.io/postcodes/' || replace(v_postcode, ' ', '');

  BEGIN
    v_body := public.http_get_text(v_url);
    v_json := v_body::jsonb;

    IF COALESCE(v_json->>'status', '0')::int = 200 THEN
      v_lat := (v_json->'result'->>'latitude')::double precision;
      v_lon := (v_json->'result'->>'longitude')::double precision;
      IF v_lat IS NOT NULL AND v_lon IS NOT NULL THEN
        lat := v_lat;
        lon := v_lon;
        source := 'postcodes.io';
        RETURN NEXT;
        RETURN;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RAISE EXCEPTION 'could not geocode address: %, %, %', v_hn, v_street, v_postcode;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_report_to_pub(p_report_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  r public.reports%ROWTYPE;
  pl public."Pubs_List"%ROWTYPE;
  v_photo_count int;
  v_new_pub_id text;
  v_lat double precision;
  v_lon double precision;
  v_geo_source text;
BEGIN
  SELECT * INTO r FROM public.reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found';
  END IF;

  IF r.applied_at IS NOT NULL THEN
    RETURN;
  END IF;

  v_photo_count := CASE
    WHEN r.photo_urls IS NULL THEN 0
    ELSE LEAST(COALESCE(array_length(r.photo_urls, 1), 0), 5)
  END;

  IF r.report_type = 'missing_pub' THEN
    IF NULLIF(trim(r.addr_housenumber), '') IS NULL THEN
      RAISE EXCEPTION 'missing_pub requires house number (addr_housenumber)';
    END IF;
    IF NULLIF(trim(r.addr_street), '') IS NULL THEN
      RAISE EXCEPTION 'missing_pub requires street (addr_street)';
    END IF;
    IF NULLIF(trim(r.postcode), '') IS NULL THEN
      RAISE EXCEPTION 'missing_pub requires postcode';
    END IF;

    SELECT g.lat, g.lon, g.source
      INTO v_lat, v_lon, v_geo_source
      FROM public.geocode_uk_address(r.addr_housenumber, r.addr_street, r.postcode) g;

    v_new_pub_id := 'submission/' || gen_random_uuid()::text;

    INSERT INTO public."Pubs_List" (
      id, name, lat, lon, ownership,
      addr_housenumber, addr_street, postcode_district, postcode_area,
      website, phone, founded, description, opening_hours, is_active,
      has_pub_garden, has_live_music, has_food_available, has_dog_friendly,
      has_pool_darts, has_accommodation, has_live_sport,
      photo_url1, photo_url2, photo_url3, photo_url4, photo_url5
    ) VALUES (
      v_new_pub_id,
      COALESCE(NULLIF(trim(r.pub_name), ''), 'Unknown Pub'),
      v_lat, v_lon,
      r.chain_or_independent,
      r.addr_housenumber, r.addr_street, r.postcode_district, r.postcode_area,
      r.website, r.phone, r.founded, r.history, r.closing_time, true,
      COALESCE(public.report_feature_bool(r.features_snapshot, 'Pub garden'), false),
      COALESCE(public.report_feature_bool(r.features_snapshot, 'Live music'), false),
      COALESCE(public.report_feature_bool(r.features_snapshot, 'Food available'), false),
      COALESCE(public.report_feature_bool(r.features_snapshot, 'Dog friendly'), false),
      COALESCE(public.report_feature_bool(r.features_snapshot, 'Pool/darts'), false),
      COALESCE(public.report_feature_bool(r.features_snapshot, 'Accommodation'), false),
      COALESCE(public.report_feature_bool(r.features_snapshot, 'Live sport'), false),
      CASE WHEN v_photo_count >= 1 THEN r.photo_urls[1] END,
      CASE WHEN v_photo_count >= 2 THEN r.photo_urls[2] END,
      CASE WHEN v_photo_count >= 3 THEN r.photo_urls[3] END,
      CASE WHEN v_photo_count >= 4 THEN r.photo_urls[4] END,
      CASE WHEN v_photo_count >= 5 THEN r.photo_urls[5] END
    );

    UPDATE public.reports
       SET pub_id = v_new_pub_id,
           applied_at = now(),
           apply_error = NULL
     WHERE id = p_report_id;

    RETURN;
  END IF;

  IF r.report_type <> 'pub_correction' OR r.pub_id IS NULL THEN
    RAISE EXCEPTION 'report is not a pub correction with pub_id';
  END IF;

  SELECT * INTO pl FROM public."Pubs_List" WHERE id = r.pub_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pub not found: %', r.pub_id;
  END IF;

  UPDATE public."Pubs_List" SET
    name = COALESCE(NULLIF(trim(r.pub_name), ''), pl.name),
    ownership = COALESCE(r.chain_or_independent, pl.ownership),
    addr_housenumber = COALESCE(r.addr_housenumber, pl.addr_housenumber),
    addr_street = COALESCE(r.addr_street, pl.addr_street),
    postcode_district = COALESCE(r.postcode_district, pl.postcode_district),
    postcode_area = COALESCE(r.postcode_area, pl.postcode_area),
    website = COALESCE(r.website, pl.website),
    phone = COALESCE(r.phone, pl.phone),
    founded = COALESCE(r.founded, pl.founded),
    description = COALESCE(r.history, pl.description),
    is_active = CASE
      WHEN r.still_operating IS NOT NULL THEN r.still_operating
      ELSE pl.is_active
    END,
    opening_hours = CASE
      WHEN r.still_operating = false THEN 'closed'
      WHEN r.closing_time IS NOT NULL AND trim(r.closing_time) <> '' THEN r.closing_time
      ELSE pl.opening_hours
    END,
    has_pub_garden = COALESCE(public.report_feature_bool(r.features_snapshot, 'Pub garden'), pl.has_pub_garden),
    has_live_music = COALESCE(public.report_feature_bool(r.features_snapshot, 'Live music'), pl.has_live_music),
    has_food_available = COALESCE(public.report_feature_bool(r.features_snapshot, 'Food available'), pl.has_food_available),
    has_dog_friendly = COALESCE(public.report_feature_bool(r.features_snapshot, 'Dog friendly'), pl.has_dog_friendly),
    has_pool_darts = COALESCE(public.report_feature_bool(r.features_snapshot, 'Pool/darts'), pl.has_pool_darts),
    has_accommodation = COALESCE(public.report_feature_bool(r.features_snapshot, 'Accommodation'), pl.has_accommodation),
    has_live_sport = COALESCE(public.report_feature_bool(r.features_snapshot, 'Live sport'), pl.has_live_sport),
    photo_url1 = CASE WHEN v_photo_count >= 1 THEN r.photo_urls[1] ELSE pl.photo_url1 END,
    photo_url2 = CASE WHEN v_photo_count >= 2 THEN r.photo_urls[2] ELSE pl.photo_url2 END,
    photo_url3 = CASE WHEN v_photo_count >= 3 THEN r.photo_urls[3] ELSE pl.photo_url3 END,
    photo_url4 = CASE WHEN v_photo_count >= 4 THEN r.photo_urls[4] ELSE pl.photo_url4 END,
    photo_url5 = CASE WHEN v_photo_count >= 5 THEN r.photo_urls[5] ELSE pl.photo_url5 END
  WHERE id = r.pub_id;

  UPDATE public.reports
     SET applied_at = now(),
         apply_error = NULL
   WHERE id = p_report_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_report(p_report_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.reports
     SET status = 'approved'::public.report_status,
         reviewed_at = COALESCE(reviewed_at, now())
   WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found: %', p_report_id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_report(p_report_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.reports
     SET status = 'rejected'::public.report_status,
         reviewed_at = COALESCE(reviewed_at, now())
   WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found: %', p_report_id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_reports_after_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'approved'::public.report_status
     AND OLD.status IS DISTINCT FROM 'approved'::public.report_status
     AND NEW.applied_at IS NULL THEN
    PERFORM set_config('app.system_stats_recompute', 'true', true);
    BEGIN
      PERFORM public.apply_report_to_pub(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.reports
         SET status = 'apply_failed'::public.report_status,
             apply_error = SQLERRM
       WHERE id = NEW.id;
      RETURN NEW;
    END;
  END IF;

  IF NEW.reporter_id IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM set_config('app.system_stats_recompute', 'true', true);
    BEGIN
      PERFORM public.compute_user_stats(NEW.reporter_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'compute_user_stats failed for reporter %: %', NEW.reporter_id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_reports_recompute_user_stats()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.reporter_id IS NOT NULL THEN
    PERFORM public.compute_user_stats(NEW.reporter_id);
  END IF;
  RETURN NEW;
END;
$function$
;

-- --- 3e. Data-pipeline helpers (used in one-off SQL, not by the app) ----------

CREATE OR REPLACE FUNCTION public.pub_phone_digits(raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT regexp_replace(COALESCE(raw, ''), '[^0-9]', '', 'g');
$function$
;

CREATE OR REPLACE FUNCTION public.format_uk_phone_national(d text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF length(d) <> 11 OR left(d, 1) <> '0' THEN
    RETURN d;
  END IF;

  IF d LIKE '020%' THEN
    RETURN '(020) ' || substring(d FROM 4 FOR 4) || ' ' || substring(d FROM 8);
  END IF;

  IF d LIKE '07%' THEN
    RETURN substring(d FROM 1 FOR 5) || ' ' || substring(d FROM 6);
  END IF;

  -- 01xxx, 02x (non-London), 03xx, 08xx, etc.
  RETURN substring(d FROM 1 FOR 5) || ' ' || substring(d FROM 6);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_uk_phone(raw text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  s text;
  d text;
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN NULL;
  END IF;

  s := btrim(raw);
  s := regexp_replace(s, '\(\s*0\s*\)', '', 'g');
  -- +44 020… or +44 07… → drop redundant trunk 0 after country code
  s := regexp_replace(s, '^\+44\s*0', '+44 ', 'i');

  d := pub_phone_digits(s);

  -- 10-digit national without trunk 0
  IF length(d) = 10 THEN
    IF d ~ '^(20|7|3|8)' THEN
      d := '0' || d;
    END IF;
  END IF;

  -- International 12-digit → national 11-digit
  IF length(d) = 12 AND d LIKE '44%' THEN
    d := '0' || substring(d FROM 3);
  END IF;

  IF length(d) = 11 AND d LIKE '0%' THEN
    RETURN format_uk_phone_national(d);
  END IF;

  -- Unchanged if we cannot validate
  RETURN raw;
END;
$function$
;

-- NOTE: live definition — the '\\s' in the standard (non-E) strings below is a
-- literal backslash in the regex, so postcodes never match. Unused.
CREATE OR REPLACE FUNCTION public.uk_postcode_from_address(p_address text)
 RETURNS TABLE(district text, area text)
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH s AS (
    SELECT CASE
      WHEN p_address IS NULL OR length(trim(p_address)) = 0 THEN NULL::text
      ELSE upper(regexp_replace(p_address, E'[\\n\\r\\t]+', ' ', 'g'))
    END AS txt
  ),
  lastm AS (
    SELECT (rm.arr)[1] AS pc
    FROM s
    CROSS JOIN LATERAL regexp_matches(
      s.txt,
      '([A-Z]{1,2}[0-9]{1,2}[A-Z]?\\s?[0-9][A-Z]{2})',
      'gi'
    ) WITH ORDINALITY AS rm(arr, ord)
    ORDER BY rm.ord DESC
    LIMIT 1
  ),
  compact AS (
    SELECT regexp_replace(lastm.pc, '\\s+', '', 'g') AS c
    FROM lastm
    WHERE lastm.pc IS NOT NULL
  ),
  split AS (
    SELECT
      left(c, length(c) - 3) AS outward,
      right(c, 3) AS inward3
    FROM compact
    WHERE length(c) >= 5
      AND right(c, 3) ~ '^[0-9][A-Z]{2}$'
  )
  SELECT
    split.outward AS district,
    (regexp_match(split.outward, '^([A-Z]+)'))[1] AS area
  FROM split;
$function$
;

-- LEGACY: queries the unused `pubs` table.
CREATE OR REPLACE FUNCTION public.pubs_in_bounds(north_lat numeric, south_lat numeric, east_lon numeric, west_lon numeric)
 RETURNS TABLE(id uuid, name text, lat numeric, lon numeric, address text, phone text, description text, founded text, history text, area text, ownership text, photo_url text, points integer, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT p.*
  FROM pubs p
  WHERE p.lat BETWEEN south_lat AND north_lat
    AND p.lon BETWEEN west_lon AND east_lon;
END;
$function$
;


-- =============================================================================
-- 4. Triggers
-- =============================================================================
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER trg_seed_user_stats AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION seed_user_stats_on_create();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_recompute_user_stats AFTER INSERT OR DELETE ON public.visited_pubs FOR EACH ROW EXECUTE FUNCTION recompute_user_stats();
CREATE TRIGGER trg_pub_drinks_sync_total_drinks AFTER INSERT OR DELETE OR UPDATE OF count ON public.pub_drinks FOR EACH ROW EXECUTE FUNCTION trg_pub_drinks_sync_total_drinks();
CREATE TRIGGER trg_reports_recompute_user_stats AFTER INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION trg_reports_recompute_user_stats();
CREATE TRIGGER trg_reports_after_status_change AFTER UPDATE OF status ON public.reports FOR EACH ROW EXECUTE FUNCTION trg_reports_after_status_change();
CREATE TRIGGER tr_friend_request_notification AFTER INSERT ON public.friendships FOR EACH ROW EXECUTE FUNCTION tr_enqueue_friend_request_notification();
CREATE TRIGGER tr_league_member_added_notification AFTER INSERT ON public.league_members FOR EACH ROW EXECUTE FUNCTION tr_enqueue_league_added_notification();
CREATE TRIGGER tr_delete_league_if_empty AFTER DELETE ON public.league_members FOR EACH ROW EXECUTE FUNCTION tr_delete_league_if_empty();
CREATE TRIGGER update_leagues_updated_at BEFORE UPDATE ON public.leagues FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- =============================================================================
-- 5. Row Level Security policies
-- =============================================================================
-- No policies (server/service_role only): notification_outbox,
-- notification_monthly_digest_log.

-- Pubs_List / pub_achievements: public read, no client writes
CREATE POLICY pub_list_public_read ON public."Pubs_List" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY pub_achievements_public_read ON public.pub_achievements AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (true);

-- users
CREATE POLICY users_insert_own ON public.users AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT auth.uid() AS uid) = id));

CREATE POLICY users_select_authenticated ON public.users AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY users_update_own ON public.users AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT auth.uid() AS uid) = id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = id));

-- user_stats: read-only for clients
CREATE POLICY user_stats_select_all ON public.user_stats AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- visited_pubs / favorite_pubs: own rows; friends can read
CREATE POLICY visited_pubs_delete_own ON public.visited_pubs AS PERMISSIVE FOR DELETE TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY visited_pubs_insert_own ON public.visited_pubs AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY visited_pubs_select_own_or_friend ON public.visited_pubs AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM friendships f
  WHERE ((f.status = 'accepted'::text) AND (((f.user_id = ( SELECT auth.uid() AS uid)) AND (f.friend_id = visited_pubs.user_id)) OR ((f.friend_id = ( SELECT auth.uid() AS uid)) AND (f.user_id = visited_pubs.user_id))))))));

CREATE POLICY favorite_pubs_delete_own ON public.favorite_pubs AS PERMISSIVE FOR DELETE TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY favorite_pubs_insert_own ON public.favorite_pubs AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY favorite_pubs_select_own_or_friend ON public.favorite_pubs AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM friendships f
  WHERE ((f.status = 'accepted'::text) AND (((f.user_id = ( SELECT auth.uid() AS uid)) AND (f.friend_id = favorite_pubs.user_id)) OR ((f.friend_id = ( SELECT auth.uid() AS uid)) AND (f.user_id = favorite_pubs.user_id))))))));

-- pub_drinks: own rows only
CREATE POLICY pub_drinks_delete_own ON public.pub_drinks AS PERMISSIVE FOR DELETE TO authenticated
  USING ((auth.uid() = user_id));

CREATE POLICY pub_drinks_insert_own ON public.pub_drinks AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY pub_drinks_select_own ON public.pub_drinks AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() = user_id));

CREATE POLICY pub_drinks_update_own ON public.pub_drinks AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

-- pub_reviews: public read, own writes
CREATE POLICY "Reviews readable by all" ON public.pub_reviews AS PERMISSIVE FOR SELECT TO public
  USING (true);

CREATE POLICY pub_reviews_delete_own ON public.pub_reviews AS PERMISSIVE FOR DELETE TO authenticated
  USING ((auth.uid() = user_id));

CREATE POLICY pub_reviews_insert_own ON public.pub_reviews AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY pub_reviews_update_own ON public.pub_reviews AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

-- friendships
CREATE POLICY friendships_delete ON public.friendships AS PERMISSIVE FOR DELETE TO authenticated
  USING (((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = friend_id)));

CREATE POLICY friendships_insert ON public.friendships AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY friendships_select_own ON public.friendships AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR (friend_id = ( SELECT auth.uid() AS uid))));

CREATE POLICY friendships_update ON public.friendships AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = friend_id)))
  WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = friend_id)));

-- leagues / league_members
CREATE POLICY leagues_delete ON public.leagues AS PERMISSIVE FOR DELETE TO authenticated
  USING ((( SELECT auth.uid() AS uid) = created_by));

CREATE POLICY leagues_insert ON public.leagues AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT auth.uid() AS uid) = created_by));

CREATE POLICY leagues_select_all ON public.leagues AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY leagues_update ON public.leagues AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT auth.uid() AS uid) = created_by))
  WITH CHECK ((( SELECT auth.uid() AS uid) = created_by));

CREATE POLICY league_members_delete ON public.league_members AS PERMISSIVE FOR DELETE TO authenticated
  USING (((league_id IN ( SELECT leagues.id
   FROM leagues
  WHERE (leagues.created_by = ( SELECT auth.uid() AS uid)))) OR (user_id = ( SELECT auth.uid() AS uid))));

CREATE POLICY league_members_insert ON public.league_members AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) OR (league_id IN ( SELECT leagues.id
   FROM leagues
  WHERE (leagues.created_by = ( SELECT auth.uid() AS uid))))));

CREATE POLICY league_members_select_all ON public.league_members AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- reports: file own pending reports; read own
CREATE POLICY reports_insert_own_pending ON public.reports AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((reporter_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::report_status) AND (reviewed_at IS NULL) AND (reviewed_by IS NULL) AND (applied_at IS NULL) AND (apply_error IS NULL)));

CREATE POLICY reports_select_own ON public.reports AS PERMISSIVE FOR SELECT TO authenticated
  USING ((reporter_id = ( SELECT auth.uid() AS uid)));

-- user_push_tokens: own rows
CREATE POLICY user_push_tokens_delete_own ON public.user_push_tokens AS PERMISSIVE FOR DELETE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY user_push_tokens_insert_own ON public.user_push_tokens AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY user_push_tokens_select_own ON public.user_push_tokens AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY user_push_tokens_update_own ON public.user_push_tokens AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

-- Legacy tables
CREATE POLICY "Allow public read access to pubs" ON public.pubs AS PERMISSIVE FOR SELECT TO public
  USING (true);

CREATE POLICY "Allow public read access to pubs_all" ON public.pubs_all AS PERMISSIVE FOR SELECT TO public
  USING (true);

CREATE POLICY pubs_all_delete_service ON public.pubs_all AS PERMISSIVE FOR DELETE TO service_role
  USING (true);

CREATE POLICY pubs_all_insert_service ON public.pubs_all AS PERMISSIVE FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY pubs_all_update_service ON public.pubs_all AS PERMISSIVE FOR UPDATE TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY pub_spatial_assignments_delete_service ON public.pub_spatial_assignments AS PERMISSIVE FOR DELETE TO service_role
  USING (true);

CREATE POLICY pub_spatial_assignments_insert_service ON public.pub_spatial_assignments AS PERMISSIVE FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY pub_spatial_assignments_select_public ON public.pub_spatial_assignments AS PERMISSIVE FOR SELECT TO public
  USING (true);

CREATE POLICY pub_spatial_assignments_update_service ON public.pub_spatial_assignments AS PERMISSIVE FOR UPDATE TO service_role
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- 6. Privileges
-- =============================================================================
-- Start from nothing for client roles, then grant exactly what exists live.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT  ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Table privileges (RLS policies above decide which rows)
GRANT SELECT, INSERT, UPDATE, DELETE ON public."Pubs_List"                     TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pub_achievements                TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visited_pubs                    TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.favorite_pubs                   TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pub_drinks                      TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pub_reviews                     TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friendships                     TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leagues                         TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.league_members                  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_push_tokens                TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_outbox             TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_monthly_digest_log TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pubs                            TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pubs_all                        TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pub_spatial_assignments         TO anon, authenticated;
GRANT SELECT                         ON public.user_stats                      TO anon, authenticated;
GRANT SELECT, INSERT                 ON public.reports                         TO authenticated;

-- users: column-level so clients can never read email or change id/created_at
GRANT SELECT (id, username, created_at, updated_at, avatar_url)        ON public.users TO authenticated;
GRANT INSERT (id, email, username, created_at, updated_at, avatar_url) ON public.users TO authenticated;
GRANT UPDATE (username, updated_at, avatar_url)                        ON public.users TO authenticated;

-- Function privileges: only the RPCs the app calls
GRANT EXECUTE ON FUNCTION public.get_area_stats(uuid)                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_borough_stats(uuid)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_achievements(uuid)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_pubs(text, integer)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_account()                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_pub_summon_notifications(text, uuid[], text) TO authenticated;

-- Default privileges: new functions in public are not auto-granted to clients.
-- (New tables/sequences still are — Supabase default — rely on RLS.)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;


-- =============================================================================
-- 7. Storage & external config (not SQL-managed; recorded for reference)
-- =============================================================================
-- Storage bucket `pub-photos`: public, no size/MIME limits, no storage.objects
--   policies. Appears unused — photos are stored in Cloudflare R2 via the
--   `presign-r2-upload` Edge Function.
-- Edge Functions: supabase/functions/{presign-r2-upload,process-notification-queue,monthly-friends-digest}
-- Cron: cron-job.org (see CLAUDE.md).
