-- Migration 040: Interactive Guided Tour progress
--
-- Tracks each user's progress through the tier-aware product tour so completion
-- persists across devices. One row per (user, tour_type): the tour_type mirrors
-- the sequence the user was shown (starter / pro / enterprise / admin).
--
-- Progress is keyed by the REAL authenticated user (auth.actualUserId), not the
-- remapped workspace owner, so every team member has their own tour state.

CREATE TABLE IF NOT EXISTS tour_progress (
  progress_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  tour_type     TEXT NOT NULL,
  current_step  INTEGER NOT NULL DEFAULT 0,
  completed     BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, tour_type)
);

CREATE INDEX IF NOT EXISTS idx_tour_progress_user_id
  ON tour_progress (user_id);

DROP TRIGGER IF EXISTS trg_tour_progress_updated_at ON tour_progress;
CREATE TRIGGER trg_tour_progress_updated_at BEFORE UPDATE ON tour_progress
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
