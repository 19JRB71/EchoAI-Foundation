-- Echo voice speech-pattern learning: per-owner phrases Echo has learned to
-- map to actions (stop / yes / no / briefing / briefing_quick / status).
-- Learned when a misheard phrase is repeated in a form Echo understands.
CREATE TABLE IF NOT EXISTS voice_learned_phrases (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  phrase TEXT NOT NULL,
  action TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, phrase)
);

CREATE INDEX IF NOT EXISTS idx_voice_learned_phrases_user
  ON voice_learned_phrases (user_id, hits DESC);
