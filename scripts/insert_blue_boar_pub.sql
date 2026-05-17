-- ============================================================================
-- Add Blue Boar Pub (Westminster) — not in OSM import
-- ============================================================================
-- Source: https://blueboarlondon.com/
-- Run in Supabase SQL Editor after pub_list_migration + create_pub_achievements_table.
--
-- Uses a new UUID as Pubs_List.id (same pattern as Devonshire, Wheatsheaf).
-- Verify lat/lon on the map after insert; tweak if the pin is off.
-- ============================================================================

DO $$
DECLARE
  v_pub_id TEXT := gen_random_uuid()::TEXT;
BEGIN
  INSERT INTO public."Pubs_List" (
    id,
    name,
    lat,
    lon,
    postcode_district,
    postcode_area,
    ownership,
    description,
    addr_housenumber,
    addr_street,
    phone,
    website,
    opening_hours,
    has_food_available,
    has_live_music,
    has_dog_friendly,
    has_pub_garden,
    has_pool_darts,
    has_accommodation,
    has_live_sport
  ) VALUES (
    v_pub_id,
    'Blue Boar Pub',
    51.499416,
    -0.131892,
    'SW1H',
    'SW',
    'Conrad London St. James',
    'Blue Boar Pub is a comfortable, modern take on the classic London pub in Westminster — a real local at the heart of the city. The menu focuses on British pub dining, with craft and international beers, a diverse wine list, cocktails and top-tier spirits, honouring the venue''s history with a forward-looking team.

Open daily from midday until 11pm. Saturdays feature bottomless brunch; Sundays bring roasts from 12pm–10pm (including a Beef Wellington option, limited portions, booking recommended) with live music 7–9pm. Friday evenings also have live music 7–9pm. Dogs are welcome (on a lead, at your table or feet).

Awards: Best Pub & Bar in Greater London and Greater London county winner at the National Pub & Bar Awards 2022; Estrella Damm Top 50 Gastropubs “One to Watch” 2022.',
    '45',
    'Tothill Street',
    '+44 20 3301 8080',
    'https://blueboarlondon.com/',
    'Mo-Su 12:00-23:00',
    TRUE,
    TRUE,
    TRUE,
    FALSE,
    FALSE,
    FALSE,
    FALSE
  );

  INSERT INTO public.pub_achievements (pub_id, title, points, sort_order)
  VALUES (v_pub_id, 'National Pub & Bar Awards Winner 2022', 25, 0);

  RAISE NOTICE 'Blue Boar Pub inserted with id: %', v_pub_id;
END $$;

-- Confirm pub + milestone
SELECT pl.id, pl.name, pl.postcode_district, pl.website, a.title, a.points
  FROM public."Pubs_List" pl
  LEFT JOIN public.pub_achievements a ON a.pub_id = pl.id
 WHERE pl.name ILIKE '%Blue Boar%'
   AND pl.addr_street ILIKE '%Tothill%';
