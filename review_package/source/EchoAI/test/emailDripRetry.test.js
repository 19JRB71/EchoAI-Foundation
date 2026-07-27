const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// retryDripRecipient: the one-tap recovery path for a drip recipient stuck at
// delivery_status='failed'. Mirrors socialReschedule.test.js and covers the
// invariants that matter:
//   - only the failed -> pending transition is allowed (409 otherwise)
//   - the flip resets send_attempts to 0 and sets next_send_at (atomically,
//     inside the same UPDATE) so the next hourly drip tick picks it up
//   - ownership is enforced via the brands join (foreign recipient -> 404)
//   - only drip campaigns qualify (one-time campaign recipient -> 400)
//   - malformed UUIDs are rejected before any query runs (400)
//   - the handler branches on the atomic UPDATE's row count, never a pre-read
// Tests never touch a real database: db.query is swapped for a fake.
// ---------------------------------------------------------------------------

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";

const db = require("../config/db");
const { retryDripRecipient } = require("../controllers/emailMarketingController");

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

function makeReq({
  campaignId = CAMPAIGN_ID,
  recipientId = RECIPIENT_ID,
  userId = "u1",
} = {}) {
  return { user: { userId }, params: { campaignId, recipientId } };
}

/**
 * Fake db for the retry handler. `row` describes the recipient as the UPDATE
 * sees it: { deliveryStatus, campaignType, ownedBy }. The UPDATE only "hits"
 * when the recipient is owned by the caller AND failed AND on a drip campaign;
 * the follow-up existence check answers the 404-vs-400-vs-409 branch.
 */
function makeDb(row) {
  const state = { updates: 0, checks: 0, updateParams: null };
  async function query(sql, params = []) {
    if (
      /UPDATE email_marketing_recipients r/i.test(sql) &&
      /SET delivery_status = 'pending'/i.test(sql)
    ) {
      state.updates += 1;
      state.updateParams = params;
      const [, , userId] = params;
      if (
        row &&
        row.ownedBy === userId &&
        row.deliveryStatus === "failed" &&
        row.campaignType === "drip"
      ) {
        return {
          rows: [
            {
              recipient_id: RECIPIENT_ID,
              email_address: "lead@example.com",
              delivery_status: "pending",
              current_step: 2,
              send_attempts: 0,
              next_send_at: "2026-07-06T00:00:00Z",
            },
          ],
        };
      }
      return { rows: [] };
    }
    if (
      /SELECT r\.delivery_status, c\.campaign_type/i.test(sql) &&
      /FROM email_marketing_recipients r/i.test(sql)
    ) {
      state.checks += 1;
      const [, , userId] = params;
      if (row && row.ownedBy === userId) {
        return {
          rows: [
            { delivery_status: row.deliveryStatus, campaign_type: row.campaignType },
          ],
        };
      }
      return { rows: [] };
    }
    throw new Error(`emailDripRetry.test: unexpected query: ${sql.slice(0, 80)}`);
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

test("retryDripRecipient: a failed recipient flips back to pending with reset attempts", async () => {
  const fake = makeDb({ deliveryStatus: "failed", campaignType: "drip", ownedBy: "u1" });
  await withDb(fake.query, async () => {
    const res = makeRes();
    await retryDripRecipient(makeReq(), res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.recipient.delivery_status, "pending");
    assert.strictEqual(res.body.recipient.send_attempts, 0);
    assert.ok(res.body.recipient.next_send_at, "next_send_at must be set");
    // Exactly one atomic UPDATE carrying (recipientId, campaignId, userId).
    assert.strictEqual(fake.state.updates, 1);
    assert.deepStrictEqual(fake.state.updateParams, [RECIPIENT_ID, CAMPAIGN_ID, "u1"]);
    // Success path never needs the existence check — row count decided it.
    assert.strictEqual(fake.state.checks, 0);
  });
});

test("retryDripRecipient: a recipient that isn't failed is rejected with 409", async () => {
  for (const deliveryStatus of ["pending", "sent", "unsubscribed"]) {
    const fake = makeDb({ deliveryStatus, campaignType: "drip", ownedBy: "u1" });
    await withDb(fake.query, async () => {
      const res = makeRes();
      await retryDripRecipient(makeReq(), res);
      assert.strictEqual(res.statusCode, 409, `status '${deliveryStatus}' must 409`);
      assert.match(res.body.error, new RegExp(deliveryStatus));
    });
  }
});

test("retryDripRecipient: someone else's recipient looks like it doesn't exist (404)", async () => {
  const fake = makeDb({ deliveryStatus: "failed", campaignType: "drip", ownedBy: "other" });
  await withDb(fake.query, async () => {
    const res = makeRes();
    await retryDripRecipient(makeReq({ userId: "u1" }), res);
    assert.strictEqual(res.statusCode, 404);
  });
});

test("retryDripRecipient: a one-time campaign recipient is rejected with 400", async () => {
  const fake = makeDb({ deliveryStatus: "failed", campaignType: "one_time", ownedBy: "u1" });
  await withDb(fake.query, async () => {
    const res = makeRes();
    await retryDripRecipient(makeReq(), res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.error, /drip/i);
  });
});

test("retryDripRecipient: malformed ids are 400s before any query runs", async () => {
  const fake = makeDb({ deliveryStatus: "failed", campaignType: "drip", ownedBy: "u1" });
  await withDb(fake.query, async () => {
    for (const bad of [
      { campaignId: "not-a-uuid" },
      { recipientId: "1; DROP TABLE" },
      { campaignId: "" },
      { recipientId: "" },
    ]) {
      const res = makeRes();
      await retryDripRecipient(makeReq(bad), res);
      assert.strictEqual(res.statusCode, 400, `${JSON.stringify(bad)} must 400`);
    }
    assert.strictEqual(fake.state.updates, 0, "validation failures must not hit the db");
  });
});
