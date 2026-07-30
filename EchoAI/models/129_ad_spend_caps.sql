-- Prompt 015: spending caps and pause/unpause controls (no-cap-no-unpause).
--
-- Additive only. Three changes:
--
-- 1. ad_spend_caps — daily spending ceilings, in CENTS (integer; the campaigns
--    table stores dollars NUMERIC(12,2), Graph daily_budget is cents — this
--    table matches Graph's unit and converts at the edges).
--      * per-brand rows: brand_id set, one per brand (owner-set; NO default —
--        a brand without a cap row cannot be unpaused, deny-by-default).
--      * ONE platform row: brand_id IS NULL. Seeded here at $25/day (D-6
--        pilot value, owner-approved). CONFIGURABLE DATABASE DATA — the
--        application must never hard-code the platform cap.
--
-- 2. ad_spend_audit — append-only approval/audit trail for every
--    state-changing pause/unpause attempt (and every denial). NOTE:
--    result = 'success' means Facebook ACCEPTED the requested provider
--    change — it does NOT mean the campaign is verified live. Only the
--    Prompt 005 read-back helper can mark a row live.
--
-- 3. campaigns.activation_requested_at — explicit activation-pending marker
--    (owner term 7): set ONLY after Facebook accepts an activation request,
--    cleared on verified live, on pause, or on definitive activation failure.
--    Distinguishes "Facebook is reviewing / activation pending" from
--    "intentionally paused" — created_paused alone may not carry both
--    meanings. Pending rows COUNT toward committed-spend sums (term 6).
--
-- Rollback (reverses this migration exactly):
--   DROP TABLE IF EXISTS ad_spend_audit;
--   DROP TABLE IF EXISTS ad_spend_caps;
--   ALTER TABLE campaigns DROP COLUMN IF EXISTS activation_requested_at;

CREATE TABLE IF NOT EXISTS ad_spend_caps (
    cap_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL brand_id = the single platform-level cap row.
    brand_id          UUID REFERENCES brands (brand_id) ON DELETE CASCADE,
    daily_cap_cents   INTEGER NOT NULL CHECK (daily_cap_cents > 0),
    -- NULL = system-seeded (the platform row); otherwise the owner who set it.
    set_by_user_id    UUID REFERENCES users (user_id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One cap row per brand…
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_spend_caps_brand
    ON ad_spend_caps (brand_id) WHERE brand_id IS NOT NULL;
-- …and exactly one platform row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_spend_caps_platform
    ON ad_spend_caps ((true)) WHERE brand_id IS NULL;

-- Seed the platform cap: $25/day pilot (owner-approved D-6 value). Data, not
-- code — changing it is an UPDATE, never a deploy.
INSERT INTO ad_spend_caps (brand_id, daily_cap_cents, set_by_user_id)
SELECT NULL, 2500, NULL
WHERE NOT EXISTS (SELECT 1 FROM ad_spend_caps WHERE brand_id IS NULL);

CREATE TABLE IF NOT EXISTS ad_spend_audit (
    audit_id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id                   UUID NOT NULL REFERENCES campaigns (campaign_id) ON DELETE CASCADE,
    brand_id                      UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    actor_user_id                 UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    action                        TEXT NOT NULL CHECK (action IN ('unpause', 'pause')),
    -- 'success' = Facebook accepted the provider change (NOT verified live).
    -- 'failed'  = a Graph update failed (atomicity rule: no local state change).
    -- 'denied'  = blocked by cap enforcement before any Graph call.
    result                        TEXT NOT NULL CHECK (result IN ('success', 'failed', 'denied')),
    brand_cap_cents_at_time       INTEGER,
    platform_cap_cents_at_time    INTEGER,
    campaign_budget_cents         INTEGER NOT NULL,
    committed_live_cents_at_time  INTEGER NOT NULL,
    denial_reason                 TEXT,
    error_message                 TEXT,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_spend_audit_campaign ON ad_spend_audit (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_spend_audit_brand ON ad_spend_audit (brand_id, created_at DESC);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS activation_requested_at TIMESTAMPTZ;
