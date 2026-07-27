const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// Owner alerts when a scheduled email or SMS blast flips to 'failed'.
// Mirrors socialFailureAlert.test.js and covers the invariants that matter:
//   - a drip recipient that exhausts its send attempts flips to 'failed' and
//     the campaign's owner gets ONE alert per campaign per run with the reason
//     and an Email-section deep link (below the limit: no flip, no alert)
//   - an SMS blast whose every message fails flips the campaign to 'failed'
//     and alerts the owner with an SMS-section deep link; when the guarded
//     final flip loses the race (health-monitor rescue got there first) no
//     alert fires from the request path
//   - the health monitor's stale-'sending' rescue alerts for each campaign it
//     marks failed
//   - demo brands NEVER alert (the failed flip still happens)
// Tests never touch a real database or Twilio/SMTP: db.query/db.getClient are
// swapped for fakes and the push controllers' exports are stubbed.
// ---------------------------------------------------------------------------

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";
process.env.PUBLIC_BASE_URL = "https://example.com";

// Stub the mail transport BEFORE the email controller lazily builds one.
const nodemailer = require("nodemailer");
let sendMailImpl = async () => {
  throw new Error("emailSmsFailureAlert.test: unexpected sendMail call");
};
nodemailer.createTransport = () => ({
  sendMail: (message) => sendMailImpl(message),
});

const db = require("../config/db");
const { encrypt } = require("../utils/encryption");
const pushController = require("../controllers/pushController");
const mobilePushController = require("../controllers/mobilePushController");
const { sendDueDripEmails } = require("../controllers/emailMarketingController");
const { sendCampaign } = require("../controllers/smsMarketingController");
const { applyAutoFix } = require("../controllers/healthMonitorController");

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

// --- Drip emails: attempt limit -> failed flip -> one alert per campaign ------

/**
 * Fake db for sendDueDripEmails where every recipient's SMTP send fails.
 * `recipients` rows carry send_attempts so tests control distance from the
 * limit. Brands lookups serve the alert helper.
 *
 * The fake is STATEFUL across runs so tests can call sendDueDripEmails twice
 * to model consecutive hourly ticks: attempt bumps persist, recipients that
 * flip to 'failed' drop out of the due/claim queries, and the per-campaign
 * failure-alert cooldown claim (UPDATE email_marketing_campaigns SET
 * last_failure_alert_at ...) mirrors production — it hits a row only if the
 * campaign has never claimed the cooldown, or the test aged it out via
 * `expireCooldown(campaignId)`.
 */
function makeDripDb({ recipients, brands }) {
  const state = {
    failedFlips: [],
    attemptBumps: [],
    brandLookups: [],
    cooldownClaims: [], // every claim attempt: { campaignId, hit }
  };
  const failed = new Set();
  const cooldownClaimed = new Set(); // campaigns holding an unexpired cooldown

  async function clientQuery(sql, params = []) {
    const bare = sql.trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(bare)) return { rows: [] };
    if (/FROM email_marketing_recipients r/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      const rec = recipients[params[0]];
      if (!rec || failed.has(rec.recipient_id)) return { rows: [] };
      return { rows: [{ ...rec }] };
    }
    if (/FROM email_opt_outs/i.test(sql)) return { rows: [] };
    if (/FROM email_marketing_emails/i.test(sql)) {
      return {
        rows: [
          { sequence_position: 1, subject_line: "Day 1", body_html: "<p>Hi</p>", send_delay_days: 0 },
        ],
      };
    }
    if (
      /UPDATE email_marketing_recipients/i.test(sql) &&
      /delivery_status = 'failed'/i.test(sql)
    ) {
      state.failedFlips.push(params[1]);
      failed.add(params[1]);
      return { rows: [{ recipient_id: params[1] }] };
    }
    if (/UPDATE email_marketing_recipients/i.test(sql) && /SET send_attempts =/i.test(sql)) {
      state.attemptBumps.push({ recipientId: params[1], attempts: params[0] });
      const rec = recipients[params[1]];
      if (rec) rec.send_attempts = params[0];
      return { rows: [] };
    }
    throw new Error(`makeDripDb: unexpected client query: ${sql.slice(0, 80)}`);
  }

  async function query(sql, params = []) {
    if (
      /FROM email_marketing_recipients r/i.test(sql) &&
      /JOIN email_marketing_campaigns c/i.test(sql)
    ) {
      return {
        rows: Object.keys(recipients)
          .filter((id) => !failed.has(id))
          .map((recipient_id) => ({ recipient_id })),
      };
    }
    if (
      /UPDATE email_marketing_campaigns/i.test(sql) &&
      /last_failure_alert_at/i.test(sql)
    ) {
      const campaignId = params[0];
      const hit = !cooldownClaimed.has(campaignId);
      state.cooldownClaims.push({ campaignId, hit });
      if (hit) cooldownClaimed.add(campaignId);
      return { rows: hit ? [{ campaign_id: campaignId }] : [] };
    }
    if (/SELECT brand_name, user_id, is_demo FROM brands/i.test(sql)) {
      state.brandLookups.push(params[0]);
      const b = brands[params[0]];
      return { rows: b ? [b] : [] };
    }
    throw new Error(`makeDripDb: unexpected query: ${sql.slice(0, 80)}`);
  }

  async function getClient() {
    return { query: clientQuery, release: () => {} };
  }

  /** Ages the campaign's cooldown past the window (as if 24h elapsed). */
  function expireCooldown(campaignId) {
    cooldownClaimed.delete(campaignId);
  }

  return { query, getClient, state, expireCooldown };
}

test("drip recipient at the attempt limit flips to failed and alerts the owner once per campaign", async () => {
  // Two recipients of the SAME campaign both exhaust their attempts this run:
  // exactly one alert must go out (per-campaign aggregation), naming the
  // campaign, the count, and the SMTP reason, deep-linked to the Email section.
  const fake = makeDripDb({
    recipients: {
      r1: {
        recipient_id: "r1", campaign_id: "c1", email_address: "a@x.com",
        current_step: 1, send_attempts: 2, brand_id: "b1", campaign_name: "Welcome Drip",
      },
      r2: {
        recipient_id: "r2", campaign_id: "c1", email_address: "b@x.com",
        current_step: 1, send_attempts: 2, brand_id: "b1", campaign_name: "Welcome Drip",
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
        const summary = await sendDueDripEmails();
        assert.strictEqual(summary.sent, 0);
        assert.strictEqual(summary.failed, 1, "one campaign had failures");
      },
    );
  } finally {
    sendMailImpl = origSendMail;
  }

  assert.deepStrictEqual(fake.state.failedFlips, ["r1", "r2"], "both recipients flipped to failed");
  assert.strictEqual(pushes.length, 1, "one alert per campaign, not per recipient");
  assert.strictEqual(pushes[0].userId, "owner-1");
  const p = pushes[0].payload;
  assert.match(p.title, /email campaign send failed/i);
  assert.match(p.body, /2 emails/i, "body carries the failed count");
  assert.match(p.body, /Welcome Drip/, "body names the campaign");
  assert.match(p.body, /Acme/, "body names the brand");
  assert.match(p.body, /SMTP connection refused/i, "body carries the failure reason");
  assert.strictEqual(p.url, "/dashboard?section=email", "deep-links to the Email section");
  assert.strictEqual(p.tag, "email-campaign-failed-c1", "per-campaign tag");
  assert.strictEqual(mobilePushes.length, 1, "FCM mirror also sent");
});

test("drip recipient below the attempt limit stays pending: no flip, no alert", async () => {
  const fake = makeDripDb({
    recipients: {
      r1: {
        recipient_id: "r1", campaign_id: "c1", email_address: "a@x.com",
        current_step: 1, send_attempts: 0, brand_id: "b1", campaign_name: "Welcome Drip",
      },
    },
    brands: { b1: { brand_name: "Acme", user_id: "owner-1", is_demo: false } },
  });
  const origSendMail = sendMailImpl;
  sendMailImpl = async () => {
    throw new Error("transient SMTP hiccup");
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
        const summary = await sendDueDripEmails();
        assert.strictEqual(summary.failed, 0);
      },
    );
  } finally {
    sendMailImpl = origSendMail;
  }
  assert.deepStrictEqual(fake.state.failedFlips, [], "no failed flip below the limit");
  assert.deepStrictEqual(fake.state.attemptBumps, [{ recipientId: "r1", attempts: 1 }]);
  assert.strictEqual(pushes.length, 0, "no alert without a real failed transition");
});

test("drip failure on a demo brand flips but never alerts", async () => {
  const fake = makeDripDb({
    recipients: {
      r1: {
        recipient_id: "r1", campaign_id: "c1", email_address: "a@x.com",
        current_step: 1, send_attempts: 2, brand_id: "b-demo", campaign_name: "Demo Drip",
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
        await sendDueDripEmails();
      },
    );
  } finally {
    sendMailImpl = origSendMail;
  }
  assert.deepStrictEqual(fake.state.failedFlips, ["r1"], "the failed flip still happens");
  assert.deepStrictEqual(fake.state.brandLookups, ["b-demo"], "the brand was considered");
  assert.strictEqual(pushes.length, 0, "demo brands never alert");
});

// --- Cross-run cooldown: a multi-hour outage alerts once, not once per run ----

test("a multi-hour outage where recipients fail in different runs alerts the campaign once, not once per run", async () => {
  // Simulates an SMTP outage spanning two hourly ticks: r1 exhausts its
  // attempts in run 1, r2 (one attempt behind) exhausts in run 2. Without the
  // per-campaign cooldown each run would fire its own alert — and FCM mobile
  // pushes don't collapse by tag, so the owner's phone would buzz hourly.
  // Run 2's flip must still happen (data stays honest); only the repeat
  // notification is suppressed.
  const fake = makeDripDb({
    recipients: {
      r1: {
        recipient_id: "r1", campaign_id: "c1", email_address: "a@x.com",
        current_step: 1, send_attempts: 2, brand_id: "b1", campaign_name: "Welcome Drip",
      },
      r2: {
        recipient_id: "r2", campaign_id: "c1", email_address: "b@x.com",
        current_step: 1, send_attempts: 1, brand_id: "b1", campaign_name: "Welcome Drip",
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
        // Run 1 (hour N): r1 hits the limit and flips; r2 just bumps to 2.
        const run1 = await sendDueDripEmails();
        assert.strictEqual(run1.failed, 1, "run 1: one campaign had failures");
        assert.strictEqual(pushes.length, 1, "run 1 alerts the owner");

        // Run 2 (hour N+1): r2 now hits the limit and flips — same campaign,
        // same outage, still inside the cooldown window.
        const run2 = await sendDueDripEmails();
        assert.strictEqual(run2.failed, 1, "run 2: the campaign had new failures");
      },
    );
  } finally {
    sendMailImpl = origSendMail;
  }

  assert.deepStrictEqual(
    fake.state.failedFlips,
    ["r1", "r2"],
    "both recipients flipped to failed across the two runs",
  );
  assert.deepStrictEqual(
    fake.state.cooldownClaims,
    [
      { campaignId: "c1", hit: true },
      { campaignId: "c1", hit: false },
    ],
    "run 2 attempted the claim but lost to the unexpired cooldown",
  );
  assert.strictEqual(pushes.length, 1, "one web-push alert across both runs, not one per run");
  assert.strictEqual(mobilePushes.length, 1, "one FCM alert across both runs (FCM can't collapse by tag)");
  assert.strictEqual(pushes[0].payload.tag, "email-campaign-failed-c1");
});

test("a campaign whose cooldown has expired alerts again on new failures", async () => {
  // Two waves of failures more than the cooldown window apart must each
  // alert: the cooldown suppresses hourly repeats, not a genuinely new
  // outage the next day.
  const fake = makeDripDb({
    recipients: {
      r1: {
        recipient_id: "r1", campaign_id: "c1", email_address: "a@x.com",
        current_step: 1, send_attempts: 2, brand_id: "b1", campaign_name: "Welcome Drip",
      },
      r2: {
        recipient_id: "r2", campaign_id: "c1", email_address: "b@x.com",
        current_step: 1, send_attempts: 1, brand_id: "b1", campaign_name: "Welcome Drip",
      },
    },
    brands: { b1: { brand_name: "Acme", user_id: "owner-1", is_demo: false } },
  });
  const origSendMail = sendMailImpl;
  sendMailImpl = async () => {
    throw new Error("SMTP connection refused");
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
        await sendDueDripEmails(); // r1 flips, alert #1, cooldown claimed
        fake.expireCooldown("c1"); // > 24h pass
        await sendDueDripEmails(); // r2 flips, cooldown expired -> alert #2
      },
    );
  } finally {
    sendMailImpl = origSendMail;
  }

  assert.deepStrictEqual(fake.state.failedFlips, ["r1", "r2"]);
  assert.strictEqual(pushes.length, 2, "an expired cooldown re-alerts on new failures");
  assert.deepStrictEqual(
    fake.state.cooldownClaims.map((c) => c.hit),
    [true, true],
    "both claims hit once the cooldown aged out",
  );
});

// --- SMS blast: total failure -> campaign 'failed' -> owner alert -------------

/**
 * Fake db for smsMarketingController.sendCampaign. All queued messages have no
 * phone number, so every send fails without touching Twilio. `finalFlipHits`
 * controls whether the guarded 'sending' -> final status UPDATE hits a row.
 */
function makeSmsDb({ finalFlipHits = true, brands }) {
  const state = { finalStatuses: [], brandLookups: [] };
  const campaign = {
    campaign_id: "c1",
    brand_id: "b1",
    campaign_name: "Flash Sale",
    status: "draft",
  };

  async function query(sql, params = []) {
    if (/FROM sms_campaigns c/i.test(sql) && /JOIN brands b/i.test(sql)) {
      return { rows: [{ ...campaign }] };
    }
    if (/FROM twilio_config/i.test(sql)) {
      return {
        rows: [
          {
            account_sid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            auth_token_encrypted: encrypt("token"),
            phone_number: "+15550001111",
          },
        ],
      };
    }
    if (/UPDATE sms_campaigns SET status = 'sending'/i.test(sql)) {
      return { rows: [{ campaign_id: "c1" }] };
    }
    if (/FROM sms_messages m/i.test(sql)) {
      return { rows: [{ message_id: "m1", message_body: "Hi", phone: null }] };
    }
    if (/UPDATE sms_messages\s+SET delivery_status = 'failed'/i.test(sql)) {
      return { rows: [] };
    }
    if (/UPDATE sms_campaigns/i.test(sql) && /status = 'sending'/i.test(sql)) {
      state.finalStatuses.push(params[1]);
      return {
        rows: finalFlipHits ? [{ ...campaign, status: params[1] }] : [],
      };
    }
    if (/SELECT \* FROM sms_campaigns/i.test(sql)) {
      return { rows: [{ ...campaign, status: "failed" }] };
    }
    if (/SELECT brand_name, user_id, is_demo FROM brands/i.test(sql)) {
      state.brandLookups.push(params[0]);
      const b = brands[params[0]];
      return { rows: b ? [b] : [] };
    }
    throw new Error(`makeSmsDb: unexpected query: ${sql.slice(0, 80)}`);
  }

  return { query, state };
}

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

test("an SMS blast where every message fails flips the campaign to failed and alerts the owner", async () => {
  const fake = makeSmsDb({
    brands: { b1: { brand_name: "Acme", user_id: "owner-1", is_demo: false } },
  });
  const pushes = [];
  const res = makeRes();
  await withStubs(
    {
      fakeQuery: fake.query,
      onPush: async (userId, payload) => {
        pushes.push({ userId, payload });
        return { sent: 1, failed: 0 };
      },
    },
    async () => {
      await sendCampaign({ user: { userId: "u1" }, params: { campaignId: "c1" } }, res);
    },
  );

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(fake.state.finalStatuses, ["failed"]);
  assert.strictEqual(pushes.length, 1, "the owner was alerted");
  const p = pushes[0].payload;
  assert.match(p.title, /SMS blast failed/i);
  assert.match(p.body, /Flash Sale/, "body names the campaign");
  assert.match(p.body, /Acme/, "body names the brand");
  assert.match(p.body, /no phone number/i, "body carries the failure reason");
  assert.strictEqual(p.url, "/dashboard?section=sms", "deep-links to the SMS section");
  assert.strictEqual(p.tag, "sms-campaign-failed-c1", "per-campaign tag");
});

test("no SMS alert when the guarded final flip lost the race (rescue got there first)", async () => {
  const fake = makeSmsDb({
    finalFlipHits: false,
    brands: { b1: { brand_name: "Acme", user_id: "owner-1", is_demo: false } },
  });
  const pushes = [];
  const res = makeRes();
  await withStubs(
    {
      fakeQuery: fake.query,
      onPush: async (userId, payload) => {
        pushes.push(payload);
        return { sent: 1, failed: 0 };
      },
    },
    async () => {
      await sendCampaign({ user: { userId: "u1" }, params: { campaignId: "c1" } }, res);
    },
  );
  assert.strictEqual(pushes.length, 0, "no alert without a real transition");
  assert.ok(res.body.campaign, "the response still returns the campaign row");
});

// --- Health monitor rescue: stale 'sending' -> failed -> owner alert ----------

test("the stale-sending rescue alerts the owner for each campaign it marks failed", async () => {
  const pushes = [];
  const brandLookups = [];
  await withStubs(
    {
      fakeQuery: async (sql, params = []) => {
        if (/UPDATE sms_campaigns/i.test(sql) && /SET status = 'failed'/i.test(sql)) {
          return {
            rows: [
              { campaign_id: "c1", campaign_name: "Stuck Blast" },
              { campaign_id: "c2", campaign_name: "Also Stuck" },
            ],
          };
        }
        if (/SELECT brand_name, user_id, is_demo FROM brands/i.test(sql)) {
          brandLookups.push(params[0]);
          return { rows: [{ brand_name: "Acme", user_id: "owner-1", is_demo: false }] };
        }
        throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
      },
      onPush: async (userId, payload) => {
        pushes.push({ userId, payload });
        return { sent: 1, failed: 0 };
      },
    },
    async () => {
      const fixed = await applyAutoFix(
        { type: "stale_sending_sms_campaign" },
        { brand_id: "b1", brand_name: "Acme", user_id: "owner-1" },
      );
      assert.strictEqual(fixed, true);
    },
  );

  assert.strictEqual(pushes.length, 2, "one alert per rescued campaign");
  assert.deepStrictEqual(
    pushes.map((x) => x.payload.tag).sort(),
    ["sms-campaign-failed-c1", "sms-campaign-failed-c2"],
  );
  assert.match(pushes[0].payload.body, /interrupted mid-blast/i);
  assert.strictEqual(pushes[0].payload.url, "/dashboard?section=sms");
});
