-- Demo Mode — AI marketing suggestions for Sales Presentation Mode.
--
-- Extends the singleton demo_config with:
--   suggestions_enabled  master toggle (default ON) so the presenter can turn
--                        the live in-demo suggestions on/off before a call.
--   custom_scenario      free-form text the presenter enters to re-theme the
--                        demo (e.g. "the prospect runs a restaurant").
--   custom_suggestions   AI-adapted version of the 5 built-in suggestions,
--                        generated from custom_scenario and cached here so the
--                        live demo never waits on an AI call. NULL = use the
--                        built-in Premier Auto Group suggestions.

ALTER TABLE demo_config
    ADD COLUMN IF NOT EXISTS suggestions_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE demo_config
    ADD COLUMN IF NOT EXISTS custom_scenario TEXT;

ALTER TABLE demo_config
    ADD COLUMN IF NOT EXISTS custom_suggestions JSONB;
