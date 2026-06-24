-- ============================================================================
-- EchoAI - Database Schema Migration
-- ----------------------------------------------------------------------------
-- Creates all eight core tables, relationships, constraints, indexes, and
-- timestamps for the EchoAI marketing platform.
--
-- Run with:  psql "$DATABASE_URL" -f models/schema.sql
-- ============================================================================

BEGIN;

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- Enumerated types
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_tier') THEN
        CREATE TYPE subscription_tier AS ENUM ('free', 'starter', 'growth', 'pro', 'enterprise');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_cycle') THEN
        CREATE TYPE billing_cycle AS ENUM ('monthly', 'quarterly', 'annual');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
        CREATE TYPE payment_status AS ENUM ('active', 'past_due', 'failed', 'canceled');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_temperature') THEN
        CREATE TYPE lead_temperature AS ENUM ('tire_kicker', 'warm', 'hot');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'conversion_status') THEN
        CREATE TYPE conversion_status AS ENUM ('new', 'in_progress', 'converted', 'lost');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'interaction_type') THEN
        CREATE TYPE interaction_type AS ENUM ('chatbot_conversation', 'website_visit', 'email', 'phone_call');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'integration_platform') THEN
        CREATE TYPE integration_platform AS ENUM ('facebook', 'stripe');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connection_status') THEN
        CREATE TYPE connection_status AS ENUM ('connected', 'disconnected', 'error');
    END IF;
END$$;

-- ----------------------------------------------------------------------------
-- Shared trigger function: keep updated_at current on every UPDATE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Table 1: users
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    user_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email             VARCHAR(255) NOT NULL UNIQUE,
    password_hash     VARCHAR(255) NOT NULL,
    subscription_tier subscription_tier NOT NULL DEFAULT 'free',
    team_size         INTEGER NOT NULL DEFAULT 1 CHECK (team_size >= 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ============================================================================
-- Table 2: subscriptions  (Users have many Subscriptions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
    subscription_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    subscription_tier   subscription_tier NOT NULL DEFAULT 'free',
    billing_cycle       billing_cycle NOT NULL DEFAULT 'monthly',
    payment_method      VARCHAR(100),
    renewal_date        DATE,
    payment_status      payment_status NOT NULL DEFAULT 'active',
    -- Lockout logic: account locks completely if payment fails past the threshold
    failed_payment_at   TIMESTAMPTZ,
    lockout_threshold_days INTEGER NOT NULL DEFAULT 7 CHECK (lockout_threshold_days >= 0),
    is_locked           BOOLEAN NOT NULL DEFAULT FALSE,
    locked_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_status ON subscriptions (payment_status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_renewal_date ON subscriptions (renewal_date);

-- ============================================================================
-- Table 3: brands  (Users have many Brands)
-- ============================================================================
CREATE TABLE IF NOT EXISTS brands (
    brand_id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    brand_name                VARCHAR(255) NOT NULL,
    brand_personality         TEXT,
    voice_description         TEXT,
    visual_style_preferences  JSONB,
    target_audience           JSONB,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brands_user_id ON brands (user_id);

-- ============================================================================
-- Table 4: leads  (Brands have many Leads)
-- ============================================================================
CREATE TABLE IF NOT EXISTS leads (
    lead_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id             UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    lead_name            VARCHAR(255),
    email                VARCHAR(255),
    phone                VARCHAR(50),
    temperature          lead_temperature NOT NULL DEFAULT 'tire_kicker',
    conversation_history JSONB,
    conversion_status    conversion_status NOT NULL DEFAULT 'new',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_brand_id ON leads (brand_id);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads (email);
CREATE INDEX IF NOT EXISTS idx_leads_temperature ON leads (temperature);
CREATE INDEX IF NOT EXISTS idx_leads_conversion_status ON leads (conversion_status);

-- ============================================================================
-- Table 5: campaigns  (Users have many Campaigns, Brands have many Campaigns)
-- ============================================================================
CREATE TABLE IF NOT EXISTS campaigns (
    campaign_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id                 UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    user_id                  UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    campaign_name            VARCHAR(255) NOT NULL,
    budget                   NUMERIC(12, 2) CHECK (budget >= 0),
    cost_per_lead            NUMERIC(12, 2) CHECK (cost_per_lead >= 0),
    conversion_rate          NUMERIC(5, 4) CHECK (conversion_rate >= 0 AND conversion_rate <= 1),
    ad_creative_variations   JSONB,
    launch_date              DATE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_brand_id ON campaigns (brand_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns (user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_launch_date ON campaigns (launch_date);

-- ============================================================================
-- Table 6: crm_interactions  (Leads have many CRMInteractions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS crm_interactions (
    interaction_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id              UUID NOT NULL REFERENCES leads (lead_id) ON DELETE CASCADE,
    interaction_type     interaction_type NOT NULL,
    occurred_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    interaction_details  JSONB,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_interactions_lead_id ON crm_interactions (lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_type ON crm_interactions (interaction_type);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_occurred_at ON crm_interactions (occurred_at);

-- ============================================================================
-- Table 7: api_integrations  (Users have many APIIntegrations)
-- ============================================================================
CREATE TABLE IF NOT EXISTS api_integrations (
    integration_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    platform           integration_platform NOT NULL,
    api_token_encrypted TEXT NOT NULL,
    connection_status  connection_status NOT NULL DEFAULT 'disconnected',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_api_integrations_user_id ON api_integrations (user_id);
CREATE INDEX IF NOT EXISTS idx_api_integrations_platform ON api_integrations (platform);

-- ============================================================================
-- Table 8: analytics  (Brands have many weekly Analytics rows)
-- ============================================================================
CREATE TABLE IF NOT EXISTS analytics (
    analytics_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id       UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    week_date      DATE NOT NULL,
    total_spend    NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_spend >= 0),
    total_leads    INTEGER NOT NULL DEFAULT 0 CHECK (total_leads >= 0),
    cost_per_lead  NUMERIC(12, 2) CHECK (cost_per_lead >= 0),
    conversions    INTEGER NOT NULL DEFAULT 0 CHECK (conversions >= 0),
    return_on_ad_spend NUMERIC(10, 4) CHECK (return_on_ad_spend >= 0),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (brand_id, week_date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_brand_id ON analytics (brand_id);
CREATE INDEX IF NOT EXISTS idx_analytics_week_date ON analytics (week_date);

-- ----------------------------------------------------------------------------
-- updated_at triggers for every table
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_brands_updated_at ON brands;
CREATE TRIGGER trg_brands_updated_at BEFORE UPDATE ON brands
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_campaigns_updated_at ON campaigns;
CREATE TRIGGER trg_campaigns_updated_at BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_crm_interactions_updated_at ON crm_interactions;
CREATE TRIGGER trg_crm_interactions_updated_at BEFORE UPDATE ON crm_interactions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_api_integrations_updated_at ON api_integrations;
CREATE TRIGGER trg_api_integrations_updated_at BEFORE UPDATE ON api_integrations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_analytics_updated_at ON analytics;
CREATE TRIGGER trg_analytics_updated_at BEFORE UPDATE ON analytics
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
