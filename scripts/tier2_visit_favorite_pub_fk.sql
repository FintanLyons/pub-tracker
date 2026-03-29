-- ============================================================================
-- Optional: FK from visited_pubs / favorite_pubs.pub_id → pubs_all(id)
-- ============================================================================
-- Run ONLY after tier2_security_hardening.sql (or equivalent) is applied.
-- If this errors on VALIDATE CONSTRAINT, you have visit rows whose pub_id is
-- not in pubs_all — clean or delete those rows first.
-- ============================================================================

DO $$
DECLARE
  orphan_visits INT;
  orphan_favs INT;
BEGIN
  SELECT COUNT(*) INTO orphan_visits
  FROM public.visited_pubs vp
  WHERE NOT EXISTS (SELECT 1 FROM public.pubs_all p WHERE p.id = vp.pub_id);

  SELECT COUNT(*) INTO orphan_favs
  FROM public.favorite_pubs fp
  WHERE NOT EXISTS (SELECT 1 FROM public.pubs_all p WHERE p.id = fp.pub_id);

  IF orphan_visits > 0 THEN
    RAISE EXCEPTION 'visited_pubs has % row(s) with pub_id not in pubs_all; fix data first', orphan_visits;
  END IF;

  IF orphan_favs > 0 THEN
    RAISE EXCEPTION 'favorite_pubs has % row(s) with pub_id not in pubs_all; fix data first', orphan_favs;
  END IF;
END $$;

ALTER TABLE public.visited_pubs
  DROP CONSTRAINT IF EXISTS visited_pubs_pub_id_fkey;

ALTER TABLE public.visited_pubs
  ADD CONSTRAINT visited_pubs_pub_id_fkey
  FOREIGN KEY (pub_id) REFERENCES public.pubs_all(id) ON DELETE CASCADE;

ALTER TABLE public.favorite_pubs
  DROP CONSTRAINT IF EXISTS favorite_pubs_pub_id_fkey;

ALTER TABLE public.favorite_pubs
  ADD CONSTRAINT favorite_pubs_pub_id_fkey
  FOREIGN KEY (pub_id) REFERENCES public.pubs_all(id) ON DELETE CASCADE;
