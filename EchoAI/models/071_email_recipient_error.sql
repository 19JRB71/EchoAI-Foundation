-- ============================================================================
-- 071_email_recipient_error.sql — store per-recipient email send failure reason
--
-- The failed-recipient panel in a drip sequence lists each recipient's address
-- and the step they stopped at, but not WHY the send failed (bounce, invalid
-- address, SMTP/provider error). Without the reason, owners retry blindly — a
-- hard-bounced address just fails again. We persist the send failure message on
-- the recipient row so the dashboard can surface a short human-readable reason
-- alongside the "Stopped at email N" line, mirroring the SMS error_message idea
-- but for the separate email-marketing code path.
-- Idempotent: IF NOT EXISTS guards let the runner re-apply safely.
-- ============================================================================

ALTER TABLE email_marketing_recipients
  ADD COLUMN IF NOT EXISTS send_error TEXT;
