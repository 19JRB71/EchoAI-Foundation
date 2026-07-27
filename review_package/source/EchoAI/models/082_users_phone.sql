-- ============================================================================
-- 082_users_phone.sql — owner mobile number for Echo's personal SMS fallback
--
-- Echo's personal reminders fall back to a text message when the spoken
-- reminder isn't picked up, and overdue high-priority tasks SMS-alert the
-- owner. Both need a phone number on the owner's own account.
--
-- Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
