const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// Background sender for scheduled one-time email blasts
// (sendDueScheduledCampaigns) + owner alerting on the real 'failed' flip.
// Mirrors emailSmsFailureAlert.test.js and covers the invariants that matter:
//   - a due blast whose every send fails flips the campaign to 'failed' via a
//     status-guarded UPDATE and the owner gets ONE alert with the reason and
//     an Email-section deep link (per-campaign tag)
//   - partial success marks the campaign 'sent' — no failed flip, no alert
//   - a blast with zero remaining recipients flips to 'failed' and alerts
//   - a claim that finds no row (already claimed / status moved on) is skipped
//     without touching anything
//   - the guarded failed flip losing the race (0 rows) never alerts
//   - demo brands are excluded in the due query (is_demo = false) and the
//     shared alert helper skips them as a backstop
// Tests never touch a real database or SMTP: db.query/db.getClient are swapped
// for fakes and the push controllers' exports are stubbed.
// ---------------------------------------------------------------------------

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";
process.env.PUBLIC_BASE_URL = "https://example.com";

// Stub the mail transport BEFORE the email controller lazily builds one.
const nodemailer = require("nodemailer");
let sendMailImpl = async () => {
  throw new Error("scheduledEmailBlast.test: unexpected sendMail call");
};
nodemailer.createTransport = () => ({
  sendMail: (message) => sendMailImpl(message),
});

const db = require("../config/db");
const pushController = require("../controllers/pushController");
const mobilePushController = require("../controllers/mobilePushController");
const {
  sendDueScheduledCampaigns,
} = require("../controllers/emailMarketingController");

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

/**
 * Fake db for sendDueScheduledCampaigns.
 * `campaigns` maps campaign_id -> { brand_id, campaign_name, email,
 * recipients: [{recipient_id, email_address}], claimable, flipRows }.
 * `brands` serves the alert helper's lookup.
 */
function makeBlastDb({ campaigns, brands }) {
  const state = {
    recipientUpdates: [],
    campaignSent: [],
    failedFlips: [],
    brandLookups: [],
    dueQueries: [],
  };

  async function clientQuery(sql, params = []) {
    const bare = sql.trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(bare)) return { rows: [] };
    if (/FROM email_marketing_campaigns c/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      const c = campaigns[params[0]];
      if (!c || c.claimable === false) return { rows: [] };
      return {
        rows: [
          {
            campaign_id: params[0],
            brand_id: c.brand_id,
            campaign_name: c.campaign_name,
          },
        ],
      };
    }
    if (/FROM email_marketing_emails/i.test(sql)) {
      const c = campaigns[params[0]];
      return { rows: c && c.email ? [c.email] : [] };
    }
    if (/FROM email_marketing_recipients/i.test(sql) && /delivery_status = 'pending'/i.test(sql)) {
      const c = campaigns[params[0]];
      return { rows: (c && c.recipients) || [] };
    }
    if (/FROM email_opt_outs/i.test(sql)) return { rows: [] };
    if (/UPDATE email_marketing_recipients/i.test(sql)) {
      const status = /delivery_status = 'sent'/i.test(sql)
        ? "sent"
        : /delivery_status = 'failed'/i.test(sql)
          ? "failed"
          : "other";
      state.recipientUpdates.push({ recipientId: params[0], status });
      return { rows: [] };
    }
    if (
      /UPDATE email_marketing_campaigns/i.test(sql) &&
      /status = 'sent'/i.test(sql)
    ) {
      state.campaignSent.push({ campaignId: params[1], sent: params[0] });
      return { rows: [{ campaign_id: params[1] }] };
    }
    if (
      /UPDATE email_marketing_campaigns/i.test(sql) &&
      /status = 'failed'/i.test(sql)
    ) {
      const c = campaigns[params[0]];
      const rows = c && c.flipRows === 0 ? [] : [{ campaign_id: params[0] }];
      if (rows.length) state.failedFlips.push(params[0]);
      return { rows };
    }
    throw new Error(`makeBlastDb: unexpected client query: ${sql.slice(0, 80)}`);
  }

  async function query(sql, params = []) {
    if (
      /FROM email_marketing_campaigns c/i.test(sql) &&
      /JOIN brands b/i.test(sql)
    ) {
      state.dueQueries.push(sql);
      return {
        rows: Object.keys(campaigns).map((campaign_id) => ({ campaign_id })),
      };
    }
    if (/SELECT brand_name, user_id, is_demo FROM brands/i.test(sql)) {
      state.brandLookups.push(params[0]);
      const b = brands[params[0]];
      return { rows: b ? [b] : [] };
    }
    throw new Error(`makeBlastDb: unexpected query: ${sql.slice(0, 80)}`);
  }

  async function getClient() {
    return { query: clientQuery, release: () => {} };
  }

  return { query, getClient, state };
}

test("due blast with total send failure flips to failed and alerts the owner once", async () => {
  const fake = makeBlastDb({
    campaigns: {
      c1: {
        brand_id: "b1",
        campaign_name: "Spring Promo",
        email: { subject_line: "Hi", body_html: "<p>Hello</p>" },
        recipients: [
          { recipient_id: "r1", email_address: "a@x.com" },
          { recipient_id: "r2", email_address: "b@x.com" },
        ],
      },
    },
    brands: { b1: { brand_name: "Acme", user_id: "owner-1", is_demo: false } },
  });
  const origSendMail = sendMailImpl;
  sendMailImpl = async () => {
    throw new Error("SMTP connection refused");
  };
  const pushes = [];
  const mobilePushes = [];
  try {
    await withStubs(
      {
        fakeQuery: fake.query,
        fakeGetClient: fake.getClient,
        onPush: async (userId, payload) => {
          pushes.push({ userId, payload });
          return { sent: 1, failed: 0 };
        },
        onMobilePush: async (userId, payload) => {
          mobilePushes.push({ userId, payload });
          return { sent: 1, failed: 0 };
        },
      },
      async () => {
        const summary = await sendDueScheduledCampaigns();
        assert.strictEqual(summary.processed, 1);
        assert.strictEqual(summary.sent, 0);
        assert.strictEqual(summary.failed, 1);
      },
    );
  } finally {
    sendMailImpl = origSendMail;
  }

  assert.deepStrictEqual(
    fake.state.recipientUpdates,
    [
      { recipientId: "r1", status: "failed" },
      { recipientId: "r2", status: "failed" },
    ],
    "both recipients marked failed",
  );
  assert.deepStrictEqual(fake.state.failedFlips, ["c1"], "campaign flipped to failed");
  assert.deepStrictEqual(fake.state.campaignSent, [], "campaign never marked sent");
  assert.strictEqual(pushes.length, 1, "exactly one alert per campaign");
  assert.strictEqual(pushes[0].userId, "owner-1");
  const p = pushes[0].payload;
  assert.match(p.title, /email blast failed/i);
  assert.match(p.body, /Spring Promo/, "body names the campaign");
  assert.match(p.body, /Acme/, "body names the brand");
  assert.match(p.body, /SMTP connection refused/i, "body carries the failure reason");
  assert.strictEqual(p.url, "/dashboard?section=email", "deep-links to the Email section");
  assert.strictEqual(p.tag, "email-campaign-failed-c1", "per-campaign tag");
  assert.strictEqual(mobilePushes.length, 1, "FCM mirror also sent");
});

test("partial success marks the blast sent: no failed flip, no alert", async () => {
  const fake = makeBlastDb({
    campaigns: {
      c1: {
        brand_id: "b1",
        campaign_name: "Spring Promo",
        email: { subject_line: "Hi", body_html: "<p>Hello</p>" },
        recipients: [
          { recipient_id: "r1", email_address: "ok@x.com" },
          { recipient_id: "r2", email_address: "bad@x.com" },
        ],
      },
    },
    brands: { b1: { brand_name: "Acme", user_id: "owner-1", is_demo: false } },
  });
  const origSendMail = sendMailImpl;
  sendMailImpl = async ({ to }) => {
    if (/bad@/.test(to)) throw new Error("mailbox unavailable");
    return { messageId: "m1" };
  };
  const pushes = [];
  try {
    await withStubs(
      {
        fakeQuery: fake.query,
        fakeGetClient: fake.getClient,
        onPush: async (userId, payload) => {
          pushes.push(payload);
          return { sent: 1, failed: 0 };
        },
      },
      async () => {
        const summary = await sendDueScheduledCampaigns();
        assert.strictEqual(summary.sent, 1, "campaign counted as sent");
        assert.strictEqual(summary.failed, 0);
      },
    );
  } finally {
    sendMailImpl = origSendMail;
  }
  assert.deepStrictEqual(fake.state.campaignSent, [{ campaignId: "c1", sent: 1 }]);
  assert.deepStrictEqual(fake.state.failedFlips, [], "no failed flip on partial success");
  assert.strictEqual(pushes.length, 0, "no alert without a real failed transition");
});

test("blast with no remaining recipients flips to failed and alerts with the reason", async () => {
  const fake = makeBlastDb({
    campaigns: {
      c1: {
        brand_id: "b1",
        campaign_name: "Ghost Blast",
        email: { subject_line: "Hi", body_html: "<p>Hello</p>" },
        recipients: [],
      },
    },
    brands: { b1: { brand_name: "Acme", user_id: "owner-1", is_demo: false } },
  });
  const pushes = [];
  await withStubs(
    {
      fakeQuery: fake.query,
      fakeGetClient: fake.getClient,
      onPush: async (userId, payload) => {
        pushes.push(payload);
        return { sent: 1, failed: 0 };
      },
    },
    async () => {
      const summary = await sendDueScheduledCampaigns();
      assert.strictEqual(summary.failed, 1);
    },
  );
  assert.deepStrictEqual(fake.state.failedFlips, ["c1"]);
  assert.strictEqual(pushes.length, 1);
  assert.match(pushes[0].body, /No recipients left/i, "body carries the reason");
});

test("unclaimable campaign (already claimed or status moved on) is skipped untouched", async () => {
  const fake = makeBlastDb({
    campaigns: {
      c1: {
        brand_id: "b1",
        campaign_name: "Racing Blast",
        claimable: false,
      },
    },
    brands: { b1: { brand_name: "Acme", user_id: "owner-1", is_demo: false } },
  });
  const pushes = [];
  await withStubs(
    {
      fakeQuery: fake.query,
      fakeGetClient: fake.getClient,
      onPush: async (userId, payload) => {
        pushes.push(payload);
        return { sent: 1, failed: 0 };
      },
    },
    async () => {
      const summary = await sendDueScheduledCampaigns();
      assert.strictEqual(summary.processed, 0, "nothing processed");
      assert.strictEqual(summary.failed, 0);
    },
  );
  assert.deepStrictEqual(fake.state.recipientUpdates, []);
  assert.deepStrictEqual(fake.state.failedFlips, []);
  assert.strictEqual(pushes.length, 0);
});

test("guarded failed flip losing the race (0 rows) never alerts", async () => {
  const fake = makeBlastDb({
    campaigns: {
      c1: {
        brand_id: "b1",
        campaign_name: "Raced Blast",
        email: { subject_line: "Hi", body_html: "<p>Hello</p>" },
        recipients: [{ recipient_id: "r1", email_address: "a@x.com" }],
        flipRows: 0,
      },
    },
    brands: { b1: { brand_name: "Acme", user_id: "owner-1", is_demo: false } },
  });
  const origSendMail = sendMailImpl;
  sendMailImpl = async () => {
    throw new Error("SMTP down");
  };
  const pushes = [];
  try {
    await withStubs(
      {
        fakeQuery: fake.query,
        fakeGetClient: fake.getClient,
        onPush: async (userId, payload) => {
          pushes.push(payload);
          return { sent: 1, failed: 0 };
        },
      },
      async () => {
        const summary = await sendDueScheduledCampaigns();
        assert.strictEqual(summary.failed, 0, "flip did not happen here");
      },
    );
  } finally {
    sendMailImpl = origSendMail;
  }
  assert.strictEqual(pushes.length, 0, "no alert when the guarded flip hit no row");
});

test("total failure on a demo brand flips but never alerts (helper backstop)", async () => {
  const fake = makeBlastDb({
    campaigns: {
      c1: {
        brand_id: "b-demo",
        campaign_name: "Demo Blast",
        email: { subject_line: "Hi", body_html: "<p>Hello</p>" },
        recipients: [{ recipient_id: "r1", email_address: "a@x.com" }],
      },
    },
    brands: { "b-demo": { brand_name: "Demo Co", user_id: "owner-1", is_demo: true } },
  });
  const origSendMail = sendMailImpl;
  sendMailImpl = async () => {
    throw new Error("SMTP down");
  };
  const pushes = [];
  try {
    await withStubs(
      {
        fakeQuery: fake.query,
        fakeGetClient: fake.getClient,
        onPush: async (userId, payload) => {
          pushes.push(payload);
          return { sent: 1, failed: 0 };
        },
      },
      async () => {
        await sendDueScheduledCampaigns();
      },
    );
  } finally {
    sendMailImpl = origSendMail;
  }
  assert.deepStrictEqual(fake.state.failedFlips, ["c1"], "the failed flip still happens");
  assert.strictEqual(pushes.length, 0, "demo brands never alert");
  // And the due query itself excludes demo brands at the data-gathering layer.
  assert.match(fake.state.dueQueries[0], /is_demo = false/);
});
