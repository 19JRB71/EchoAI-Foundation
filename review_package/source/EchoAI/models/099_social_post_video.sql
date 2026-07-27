-- Owner-uploaded media on scheduled social posts. image_url already exists
-- (092); video_url holds a relative /uploads/media/... path for uploaded
-- videos. A post carries at most one of the two (enforced in app code).
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS video_url TEXT;
