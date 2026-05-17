-- ============================================================================
-- Historic pub milestones — run in Supabase SQL Editor after create_pub_achievements_table.sql
-- ============================================================================
-- pub_id values match Pubs_List.id (OSM way/node/… or Supabase UUID for manual rows).
-- points = bonus score when the user visits that pub (on top of the usual +10 visit).
-- Re-run safe: removes prior rows for these pubs with the same titles, then re-inserts.
-- ============================================================================

DELETE FROM public.pub_achievements
 WHERE pub_id IN (
   'way/204148499',
   'way/334243397',
   'way/90830736',
   'node/13386371751',
   'way/195200692',
   'way/185312889',
   'way/444744679',
   'node/288045288',
   'way/420644092',
   'way/60186067',
   'way/159751191',
   'node/13235500301',
   'way/565171598',
   'way/166320158',
   'way/192794336',
   'way/99275253',
   'node/1497452168',
   'way/944382658',
   '8e4e58c7-07e1-4707-af1f-aee7853fb23f',
   'way/342206350',
   'way/810341385',
   'way/188091841',
   'node/6119354792',
   'node/4250008044',
   'way/558503742'
 );

INSERT INTO public.pub_achievements (pub_id, title, points, sort_order)
SELECT v.pub_id, v.title, v.points, v.sort_order
  FROM (
    VALUES
      ('way/204148499',     'Oldest Pub in London',                          50, 0),
      ('way/334243397',     'Historic London Pub',                           25, 0),
      ('way/90830736',      'Only Surviving Galleried London Coaching Inn', 25, 0),
      ('way/195200692',     'Historic London Pub',                           25, 0),
      ('way/185312889',     'Historic London Pub',                           25, 0),
      ('way/444744679',     'Historic London Pub',                           25, 0),
      ('node/288045288',    'Historic London Pub',                           25, 0),
      ('way/420644092',     'Historic London Pub',                           25, 0),
      ('way/60186067',      'Historic London Pub',                           25, 0),
      ('way/159751191',     'Historic London Pub',                           25, 0),
      ('node/13235500301',  'Haunted Historic Pub',                          25, 0),
      ('way/565171598',     'Traditionally Famous for Bare-Knuckle Prize Fights', 25, 0),
      ('way/166320158',     'Site of Former Medieval Dominican Friary',      25, 0),
      ('way/192794336',     'Most Photographed Pub in London',               25, 0),
      ('way/99275253',      'Former Bank of England',                        25, 0),
      ('node/1497452168',    'London''s First Coffee House',                  25, 0),
      ('way/944382658',      'Only Michelin-Starred London Pub',              25, 0),
      ('8e4e58c7-07e1-4707-af1f-aee7853fb23f', 'Best London Guinness',        25, 0),
      ('way/342206350',      'National Pub & Bar Awards Winner 2024',         25, 0),
      ('way/810341385',      'National Pub & Bar Awards Winner 2025',         25, 0),
      ('way/188091841',      'National Pub & Bar Awards Winner 2023',         25, 0),
      ('node/6119354792',    'National Pub & Bar Awards Winner 2021',         25, 0),
      ('node/4250008044',    'Opentable Gastropub of the Year 2026',          25, 0),
      ('way/558503742',      'Multiple Real Ale CAMRA Award Winner',          25, 0)
  ) AS v(pub_id, title, points, sort_order)
 WHERE EXISTS (
   SELECT 1 FROM public."Pubs_List" pl WHERE pl.id = v.pub_id
 );

-- Refresh scores for anyone who already visited these pubs
DO $$
DECLARE
  uid UUID;
BEGIN
  FOR uid IN SELECT DISTINCT user_id FROM public.visited_pubs LOOP
    PERFORM public.compute_user_stats(uid);
  END LOOP;
END $$;

-- Preview
SELECT a.pub_id, pl.name, a.title, a.points
  FROM public.pub_achievements a
  JOIN public."Pubs_List" pl ON pl.id = a.pub_id
 WHERE a.pub_id IN (
   'way/204148499',
   'way/334243397',
   'way/90830736',
   'way/195200692',
   'way/185312889',
   'way/444744679',
   'node/288045288',
   'way/420644092',
   'way/60186067',
   'way/159751191',
   'node/13235500301',
   'way/565171598',
   'way/166320158',
   'way/192794336',
   'way/99275253',
   'node/1497452168',
   'way/944382658',
   '8e4e58c7-07e1-4707-af1f-aee7853fb23f',
   'way/342206350',
   'way/810341385',
   'way/188091841',
   'node/6119354792',
   'node/4250008044',
   'way/558503742'
 )
 ORDER BY a.points DESC, pl.name;
