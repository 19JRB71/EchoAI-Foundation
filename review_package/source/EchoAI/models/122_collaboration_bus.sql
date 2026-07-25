-- Department Collaboration Architecture — Stage 0 (Foundation, dark).
-- Approved CEO baseline: ZORECHO_DEPARTMENT_COLLABORATION_ARCHITECTURE.md
-- (final approval July 19, 2026). Additive only; all runtime behavior is
-- behind COLLAB_BUS (default OFF), so this table stays dormant.
--
-- One table = the whole bus AND its audit log (§3.1 + Appendix A).
-- Chokepoint rules (schema validation, topic ownership, anti-loop, caps,
-- dedup, PII/denylist governance) live in utils/collaborationBus.js — JSONB
-- payloads cannot express them as CHECKs. What the DB *can* guarantee, it
-- does: roster/kind/status enums, at-most-one-response-per-request, and
-- requests-never-carry-correlation_id.

CREATE TABLE IF NOT EXISTS department_messages (
  message_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  from_dept       TEXT NOT NULL,
  to_dept         TEXT NOT NULL,
  kind            TEXT NOT NULL,
  topic           TEXT NOT NULL,
  payload         JSONB NOT NULL,
  correlation_id  UUID REFERENCES department_messages (message_id) ON DELETE CASCADE,
  plan_id         UUID,           -- Echo orchestration plans only (Stage 3; column reserved now)
  status          TEXT NOT NULL DEFAULT 'sent',
  priority        TEXT NOT NULL DEFAULT 'routine',
  answer_by       TIMESTAMPTZ,
  input_hash      TEXT,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at      TIMESTAMPTZ,
  answered_at     TIMESTAMPTZ,
  CONSTRAINT dept_msg_from_chk CHECK (from_dept IN
    ('echo','scout','atlas','nova','pulse','voice','forge','sentinel','sage','vision')),
  CONSTRAINT dept_msg_to_chk CHECK (to_dept IN
    ('echo','scout','atlas','nova','pulse','voice','forge','sentinel','sage','vision')),
  CONSTRAINT dept_msg_kind_chk CHECK (kind IN ('request','response','report','alert')),
  CONSTRAINT dept_msg_status_chk CHECK (status IN
    ('sent','claimed','answered','declined','expired','failed')),
  CONSTRAINT dept_msg_priority_chk CHECK (priority IN ('routine','elevated')),
  -- Appendix A: requests never carry a correlation_id (Echo plan steps use
  -- plan_id, a different column, so ad-hoc chaining stays impossible);
  -- responses must carry one.
  CONSTRAINT dept_msg_correlation_chk CHECK (
    (kind = 'request' AND correlation_id IS NULL)
    OR (kind = 'response' AND correlation_id IS NOT NULL)
    OR kind IN ('report','alert')
  ),
  -- plan_id is reserved for Echo-issued requests only (Stage 3 mechanics).
  CONSTRAINT dept_msg_plan_chk CHECK (
    plan_id IS NULL OR (kind = 'request' AND from_dept = 'echo')
  )
);

-- Appendix A: at most one response per request — DB-level backstop.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_dept_msg_one_response
  ON department_messages (correlation_id)
  WHERE kind = 'response';

-- Consumer inbox scan: open requests for a department.
CREATE INDEX IF NOT EXISTS idx_dept_msg_inbox
  ON department_messages (to_dept, status, created_at)
  WHERE kind = 'request';

-- Expiry sweep + retention purge + activity views.
CREATE INDEX IF NOT EXISTS idx_dept_msg_brand_created
  ON department_messages (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dept_msg_answer_by
  ON department_messages (answer_by)
  WHERE kind = 'request' AND status IN ('sent','claimed');

-- Input-hash dedup lookup (§10.2): answered requests by hash, freshest first.
CREATE INDEX IF NOT EXISTS idx_dept_msg_dedup
  ON department_messages (brand_id, topic, input_hash, answered_at DESC)
  WHERE kind = 'request' AND status = 'answered';
