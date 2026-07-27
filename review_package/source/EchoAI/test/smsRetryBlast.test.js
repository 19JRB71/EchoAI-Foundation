const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// retryCampaign: the one-tap recovery path for a failed SMS blast. Covers the
// invariants that matter:
//   - only a 'failed' campaign can be retried (atomic row-count-guarded claim
//     to 'sending'; anything else -> 409, and the re-queue never runs)
//   - the claim happens BEFORE the re-queue, so no concurrent send/retry can
//     pick up the re-queued rows
//   - only this campaign's failed outbound messages are re-queued —
//     already-sent messages stay 'sent' (no double-texting)
//   - ownership is enforced via the brands join (foreign campaign -> 404)
//   - the final flip recomputes delivered_count from the messages table so a
//     retry reflects the campaign's TOTAL sent messages, not just this run's
// Tests never touch a real database or Twilio: db.query is swapped for a fake
// and config/twilio's buildClient is stubbed before the controller loads.
// ---------------------------------------------------------------------------

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";

// Stub the Twilio client factory BEFORE the controller destructures it.
const twilioCfg = require("../config/twilio");
let createImpl = async () => {
  throw new Error("smsRetryBlast.test: unexpected Twilio send");
};
twilioCfg.buildClient = () => ({ messages: { create: (opts) => createImpl(opts) } });

const db = require("../config/db");
const { encrypt } = require("../utils/encryption");
const { retryCampaign } = require("../controllers/smsMarketingController");

const CAMPAIGN_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

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

function makeReq({ userId = "u1", campaignId = CAMPAIGN_ID } = {}) {
  return { user: { userId }, params: { campaignId } };
}

/**
 * Fake db for the retry handler. `campaign` describes the row as the queries
 * see it: { status, ownedBy }. The claim UPDATE only "hits" when the campaign
 * is currently 'failed'; the re-queue and send loop are recorded so tests can
 * assert ordering and scoping.
 */
function makeDb(campaign, { queuedAfterRequeue = [] } = {}) {
  const state = {
    ops: [], // ordered log: 'claim', 'requeue', 'fetch-queued', 'mark-sent', 'final-flip'
    requeueSql: null,
    finalFlipSql: null,
    finalFlipParams: null,
  };
  async function query(sql, params = []) {
    if (/FROM sms_campaigns c/i.test(sql) && /JOIN brands b/i.test(sql)) {
      const [, userId] = params;
      if (campaign && campaign.ownedBy === userId) {
        return {
          rows: [
            {
              campaign_id: CAMPAIGN_ID,
              brand_id: "b1",
              campaign_name: "Flash Sale",
              status: campaign.status,
            },
          ],
        };
      }
      return { rows: [] };
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
    if (
      /UPDATE sms_campaigns SET status = 'sending'/i.test(sql) &&
      /status = 'failed'/i.test(sql)
    ) {
      state.ops.push("claim");
      if (campaign && campaign.status === "failed") {
        return { rows: [{ campaign_id: CAMPAIGN_ID }] };
      }
      return { rows: [] };
    }
    if (
      /UPDATE sms_messages/i.test(sql) &&
      /SET delivery_status = 'queued'/i.test(sql)
    ) {
      state.ops.push("requeue");
      state.requeueSql = sql;
      return { rows: [] };
    }
    if (/SELECT m\.message_id/i.test(sql) && /delivery_status = 'queued'/i.test(sql)) {
      state.ops.push("fetch-queued");
      return { rows: queuedAfterRequeue.map((m) => ({ ...m })) };
    }
    if (/FROM sms_opt_outs/i.test(sql)) return { rows: [] };
    if (/UPDATE sms_messages/i.test(sql) && /delivery_status = 'sent'/i.test(sql)) {
      state.ops.push("mark-sent");
      return { rows: [] };
    }
    if (/UPDATE sms_campaigns/i.test(sql) && /SET status = \$2/i.test(sql)) {
      state.ops.push("final-flip");
      state.finalFlipSql = sql;
      state.finalFlipParams = params;
      return {
        rows: [
          {
            campaign_id: CAMPAIGN_ID,
            status: params[1],
            delivered_count: 3, // whatever the COUNT(*) subquery yields
          },
        ],
      };
    }
    throw new Error(`smsRetryBlast.test: unexpected query: ${sql.slice(0, 80)}`);
  }
  return { query, state };
}

async function withDb(fakeQuery, fn) {
  const orig = db.query;
  db.query = fakeQuery;
  try {
    return await fn();
  } finally {
    db.query = orig;
  }
}

test("retryCampaign: a failed blast is claimed, re-queued, resent, and flipped to sent", async () => {
  const fake = makeDb(
    { status: "failed", ownedBy: "u1" },
    { queuedAfterRequeue: [{ message_id: "m1", message_body: "Hi", phone: "+15557778888" }] }
  );
  const sends = [];
  createImpl = async (opts) => {
    sends.push(opts);
    return { sid: "SM123" };
  };
  await withDb(fake.query, async () => {
    const res = makeRes();
    await retryCampaign(makeReq(), res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.delivered, 1);
    assert.strictEqual(res.body.failed, 0);
    assert.strictEqual(res.body.campaign.status, "sent");
    assert.strictEqual(sends.length, 1);
    assert.strictEqual(sends[0].to, "+15557778888");

    // The atomic claim MUST precede the re-queue so no concurrent sender can
    // pick up the re-queued rows.
    assert.deepStrictEqual(fake.state.ops, [
      "claim",
      "requeue",
      "fetch-queued",
      "mark-sent",
      "final-flip",
    ]);
    // Only failed outbound messages are re-queued — sent rows stay sent.
    assert.match(fake.state.requeueSql, /delivery_status = 'failed'/);
    assert.match(fake.state.requeueSql, /direction = 'outbound'/);
    // delivered_count is recomputed from the messages table (total sent),
    // never overwritten with just this run's count.
    assert.match(fake.state.finalFlipSql, /SELECT COUNT\(\*\) FROM sms_messages/i);
    assert.strictEqual(fake.state.finalFlipParams[1], "sent");
  });
});

test("retryCampaign: a campaign that isn't failed is rejected with 409 and never re-queued", async () => {
  for (const status of ["draft", "sending", "sent"]) {
    const fake = makeDb({ status, ownedBy: "u1" });
    await withDb(fake.query, async () => {
      const res = makeRes();
      await retryCampaign(makeReq(), res);
      assert.strictEqual(res.statusCode, 409, `status '${status}' must 409`);
      assert.match(res.body.error, new RegExp(status));
      assert.ok(
        !fake.state.ops.includes("requeue"),
        `status '${status}' must never reach the re-queue`
      );
    });
  }
});

test("retryCampaign: someone else's campaign looks like it doesn't exist (404)", async () => {
  const fake = makeDb({ status: "failed", ownedBy: "other-user" });
  await withDb(fake.query, async () => {
    const res = makeRes();
    await retryCampaign(makeReq({ userId: "u1" }), res);
    assert.strictEqual(res.statusCode, 404);
    assert.deepStrictEqual(fake.state.ops, [], "foreign campaign must not be claimed");
  });
});
