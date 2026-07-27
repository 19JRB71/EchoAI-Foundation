-- ============================================================================
-- Migration 024: Zapier / outbound webhooks
--
-- Adds:
--   - webhooks: brand-scoped webhook subscriptions. Each row maps a trigger
--     event_name to a destination webhook_url (e.g. a Zapier catch hook). A
--     brand can have many webhooks (including several for the same event).
--   - webhook_delivery_logs: one row per delivery attempt (incl. retries), used
--     for the dashboard's delivery history / debugging. ON DELETE CASCADE so
--     removing a webhook removes its logs.
--
-- Idempotent: safe to re-run (IF NOT EXISTS / guarded). set_updated_at() is
-- defined in schema.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS webhooks (
    webhook_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id          UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    event_name        VARCHAR(60) NOT NULL,
    webhook_url       TEXT NOT NULL,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    last_triggered_at TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup path for triggerWebhook(): active subscriptions for a brand + event.
CREATE INDEX IF NOT EXISTS idx_webhooks_brand_event
    ON webhooks (brand_id, event_name) WHERE is_active;

DROP TRIGGER IF EXISTS trg_webhooks_updated_at ON webhooks;
CREATE TRIGGER trg_webhooks_updated_at BEFORE UPDATE ON webhooks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
    log_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id      UUID NOT NULL REFERENCES webhooks (webhook_id) ON DELETE CASCADE,
    event_name      VARCHAR(60) NOT NULL,
    payload         JSONB,
    response_status INTEGER,
    success         BOOLEAN NOT NULL DEFAULT FALSE,
    delivered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook
    ON webhook_delivery_logs (webhook_id, delivered_at DESC);
