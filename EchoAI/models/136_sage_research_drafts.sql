-- Prompt 022: Sage pre-interview public research drafts.
--
-- UNAPPROVED, source-tagged draft business profiles produced by Sage's
-- pre-interview research. ADDITIVE ONLY: research never writes authoritative
-- brands columns; the draft feeds the future interview/review flow (Prompt 023)
-- and will be versioned by Prompt 011.
--
-- Lifecycle (Company Truth pattern):
--   running -> complete | partial | empty | failed
--   a rerun marks the previous active draft 'superseded' transactionally.
-- Partial unique indexes enforce one running claim and one active draft per
-- brand, so concurrent runs 23505 -> 409 and mixed drafts are structurally
-- impossible.

CREATE TABLE IF NOT EXISTS sage_research_drafts (
  draft_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'complete', 'partial', 'empty', 'failed', 'superseded')),
  -- Field contract (011-forward): each key maps to
  --   { value, confidence: high|medium|low,
  --     sources: [ { source: website|facebook|public_web|inferred,
  --                  source_url, retrieved_at, excerpt, basis } ],  -- ordered; [0] = primary evidence
  --     conflict: boolean, alternatives: [ { value, sources: [...] } ] }
  fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  stop_reason TEXT,
  error_message TEXT,
  ai_cost_cents INTEGER,
  elapsed_ms INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One in-flight research claim per brand (second claim -> 23505 -> 409).
CREATE UNIQUE INDEX IF NOT EXISTS idx_sage_research_one_running
  ON sage_research_drafts (brand_id) WHERE status = 'running';

-- One active (presentable) draft per brand; reruns supersede transactionally.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sage_research_one_active
  ON sage_research_drafts (brand_id) WHERE status IN ('complete', 'partial', 'empty');

CREATE INDEX IF NOT EXISTS idx_sage_research_brand
  ON sage_research_drafts (brand_id, created_at DESC);
