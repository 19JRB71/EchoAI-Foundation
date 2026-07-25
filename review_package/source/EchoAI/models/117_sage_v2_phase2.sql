-- Sage V2 Phase 2 (approved architecture: SAGE_V2_PHASE2_ARCHITECTURE.md).
-- Additive only; every runtime behavior is behind SAGE_V2_INTEL_STORE /
-- SAGE_V2_JOB_QUEUE / SAGE_V2_SKIP_GATES / SAGE_V2_DQ_SENTRY (default OFF),
-- so these tables stay dormant until enabled.

-- --- canonical intelligence store -------------------------------------------
-- The single write path for ALL Sage intelligence going forward (W2: no dual
-- writes, no adapters). Column names deliberately match sage_intelligence_feed
-- so every existing reader works against either relation with only the table
-- name switched (utils/intelStore.js owns that switch). item_id is backfilled
-- FROM feed_id so dedup/soft-dismiss history survives the cutover byte-for-byte.
CREATE TABLE IF NOT EXISTS sage_intel_items (
  item_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  source_type     TEXT NOT NULL DEFAULT 'trend',   -- trend | competitor | regulation | opportunity | threat | market | site_change | ad_intel
  summary         TEXT NOT NULL,
  why_it_matters  TEXT NOT NULL,
  url             TEXT,
  source_title    TEXT,
  urgent          BOOLEAN NOT NULL DEFAULT FALSE,
  signal_key      TEXT NOT NULL,
  content_key     TEXT,
  dismissed_at    TIMESTAMPTZ,
  -- New V2 columns (unused by legacy-shaped readers):
  confidence      TEXT NOT NULL DEFAULT 'reported', -- how sure we are of the finding
  sensitive       BOOLEAN NOT NULL DEFAULT FALSE,   -- conversation-derived etc: owner-only, never aggregated
  source          TEXT NOT NULL DEFAULT 'sage_research', -- which collector wrote it
  source_ref      TEXT,                             -- link to the raw detail row (e.g. competitor_ads.ad_id)
  expires_at      TIMESTAMPTZ,                      -- time-boxed signals (readers may ignore expired)
  conflict_of     UUID REFERENCES sage_intel_items (item_id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sage_intel_confidence_chk CHECK (confidence IN ('verified', 'reported', 'inferred'))
);

CREATE INDEX IF NOT EXISTS idx_sage_intel_brand
  ON sage_intel_items (brand_id, created_at DESC);

-- Mirror the feed's proven dual-key dedup contract exactly:
-- one row per (brand, signal_key) ever; one VISIBLE row per (brand, content_key).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sage_intel_signal
  ON sage_intel_items (brand_id, signal_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sage_intel_content_visible
  ON sage_intel_items (brand_id, content_key)
  WHERE dismissed_at IS NULL AND content_key IS NOT NULL;

-- Idempotent backfill of the existing feed history (keys preserved). Runs again
-- harmlessly; rows written to the legacy feed AFTER this migration are caught
-- up by the same statement executed at cutover (intelStore.backfillFromFeed).
INSERT INTO sage_intel_items
  (item_id, brand_id, source_type, summary, why_it_matters, url, source_title,
   urgent, signal_key, content_key, dismissed_at, created_at)
SELECT feed_id, brand_id, source_type, summary, why_it_matters, url, source_title,
       urgent, signal_key, content_key, dismissed_at, created_at
  FROM sage_intelligence_feed
ON CONFLICT (item_id) DO NOTHING;

-- --- job queue claim table (W7: horizontal headroom, house pattern) ---------
-- Scheduler ticks ENQUEUE per-brand work; a worker CLAIMS rows with
-- FOR UPDATE SKIP LOCKED and drains them. brand_id is NULL for global jobs, so
-- uniqueness uses a COALESCEd expression index (NULLs would otherwise dup).
CREATE TABLE IF NOT EXISTS sage_job_queue (
  job_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type     TEXT NOT NULL,
  brand_id     UUID REFERENCES brands (brand_id) ON DELETE CASCADE,
  run_key      TEXT NOT NULL,                 -- e.g. deep:2026-07-20
  status       TEXT NOT NULL DEFAULT 'queued',
  input_hash   TEXT,                          -- hash that ran (or matched, when skipped)
  claimed_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sage_job_status_chk CHECK (
    status IN ('queued', 'running', 'done', 'failed', 'skipped_unchanged')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sage_job_once
  ON sage_job_queue (job_type, COALESCE(brand_id::text, 'global'), run_key);
CREATE INDEX IF NOT EXISTS idx_sage_job_claim
  ON sage_job_queue (status, created_at) WHERE status = 'queued';

-- --- last-run input hashes (skip gates on ALL recurring AI jobs) -------------
-- One row per (job_type, brand). Unchanged inputs => the job records
-- 'skipped_unchanged' and makes ZERO AI calls. Missing/incomputable hash =>
-- the job RUNS (fail-open on cost, never on staleness).
CREATE TABLE IF NOT EXISTS sage_job_hashes (
  job_type     TEXT NOT NULL,
  brand_id     UUID REFERENCES brands (brand_id) ON DELETE CASCADE,
  last_hash    TEXT NOT NULL,
  last_run_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_status  TEXT NOT NULL DEFAULT 'done'
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sage_job_hash
  ON sage_job_hashes (job_type, COALESCE(brand_id::text, 'global'));

-- --- data-quality sentry flags (deterministic, zero AI) ----------------------
-- Nightly rule-based checks write one OPEN flag per (brand, rule, subject);
-- re-detection is a no-op while the flag stays open, and a resolved/dismissed
-- flag can be re-raised later (partial unique on open rows only).
CREATE TABLE IF NOT EXISTS sage_data_quality_flags (
  flag_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  rule_id     TEXT NOT NULL,                  -- e.g. stale_company_truth, coverage_gap_analytics, conflicting_items
  dedup_key   TEXT NOT NULL,                  -- rule-specific subject key
  severity    TEXT NOT NULL DEFAULT 'info',
  message     TEXT NOT NULL,                  -- plain-English, traceable to the rule — never AI-generated
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT sage_dq_severity_chk CHECK (severity IN ('info', 'warning', 'critical')),
  CONSTRAINT sage_dq_status_chk CHECK (status IN ('open', 'resolved', 'dismissed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sage_dq_open
  ON sage_data_quality_flags (brand_id, rule_id, dedup_key)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_sage_dq_brand
  ON sage_data_quality_flags (brand_id, status, created_at DESC);

-- updated_at triggers (house pattern)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sage_intel_items_set_updated_at') THEN
    CREATE TRIGGER sage_intel_items_set_updated_at
      BEFORE UPDATE ON sage_intel_items
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sage_job_queue_set_updated_at') THEN
    CREATE TRIGGER sage_job_queue_set_updated_at
      BEFORE UPDATE ON sage_job_queue
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
