-- Durable copy of served upload files (AI-generated images under
-- /uploads/images and owner-uploaded post media under /uploads/media).
-- Production runs on an ephemeral filesystem that is wiped on every deploy,
-- which silently deleted post images — Facebook then published text-only
-- posts because the image URL 404'd at publish time. The database copy is
-- the source of truth; the disk file is a self-restoring cache.
-- (Vision reference photos got the same treatment in 112 via their own table.)

CREATE TABLE IF NOT EXISTS stored_files (
  file_path  TEXT PRIMARY KEY,          -- relative URL, e.g. /uploads/images/<uuid>.png
  mime_type  TEXT NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
