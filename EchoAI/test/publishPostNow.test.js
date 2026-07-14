const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// POST /api/social/posts/:postId/publish-now (publishPostNow) regressions:
//  1) A scheduled, owned, non-demo post is claimed atomically and published.
//  2) A claim miss on an existing post returns an honest 409 (never publishes).
//  3) A publish failure flips the claimed row to 'failed' (status-guarded) and
//     returns 502 with the reason — the post is recoverable via Reschedule.
// Tests never touch a real database or platform: db.query is swapped for the
// fake below (unrecognized queries throw) and socialApi.publishPost is stubbed.
// ---------------------------------------------------------------------------

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";

const db = require("../config/db");
const { encrypt } = require("../utils/encryption");
const socialApi = require("../utils/socialApi");
const { publishPostNow } = require("../controllers/socialController");

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const POST_ROW = {
  post_id: "11111111-1111-1111-1111-111111111111",
  brand_id: "brand-1",
  platform: "twitter",
  post_content: "Hello world",
  image_url: null,
  video_url: null,
  publish_attempts: 0,
};

/**
 * Fake db for publishPostNow. `claimRows` seeds what the atomic claim
 * returns; `existingRow` seeds the honest-409 lookup. Records failed flips.
 */
function makeDb({ claimRows = [], existingRow = null } = {}) {
  const state = { failed: [], published: [] };
  async function query(sql, params = []) {
    if (/UPDATE social_posts sp/i.test(sql) && /SET status = 'publishing'/i.test(sql)) {
      return { rows: claimRows.map((r) => ({ ...r })) };
    }
    if (/SELECT sp\.status, b\.is_demo/i.test(sql)) {
      return { rows: existingRow ? [{ ...existingRow }] : [] };
    }
    if (/FROM social_accounts/i.test(sql)) {
      return {
        rows: [
          {
            account_id: "acct-1",
            platform_username: "zorecho",
            credentials_encrypted: encrypt(JSON.stringify({ accessToken: "tok" })),
            connection_status: "connected",
          },
        ],
      };
    }
    if (/SET status = 'published'/i.test(sql)) {
      state.published.push(params[1]);
      return { rows: [] };
    }
    if (/SET status = 'failed'/i.test(sql) && /status = 'publishing'/i.test(sql)) {
      state.failed.push({ postId: params[1], error: params[0] });
      return { rows: [{ post_id: params[1] }] };
    }
    if (/SELECT post_id, brand_id, platform, post_content/i.test(sql)) {
      return {
        rows: [{ ...POST_ROW, status: "published", published_time: "now" }],
      };
    }
    throw new Error(`publishPostNow.test: unexpected query: ${sql.slice(0, 80)}`);
  }
  return { query, state };
}

const req = { user: { userId: "user-1" }, params: { postId: "11111111-1111-1111-1111-111111111111" } };

test("publish-now: claims the scheduled post and publishes it", async () => {
  const fake = makeDb({ claimRows: [POST_ROW] });
  const origQuery = db.query;
  const origPublish = socialApi.publishPost;
  db.query = fake.query;
  socialApi.publishPost = async () => ({ externalId: "ext-99" });
  try {
    const res = makeRes();
    await publishPostNow(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.post.status, "published");
    assert.deepStrictEqual(fake.state.published, ["11111111-1111-1111-1111-111111111111"]);
    assert.strictEqual(fake.state.failed.length, 0);
  } finally {
    db.query = origQuery;
    socialApi.publishPost = origPublish;
  }
});

test("publish-now: an already-published post is refused with 409, nothing publishes", async () => {
  const fake = makeDb({
    claimRows: [],
    existingRow: { status: "published", is_demo: false },
  });
  const origQuery = db.query;
  const origPublish = socialApi.publishPost;
  db.query = fake.query;
  socialApi.publishPost = async () => {
    throw new Error("publishPost must not be called on a claim miss");
  };
  try {
    const res = makeRes();
    await publishPostNow(req, res);
    assert.strictEqual(res.statusCode, 409);
    assert.match(res.body.error, /already been published/);
    assert.strictEqual(fake.state.published.length, 0);
  } finally {
    db.query = origQuery;
    socialApi.publishPost = origPublish;
  }
});

test("publish-now: a platform failure flips the row to 'failed' and returns 502", async () => {
  const fake = makeDb({ claimRows: [POST_ROW] });
  const origQuery = db.query;
  const origPublish = socialApi.publishPost;
  db.query = fake.query;
  socialApi.publishPost = async () => {
    throw new Error("Platform rejected the post");
  };
  try {
    const res = makeRes();
    await publishPostNow(req, res);
    assert.strictEqual(res.statusCode, 502);
    assert.match(res.body.error, /Platform rejected the post/);
    assert.strictEqual(fake.state.failed.length, 1);
    assert.strictEqual(fake.state.failed[0].postId, "11111111-1111-1111-1111-111111111111");
    assert.match(fake.state.failed[0].error, /Platform rejected the post/);
    assert.strictEqual(fake.state.published.length, 0);
  } finally {
    db.query = origQuery;
    socialApi.publishPost = origPublish;
  }
});
