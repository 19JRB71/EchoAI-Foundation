-- ============================================================================
-- 072_email_recipient_error_permanent.sql — classify per-recipient email errors
--
-- The failed-recipient panel already shows the raw send failure reason
-- (071_email_recipient_error.sql), but owners still can't tell a permanent
-- failure (hard bounce / invalid address — retrying just fails again) from a
-- transient one (SMTP outage / connection blip — safe to retry). We persist a
-- permanence classification alongside `send_error`, mirroring the SMS
-- `error_permanent` flag (068_sms_message_error.sql) so the dashboard can group
-- "fix first" vs "safe to retry" and stop owners re-queuing dead addresses.
-- Nullable: NULL means "not classified / unknown" (older rows, or reasons we
-- can't confidently classify).
-- Idempotent: IF NOT EXISTS guards let the runner re-apply safely.
-- ============================================================================

ALTER TABLE email_marketing_recipients
  ADD COLUMN IF NOT EXISTS send_error_permanent BOOLEAN;
