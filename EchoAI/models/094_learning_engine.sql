-- Learning Engine: Echo learns the owner's taste from every review decision.
--
-- Every approve / decline / revise (autopilot batch review AND the interactive
-- voice content flow) is logged as a raw signal. Once a week Sage studies the
-- accumulated signals and distills them into plain-English learnings ("James
-- prefers short posts with no emojis") that are injected into every future
-- drafting prompt. When a pattern is ambiguous, the study produces an OPEN
-- QUESTION instead of guessing — Echo asks it in the morning briefing and the
-- owner can answer or dismiss it in the Autopilot section.
-- Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS echo_learning_signals (
  signal_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('autopilot', 'voice_content')),
  item_type       TEXT NOT NULL CHECK (item_type IN ('post', 'ad')),
  platform        TEXT,
  action          TEXT NOT NULL CHECK (action IN ('approve', 'decline', 'revise')),
  instruction     TEXT,                  -- the owner's spoken change request (revise only)
  content_excerpt TEXT,                  -- first ~300 chars of the content decided on
  distilled_at    TIMESTAMPTZ,           -- set once the weekly study has consumed it
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_signals_brand
  ON echo_learning_signals (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_signals_undistilled
  ON echo_learning_signals (brand_id) WHERE distilled_at IS NULL;

CREATE TABLE IF NOT EXISTS echo_learnings (
  learning_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id       UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  insight        TEXT NOT NULL,          -- short imperative preference statement
  category       TEXT NOT NULL DEFAULT 'content_preference',
                 -- content_preference | ad_preference | platform_insight | owner_answer
  evidence_count INTEGER NOT NULL DEFAULT 1,
  active         BOOLEAN NOT NULL DEFAULT TRUE,  -- owner can tell Echo to forget one
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_echo_learnings_brand_insight UNIQUE (brand_id, insight)
);

CREATE INDEX IF NOT EXISTS idx_echo_learnings_brand
  ON echo_learnings (brand_id, active, updated_at DESC);

CREATE TABLE IF NOT EXISTS echo_open_questions (
  question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  question    TEXT NOT NULL,             -- plain-English question for the owner
  context     TEXT,                      -- why Echo is asking (the ambiguous pattern)
  status      TEXT NOT NULL DEFAULT 'pending',
              -- pending | asked | answered | dismissed
  answer      TEXT,
  asked_at    TIMESTAMPTZ,               -- when the briefing surfaced it
  answered_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_echo_open_questions_brand_question UNIQUE (brand_id, question)
);

CREATE INDEX IF NOT EXISTS idx_echo_open_questions_open
  ON echo_open_questions (user_id, created_at)
  WHERE status IN ('pending', 'asked');
