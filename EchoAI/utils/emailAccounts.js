/**
 * Echo Email Assistant — account connections.
 *
 * Owners connect personal email accounts with an app password (Gmail, Yahoo,
 * iCloud all issue app-specific passwords; any custom IMAP host works too).
 * Passwords are AES-256-GCM encrypted at rest (utils/encryption.js) and are
 * never returned by any endpoint. Connections are verified with a real IMAP
 * login before saving — no silent "connected" rows that can't actually log in.
 */

const { ImapFlow } = require("imapflow");
const db = require("../config/db");
const { encrypt, decrypt } = require("./encryption");

// Provider presets: known IMAP/SMTP hosts so the owner only enters their
// email + app password. "outlook" is included for custom/app-password setups;
// Microsoft has been retiring basic auth, so it may require the custom route.
const PROVIDER_PRESETS = {
  gmail: { imapHost: "imap.gmail.com", imapPort: 993, smtpHost: "smtp.gmail.com", smtpPort: 465 },
  yahoo: { imapHost: "imap.mail.yahoo.com", imapPort: 993, smtpHost: "smtp.mail.yahoo.com", smtpPort: 465 },
  icloud: { imapHost: "imap.mail.me.com", imapPort: 993, smtpHost: "smtp.mail.me.com", smtpPort: 587 },
  outlook: { imapHost: "outlook.office365.com", imapPort: 993, smtpHost: "smtp-mail.outlook.com", smtpPort: 587 },
};

function presetFor(provider, overrides = {}) {
  const p = PROVIDER_PRESETS[provider] || {};
  return {
    imapHost: overrides.imapHost || p.imapHost,
    imapPort: Number(overrides.imapPort || p.imapPort || 993),
    smtpHost: overrides.smtpHost || p.smtpHost,
    smtpPort: Number(overrides.smtpPort || p.smtpPort || 465),
  };
}

function detectProvider(emailAddress) {
  const domain = String(emailAddress).split("@")[1]?.toLowerCase() || "";
  if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
  if (domain === "yahoo.com" || domain.endsWith(".yahoo.com")) return "yahoo";
  if (["icloud.com", "me.com", "mac.com"].includes(domain)) return "icloud";
  if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)) return "outlook";
  return "custom";
}

// Open a verified IMAP connection for an account row (decrypts the password).
// Callers MUST call client.logout() (or close) when done.
async function openImap(account) {
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: true,
    auth: { user: account.email_address, pass: decrypt(account.password_encrypted) },
    logger: false,
    // fail fast: a dead mailbox shouldn't hang the 15-minute sweep
    socketTimeout: 60 * 1000,
    greetingTimeout: 15 * 1000,
  });
  await client.connect();
  return client;
}

// Verify a login with a throwaway connection (used before saving an account).
async function verifyImapLogin({ emailAddress, password, imapHost, imapPort }) {
  const client = new ImapFlow({
    host: imapHost,
    port: imapPort,
    secure: true,
    auth: { user: emailAddress, pass: password },
    logger: false,
    socketTimeout: 30 * 1000,
    greetingTimeout: 15 * 1000,
  });
  try {
    await client.connect();
    await client.logout();
  } finally {
    try {
      client.close();
    } catch (_) {
      /* already closed */
    }
  }
}

async function getOwnedAccount(userId, accountId) {
  const { rows } = await db.query(
    `SELECT * FROM email_accounts WHERE account_id = $1 AND user_id = $2`,
    [accountId, userId],
  );
  return rows[0] || null;
}

async function listAccounts(userId) {
  const { rows } = await db.query(
    `SELECT account_id, provider, email_address, display_name, status, last_error,
            last_checked_at, created_at
       FROM email_accounts WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId],
  );
  return rows;
}

// SSRF guard for owner-supplied custom mail hosts: only real public hostnames
// are allowed — never IP literals, localhost, or single-label internal names.
// (Preset providers use hardcoded hosts and skip user input entirely.)
function assertPublicMailHost(host, label) {
  const h = String(host || "").trim().toLowerCase();
  const bad =
    !h ||
    h.length > 253 ||
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h) || // must be a dotted DNS name
    /^\d+\.\d+\.\d+\.\d+$/.test(h) || // IPv4 literal
    h.includes(":") || // IPv6 literal
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".home.arpa");
  if (bad) {
    const e = new Error(`That ${label} server address doesn't look like a public mail server. Please use your provider's hostname (like mail.yourdomain.com).`);
    e.statusCode = 400;
    throw e;
  }
}

async function createAccount(userId, { emailAddress, password, provider, displayName, imapHost, imapPort, smtpHost, smtpPort }) {
  const resolvedProvider = provider || detectProvider(emailAddress);
  const hosts = presetFor(resolvedProvider, { imapHost, imapPort, smtpHost, smtpPort });
  if (!hosts.imapHost || !hosts.smtpHost) {
    const e = new Error("This email provider needs custom mail server settings (IMAP and SMTP host).");
    e.statusCode = 400;
    throw e;
  }
  assertPublicMailHost(hosts.imapHost, "IMAP");
  assertPublicMailHost(hosts.smtpHost, "SMTP");
  const badPort = (p) => !Number.isInteger(p) || p < 1 || p > 65535;
  if (badPort(hosts.imapPort) || badPort(hosts.smtpPort)) {
    const e = new Error("Mail server ports must be between 1 and 65535.");
    e.statusCode = 400;
    throw e;
  }
  // Real login check before anything is stored — honest failure, no bad rows.
  try {
    await verifyImapLogin({ emailAddress, password, imapHost: hosts.imapHost, imapPort: hosts.imapPort });
  } catch (err) {
    const e = new Error(
      "Couldn't sign in to that mailbox. Double-check the email address and app password (regular account passwords usually don't work — use an app password).",
    );
    e.statusCode = 400;
    e.cause = err;
    throw e;
  }
  const { rows } = await db.query(
    `INSERT INTO email_accounts
       (user_id, provider, email_address, display_name, imap_host, imap_port, smtp_host, smtp_port, password_encrypted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (user_id, LOWER(email_address)) DO UPDATE SET
       provider = EXCLUDED.provider,
       display_name = COALESCE(EXCLUDED.display_name, email_accounts.display_name),
       imap_host = EXCLUDED.imap_host,
       imap_port = EXCLUDED.imap_port,
       smtp_host = EXCLUDED.smtp_host,
       smtp_port = EXCLUDED.smtp_port,
       password_encrypted = EXCLUDED.password_encrypted,
       status = 'connected', last_error = NULL, updated_at = NOW()
     RETURNING account_id, provider, email_address, display_name, status, created_at`,
    [
      userId,
      resolvedProvider,
      String(emailAddress).trim(),
      displayName ? String(displayName).trim() : null,
      hosts.imapHost,
      hosts.imapPort,
      hosts.smtpHost,
      hosts.smtpPort,
      encrypt(password),
    ],
  );
  return rows[0];
}

async function deleteAccount(userId, accountId) {
  const { rowCount } = await db.query(
    `DELETE FROM email_accounts WHERE account_id = $1 AND user_id = $2`,
    [accountId, userId],
  );
  return rowCount > 0;
}

module.exports = {
  PROVIDER_PRESETS,
  assertPublicMailHost,
  presetFor,
  detectProvider,
  openImap,
  verifyImapLogin,
  getOwnedAccount,
  listAccounts,
  createAccount,
  deleteAccount,
};
