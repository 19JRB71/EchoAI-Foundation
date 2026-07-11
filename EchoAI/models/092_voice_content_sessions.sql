-- Voice-driven content creation (Echo hands-free flow)
--
-- "Hey Echo, let's create some content" starts a voice_content_session: Echo
-- gathers the brand's real intelligence (profile, post performance, competitor
-- ads), Claude drafts posts + image briefs (or asks clarifying questions when
-- confidence is low), each draft gets a DALL-E visual, and NOTHING is scheduled
-- until the owner says "approve" — approval copies the draft into the existing
-- social_posts lifecycle as a 'scheduled' row. Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS voice_content_sessions (
  session_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'drafting',
               -- drafting | awaiting_answers | reviewing | completed | cancelled
  request_text TEXT,                          -- what the owner asked for, verbatim
  questions    JSONB NOT NULL DEFAULT '[]'::jsonb, -- clarifying questions (when unsure)
  answers      JSONB NOT NULL DEFAULT '[]'::jsonb, -- owner's spoken answers
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_content_sessions_brand
  ON voice_content_sessions (brand_id, created_at DESC);

CREATE TABLE IF NOT EXISTS voice_content_drafts (
  draft_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL REFERENCES voice_content_sessions (session_id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,            -- review order (1-based)
  platform       social_platform NOT NULL,
  post_content   TEXT NOT NULL,
  visual_idea    TEXT,                        -- the AI's short visual brief (spoken to owner)
  image_prompt   TEXT,                        -- engineered DALL-E prompt (set at image time)
  image_url      TEXT,                        -- permanent /uploads/images/... path once rendered
  scheduled_time TIMESTAMPTZ,                 -- proposed UTC instant (brand-tz wall clock)
  rationale      TEXT,                        -- why Echo chose this angle (grounded in real data)
  status         TEXT NOT NULL DEFAULT 'pending',
                 -- pending | approved | skipped
  posted_post_id UUID REFERENCES social_posts (post_id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_content_drafts_session
  ON voice_content_drafts (session_id, position);

-- Approved voice drafts carry their visual through the normal publish pipeline.
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS image_url TEXT;

-- updated_at triggers (same convention as the rest of the schema)
DROP TRIGGER IF EXISTS trg_voice_content_sessions_updated_at ON voice_content_sessions;
CREATE TRIGGER trg_voice_content_sessions_updated_at BEFORE UPDATE ON voice_content_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_voice_content_drafts_updated_at ON voice_content_drafts;
CREATE TRIGGER trg_voice_content_drafts_updated_at BEFORE UPDATE ON voice_content_drafts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
