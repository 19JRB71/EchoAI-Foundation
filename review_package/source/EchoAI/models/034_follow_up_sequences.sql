-- ============================================================================
-- Migration 034: AI Follow-Up Sequences
--
-- Adds the automated follow-up subsystem: a per-lead multi-step sequence
-- (follow_up_sequences) plus its individual scheduled touchpoints
-- (sequence_touchpoints). Each touchpoint reaches the lead on one channel
-- (email / SMS / phone) at a scheduled time. A background job sends due
-- touchpoints; the sequence runs until it completes or is stopped early because
-- the lead responded, booked, or converted.
--
-- Idempotent: enums guarded with DO blocks, tables/indexes use IF NOT EXISTS,
-- triggers are dropped-then-created. Reuses the shared set_updated_at() function
-- defined in models/schema.sql.
-- ============================================================================

-- Sequence lifecycle status.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'follow_up_status') THEN
        CREATE TYPE follow_up_status AS ENUM (
            'active', 'paused', 'completed', 'stopped', 'cancelled'
        );
    END IF;
END$$;

-- Channel a single touchpoint is delivered on.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'follow_up_channel') THEN
        CREATE TYPE follow_up_channel AS ENUM ('email', 'sms', 'phone');
    END IF;
END$$;

-- Per-touchpoint delivery status.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'touchpoint_status') THEN
        CREATE TYPE touchpoint_status AS ENUM (
            'pending', 'sent', 'skipped', 'failed'
        );
    END IF;
END$$;

-- ----------------------------------------------------------------------------
-- A follow-up sequence belongs to a brand and targets a single lead. Bookkeeping
-- columns (current_step / total_steps) drive progress display; stop_reason
-- records why a running sequence ended early (lead_responded / booked /
-- converted). source distinguishes auto-enrolled (qualification flow) from
-- manually-built sequences.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follow_up_sequences (
    sequence_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id       UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    lead_id        UUID NOT NULL REFERENCES leads (lead_id) ON DELETE CASCADE,
    goal           VARCHAR(64) NOT NULL DEFAULT 'reengage',
    sequence_type  VARCHAR(32) NOT NULL DEFAULT 'nurture',
    status         follow_up_status NOT NULL DEFAULT 'active',
    current_step   INTEGER NOT NULL DEFAULT 0,
    total_steps    INTEGER NOT NULL DEFAULT 0,
    source         VARCHAR(32) NOT NULL DEFAULT 'manual',
    stop_reason    VARCHAR(64),
    started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_follow_up_sequences_brand_id
    ON follow_up_sequences (brand_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_sequences_lead_id
    ON follow_up_sequences (lead_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_sequences_status
    ON follow_up_sequences (brand_id, status);

-- A lead may only have ONE running (active or paused) sequence at a time. This is
-- the DB backstop for the app-level dedup so concurrent qualification events
-- can't enroll the same lead twice.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_follow_up_running_per_lead
    ON follow_up_sequences (lead_id)
    WHERE status IN ('active', 'paused');

-- ----------------------------------------------------------------------------
-- Individual scheduled touchpoints within a sequence. The background sender
-- claims due pending rows (scheduled_at <= now) whose sequence is still active,
-- delivers them on their channel, and records the outcome + any error.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sequence_touchpoints (
    touchpoint_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id    UUID NOT NULL REFERENCES follow_up_sequences (sequence_id) ON DELETE CASCADE,
    step_number    INTEGER NOT NULL,
    channel        follow_up_channel NOT NULL,
    scheduled_at   TIMESTAMPTZ NOT NULL,
    status         touchpoint_status NOT NULL DEFAULT 'pending',
    subject        VARCHAR(255),
    body           TEXT NOT NULL,
    sent_at        TIMESTAMPTZ,
    error          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sequence_touchpoints_sequence_id
    ON sequence_touchpoints (sequence_id);
-- Drives the scheduler's "due touchpoints" lookup.
CREATE INDEX IF NOT EXISTS idx_sequence_touchpoints_due
    ON sequence_touchpoints (status, scheduled_at);

-- One row per (sequence, step) — backstop against a step being inserted twice.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sequence_touchpoint_step
    ON sequence_touchpoints (sequence_id, step_number);

-- updated_at triggers (drop-then-create so re-running is safe).
DROP TRIGGER IF EXISTS trg_follow_up_sequences_updated_at ON follow_up_sequences;
CREATE TRIGGER trg_follow_up_sequences_updated_at
    BEFORE UPDATE ON follow_up_sequences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sequence_touchpoints_updated_at ON sequence_touchpoints;
CREATE TRIGGER trg_sequence_touchpoints_updated_at
    BEFORE UPDATE ON sequence_touchpoints
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
