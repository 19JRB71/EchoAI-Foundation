-- Demo Account & Sales Presentation Mode.
--
-- The demo is a single brand owned by the platform admin, flagged is_demo. Every
-- feature is brand-scoped, so pointing the client's brand switcher at this brand
-- makes the whole product come alive with realistic data during a sales call —
-- with zero changes to feature endpoints. The flag keeps the demo fully isolated:
-- background dispatchers, weekly/health sweeps and admin platform stats all
-- exclude is_demo brands, so demo data never mixes with real customer data and
-- nothing (posts, emails, SMS, reminders) ever actually sends.

ALTER TABLE brands
    ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_brands_is_demo ON brands (is_demo);

-- Single-row platform-level configuration for the demo / presentation mode.
-- id is pinned to TRUE so there can only ever be one row (UNIQUE PK on a boolean
-- with a CHECK) — a classic singleton-table pattern.
CREATE TABLE IF NOT EXISTS demo_config (
    id                BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
    active            BOOLEAN NOT NULL DEFAULT false,
    business_name     VARCHAR(255) NOT NULL DEFAULT 'Premier Auto Group',
    prospect_name     VARCHAR(255),
    demo_brand_id     UUID REFERENCES brands (brand_id) ON DELETE SET NULL,
    morning_briefing  TEXT,
    seeded_at         TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO demo_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
