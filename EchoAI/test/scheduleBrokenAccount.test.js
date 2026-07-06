const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// schedulePost: scheduling to a broken social account is refused up front.
// Covers the invariants that matter:
//   - a platform whose stored connection_status is 'error' -> 409 with a
//     clear "reconnect first" message (and connectionError flag for the UI)
//   - a 'connected' account (or no stored account at all) schedules normally
//   - after the owner reconnects (status back to 'connected') scheduling
//     works again with no extra steps
// Tests never touch a real database: db.query is swapped for a fake.
// ---------------------------------------------------------------------------

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";

const db = require("../config/db");
const { schedulePost } = require("../controllers/socialController");

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

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
  brandId = "b1",
  platform = "facebook",
  postContent = "hello world",
  scheduledTime = FUTURE,
  userId = "u1",
} = {}) {
  return {
    user: { userId },
    body: { brandId, platform, postContent, scheduledTime },
  };
}

/**
 * Fake db for the schedule handler. `accountStatus` is the stored
 * connection_status for the brand+platform ('error'/'connected') or null for
 * "no account row at all".
 */
function makeDb({ accountStatus = "connected" } = {}) {
  const state = { inserts: 0, accountChecks: 0 };
  async function query(sql, params = []) {
    if (/FROM brands/i.test(sql)) {
      return { rows: [{ brand_id: params[0], brand_name: "Test Brand" }] };
    }
    if (/SELECT connection_status FROM social_accounts/i.test(sql)) {
      state.accountChecks += 1;
      if (accountStatus === null) return { rows: [] };
      return { rows: [{ connection_status: accountStatus }] };
    }
    if (/INSERT INTO social_posts/i.test(sql)) {
      state.inserts += 1;
      return {
        rows: [
          {
            post_id: "p1",
            brand_id: params[0],
            platform: params[1],
            post_content: params[2],
            scheduled_time: params[3],
            status: "scheduled",
            created_at: "2026-07-01T00:00:00Z",
          },
        ],
      };
    }
    throw new Error(
      `scheduleBrokenAccount.test: unexpected query: ${sql.slice(0, 80)}`
    );
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

test("schedulePost: a platform in 'error' status is rejected with 409 and a reconnect message", async () => {
  const fake = makeDb({ accountStatus: "error" });
  await withDb(fake.query, async () => {
    const res = makeRes();
    await schedulePost(makeReq(), res);

    assert.strictEqual(res.statusCode, 409);
    assert.match(res.body.error, /reconnect/i);
    assert.match(res.body.error, /Facebook/);
    assert.strictEqual(res.body.connectionError, true);
    assert.strictEqual(res.body.platform, "facebook");
    // The post must never be queued.
    assert.strictEqual(fake.state.inserts, 0);
  });
});

test("schedulePost: a connected account schedules normally", async () => {
  const fake = makeDb({ accountStatus: "connected" });
  await withDb(fake.query, async () => {
    const res = makeRes();
    await schedulePost(makeReq(), res);

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.post.status, "scheduled");
    assert.strictEqual(fake.state.accountChecks, 1);
    assert.strictEqual(fake.state.inserts, 1);
  });
});

test("schedulePost: no stored account row does not block scheduling", async () => {
  const fake = makeDb({ accountStatus: null });
  await withDb(fake.query, async () => {
    const res = makeRes();
    await schedulePost(makeReq(), res);

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(fake.state.inserts, 1);
  });
});

test("schedulePost: reconnecting (status back to 'connected') unblocks scheduling with no extra steps", async () => {
  // Same request, only the stored status changed — mirrors the reconnect flow.
  const broken = makeDb({ accountStatus: "error" });
  await withDb(broken.query, async () => {
    const res = makeRes();
    await schedulePost(makeReq(), res);
    assert.strictEqual(res.statusCode, 409);
  });

  const repaired = makeDb({ accountStatus: "connected" });
  await withDb(repaired.query, async () => {
    const res = makeRes();
    await schedulePost(makeReq(), res);
    assert.strictEqual(res.statusCode, 201);
  });
});
