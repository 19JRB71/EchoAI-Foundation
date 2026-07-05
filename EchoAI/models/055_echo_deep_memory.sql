-- 055_echo_deep_memory.sql
-- Part 2 of the Echo autonomy roadmap: "Deeper Echo Memory".
--
-- Builds on 049's append-only `echo_memory` event log by (1) categorizing memories
-- and making them full-text searchable + soft-deletable, (2) adding per-person
-- relationship profiles Echo maintains for the owner's key leads/customers/partners/
-- team, and (3) an owner profile Echo learns over time (values, risk tolerance,
-- preferences, decision patterns, blind spots). All idempotent (IF NOT EXISTS).

-- --------------------------------------------------------------------------
-- 1. Enrich echo_memory: taxonomy, provenance, importance, soft-delete, search.
-- --------------------------------------------------------------------------
ALTER TABLE echo_memory ADD COLUMN IF NOT EXISTS category   TEXT;   -- conversation|preference|goal|concern|decision|personal_context|relationship|event|note
ALTER TABLE echo_memory ADD COLUMN IF NOT EXISTS source     TEXT;   -- owner|echo|system
ALTER TABLE echo_memory ADD COLUMN IF NOT EXISTS importance SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE echo_memory ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Generated full-text vector over the human-readable fields so the owner can
-- search everything Echo remembers. Immutable expression → safe as STORED.
ALTER TABLE echo_memory ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' || coalesce(detail, '') || ' ' || coalesce(entity_ref, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_echo_memory_tsv ON echo_memory USING GIN (search_tsv);

-- Fast "recent, not deleted" timeline for the owner.
CREATE INDEX IF NOT EXISTS idx_echo_memory_active
  ON echo_memory (user_id, occurred_at DESC) WHERE deleted_at IS NULL;

-- --------------------------------------------------------------------------
-- 2. Relationship profiles — one living record per important person.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS echo_relationship_profiles (
  profile_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  brand_id    UUID REFERENCES brands(brand_id) ON DELETE CASCADE,
  person_name TEXT NOT NULL,
  person_type TEXT NOT NULL DEFAULT 'other',  -- lead|customer|partner|team_member|other
  entity_ref  TEXT,                           -- email / phone / id to recall by
  cares_about TEXT,
  history     TEXT,
  next_step   TEXT,
  sentiment   TEXT,                           -- positive|neutral|at_risk|negative
  importance  SMALLINT NOT NULL DEFAULT 0,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One profile per (owner, kind, name) so Echo can upsert idempotently.
CREATE UNIQUE INDEX IF NOT EXISTS uq_echo_rel_person
  ON echo_relationship_profiles (user_id, person_type, lower(person_name));
CREATE INDEX IF NOT EXISTS idx_echo_rel_user
  ON echo_relationship_profiles (user_id, importance DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_echo_rel_name
  ON echo_relationship_profiles (user_id, lower(person_name));

-- --------------------------------------------------------------------------
-- 3. Owner profile — what Echo has learned about how the owner thinks/decides.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS echo_owner_profile (
  user_id             UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  risk_tolerance      TEXT,   -- conservative|moderate|aggressive (or free text)
  core_values         TEXT,   -- ("values" is a reserved word, hence core_values)
  blind_spots         TEXT,
  decision_patterns   TEXT,
  preferences         TEXT,
  communication_style TEXT,
  goals               TEXT,
  data                JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
