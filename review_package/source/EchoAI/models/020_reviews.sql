-- Migration 020: Customer reviews (AI Reputation Management)
--
-- reviews stores customer reviews pulled from Google Business Profile, Facebook,
-- and manually-entered Yelp reviews, plus the AI-generated owner response and its
-- posting status. external_id is the platform's own review identifier (used to
-- de-duplicate on re-fetch and to post replies back); it is NULL for manual
-- (Yelp) entries.

CREATE TABLE IF NOT EXISTS reviews (
  review_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  platform        VARCHAR(20) NOT NULL,
  external_id     VARCHAR(255),
  reviewer_name   VARCHAR(255),
  star_rating     INTEGER NOT NULL CHECK (star_rating BETWEEN 1 AND 5),
  review_text     TEXT,
  response_text   TEXT,
  response_status VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (response_status IN ('pending', 'responded', 'ignored')),
  posted_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_brand_id ON reviews (brand_id);
CREATE INDEX IF NOT EXISTS idx_reviews_brand_platform ON reviews (brand_id, platform);

-- De-duplicate platform-sourced reviews on re-fetch (NULLs are distinct, so this
-- never blocks manual Yelp entries which have no external_id).
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_brand_platform_external
  ON reviews (brand_id, platform, external_id)
  WHERE external_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_reviews_updated_at ON reviews;
CREATE TRIGGER trg_reviews_updated_at BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
