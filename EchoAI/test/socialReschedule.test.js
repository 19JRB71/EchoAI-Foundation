const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// reschedulePost: the one-click recovery path for failed social posts.
// Covers the invariants that matter:
//   - only the failed -> scheduled transition is allowed (409 otherwise)
//   - ownership is enforced via the brands join (foreign post -> 404)
//   - the new time must be a valid FUTURE datetime (400 otherwise)
//   - the stored failure reason (engagement_metrics) is cleared atomically
//   - the handler branches on the atomic UPDATE's row count, never a pre-read
// Tests never touch a real database: db.query is swapped for a fake.
// ---------------------------------------------------------------------------

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";

const db = require("../config/db");
const { reschedulePost } = require("../controllers/socialController");

const POST_ID = "11111111-2222-3333-4444-555555555555";
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

function makeReq({ postId = POST_ID, scheduledTime = FUTURE, userId = "u1" } = {}) {
  return { user: { userId }, params: { postId }, body: { scheduledTime } };
}

/**
 * Fake db for the reschedule handler. `row` describes the post as the update
 * sees it: { status, ownedBy }. The UPDATE only "hits" when the post is owned
 * by the caller AND currently failed; the follow-up existence check answers
 * the 404-vs-409 branch.
 */
function makeDb(row) {
  const state = { updates: 0, checks: 0, updateParams: null };
  async function query(sql, params = []) {
    if (/UPDATE social_posts/i.test(sql) && /SET status = 'scheduled'/i.test(sql)) {
      state.updates += 1;
      state.updateParams = params;
      const [, , userId] = params;
      if (row && row.ownedBy === userId && row.status === "failed") {
        return {
          rows: [
            {
              post_id: POST_ID,
              brand_id: "b1",
              platform: "facebook",
              post_content: "hello",
              scheduled_time: params[0],
              published_time: null,
              status: "scheduled",
              engagement_metrics: null,
              external_post_id: null,
              created_at: "2026-07-01T00:00:00Z",
            },
          ],
        };
      }
      return { rows: [] };
    }
    if (/SELECT sp\.status FROM social_posts/i.test(sql)) {
      state.checks += 1;
      const [, userId] = params;
      if (row && row.ownedBy === userId) return { rows: [{ status: row.status }] };
      return { rows: [] };
    }
    throw new Error(`socialReschedule.test: unexpected query: ${sql.slice(0, 80)}`);
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

test("reschedulePost: failed post flips back to scheduled with the new time and a cleared error", async () => {
  const fake = makeDb({ status: "failed", ownedBy: "u1" });
  await withDb(fake.query, async () => {
    const res = makeRes();
    await reschedulePost(makeReq(), res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.post.status, "scheduled");
    assert.strictEqual(res.body.post.engagement_metrics, null);
    // The UPDATE itself carries the new time; no separate clear query.
    assert.strictEqual(fake.state.updates, 1);
    assert.strictEqual(fake.state.updateParams[0], new Date(FUTURE).toISOString());
    // Success path never needs the existence check — row count decided it.
    assert.strictEqual(fake.state.checks, 0);
  });
});

test("reschedulePost: a post that isn't failed is rejected with 409 (no silent re-queue)", async () => {
  for (const status of ["published", "publishing", "scheduled"]) {
    const fake = makeDb({ status, ownedBy: "u1" });
    await withDb(fake.query, async () => {
      const res = makeRes();
      await reschedulePost(makeReq(), res);
      assert.strictEqual(res.statusCode, 409, `status '${status}' must 409`);
      assert.match(res.body.error, new RegExp(status));
    });
  }
});

test("reschedulePost: someone else's post looks like it doesn't exist (404)", async () => {
  const fake = makeDb({ status: "failed", ownedBy: "other-user" });
  await withDb(fake.query, async () => {
    const res = makeRes();
    await reschedulePost(makeReq({ userId: "u1" }), res);
    assert.strictEqual(res.statusCode, 404);
  });
});

test("reschedulePost: past, invalid, and missing times are 400s before any query runs", async () => {
  const fake = makeDb({ status: "failed", ownedBy: "u1" });
  await withDb(fake.query, async () => {
    for (const scheduledTime of [
      new Date(Date.now() - 60 * 1000).toISOString(), // past
      "not-a-date",
      null, // missing (undefined would be replaced by the helper's default)
    ]) {
      const res = makeRes();
      await reschedulePost(makeReq({ scheduledTime }), res);
      assert.strictEqual(res.statusCode, 400, `time ${scheduledTime} must 400`);
    }
    assert.strictEqual(fake.state.updates, 0, "validation failures must not hit the db");
  });
});

test("reschedulePost: a malformed post id is a clean 400, not a Postgres cast error", async () => {
  const fake = makeDb({ status: "failed", ownedBy: "u1" });
  await withDb(fake.query, async () => {
    const res = makeRes();
    await reschedulePost(makeReq({ postId: "1; DROP TABLE" }), res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(fake.state.updates, 0);
  });
});
