-- ============================================================================
-- Migration 033: AI Appointment Booking System
--
-- Adds the appointment scheduler subsystem: per-brand availability rules,
-- one-off blackout blocks, and the booked appointments themselves. Bookings can
-- originate from the dashboard (manual), the website chatbot, or the phone agent
-- (source column), can be linked back to the lead they came from, and carry an
-- optional Google Calendar event id once synced.
--
-- Idempotent: enum guarded with a DO block, tables/indexes use IF NOT EXISTS,
-- triggers are dropped-then-created. Reuses the shared set_updated_at() function
-- defined in models/schema.sql.
-- ============================================================================

-- Appointment lifecycle status.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status') THEN
        CREATE TYPE appointment_status AS ENUM (
            'scheduled', 'completed', 'cancelled', 'no_show'
        );
    END IF;
END$$;

-- ----------------------------------------------------------------------------
-- Per-brand availability configuration (one row per brand). weekly_hours is a
-- JSONB array of { day: 0-6 (0 = Sunday), start: "HH:MM", end: "HH:MM" } windows
-- expressed in the brand's timezone. Open slots are derived from these windows
-- minus existing appointments, blackout blocks, and Google Calendar busy times.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS availability_schedules (
    schedule_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id              UUID NOT NULL UNIQUE REFERENCES brands (brand_id) ON DELETE CASCADE,
    timezone              VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
    slot_duration_minutes INTEGER NOT NULL DEFAULT 30,
    buffer_minutes        INTEGER NOT NULL DEFAULT 0,
    weekly_hours          JSONB NOT NULL DEFAULT
        '[{"day":1,"start":"09:00","end":"17:00"},
          {"day":2,"start":"09:00","end":"17:00"},
          {"day":3,"start":"09:00","end":"17:00"},
          {"day":4,"start":"09:00","end":"17:00"},
          {"day":5,"start":"09:00","end":"17:00"}]'::jsonb,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_availability_schedules_brand_id
    ON availability_schedules (brand_id);

-- ----------------------------------------------------------------------------
-- One-off blackout windows (vacation, holidays, ad-hoc busy time) that remove
-- otherwise-open slots from a brand's availability.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS availability_blocks (
    block_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id    UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    start_time  TIMESTAMPTZ NOT NULL,
    end_time    TIMESTAMPTZ NOT NULL,
    reason      VARCHAR(255),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_availability_blocks_brand_id
    ON availability_blocks (brand_id);
CREATE INDEX IF NOT EXISTS idx_availability_blocks_window
    ON availability_blocks (brand_id, start_time, end_time);

-- ----------------------------------------------------------------------------
-- Booked appointments.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
    appointment_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id         UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    lead_id          UUID REFERENCES leads (lead_id) ON DELETE SET NULL,
    title            VARCHAR(255) NOT NULL DEFAULT 'Appointment',
    description      TEXT,
    location         VARCHAR(255),
    start_time       TIMESTAMPTZ NOT NULL,
    end_time         TIMESTAMPTZ NOT NULL,
    status           appointment_status NOT NULL DEFAULT 'scheduled',
    contact_name     VARCHAR(255),
    contact_email    VARCHAR(255),
    contact_phone    VARCHAR(50),
    source           VARCHAR(32) NOT NULL DEFAULT 'manual',
    google_event_id  VARCHAR(255),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_brand_id
    ON appointments (brand_id);
CREATE INDEX IF NOT EXISTS idx_appointments_lead_id
    ON appointments (lead_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start_time
    ON appointments (brand_id, start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_status
    ON appointments (brand_id, status);

-- Prevent the same slot being double-booked for a brand: only one active
-- (scheduled) appointment may start at a given time for a brand. Cancelled /
-- completed / no_show rows are excluded so a freed slot can be re-booked.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_appointments_active_slot
    ON appointments (brand_id, start_time)
    WHERE status = 'scheduled';

-- updated_at triggers (drop-then-create so re-running is safe).
DROP TRIGGER IF EXISTS trg_availability_schedules_updated_at ON availability_schedules;
CREATE TRIGGER trg_availability_schedules_updated_at
    BEFORE UPDATE ON availability_schedules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_availability_blocks_updated_at ON availability_blocks;
CREATE TRIGGER trg_availability_blocks_updated_at
    BEFORE UPDATE ON availability_blocks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON appointments;
CREATE TRIGGER trg_appointments_updated_at
    BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
