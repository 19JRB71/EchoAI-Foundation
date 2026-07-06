const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// publishDuePosts: owner alerts the moment a post flips to 'failed'.
// Covers the invariants that matter:
//   - a per-post publish failure pushes a web-push alert to the brand owner
//     with the platform + failure reason and a calendar deep link
//   - the stale-'publishing' rescue sweep alerts for each rescued post
//   - demo brands NEVER alert (the failed flip still happens)
//   - the alert only fires when the atomic publishing -> failed UPDATE really
//     hit a row (row-count branch, no alert on a lost race)
//   - alert delivery is best-effort: a push failure never breaks the loop
// Tests never touch a real database: db.query is swapped for a fake, and the
// push controllers' exports are stubbed (same pattern as goals.test.js).
// ---------------------------------------------------------------------------

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";

const db = require("../config/db");
const pushController = require("../controllers/pushController");
const mobilePushController = require("../controllers/mobilePushController");
const { publishDuePosts } = require("../controllers/socialController");

/**
 * Fake db for the scheduler tick.
 *  - `rescued`: rows the stale-'publishing' rescue UPDATE returns
 *  - `due`: rows the due-post claim returns (each will fail to publish because
 *    the social_accounts lookup returns no rows -> publishStoredPost throws)
 *  - `brands`: brand_id -> { brand_name, user_id, is_demo } for alert lookups
 *  - `failFlipHits`: post_ids for which the publishing->failed UPDATE "hits"
 *    (defaults to all); anything else returns 0 rows (lost race)
 */
function makeDb({ rescued = [], due = [], brands = {}, failFlipHits = null } = {}) {
  const state = { failedFlips: [], brandLookups: [] };
  async function query(sql, params = []) {
    if (/SET status = 'failed'/i.test(sql) && /updated_at </i.test(sql)) {
      return { rows: rescued };
    }
    if (/SET status = 'publishing'/i.test(sql)) {
      return { rows: due };
    }
    if (/FROM social_accounts/i.test(sql)) {
      return { rows: [] }; // no connected account -> publish throws
    }
    if (/SET status = 'failed'/i.test(sql) && /WHERE post_id/i.test(sql)) {
      const postId = params[1];
      state.failedFlips.push(postId);
      const hit = failFlipHits === null || failFlipHits.includes(postId);
      return { rows: hit ? [{ post_id: postId }] : [] };
    }
    if (/SELECT brand_name, user_id, is_demo FROM brands/i.test(sql)) {
      state.brandLookups.push(params[0]);
      const b = brands[params[0]];
      return { rows: b ? [b] : [] };
    }
    throw new Error(`socialFailureAlert.test: unexpected query: ${sql.slice(0, 80)}`);
  }
  return { query, state };
}

/** Runs fn with db.query + both push senders stubbed; restores afterwards. */
async function withStubs({ fakeQuery, onPush, onMobilePush }, fn) {
  const origQuery = db.query;
  const origPush = pushController.sendPushToUser;
  const origMobile = mobilePushController.sendToUser;
  db.query = fakeQuery;
  pushController.sendPushToUser =
    onPush || (async () => ({ sent: 1, failed: 0 }));
  mobilePushController.sendToUser =
    onMobilePush || (async () => ({ sent: 0, failed: 0, skipped: true }));
  try {
    return await fn();
  } finally {
    db.query = origQuery;
    pushController.sendPushToUser = origPush;
    mobilePushController.sendToUser = origMobile;
  }
}

test("per-post publish failure alerts the owner with platform + reason and a calendar deep link", async () => {
  const fake = makeDb({
    due: [{ post_id: "p1", brand_id: "b1", platform: "facebook", post_content: "hi" }],
    brands: { b1: { brand_name: "Acme", user_id: "owner-1", is_demo: false } },
  });
  const pushes = [];
  const mobilePushes = [];
  await withStubs(
    {
      fakeQuery: fake.query,
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
      const summary = await publishDuePosts();
      assert.strictEqual(summary.published, 0);
    },
  );

  assert.strictEqual(pushes.length, 1, "exactly one alert for one failed post");
  assert.strictEqual(pushes[0].userId, "owner-1");
  const p = pushes[0].payload;
  assert.match(p.title, /failed to publish/i);
  assert.match(p.body, /Facebook/i, "body names the platform");
  assert.match(p.body, /Acme/, "body names the brand");
  assert.match(p.body, /No connected facebook account/i, "body carries the failure reason");
  assert.strictEqual(p.url, "/dashboard?section=social", "deep-links to the calendar");
  assert.strictEqual(p.tag, "post-failed-p1", "per-post tag so one post alerts once");
  assert.strictEqual(mobilePushes.length, 1, "FCM mirror also sent");
});

test("rescue sweep alerts for each rescued post; demo brands are flipped but never alerted", async () => {
  const fake = makeDb({
    rescued: [
      { post_id: "r1", brand_id: "b1", platform: "instagram" },
      { post_id: "r2", brand_id: "b-demo", platform: "twitter" },
    ],
    brands: {
      b1: { brand_name: "Acme", user_id: "owner-1", is_demo: false },
      "b-demo": { brand_name: "Demo Co", user_id: "owner-1", is_demo: true },
    },
  });
  const pushes = [];
  await withStubs(
    {
      fakeQuery: fake.query,
      onPush: async (userId, payload) => {
        pushes.push({ userId, payload });
        return { sent: 1, failed: 0 };
      },
    },
    async () => {
      await publishDuePosts();
    },
  );

  assert.strictEqual(pushes.length, 1, "only the real brand's post alerts");
  assert.strictEqual(pushes[0].payload.tag, "post-failed-r1");
  assert.match(pushes[0].payload.body, /Instagram/i);
  assert.match(pushes[0].payload.body, /interrupted by a server restart/i);
  assert.deepStrictEqual(
    fake.state.brandLookups.sort(),
    ["b-demo", "b1"],
    "both rescued posts were considered — the demo one was filtered at alert time",
  );
});

test("no alert when the publishing->failed flip lost the race (0 rows updated)", async () => {
  const fake = makeDb({
    due: [{ post_id: "p1", brand_id: "b1", platform: "facebook", post_content: "hi" }],
    brands: { b1: { brand_name: "Acme", user_id: "owner-1", is_demo: false } },
    failFlipHits: [], // the guarded UPDATE hits nothing
  });
  const pushes = [];
  await withStubs(
    {
      fakeQuery: fake.query,
      onPush: async (userId, payload) => {
        pushes.push(payload);
        return { sent: 1, failed: 0 };
      },
    },
    async () => {
      await publishDuePosts();
    },
  );
  assert.strictEqual(fake.state.failedFlips.length, 1, "the flip was attempted");
  assert.strictEqual(pushes.length, 0, "but no alert without a real transition");
});

test("a push delivery failure never breaks the scheduler loop", async () => {
  const fake = makeDb({
    due: [
      { post_id: "p1", brand_id: "b1", platform: "facebook", post_content: "a" },
      { post_id: "p2", brand_id: "b1", platform: "linkedin", post_content: "b" },
    ],
    brands: { b1: { brand_name: "Acme", user_id: "owner-1", is_demo: false } },
  });
  let calls = 0;
  await withStubs(
    {
      fakeQuery: fake.query,
      onPush: async () => {
        calls += 1;
        throw new Error("push service down");
      },
    },
    async () => {
      const summary = await publishDuePosts();
      assert.strictEqual(summary.due, 2, "both posts were processed");
    },
  );
  assert.strictEqual(calls, 2, "an alert was attempted for each failure");
  assert.strictEqual(fake.state.failedFlips.length, 2, "both posts were marked failed");
});

test("missing or ownerless brand rows alert no one (and never throw)", async () => {
  const fake = makeDb({
    due: [{ post_id: "p1", brand_id: "gone", platform: "facebook", post_content: "x" }],
    brands: {}, // brand deleted between claim and alert
  });
  const pushes = [];
  await withStubs(
    {
      fakeQuery: fake.query,
      onPush: async (userId, payload) => {
        pushes.push(payload);
        return { sent: 1, failed: 0 };
      },
    },
    async () => {
      await publishDuePosts();
    },
  );
  assert.strictEqual(pushes.length, 0);
});
