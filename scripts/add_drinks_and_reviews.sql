-- Drinks counter — one row per (user, pub), manually maintained by the user
CREATE TABLE IF NOT EXISTS pub_drinks (
  user_id    UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pub_id     UUID    NOT NULL REFERENCES pubs_all(id) ON DELETE CASCADE,
  count      INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, pub_id)
);

ALTER TABLE pub_drinks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own drinks"
  ON pub_drinks FOR ALL
  USING (auth.uid() = user_id);

-- Reviews — one review per (user, pub); star rating + optional text
CREATE TABLE IF NOT EXISTS pub_reviews (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pub_id     UUID        NOT NULL REFERENCES pubs_all(id) ON DELETE CASCADE,
  rating     SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body       TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, pub_id)
);

ALTER TABLE pub_reviews ENABLE ROW LEVEL SECURITY;

-- All users can read all reviews
CREATE POLICY "Reviews readable by all"
  ON pub_reviews FOR SELECT
  USING (true);

-- Users can only insert / update / delete their own review
CREATE POLICY "Authors manage own review"
  ON pub_reviews FOR ALL
  USING (auth.uid() = user_id);
