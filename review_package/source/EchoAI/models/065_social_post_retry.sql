-- Automatic retry for transiently-failed scheduled social posts.
--
-- A single platform hiccup (timeout, 5xx, rate limit) used to mark a post
-- 'failed' on the first attempt, forcing the owner to reschedule by hand.
-- publishDuePosts now puts a transiently-failed post back to 'scheduled' a few
-- minutes later and tracks how many publish attempts it has consumed here.
-- After the attempt limit (or on any hard error: expired token, rejected
-- content) the post still becomes 'failed' with the stored reason, exactly as
-- before. The stale-'publishing' rescue sweep never retries (double-post risk)
-- and leaves this counter untouched.
--
-- Manual reschedule (failed -> scheduled) resets the counter so an owner-
-- requeued post gets a fresh retry allowance.

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS publish_attempts INTEGER NOT NULL DEFAULT 0;
