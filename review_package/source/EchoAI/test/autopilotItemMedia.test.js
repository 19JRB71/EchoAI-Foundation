const { test } = require("node:test");
const assert = require("node:assert");

// PUT /api/autopilot/items/:itemId/media — attach owner-uploaded media to a
// pending batch item. Covers: path allowlist, Facebook-only video, not-both,
// pending-only, and that approve forwards video_url into social_posts.
const db = require("../config/db");
const autopilot = require("../controllers/autopilotController");

function res() {
  const r = { statusCode: 200 };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
}

function fakeItem(over = {}) {
  return {
    item_id: "i1",
    batch_id: "bt1",
    brand_id: "b1",
    owner_id: "u1",
    item_type: "post",
    platform: "facebook",
    status: "pending",
    post_content: "hi",
    image_url: null,
    video_url: null,
    ...over,
  };
}

async function withDb(handlers, fn) {
  const orig = db.query;
  db.query = async (sql, params = []) => {
    for (const [re, h] of handlers) {
      if (re.test(sql)) return h(sql, params);
    }
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  };
  try {
    await fn();
  } finally {
    db.query = orig;
  }
}

function ownedItemHandler(item) {
  return [/FROM autopilot_batch_items i/i, () => ({ rows: item ? [item] : [] })];
}

test("setItemMedia attaches a video on a pending Facebook post", async () => {
  const item = fakeItem();
  let updateParams = null;
  await withDb(
    [
      ownedItemHandler(item),
      [
        /UPDATE autopilot_batch_items SET image_url/i,
        (sql, params) => {
          updateParams = params;
          return { rows: [{ ...item, image_url: params[0], video_url: params[1] }] };
        },
      ],
    ],
    async () => {
      const r = res();
      await autopilot.setItemMedia(
        { user: { userId: "u1" }, params: { itemId: "i1" }, body: { videoUrl: "/uploads/media/v.mp4" } },
        r
      );
      assert.strictEqual(r.statusCode, 200);
      assert.strictEqual(r.body.videoUrl, "/uploads/media/v.mp4");
      assert.deepStrictEqual(updateParams, [null, "/uploads/media/v.mp4", "i1"]);
    }
  );
});

test("setItemMedia rejects video on a non-Facebook post", async () => {
  await withDb([ownedItemHandler(fakeItem({ platform: "linkedin" }))], async () => {
    const r = res();
    await autopilot.setItemMedia(
      { user: { userId: "u1" }, params: { itemId: "i1" }, body: { videoUrl: "/uploads/media/v.mp4" } },
      r
    );
    assert.strictEqual(r.statusCode, 400);
  });
});

test("setItemMedia rejects non-stored paths and both-at-once", async () => {
  for (const body of [
    { imageUrl: "https://evil.example/x.png" },
    { videoUrl: "/uploads/media/../../etc/passwd" },
    { imageUrl: "/uploads/media/a.png", videoUrl: "/uploads/media/v.mp4" },
  ]) {
    await withDb([ownedItemHandler(fakeItem())], async () => {
      const r = res();
      await autopilot.setItemMedia(
        { user: { userId: "u1" }, params: { itemId: "i1" }, body },
        r
      );
      assert.strictEqual(r.statusCode, 400, JSON.stringify(body));
    });
  }
});

test("setItemMedia refuses non-pending items", async () => {
  await withDb([ownedItemHandler(fakeItem({ status: "approved" }))], async () => {
    const r = res();
    await autopilot.setItemMedia(
      { user: { userId: "u1" }, params: { itemId: "i1" }, body: { imageUrl: "/uploads/media/a.png" } },
      r
    );
    assert.strictEqual(r.statusCode, 409);
  });
});

test("approveItem forwards video_url into the scheduled social post", async () => {
  const item = fakeItem({ video_url: "/uploads/media/v.mp4" });
  let insertSql = "";
  let insertParams = null;
  const client = {
    query: async (sql, params = []) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
      if (/SET status = 'approved'/i.test(sql)) return { rows: [item] };
      if (/INSERT INTO social_posts/i.test(sql)) {
        insertSql = sql;
        insertParams = params;
        return { rows: [{ post_id: "p1", scheduled_time: new Date() }] };
      }
      if (/SET posted_post_id/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected client query: ${sql.slice(0, 60)}`);
    },
    release() {},
  };
  const origConnect = db.pool.connect;
  db.pool.connect = async () => client;
  try {
    await withDb([ownedItemHandler(item)], async () => {
      const r = res();
      await autopilot.approveItem({ user: { userId: "u1" }, params: { itemId: "i1" }, body: {} }, r);
      assert.strictEqual(r.statusCode, 200);
      assert.match(insertSql, /video_url/);
      assert.ok(insertParams.includes("/uploads/media/v.mp4"));
    });
  } finally {
    db.pool.connect = origConnect;
  }
});
