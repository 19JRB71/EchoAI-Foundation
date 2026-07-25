const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// retryFailedDripRecipients: the one-tap bulk recovery path that flips every
// failed recipient of a drip campaign back to pending in a single atomic
// UPDATE. Mirrors emailDripRetry.test.js and covers the invariants:
//   - only failed recipients flip (guarded in the UPDATE WHERE); returns count
//   - ownership is enforced via the brands join (foreign campaign -> 404)
//   - only drip campaigns qualify (one-time campaign -> 400)
//   - an owned drip campaign with no failed recipients -> 200 { retried: 0 }
//   - malformed campaign UUIDs are rejected before any query runs (400)
//   - the handler branches on the atomic UPDATE's row count, never a pre-read
// Tests never touch a real database: db.query is swapped for a fake.
// ---------------------------------------------------------------------------

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";

const db = require("../config/db");
const {
  retryFailedDripRecipients,
} = require("../controllers/emailMarketingController");

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

function makeReq({ campaignId = CAMPAIGN_ID, userId = "u1" } = {}) {
  return { user: { userId }, params: { campaignId } };
}

/**
 * Fake db for the bulk retry handler. `row` describes the campaign as the
 * UPDATE sees it: { campaignType, ownedBy, failed }. The UPDATE only "hits"
 * (and returns `failed` rows) when the campaign is owned by the caller AND is
 * a drip AND has that many failed recipients; the follow-up existence check
 * answers the 404-vs-400-vs-200 branch when nothing was updated.
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
      const [, userId] = params;
      if (
        row &&
        row.ownedBy === userId &&
        row.campaignType === "drip" &&
        row.failed > 0
      ) {
        return {
          rows: Array.from({ length: row.failed }, (_, i) => ({
            recipient_id: `r${i}`,
          })),
        };
      }
      return { rows: [] };
    }
    if (
      /SELECT c\.campaign_type/i.test(sql) &&
      /FROM email_marketing_campaigns c/i.test(sql)
    ) {
      state.checks += 1;
      const [, userId] = params;
      if (row && row.ownedBy === userId) {
        return { rows: [{ campaign_type: row.campaignType }] };
      }
      return { rows: [] };
    }
    throw new Error(`emailDripRetryAll.test: unexpected query: ${sql.slice(0, 80)}`);
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

test("retryFailedDripRecipients: all failed recipients flip back to pending, count returned", async () => {
  const fake = makeDb({ campaignType: "drip", ownedBy: "u1", failed: 3 });
  await withDb(fake.query, async () => {
    const res = makeRes();
    await retryFailedDripRecipients(makeReq(), res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.retried, 3);
    // Exactly one atomic UPDATE carrying (campaignId, userId).
    assert.strictEqual(fake.state.updates, 1);
    assert.deepStrictEqual(fake.state.updateParams, [CAMPAIGN_ID, "u1"]);
    // Success path never needs the existence check — row count decided it.
    assert.strictEqual(fake.state.checks, 0);
  });
});

test("retryFailedDripRecipients: an owned drip campaign with no failed recipients -> 200 { retried: 0 }", async () => {
  const fake = makeDb({ campaignType: "drip", ownedBy: "u1", failed: 0 });
  await withDb(fake.query, async () => {
    const res = makeRes();
    await retryFailedDripRecipients(makeReq(), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.retried, 0);
    // Nothing updated, so the disambiguation read runs.
    assert.strictEqual(fake.state.updates, 1);
    assert.strictEqual(fake.state.checks, 1);
  });
});

test("retryFailedDripRecipients: someone else's campaign looks like it doesn't exist (404)", async () => {
  const fake = makeDb({ campaignType: "drip", ownedBy: "other", failed: 2 });
  await withDb(fake.query, async () => {
    const res = makeRes();
    await retryFailedDripRecipients(makeReq({ userId: "u1" }), res);
    assert.strictEqual(res.statusCode, 404);
  });
});

test("retryFailedDripRecipients: a one-time campaign is rejected with 400", async () => {
  const fake = makeDb({ campaignType: "one_time", ownedBy: "u1", failed: 2 });
  await withDb(fake.query, async () => {
    const res = makeRes();
    await retryFailedDripRecipients(makeReq(), res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.error, /drip/i);
  });
});

test("retryFailedDripRecipients: malformed campaign ids are 400s before any query runs", async () => {
  const fake = makeDb({ campaignType: "drip", ownedBy: "u1", failed: 2 });
  await withDb(fake.query, async () => {
    for (const bad of [
      { campaignId: "not-a-uuid" },
      { campaignId: "1; DROP TABLE" },
      { campaignId: "" },
    ]) {
      const res = makeRes();
      await retryFailedDripRecipients(makeReq(bad), res);
      assert.strictEqual(res.statusCode, 400, `${JSON.stringify(bad)} must 400`);
    }
    assert.strictEqual(fake.state.updates, 0, "validation failures must not hit the db");
  });
});
