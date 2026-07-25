-- Owner-uploaded video attached to an Autopilot batch item (Facebook only).
ALTER TABLE autopilot_batch_items ADD COLUMN IF NOT EXISTS video_url TEXT;
