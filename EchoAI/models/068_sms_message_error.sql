-- ============================================================================
-- 068_sms_message_error.sql — store per-message SMS send failure reasons
--
-- When a bulk SMS blast fails, owners couldn't see WHY each recipient failed
-- (bad number vs Twilio credential/outage vs opt-out). We persist the failure
-- reason on the outbound message row plus a classification flag so the
-- dashboard can distinguish permanent failures (retrying won't help — fix the
-- number first) from transient ones (safe to retry the blast).
-- Idempotent: IF NOT EXISTS guards let the runner re-apply safely.
-- ============================================================================

BEGIN;

ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS error_permanent BOOLEAN;

COMMIT;
