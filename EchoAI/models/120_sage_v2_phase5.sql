-- Sage V2 Phase 5 (Milestone 5): Opportunity queue + Directive Bus +
-- decisions table + Change Diagnostics. Additive only; all runtime behavior
-- is behind SAGE_V2_OPPORTUNITIES / SAGE_V2_DIRECTIVES /
-- SAGE_V2_CHANGE_DIAGNOSTICS / SAGE_V2_KNOWLEDGE_PAGE (default OFF), so
-- these tables stay dormant until enabled.
-- See SAGE_V2_PHASE5_ARCHITECTURE.md. No uuid[] arrays (W3): junction tables.

-- --- Opportunity queue (§4) ----------------------------------------------------
-- confidence is code-recomputed as min of cited evidence (never AI-asserted).
-- expected_impact_cents must carry impact_basis or stay NULL (never fabricated).
-- Max-5-open cap is enforced in code under the per-brand advisory lock (a DB
-- CHECK cannot count rows). rationale JSONB is written once and immutable.
CREATE TABLE IF NOT EXISTS sage_opportunities (
  opportunity_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  thesis          TEXT NOT NULL,
  category        TEXT NOT NULL,
  confidence      TEXT NOT NULL,
  expected_impact_cents BIGINT,
  impact_basis    TEXT,
  cost_estimate_cents   BIGINT,
  effort          TEXT,
  risk            TEXT,
  recommended_department TEXT NOT NULL,
  success_metric  JSONB,
  failure_metric  JSONB,
  constraint_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  rationale       JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_key     TEXT NOT NULL,        -- dedup: brand+category+thesis stem
  status          TEXT NOT NULL DEFAULT 'proposed',
  reviewed_at     TIMESTAMPTZ,          -- owner first opened detail (lifecycle "Reviewed")
  owner_decision_note TEXT,
  decided_at      TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  measured_result JSONB,
  lesson          TEXT,
  synthesis_run_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sage_opps_confidence_chk CHECK (confidence IN ('verified', 'reported', 'inferred')),
  CONSTRAINT sage_opps_effort_chk CHECK (effort IS NULL OR effort IN ('s', 'm', 'l')),
  CONSTRAINT sage_opps_dept_chk CHECK (
    recommended_department IN ('nova', 'atlas', 'forge', 'pulse', 'voice', 'owner')
  ),
  CONSTRAINT sage_opps_status_chk CHECK (status IN (
    'proposed', 'approved', 'declined', 'expired',
    'directed', 'in_progress', 'executed', 'measuring',
    'succeeded', 'failed', 'inconclusive', 'archived'
  )),
  CONSTRAINT sage_opps_impact_basis_chk CHECK (
    expected_impact_cents IS NULL OR impact_basis IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_sage_opps_brand_status
  ON sage_opportunities (brand_id, status, created_at DESC);

-- Same opportunity never proposed twice while one is open; open = pre-terminal.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sage_opps_open_content
  ON sage_opportunities (brand_id, content_key)
  WHERE status IN ('proposed', 'approved', 'directed', 'in_progress', 'executed', 'measuring');

-- --- Evidence junction (W3: no uuid[]) — "no evidence, no opportunity" --------
CREATE TABLE IF NOT EXISTS sage_opportunity_evidence (
  opportunity_id UUID NOT NULL REFERENCES sage_opportunities (opportunity_id) ON DELETE CASCADE,
  item_id        UUID NOT NULL REFERENCES sage_intel_items (item_id) ON DELETE RESTRICT,
  claim          TEXT,   -- the one-line contribution shown in the confidence explanation
  PRIMARY KEY (opportunity_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_sage_opp_evidence_item
  ON sage_opportunity_evidence (item_id);

CREATE TABLE IF NOT EXISTS sage_opportunity_deps (
  opportunity_id UUID NOT NULL REFERENCES sage_opportunities (opportunity_id) ON DELETE CASCADE,
  depends_on_id  UUID NOT NULL REFERENCES sage_opportunities (opportunity_id) ON DELETE CASCADE,
  PRIMARY KEY (opportunity_id, depends_on_id),
  CONSTRAINT sage_opp_deps_no_self CHECK (opportunity_id <> depends_on_id)
);

-- --- Directive Bus (§9) --------------------------------------------------------
-- Structured handoff of an APPROVED opportunity to a department's EXISTING
-- entry point. clamp_applied records any Atlas budget clamp (original ask +
-- reason). Departments write result back; nightly join fills measured_result.
CREATE TABLE IF NOT EXISTS sage_directives (
  directive_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES sage_opportunities (opportunity_id) ON DELETE CASCADE,
  brand_id       UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  department     TEXT NOT NULL,
  instruction    JSONB NOT NULL,
  clamp_applied  JSONB,
  status         TEXT NOT NULL DEFAULT 'issued',
  result         JSONB,
  error          TEXT,
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sage_directives_dept_chk CHECK (
    department IN ('nova', 'atlas', 'forge', 'pulse', 'voice')
  ),
  CONSTRAINT sage_directives_status_chk CHECK (
    status IN ('issued', 'acknowledged', 'done', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS idx_sage_directives_brand
  ON sage_directives (brand_id, status, issued_at DESC);

-- One active directive per (opportunity, department).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sage_directives_active
  ON sage_directives (opportunity_id, department)
  WHERE status IN ('issued', 'acknowledged');

-- --- Decision Review (§9 blueprint as revised) ----------------------------------
-- One row per owner decision on anything Sage proposed. P5's only legal
-- subject_type is 'opportunity'; the column is generic so P6 extends without
-- migration churn.
CREATE TABLE IF NOT EXISTS sage_decisions (
  decision_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL DEFAULT 'opportunity',
  subject_id   UUID NOT NULL,
  decided      TEXT NOT NULL,
  decision_via TEXT NOT NULL DEFAULT 'opportunities_tab',
  why          TEXT,
  executed     BOOLEAN NOT NULL DEFAULT FALSE,
  measured_result JSONB,
  outcome      TEXT,
  lesson       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sage_decisions_subject_chk CHECK (subject_type IN ('opportunity')),
  CONSTRAINT sage_decisions_decided_chk CHECK (decided IN ('approved', 'declined', 'revised')),
  CONSTRAINT sage_decisions_via_chk CHECK (decision_via IN ('briefing', 'opportunities_tab', 'voice')),
  CONSTRAINT sage_decisions_outcome_chk CHECK (
    outcome IS NULL OR outcome IN ('worked', 'failed', 'unknown')
  )
);

CREATE INDEX IF NOT EXISTS idx_sage_decisions_brand
  ON sage_decisions (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sage_decisions_subject
  ON sage_decisions (subject_type, subject_id);

-- --- Change Diagnostics (§2.4) ---------------------------------------------------
-- terms = deterministic decomposition (each term: name, value, inputs used).
-- narrative is AI narration produced INSIDE the weekly synthesis call; NULL
-- when synthesis is skipped/failed — the numbers still render (honesty rule).
CREATE TABLE IF NOT EXISTS sage_change_diagnostics (
  diag_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  week_start   DATE NOT NULL,
  terms        JSONB NOT NULL,
  data_coverage JSONB NOT NULL DEFAULT '{}'::jsonb,
  narrative    TEXT,
  input_hash   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_sage_diag_week UNIQUE (brand_id, week_start)
);

-- updated_at triggers (house pattern)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sage_opportunities_set_updated_at') THEN
    CREATE TRIGGER sage_opportunities_set_updated_at
      BEFORE UPDATE ON sage_opportunities
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sage_directives_set_updated_at') THEN
    CREATE TRIGGER sage_directives_set_updated_at
      BEFORE UPDATE ON sage_directives
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sage_decisions_set_updated_at') THEN
    CREATE TRIGGER sage_decisions_set_updated_at
      BEFORE UPDATE ON sage_decisions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sage_change_diagnostics_set_updated_at') THEN
    CREATE TRIGGER sage_change_diagnostics_set_updated_at
      BEFORE UPDATE ON sage_change_diagnostics
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
