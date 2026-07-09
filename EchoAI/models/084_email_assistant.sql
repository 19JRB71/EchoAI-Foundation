-- Echo Email Assistant: multi-account email (IMAP/SMTP via app passwords,
-- OAuth-ready columns), cached message intelligence, and drafts awaiting
-- owner approval. Credentials are AES-256-GCM encrypted (utils/encryption.js).

CREATE TABLE IF NOT EXISTS email_accounts (
  account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'custom', -- gmail | yahoo | icloud | outlook | custom
  email_address TEXT NOT NULL,
  display_name TEXT,
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL DEFAULT 465,
  -- AES-256-GCM encrypted app password (never returned by any endpoint)
  password_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected', -- connected | error
  last_error TEXT,
  -- monitoring cursor: highest IMAP UID already processed per mailbox
  last_seen_uid BIGINT NOT NULL DEFAULT 0,
  uid_validity BIGINT,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_accounts_user_address_uniq
  ON email_accounts (user_id, LOWER(email_address));

CREATE TABLE IF NOT EXISTS email_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES email_accounts(account_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  message_uid BIGINT NOT NULL,
  from_address TEXT,
  from_name TEXT,
  subject TEXT,
  received_at TIMESTAMPTZ,
  snippet TEXT,                -- short plain-text excerpt (no full bodies stored)
  ai_summary TEXT,             -- one/two sentence AI summary (NULL when AI was down)
  category TEXT NOT NULL DEFAULT 'general',
  -- urgent | important | contract | lead | invoice | payment | general
  has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
  attachment_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  contract_analysis TEXT,      -- plain-English contract summary when analyzed
  lead_id UUID,                -- CRM lead created from this email, when detected
  alerted BOOLEAN NOT NULL DEFAULT FALSE,
  briefed BOOLEAN NOT NULL DEFAULT FALSE, -- included in a morning briefing already
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_messages_account_uid_uniq
  ON email_messages (account_id, message_uid);
CREATE INDEX IF NOT EXISTS email_messages_user_recent_idx
  ON email_messages (user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_category_idx
  ON email_messages (user_id, category);

CREATE TABLE IF NOT EXISTS email_drafts (
  draft_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES email_accounts(account_id) ON DELETE CASCADE,
  reply_to_message_id UUID REFERENCES email_messages(message_id) ON DELETE SET NULL,
  to_address TEXT NOT NULL,
  to_name TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | discarded | failed
  send_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS email_drafts_user_status_idx
  ON email_drafts (user_id, status);
