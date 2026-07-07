-- Per-brand content-calendar posting-window preferences.
--
-- The DEFAULT "optimal" schedule lives in code (prompts/contentCalendarPrompt.js
-- PLATFORM_SCHEDULES): FB/IG/TikTok 3x/day, LinkedIn 1x/day, YouTube 3x/week at
-- 08:00 / 12:00 / 18:00 in the brand's timezone. This table lets a business
-- owner override the posting *times* (windows) per platform. `windows` is a JSON
-- object keyed by platform, each value an array of "HH:MM" 24h wall-clock times,
-- e.g. {"facebook":["07:30","13:00","19:00"],"linkedin":["09:00"]}. A missing or
-- empty platform entry falls back to the coded default for that platform.
CREATE TABLE IF NOT EXISTS content_calendar_settings (
    brand_id   UUID PRIMARY KEY REFERENCES brands (brand_id) ON DELETE CASCADE,
    windows    JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
