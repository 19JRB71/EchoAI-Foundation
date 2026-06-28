-- ============================================================================
-- Migration 025: White-label agency system
--
-- Adds:
--   - agencies: one row per reseller/agency. Linked to its owner user account
--     (owner_user_id). Holds the branding (name, logo, colors), an optional
--     custom_domain the dashboard is served on, and a support email. The
--     custom_domain is UNIQUE (and stored lower-cased) so the white-label
--     middleware can resolve a request's Host header to exactly one agency.
--     owner_user_id is UNIQUE so each account owns at most one agency (the
--     Agency Portal then has a single, deterministic agency to manage).
--   - agency_customers: links an agency to the customer accounts it resells to,
--     with the monthly_price the agency charges that customer. customer_user_id
--     is UNIQUE so a customer belongs to exactly one agency.
--
-- Idempotent: safe to re-run (IF NOT EXISTS / guarded). set_updated_at() is
-- defined in schema.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS agencies (
    agency_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id   UUID NOT NULL UNIQUE REFERENCES users (user_id) ON DELETE CASCADE,
    agency_name     VARCHAR(120) NOT NULL,
    logo_url        TEXT,
    primary_color   VARCHAR(9),
    secondary_color VARCHAR(9),
    custom_domain   VARCHAR(255) UNIQUE,
    support_email   VARCHAR(255),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup path for the white-label middleware: active agency by custom domain.
CREATE INDEX IF NOT EXISTS idx_agencies_custom_domain
    ON agencies (custom_domain) WHERE is_active;

DROP TRIGGER IF EXISTS trg_agencies_updated_at ON agencies;
CREATE TRIGGER trg_agencies_updated_at BEFORE UPDATE ON agencies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS agency_customers (
    agency_customer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id          UUID NOT NULL REFERENCES agencies (agency_id) ON DELETE CASCADE,
    customer_user_id   UUID NOT NULL UNIQUE REFERENCES users (user_id) ON DELETE CASCADE,
    monthly_price      NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Revenue / customer-count rollups are grouped by agency.
CREATE INDEX IF NOT EXISTS idx_agency_customers_agency
    ON agency_customers (agency_id);
