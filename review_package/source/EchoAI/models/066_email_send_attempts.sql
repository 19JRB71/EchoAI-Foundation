-- Failure tracking for the hourly drip-email scheduler.
--
-- A drip send that died at the SMTP layer used to stay 'pending' and retry
-- every hour forever, silently: with a dead SMTP config or revoked credentials
-- the owner never found out. sendDueDripEmails now counts attempts here and,
-- after the attempt limit, flips the recipient to 'failed' (next_send_at
-- cleared) — the real state transition that triggers the owner's failure
-- alert, mirroring the scheduled-social-post pattern.
--
-- A transient one-off SMTP hiccup still behaves as before: the row stays
-- 'pending' and the next hourly tick retries it.

ALTER TABLE email_marketing_recipients
  ADD COLUMN IF NOT EXISTS send_attempts INTEGER NOT NULL DEFAULT 0;
