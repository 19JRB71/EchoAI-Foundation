-- Zorecho cost system Phase 1 (CEO-approved July 2026): extend the central
-- usage ledger so ONE table records every billable operation — LLM calls
-- (already ledgered) plus voice synthesis, telephony, SMS, email, and search.
--
--  workflow_id       groups every call in one user request / job tick / agent
--                    chain so a "cheap" request can't hide downstream fan-out.
--  parent_request_id optional link from a delegated call to the call that
--                    spawned it (finer-grained than workflow_id).
--  unit_type/qty     non-token billing units: characters, seconds, minutes,
--                    sms_segments, emails, images, searches.
--  provider_ref      provider-side id (Twilio SID, SMTP messageId) used later
--                    for reconciliation. NEVER an API key or secret.
--  key_label         which configured key/project was used (label only).
--  reconciled_*      provider-reported cost lands beside — never over — the
--                    original internal estimate ('estimated' until a
--                    reconciliation pass confirms it).
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS workflow_id TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS parent_request_id TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS unit_type TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS unit_quantity NUMERIC(14, 4);
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS provider_ref TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS key_label TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS reconciled_cost_usd NUMERIC(12, 6);
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'estimated';
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS provider_charged_on_failure BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_ai_usage_workflow ON ai_usage_log (workflow_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_at ON ai_usage_log (user_id, at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_ref ON ai_usage_log (provider_ref) WHERE provider_ref IS NOT NULL;
