-- ============================================================================
-- EchoAI - Migration 011: Brand tagline
-- ----------------------------------------------------------------------------
-- Adds a short, public-facing tagline to brands. Shown in the header of the
-- per-brand voice lead-capture landing page (the customer's Facebook ad page),
-- alongside the business name. Safe to expose publicly.
--
-- Run with:  psql "$DATABASE_URL" -f models/011_brand_tagline.sql
-- ============================================================================

BEGIN;

ALTER TABLE brands
    ADD COLUMN IF NOT EXISTS tagline TEXT;

COMMIT;
