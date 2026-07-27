const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// The failed-drip-recipient reason lifecycle: a recipient that exhausts its
// send attempts must persist the *real* upstream error onto its row, that
// reason must surface in the campaign detail payload, and retrying the
// recipient must clear the reason back to NULL so a stale reason never lingers
// after re-queue. Guards the three moving parts against a future refactor of
// the send loop silently dropping the reason (owners back to retrying blind):
//   - sendDueDripEmails: the pending -> failed flip stores the sendEmail error
//     message in send_error ($3 of the flip UPDATE)
//   - getCampaignDetail: send_error is selected into each recipient row
//   - retryDripRecipient: the failed -> pending flip sets send_error = NULL
// Tests never touch a real database or SMTP: db.query/db.getClient and the mail
// transport are swapped for fakes.
// ---------------------------------------------------------------------------

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";
process.env.PUBLIC_BASE_URL = "https://example.com";
// Make sendEmail fail on its first attempt (no multi-second backoff loop).
process.env.EMAIL_MAX_RETRIES = "1";

// Stub the mail transport BEFORE the email util lazily builds one so the drip
// send throws a known, specific error message we can assert is persisted.
const SEND_ERROR_MESSAGE = "SMTP 550: mailbox unavailable";
const nodemailer = require("nodemailer");
nodemailer.createTransport = () => ({
  sendMail: async () => {
    throw new Error(SEND_ERROR_MESSAGE);
  },
});

const db = require("../config/db");
const pushController = require("../controllers/pushController");
const mobilePushController = require("../controllers/mobilePushController");
const {
  sendDueDripEmails,
  getCampaignDetail,
  retryDripRecipient,
} = require("../controllers/emailMarketingController");

const CAMPAIGN_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const RECIPIENT_ID = "11111111-2222-3333-4444-555555555555";

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

/** Runs fn with db + both push senders stubbed; restores afterwards. */
async function withStubs({ fakeQuery, fakeGetClient, onPush, onMobilePush }, fn) {
  const origQuery = db.query;
  const origGetClient = db.getClient;
  const origPush = pushController.sendPushToUser;
  const origMobile = mobilePushController.sendToUser;
  db.query = fakeQuery;
  if (fakeGetClient) db.getClient = fakeGetClient;
  pushController.sendPushToUser = onPush || (async () => ({ sent: 1, failed: 0 }));
  mobilePushController.sendToUser =
    onMobilePush || (async () => ({ sent: 0, failed: 0, skipped: true }));
  try {
    return await fn();
  } finally {
    db.query = origQuery;
    db.getClient = origGetClient;
    pushController.sendPushToUser = origPush;
    mobilePushController.sendToUser = origMobile;
  }
}

// ---------------------------------------------------------------------------
// sendDueDripEmails: the flip to 'failed' persists the real send error.
// ---------------------------------------------------------------------------

/**
 * Fake db for one due drip recipient whose only remaining email fails to send.
 * `sendAttempts` seeds the claim row so we can push it over the attempt limit
 * (MAX_DRIP_SEND_ATTEMPTS = 3): with 2 already used, this run's attempt is the
 * 3rd and flips the row to 'failed'. Captures the flip UPDATE's params so the
 * test can assert send_error carries the upstream message.
 */
function makeDripDb({ sendAttempts }) {
  const state = { flipParams: null, flips: 0, failoverUpdates: 0 };

  async function clientQuery(sql, params = []) {
    const bare = sql.trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(bare)) return { rows: [] };
    // Claim the due recipient FOR UPDATE.
    if (/FOR UPDATE OF r SKIP LOCKED/i.test(sql)) {
      return {
        rows: [
          {
            recipient_id: RECIPIENT_ID,
            campaign_id: CAMPAIGN_ID,
            email_address: "lead@example.com",
            current_step: 1,
            send_attempts: sendAttempts,
            brand_id: "b1",
            campaign_name: "Welcome Series",
          },
        ],
      };
    }
    // Not opted out.
    if (/FROM email_opt_outs/i.test(sql)) return { rows: [] };
    // One email queued at this step (the send below will throw).
    if (/FROM email_marketing_emails/i.test(sql)) {
      return {
        rows: [
          {
            sequence_position: 1,
            subject_line: "Hello",
            body_html: "<p>Hi</p>",
            send_delay_days: 0,
          },
        ],
      };
    }
    // The pending -> failed flip carrying send_error in $3.
    if (
      /UPDATE email_marketing_recipients/i.test(sql) &&
      /delivery_status = 'failed'/i.test(sql) &&
      /send_error = \$3/i.test(sql)
    ) {
      state.flips += 1;
      state.flipParams = params;
      return { rows: [{ recipient_id: RECIPIENT_ID }] };
    }
    // Below-limit attempt-count bump (should not fire in the flip test).
    if (
      /UPDATE email_marketing_recipients/i.test(sql) &&
      /SET send_attempts = \$1/i.test(sql)
    ) {
      state.failoverUpdates += 1;
      return { rows: [] };
    }
    throw new Error(`makeDripDb: unexpected client query: ${sql.slice(0, 80)}`);
  }

  async function query(sql, params = []) {
    // The due-recipient scan.
    if (
      /FROM email_marketing_recipients r/i.test(sql) &&
      /campaign_type = 'drip'/i.test(sql)
    ) {
      return { rows: [{ recipient_id: RECIPIENT_ID }] };
    }
    // The per-campaign alert cooldown claim (win it so the alert path runs).
    if (
      /UPDATE email_marketing_campaigns/i.test(sql) &&
      /last_failure_alert_at = NOW\(\)/i.test(sql)
    ) {
      return { rows: [{ campaign_id: CAMPAIGN_ID }] };
    }
    // The alert helper's brand lookup.
    if (/SELECT brand_name, user_id, is_demo FROM brands/i.test(sql)) {
      return {
        rows: [{ brand_name: "Acme", user_id: "u1", is_demo: false }],
      };
    }
    throw new Error(`makeDripDb: unexpected query: ${sql.slice(0, 80)}`);
  }

  async function getClient() {
    return { query: clientQuery, release: () => {} };
  }

  return { query, getClient, state };
}

test("sendDueDripEmails: the flip to 'failed' persists the real send error", async () => {
  const fake = makeDripDb({ sendAttempts: 2 }); // this run is the 3rd attempt
  await withStubs(
    { fakeQuery: fake.query, fakeGetClient: fake.getClient },
    async () => {
      const result = await sendDueDripEmails();
      // Exactly one recipient flipped to 'failed', none stayed pending.
      assert.strictEqual(fake.state.flips, 1, "recipient must flip to failed");
      assert.strictEqual(
        fake.state.failoverUpdates,
        0,
        "at the limit the row flips, it does not just bump attempts"
      );
      // The flip UPDATE params are [attemptsUsed, recipientId, sendError].
      assert.ok(fake.state.flipParams, "flip UPDATE must have run");
      assert.strictEqual(fake.state.flipParams[1], RECIPIENT_ID);
      assert.strictEqual(
        fake.state.flipParams[2],
        SEND_ERROR_MESSAGE,
        "send_error ($3) must be the real upstream error message"
      );
      assert.strictEqual(result.failed, 1);
    }
  );
});

test("sendDueDripEmails: below the attempt limit the row stays pending with no send_error flip", async () => {
  const fake = makeDripDb({ sendAttempts: 0 }); // this run is only the 1st attempt
  await withStubs(
    { fakeQuery: fake.query, fakeGetClient: fake.getClient },
    async () => {
      const result = await sendDueDripEmails();
      assert.strictEqual(fake.state.flips, 0, "must not flip to failed yet");
      assert.strictEqual(
        fake.state.failoverUpdates,
        1,
        "below the limit only the attempt count is bumped"
      );
      assert.strictEqual(result.failed, 0);
    }
  );
});

// ---------------------------------------------------------------------------
// getCampaignDetail: send_error is returned in each recipient row.
// ---------------------------------------------------------------------------

test("getCampaignDetail: each recipient row includes send_error", async () => {
  const RECIPIENTS = [
    {
      recipient_id: RECIPIENT_ID,
      email_address: "lead@example.com",
      delivery_status: "failed",
      current_step: 1,
      send_error: SEND_ERROR_MESSAGE,
      opened_at: null,
      clicked_at: null,
      unsubscribed_at: null,
    },
    {
      recipient_id: "22222222-3333-4444-5555-666666666666",
      email_address: "ok@example.com",
      delivery_status: "sent",
      current_step: 2,
      send_error: null,
      opened_at: null,
      clicked_at: null,
      unsubscribed_at: null,
    },
  ];

  async function fakeQuery(sql, params = []) {
    // getOwnedCampaign
    if (
      /FROM email_marketing_campaigns c/i.test(sql) &&
      /JOIN brands b/i.test(sql)
    ) {
      return { rows: [{ campaign_id: CAMPAIGN_ID, brand_id: "b1", campaign_type: "drip" }] };
    }
    if (/FROM email_marketing_emails/i.test(sql)) return { rows: [] };
    if (
      /FROM email_marketing_recipients/i.test(sql) &&
      /send_error/i.test(sql)
    ) {
      return { rows: RECIPIENTS };
    }
    throw new Error(`getCampaignDetail fake: unexpected query: ${sql.slice(0, 80)}`);
  }

  await withStubs({ fakeQuery }, async () => {
    const req = { user: { userId: "u1" }, params: { campaignId: CAMPAIGN_ID } };
    const res = makeRes();
    await getCampaignDetail(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.recipients.length, 2);
    for (const r of res.body.recipients) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(r, "send_error"),
        "every recipient must carry send_error"
      );
    }
    assert.strictEqual(res.body.recipients[0].send_error, SEND_ERROR_MESSAGE);
    assert.strictEqual(res.body.recipients[1].send_error, null);
  });
});

// ---------------------------------------------------------------------------
// retryDripRecipient: the failed -> pending flip clears send_error to NULL.
// ---------------------------------------------------------------------------

test("retryDripRecipient: the retry flip clears send_error back to NULL", async () => {
  const state = { updateSql: null };
  async function fakeQuery(sql, params = []) {
    if (
      /UPDATE email_marketing_recipients r/i.test(sql) &&
      /SET delivery_status = 'pending'/i.test(sql)
    ) {
      state.updateSql = sql;
      return {
        rows: [
          {
            recipient_id: RECIPIENT_ID,
            email_address: "lead@example.com",
            delivery_status: "pending",
            current_step: 1,
            send_attempts: 0,
            next_send_at: "2026-07-07T00:00:00Z",
          },
        ],
      };
    }
    throw new Error(`retry fake: unexpected query: ${sql.slice(0, 80)}`);
  }

  await withStubs({ fakeQuery }, async () => {
    const req = {
      user: { userId: "u1" },
      params: { campaignId: CAMPAIGN_ID, recipientId: RECIPIENT_ID },
    };
    const res = makeRes();
    await retryDripRecipient(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.recipient.delivery_status, "pending");
    // The atomic re-queue UPDATE must null out the stale reason so a retried
    // recipient never shows a leftover failure message.
    assert.match(
      state.updateSql,
      /send_error = NULL/i,
      "retry UPDATE must reset send_error to NULL"
    );
  });
});
