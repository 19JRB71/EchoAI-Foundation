// Echo Email Assistant — reliability tests.
//
// Pins the invariants that keep the email assistant honest and safe:
// - drafts NEVER send without approval, and only a pending draft can send
//   (atomic claim: double-send is impossible);
// - stored messages dedup on (account, uid) so overlapping sweeps can't
//   double-record or double-alert;
// - AI triage failure degrades honestly (category general, NULL summary);
// - lead capture dedups against existing CRM leads in app code and skips
//   demo brands;
// - a bad mailbox in the sweep never blocks the other accounts;
// - briefing counts reflect only real cached rows.

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { db, createTestUser, deleteUser } = require("./helpers");
const emailMonitor = require("../utils/emailMonitor");
const emailComposer = require("../utils/emailComposer");
const { detectProvider, presetFor, assertPublicMailHost } = require("../utils/emailAccounts");
const { encrypt } = require("../utils/encryption");

let userId;
let accountId;

async function createAccount(uid, address = `owner-${Date.now()}@example.test`) {
  const { rows } = await db.query(
    `INSERT INTO email_accounts
       (user_id, provider, email_address, imap_host, imap_port, smtp_host, smtp_port, password_encrypted)
     VALUES ($1,'custom',$2,'imap.example.test',993,'smtp.example.test',465,$3)
     RETURNING *`,
    [uid, address, encrypt("app-password")],
  );
  return rows[0];
}

function fakeMessage(uid, overrides = {}) {
  return {
    uid,
    fromAddress: "jane@customer.test",
    fromName: "Jane Customer",
    subject: "Interested in your services",
    receivedAt: new Date(),
    snippet: "Hi, I'd like a quote for weekly service.",
    attachmentNames: [],
    attachments: [],
    ...overrides,
  };
}

before(async () => {
  userId = await createTestUser();
  const account = await createAccount(userId);
  accountId = account.account_id;
});

after(async () => {
  await deleteUser(userId);
  await db.pool.end();
});

// Restore any stubbed seams between tests.
const orig = { ...emailMonitor };
beforeEach(() => {
  for (const k of Object.keys(orig)) emailMonitor[k] = orig[k];
});

// ---- provider presets -------------------------------------------------------

test("detectProvider maps common domains and falls back to custom", () => {
  assert.equal(detectProvider("a@gmail.com"), "gmail");
  assert.equal(detectProvider("a@yahoo.com"), "yahoo");
  assert.equal(detectProvider("a@icloud.com"), "icloud");
  assert.equal(detectProvider("a@me.com"), "icloud");
  assert.equal(detectProvider("a@outlook.com"), "outlook");
  assert.equal(detectProvider("a@mybusiness.com"), "custom");
});

test("presetFor supplies known hosts and honors overrides", () => {
  assert.equal(presetFor("gmail").imapHost, "imap.gmail.com");
  assert.equal(presetFor("custom", { imapHost: "mail.x.test", smtpHost: "smtp.x.test" }).imapHost, "mail.x.test");
  assert.equal(presetFor("custom").imapHost, undefined);
});

test("custom mail hosts must be public DNS names — SSRF guard blocks internal targets", () => {
  for (const bad of [
    "localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254",
    "::1", "fd00::1", "db", "postgres.internal", "printer.local", "router.home.arpa", "",
  ]) {
    assert.throws(() => assertPublicMailHost(bad, "IMAP"), /public mail server/, `should reject ${JSON.stringify(bad)}`);
  }
  for (const ok of ["imap.gmail.com", "mail.mybusiness.com", "smtp.mail.yahoo.com"]) {
    assert.doesNotThrow(() => assertPublicMailHost(ok, "SMTP"), ok);
  }
});

// ---- message storage dedup --------------------------------------------------

test("storeMessage dedups on (account, uid) — overlapping sweeps store once", async () => {
  const account = { account_id: accountId, user_id: userId };
  const m = fakeMessage(101);
  const first = await emailMonitor.storeMessage(account, m, { category: "lead", summary: "Wants a quote." });
  const second = await emailMonitor.storeMessage(account, m, { category: "lead", summary: "Wants a quote." });
  assert.ok(first, "first insert returns an id");
  assert.equal(second, null, "duplicate insert returns null (no double-record)");
});

test("AI triage failure degrades honestly: general category, NULL summary", async () => {
  const account = { account_id: accountId, user_id: userId };
  const m = fakeMessage(102);
  const id = await emailMonitor.storeMessage(account, m, null); // triage failed → null
  const { rows } = await db.query(`SELECT category, ai_summary FROM email_messages WHERE message_id = $1`, [id]);
  assert.equal(rows[0].category, "general");
  assert.equal(rows[0].ai_summary, null);
});

// ---- sweepAccount orchestration ----------------------------------------------

test("sweepAccount stores messages even when classification throws, and advances the cursor", async () => {
  emailMonitor.fetchNewMessages = async () => ({
    messages: [fakeMessage(201), fakeMessage(202, { subject: "Second" })],
    newCursor: 202,
    uidValidity: 7,
  });
  emailMonitor.classifyBatch = async () => {
    throw new Error("AI down");
  };
  const { rows } = await db.query(`SELECT * FROM email_accounts WHERE account_id = $1`, [accountId]);
  const stored = await emailMonitor.sweepAccount(rows[0]);
  assert.equal(stored, 2);
  const { rows: after1 } = await db.query(`SELECT last_seen_uid, uid_validity, status FROM email_accounts WHERE account_id = $1`, [accountId]);
  assert.equal(Number(after1[0].last_seen_uid), 202);
  assert.equal(Number(after1[0].uid_validity), 7);
  assert.equal(after1[0].status, "connected");
  const { rows: msgs } = await db.query(
    `SELECT category FROM email_messages WHERE account_id = $1 AND message_uid IN (201,202)`,
    [accountId],
  );
  assert.equal(msgs.length, 2);
  for (const m of msgs) assert.equal(m.category, "general");
});

test("sweepAllEmailAccounts: one failing mailbox never blocks the others; only auth failures flip status", async () => {
  const other = await createAccount(userId, `owner-two-${Date.now()}@example.test`);
  const swept = [];
  emailMonitor.sweepAccount = async (account) => {
    if (account.account_id === other.account_id) {
      throw new Error("Invalid credentials (authentication failed)");
    }
    swept.push(account.account_id);
    return 0;
  };
  await db.query(`UPDATE email_accounts SET last_checked_at = NULL WHERE user_id = $1`, [userId]);
  await emailMonitor.sweepAllEmailAccounts();
  assert.ok(swept.includes(accountId), "healthy account still swept");
  const { rows } = await db.query(`SELECT status, last_error FROM email_accounts WHERE account_id = $1`, [other.account_id]);
  assert.equal(rows[0].status, "error");
  assert.match(rows[0].last_error, /authentication/i);
  // transient (non-auth) failure keeps status connected
  emailMonitor.sweepAccount = async () => {
    throw new Error("ETIMEDOUT connecting");
  };
  await db.query(`UPDATE email_accounts SET last_checked_at = NULL, status='connected' WHERE account_id = $1`, [accountId]);
  await emailMonitor.sweepAllEmailAccounts();
  const { rows: r2 } = await db.query(`SELECT status FROM email_accounts WHERE account_id = $1`, [accountId]);
  assert.equal(r2[0].status, "connected");
  await db.query(`DELETE FROM email_accounts WHERE account_id = $1`, [other.account_id]);
});

// ---- lead capture -------------------------------------------------------------

test("captureLeadFromEmail dedups against existing CRM leads and skips demo-only owners", async () => {
  // Owner with only a demo brand → no lead is filed anywhere.
  const demoOwner = await createTestUser();
  await db.query(
    `INSERT INTO brands (user_id, brand_name, is_demo) VALUES ($1,'Demo Co', TRUE)`,
    [demoOwner],
  );
  const demoAccount = await createAccount(demoOwner, `demo-${Date.now()}@example.test`);
  const dm = fakeMessage(301);
  const dmId = await emailMonitor.storeMessage(
    { account_id: demoAccount.account_id, user_id: demoOwner }, dm, { category: "lead", summary: "quote" });
  await emailMonitor.captureLeadFromEmail(demoAccount, dmId, dm, { category: "lead", summary: "quote" });
  const { rows: demoLeads } = await db.query(
    `SELECT l.* FROM leads l JOIN brands b ON b.brand_id = l.brand_id WHERE b.user_id = $1`,
    [demoOwner],
  );
  assert.equal(demoLeads.length, 0, "demo brands never receive auto-captured leads");
  await deleteUser(demoOwner);

  // Real brand: first capture creates, second capture reuses the same lead.
  const { rows: brandRows } = await db.query(
    `INSERT INTO brands (user_id, brand_name) VALUES ($1,'Real Co') RETURNING brand_id`,
    [userId],
  );
  const brandId = brandRows[0].brand_id;
  const account = { account_id: accountId, user_id: userId, email_address: "owner@example.test" };
  // AI extraction unavailable → falls back to sender details (honest).
  emailMonitor.classifyBatch = orig.classifyBatch;
  const m1 = fakeMessage(302);
  const id1 = await emailMonitor.storeMessage(account, m1, { category: "lead", summary: "quote" });
  // stub createMessage path by pointing extraction at a failing AI: simplest is
  // to let it fail (no ANTHROPIC key in tests) and use the fallback.
  await emailMonitor.captureLeadFromEmail(account, id1, m1, { category: "lead", summary: "Wants a quote." });
  const m2 = fakeMessage(303);
  const id2 = await emailMonitor.storeMessage(account, m2, { category: "lead", summary: "follow-up" });
  await emailMonitor.captureLeadFromEmail(account, id2, m2, { category: "lead", summary: "Follow-up." });
  const { rows: leads } = await db.query(
    `SELECT lead_id FROM leads WHERE brand_id = $1 AND LOWER(email) = 'jane@customer.test'`,
    [brandId],
  );
  assert.equal(leads.length, 1, "second email from the same sender reuses the existing lead");
  const { rows: linked } = await db.query(
    `SELECT lead_id FROM email_messages WHERE message_id IN ($1,$2)`,
    [id1, id2],
  );
  assert.equal(String(linked[0].lead_id), String(leads[0].lead_id));
  assert.equal(String(linked[1].lead_id), String(leads[0].lead_id));
});

// ---- drafts: approval-gated sending -------------------------------------------

test("sendDraft only sends a pending draft once (atomic claim); discard blocks send", async () => {
  const d1 = await emailComposer.createDraft(userId, {
    accountId,
    toAddress: "jane@customer.test",
    subject: "Quote",
    body: "Here is the quote.",
  });
  // Simulate a concurrent/duplicate approval: claim it out from under sendDraft.
  await db.query(`UPDATE email_drafts SET status='sent', sent_at=NOW() WHERE draft_id = $1`, [d1.draft_id]);
  await assert.rejects(() => emailComposer.sendDraft(userId, d1.draft_id), /already sent or discarded/);

  const d2 = await emailComposer.createDraft(userId, {
    accountId,
    toAddress: "jane@customer.test",
    subject: "Quote 2",
    body: "Body",
  });
  assert.equal(await emailComposer.discardDraft(userId, d2.draft_id), true);
  await assert.rejects(() => emailComposer.sendDraft(userId, d2.draft_id), /already sent or discarded/);
  // discarding twice is a no-op
  assert.equal(await emailComposer.discardDraft(userId, d2.draft_id), false);
});

test("sendDraft records an honest failure when SMTP rejects (draft flips to failed)", async () => {
  const d = await emailComposer.createDraft(userId, {
    accountId,
    toAddress: "jane@customer.test",
    subject: "Will fail",
    body: "Body",
  });
  // smtp.example.test is unreachable → transporter throws → 502 + failed status.
  await assert.rejects(() => emailComposer.sendDraft(userId, d.draft_id), /couldn't be sent/);
  const { rows } = await db.query(`SELECT status, send_error FROM email_drafts WHERE draft_id = $1`, [d.draft_id]);
  assert.equal(rows[0].status, "failed");
  assert.ok(rows[0].send_error, "send_error stored for the owner to see");
});

// ---- briefing counts -----------------------------------------------------------

test("inboxBriefingCounts reports only real cached rows in the window", async () => {
  const counts = await emailMonitor.inboxBriefingCounts(userId, 24);
  assert.ok(counts.total >= 4, "counts include the messages stored above");
  assert.equal(typeof counts.urgent, "number");
  // A user with no messages gets zeros, never fabricated numbers.
  const empty = await emailMonitor.inboxBriefingCounts("00000000-0000-0000-0000-000000000000", 24);
  assert.equal(empty.total, 0);
});
