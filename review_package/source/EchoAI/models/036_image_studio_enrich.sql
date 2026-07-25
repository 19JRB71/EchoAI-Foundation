-- Image Studio enrichment: store the content brief and style notes alongside
-- each saved image so the library can show what was requested and the prompt
-- engineer's palette/mood/lighting summary. Idempotent (safe to re-run).

ALTER TABLE images ADD COLUMN IF NOT EXISTS content_description TEXT;
ALTER TABLE images ADD COLUMN IF NOT EXISTS style_notes TEXT;
