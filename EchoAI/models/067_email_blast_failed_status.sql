-- One-time email blasts can now be scheduled for later and are sent by a
-- background worker (sendDueScheduledCampaigns). A blast whose every send dies
-- (dead SMTP config, revoked credentials, zero remaining recipients) flips to
-- 'failed' — the real state transition that triggers the owner's failure
-- alert, mirroring the SMS-blast and scheduled-social-post patterns.
--
-- Note: ALTER TYPE ... ADD VALUE runs fine inside the migration runner's
-- transaction on the Postgres versions we target (12+); the new value is not
-- used elsewhere in this migration.
ALTER TYPE email_marketing_status ADD VALUE IF NOT EXISTS 'failed';
