-- ============================================================================
-- 077_real_estate.sql — Real Estate Agent brand type + Property CRM
--
-- Adds:
--  - brands.real_estate_profile: JSONB profile for real-estate brands (agent
--    name, brokerage, markets served, buyer/seller focus, price range, target
--    client demographics). App code (config/goals.js) owns the allowed
--    brand_type values; 'real_estate' is new.
--  - property_listings: the agent's active/sold listings, with days-on-market
--    inputs (listed_date/sold_date), showing count, GCI on close, and an
--    idempotency marker for Atlas's automatic listing-promotion ad.
--  - property_leads: buyer + seller leads with real-estate qualification
--    fields and readiness categories, plus honest first-response/conversion
--    timestamps powering the lead-response-time and buyer-closings goals.
--  - open_houses + open_house_attendees: scheduled open houses with per-phase
--    automation markers (promoted / reminded / followed up) and the attendee
--    list the post-event follow-up runs over.
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere).
-- ============================================================================

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS real_estate_profile JSONB NOT NULL DEFAULT '{}'::jsonb;

-- --- Property CRM: listings --------------------------------------------------
CREATE TABLE IF NOT EXISTS property_listings (
    listing_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id        UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    address         VARCHAR(300) NOT NULL,
    city            VARCHAR(120),
    state           VARCHAR(60),
    zip             VARCHAR(20),
    price           NUMERIC(14, 2) CHECK (price IS NULL OR price >= 0),
    beds            INTEGER CHECK (beds IS NULL OR beds >= 0),
    baths           NUMERIC(4, 1) CHECK (baths IS NULL OR baths >= 0),
    sqft            INTEGER CHECK (sqft IS NULL OR sqft >= 0),
    description     TEXT,
    key_features    TEXT,
    photo_urls      JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- active | pending | sold | withdrawn (app code validates)
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    listed_date     DATE NOT NULL DEFAULT NOW()::date,
    sold_date       DATE,
    -- gross commission income recorded when the listing closes; NULL = none
    gci_amount      NUMERIC(12, 2) CHECK (gci_amount IS NULL OR gci_amount >= 0),
    showing_count   INTEGER NOT NULL DEFAULT 0 CHECK (showing_count >= 0),
    -- set when Atlas auto-created the listing-promotion ad (idempotency marker)
    ad_promoted_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_listings_brand
    ON property_listings (brand_id, status, listed_date DESC);

-- --- Property CRM: buyer & seller leads ---------------------------------------
CREATE TABLE IF NOT EXISTS property_leads (
    property_lead_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id         UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    -- buyer | seller (app code validates)
    lead_kind        VARCHAR(10) NOT NULL,
    name             VARCHAR(200) NOT NULL,
    email            VARCHAR(255),
    phone            VARCHAR(40),
    -- buyer qualification
    budget           VARCHAR(120),
    timeline         VARCHAR(120),
    must_haves       TEXT,
    -- seller qualification
    motivation       TEXT,
    current_home     TEXT,
    -- readiness category (app code validates per kind):
    --   buyer:  actively_looking | casually_browsing | not_ready
    --   seller: ready_to_list | thinking_about_it | just_curious
    category         VARCHAR(30),
    -- new | contacted | engaged | converted (app code validates)
    status           VARCHAR(20) NOT NULL DEFAULT 'new',
    source           VARCHAR(60),
    notes            TEXT,
    -- honest metric inputs: set once when first contacted / marked converted
    first_contact_at TIMESTAMPTZ,
    converted_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_leads_brand
    ON property_leads (brand_id, lead_kind, created_at DESC);

-- --- Open houses ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS open_houses (
    open_house_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id        UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    listing_id      UUID REFERENCES property_listings (listing_id) ON DELETE SET NULL,
    -- denormalized so an open house survives listing deletion / manual entry
    address         VARCHAR(300) NOT NULL,
    event_date      DATE NOT NULL,
    start_time      VARCHAR(20),
    end_time        VARCHAR(20),
    notes           TEXT,
    -- per-phase automation markers (idempotency: each phase fires once)
    promoted_at     TIMESTAMPTZ,
    reminded_at     TIMESTAMPTZ,
    followed_up_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_open_houses_brand
    ON open_houses (brand_id, event_date DESC);

CREATE TABLE IF NOT EXISTS open_house_attendees (
    attendee_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    open_house_id   UUID NOT NULL REFERENCES open_houses (open_house_id) ON DELETE CASCADE,
    name            VARCHAR(200) NOT NULL,
    email           VARCHAR(255),
    phone           VARCHAR(40),
    interested      BOOLEAN NOT NULL DEFAULT FALSE,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_open_house_attendees_oh
    ON open_house_attendees (open_house_id, created_at DESC);
