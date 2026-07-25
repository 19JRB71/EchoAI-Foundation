-- 095_self_review.sql — Echo Self-Review (admin-only weekly platform study).
--
-- Every Monday (07:15, after the 05:00 learning study and 06:30 autopilot
-- batch), Sage studies the past week of REAL platform data — operational
-- failures, customer feedback, feature requests, learning signals, API quota
-- alerts, adoption — and produces evidence-based, ranked improvement
-- recommendations for the platform admin. Recommendation-only: nothing is ever
-- changed automatically; the admin reads the report and decides.
--
-- Concurrency: one report per ISO week. The runner claims the week atomically
-- by INSERTing the (unique) week_start row; overlapping runs lose the claim
-- and no-op. All terminal writes are status-guarded (WHERE status='running')
-- so out-of-band changes are never clobbered.
--
-- Honesty: the gathered evidence (including any per-probe read errors) is
-- stored BEFORE the AI call, so even a failed report shows the real data that
-- was collected — never "no data" in place of "could not read".

CREATE TABLE IF NOT EXISTS self_review_reports (
  report_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start   DATE NOT NULL UNIQUE,   -- Monday of the ISO week being reviewed
  status       TEXT NOT NULL DEFAULT 'running'
               CHECK (status IN ('running', 'completed', 'failed')),
  summary      TEXT,                   -- AI executive summary (completed only)
  evidence     JSONB,                  -- raw gathered evidence incl. readErrors
  error        TEXT,                   -- honest failure reason (failed only)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS self_review_items (
  item_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id      UUID NOT NULL REFERENCES self_review_reports (report_id) ON DELETE CASCADE,
  rank           INTEGER NOT NULL,     -- 1 = highest impact
  title          TEXT NOT NULL,
  recommendation TEXT NOT NULL,        -- what to improve and why
  evidence       TEXT,                 -- the real data backing this item
  impact         TEXT NOT NULL DEFAULT 'medium'
                 CHECK (impact IN ('high', 'medium', 'low')),
  status         TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new', 'planned', 'dismissed', 'done')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_self_review_items_report
  ON self_review_items (report_id, rank);
