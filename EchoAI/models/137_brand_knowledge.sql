-- 137_brand_knowledge.sql — Prompt 011: Versioned Brand Knowledge + Approval Lock.
--
-- Owner rulings baked into this schema (authorization file, Prompt 011 Stage 2):
--  B1  brand_type / campaign_profile / visual style preferences remain
--      OPERATIONAL columns on brands — they are deliberately NOT versioned here.
--  B2  The Autonomous Growth silent overwrite path is removed: automated
--      systems may only file rows in brand_knowledge_revisions (pending),
--      never write approved knowledge directly.
--  B3  For Company Truth, the brand_knowledge_revisions row is the
--      AUTHORITATIVE approval record; company_truth_reports.status is a
--      derived mirror updated in the same transaction. Divergence between the
--      two is surfaced as a defect and never silently repaired.
--  B4  No backfill: legacy values already on brands are shown as
--      "Current (unversioned — never reviewed)" until the owner first touches
--      the field; version history begins at that first reviewed write.
--
-- Ordering note (required disclaimer): proposal ordering is deterministic
-- candidate selection for an UNAPPROVED draft; it is not an authority or
-- truth ranking.
--
-- Bookkeeping semantics carried over from the Prompt 022 research drafts work:
-- provenance is FROZEN at proposal time and copied verbatim into the version
-- row on approval (byte-equivalent), and every row records WHO proposed and
-- WHO approved — actors always come from server-side auth, never the client.

-- ---------------------------------------------------------------------------
-- Approved, immutable version history — one row per approved value.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brand_knowledge_versions (
  version_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id       UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  field_key      TEXT NOT NULL CHECK (field_key IN (
                   'business_name', 'tagline', 'brand_personality',
                   'voice_description', 'target_audience', 'description',
                   'email', 'phone', 'address', 'hours', 'services',
                   'service_area'
                 )),
  value          JSONB NOT NULL,
  provenance     JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_kind    TEXT NOT NULL CHECK (source_kind IN (
                   'stated', 'website', 'document', 'social_profile',
                   'inferred', 'imported'
                 )),
  proposed_by    TEXT NOT NULL,
  approved_by    UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  version_no     INTEGER NOT NULL CHECK (version_no >= 1),
  status         TEXT NOT NULL DEFAULT 'current'
                   CHECK (status IN ('current', 'superseded')),
  approved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at  TIMESTAMPTZ
);

-- Exactly one current value per (brand, field).
CREATE UNIQUE INDEX IF NOT EXISTS brand_knowledge_versions_one_current
  ON brand_knowledge_versions (brand_id, field_key)
  WHERE status = 'current';

-- Version numbers never collide within a field.
CREATE UNIQUE INDEX IF NOT EXISTS brand_knowledge_versions_no_unique
  ON brand_knowledge_versions (brand_id, field_key, version_no);

CREATE INDEX IF NOT EXISTS brand_knowledge_versions_brand_field
  ON brand_knowledge_versions (brand_id, field_key, version_no DESC);

-- Immutability guard: history rows may never be edited or deleted. The ONLY
-- legal UPDATE is the current -> superseded flip (status + superseded_at),
-- with every other column byte-identical. Direct DELETE is rejected;
-- FK-cascade deletes (brand/user removal) arrive at trigger depth > 1 and are
-- allowed — removing an account legitimately removes its history.
CREATE OR REPLACE FUNCTION brand_knowledge_versions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD; -- FK cascade
    END IF;
    RAISE EXCEPTION 'brand_knowledge_versions rows are immutable (no direct DELETE)';
  END IF;

  IF NOT (OLD.status = 'current' AND NEW.status = 'superseded') THEN
    RAISE EXCEPTION 'brand_knowledge_versions rows are immutable (only current -> superseded is allowed)';
  END IF;
  IF NEW.version_id   IS DISTINCT FROM OLD.version_id
     OR NEW.brand_id    IS DISTINCT FROM OLD.brand_id
     OR NEW.field_key   IS DISTINCT FROM OLD.field_key
     OR NEW.value       IS DISTINCT FROM OLD.value
     OR NEW.provenance  IS DISTINCT FROM OLD.provenance
     OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
     OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.version_no  IS DISTINCT FROM OLD.version_no
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION 'brand_knowledge_versions rows are immutable (only status/superseded_at may change)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS brand_knowledge_versions_guard_trg ON brand_knowledge_versions;
CREATE TRIGGER brand_knowledge_versions_guard_trg
  BEFORE UPDATE OR DELETE ON brand_knowledge_versions
  FOR EACH ROW EXECUTE FUNCTION brand_knowledge_versions_guard();

-- ---------------------------------------------------------------------------
-- Pending / decided revisions — every proposed change waits here for the
-- owner. Also serves as the authoritative approval record for Company Truth
-- reports (kind = 'company_truth_report', field_key likewise; ref_id is the
-- report_id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brand_knowledge_revisions (
  revision_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  field_key       TEXT NOT NULL CHECK (field_key IN (
                    'business_name', 'tagline', 'brand_personality',
                    'voice_description', 'target_audience', 'description',
                    'email', 'phone', 'address', 'hours', 'services',
                    'service_area', 'company_truth_report'
                  )),
  kind            TEXT NOT NULL DEFAULT 'field'
                    CHECK (kind IN ('field', 'company_truth_report')),
  proposed_value  JSONB NOT NULL,
  provenance      JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_kind     TEXT NOT NULL CHECK (source_kind IN (
                    'stated', 'website', 'document', 'social_profile',
                    'inferred', 'imported'
                  )),
  proposed_by     TEXT NOT NULL,
  ref_id          UUID,
  base_version_id UUID REFERENCES brand_knowledge_versions (version_id)
                    ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'base_superseded')),
  reviewed_by     UUID REFERENCES users (user_id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  review_note     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One pending proposal per (brand, field): duplicate automated proposals
-- (e.g. Autonomous Growth daily runs) collapse into an idempotent no-op.
CREATE UNIQUE INDEX IF NOT EXISTS brand_knowledge_revisions_one_pending
  ON brand_knowledge_revisions (brand_id, field_key)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS brand_knowledge_revisions_brand_status
  ON brand_knowledge_revisions (brand_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- brands.tagline — new versioned field materialized like brand_name.
-- ---------------------------------------------------------------------------
ALTER TABLE brands ADD COLUMN IF NOT EXISTS tagline TEXT;

-- ---------------------------------------------------------------------------
-- Company Truth mirror: allow the derived company_truth_reports.status to
-- honestly reflect an owner REJECTION of a pending report (previously the
-- only exits from pending_approval were approved or replacement).
-- ---------------------------------------------------------------------------
ALTER TABLE company_truth_reports DROP CONSTRAINT IF EXISTS company_truth_status_chk;
ALTER TABLE company_truth_reports ADD CONSTRAINT company_truth_status_chk
  CHECK (status IN ('generating', 'pending_approval', 'approved', 'superseded', 'failed', 'rejected'));
