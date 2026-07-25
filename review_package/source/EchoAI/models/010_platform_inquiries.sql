-- ============================================================================
-- EchoAI - Migration 010: Platform inquiries (public demo requests)
-- ----------------------------------------------------------------------------
-- Stores demo-request leads captured from the public marketing landing page.
-- These are NOT brand-scoped customer leads (that's the `leads` table, which
-- requires a brand_id) — they are prospects inquiring about EchoAI itself,
-- tagged as 'platform_inquiry' so James can follow up and book the demo call.
--
-- Run with:  psql "$DATABASE_URL" -f models/010_platform_inquiries.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS platform_inquiries (
    inquiry_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    business_type TEXT NOT NULL,
    phone         TEXT NOT NULL,
    email         TEXT NOT NULL,
    inquiry_type  TEXT NOT NULL DEFAULT 'platform_inquiry',
    status        TEXT NOT NULL DEFAULT 'new',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_inquiries_created_at
    ON platform_inquiries (created_at DESC);

COMMIT;
