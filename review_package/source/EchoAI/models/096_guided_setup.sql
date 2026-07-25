-- Guided Setup wizard progress.
--
-- One row per owner: where the new-customer front-door wizard left off
-- (current_step) plus per-connection flags (skipped / connecting / errorKey)
-- so the flow is fully resumable across page reloads, devices, and OAuth
-- full-page redirects. Real connection STATUS is never stored here — it is
-- always probed live from api_integrations / google_integrations so card
-- states can never be fabricated or go stale.

CREATE TABLE IF NOT EXISTS guided_setup_progress (
    user_id      UUID PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
    -- welcome | plan | profile | connections | team | done
    current_step TEXT NOT NULL DEFAULT 'welcome',
    -- { facebook: { skipped, connecting, errorKey }, google: { ... } }
    connections  JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
