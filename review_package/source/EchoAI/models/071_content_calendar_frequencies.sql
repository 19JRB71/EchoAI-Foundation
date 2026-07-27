-- Per-brand content-calendar per-platform frequency preferences.
--
-- Complements 070_content_calendar_settings' posting-window (times) overrides.
-- While `windows` controls WHEN a platform posts (its "HH:MM" times per active
-- day), `frequencies` controls HOW OFTEN it posts (its cadence + weekly count)
-- for the "optimal" schedule. It is a JSON object keyed by platform, each value
-- shaped { "cadence": "daily" | "weekly", "perWeek": 1..7 } (perWeek only for
-- weekly), e.g. {"linkedin":{"cadence":"weekly","perWeek":3},
-- "youtube":{"cadence":"daily"}}. A missing/empty platform entry falls back to
-- the coded default cadence for that platform (PLATFORM_SCHEDULES).
ALTER TABLE content_calendar_settings
    ADD COLUMN IF NOT EXISTS frequencies JSONB NOT NULL DEFAULT '{}'::jsonb;
