// Validation behavior of the owner-uploaded post media endpoint and the
// schedule-time media rules (pure paths only — no DB).
const test = require("node:test");
const assert = require("node:assert");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(32);
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "x".repeat(32);
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "x".repeat(64);

const socialController = require("../controllers/socialController");

function mockRes() {
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

test("uploadPostMedia rejects a missing file", async () => {
  const res = mockRes();
  await socialController.uploadPostMedia({ file: null }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /No file/i);
});

test("uploadPostMedia rejects unsupported mime types", async () => {
  const res = mockRes();
  await socialController.uploadPostMedia(
    { file: { mimetype: "application/pdf", size: 100, buffer: Buffer.alloc(1) } },
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /Unsupported file type/i);
});

test("uploadPostMedia enforces the 10 MB photo cap", async () => {
  const res = mockRes();
  await socialController.uploadPostMedia(
    {
      file: {
        mimetype: "image/png",
        size: 11 * 1024 * 1024,
        buffer: Buffer.alloc(1),
      },
    },
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /too large/i);
});

test("uploadPostMedia stores a valid photo and returns its /uploads/media URL", async (t) => {
  const fs = require("fs");
  const path = require("path");
  const res = mockRes();
  await socialController.uploadPostMedia(
    { file: { mimetype: "image/png", size: 4, buffer: Buffer.from("png!") } },
    res
  );
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.mediaType, "image");
  assert.match(res.body.url, /^\/uploads\/media\/[a-f0-9]{32}\.png$/);
  const abs = path.join(__dirname, "..", "uploads", "media", path.basename(res.body.url));
  assert.ok(fs.existsSync(abs));
  t.after(() => fs.rmSync(abs, { force: true }));
});

test("uploadPostMedia stores a valid video and returns mediaType video", async (t) => {
  const fs = require("fs");
  const path = require("path");
  const res = mockRes();
  await socialController.uploadPostMedia(
    { file: { mimetype: "video/mp4", size: 4, buffer: Buffer.from("mp4!") } },
    res
  );
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.mediaType, "video");
  assert.match(res.body.url, /^\/uploads\/media\/[a-f0-9]{32}\.mp4$/);
  const abs = path.join(__dirname, "..", "uploads", "media", path.basename(res.body.url));
  t.after(() => fs.rmSync(abs, { force: true }));
});

test("schedulePost rejects a videoUrl outside /uploads/media", async () => {
  const res = mockRes();
  await socialController.schedulePost(
    {
      user: { userId: "u1" },
      body: {
        brandId: "b1",
        platform: "facebook",
        postContent: "hi",
        scheduledTime: new Date(Date.now() + 3600e3).toISOString(),
        videoUrl: "https://evil.example/x.mp4",
      },
    },
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /videoUrl/);
});

test("schedulePost rejects a traversal videoUrl", async () => {
  const res = mockRes();
  await socialController.schedulePost(
    {
      user: { userId: "u1" },
      body: {
        brandId: "b1",
        platform: "facebook",
        postContent: "hi",
        scheduledTime: new Date(Date.now() + 3600e3).toISOString(),
        videoUrl: "/uploads/media/../../secrets",
      },
    },
    res
  );
  assert.strictEqual(res.statusCode, 400);
});

test("schedulePost rejects photo+video together", async () => {
  const res = mockRes();
  await socialController.schedulePost(
    {
      user: { userId: "u1" },
      body: {
        brandId: "b1",
        platform: "facebook",
        postContent: "hi",
        scheduledTime: new Date(Date.now() + 3600e3).toISOString(),
        imageUrl: "/uploads/images/a.png",
        videoUrl: "/uploads/media/b.mp4",
      },
    },
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /not both/i);
});

test("schedulePost rejects video on non-Facebook platforms", async () => {
  const res = mockRes();
  await socialController.schedulePost(
    {
      user: { userId: "u1" },
      body: {
        brandId: "b1",
        platform: "twitter",
        postContent: "hi",
        scheduledTime: new Date(Date.now() + 3600e3).toISOString(),
        videoUrl: "/uploads/media/b.mp4",
      },
    },
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /Facebook only/i);
});

// ---------------------------------------------------------------------------
// Regression: publishDuePosts must forward video_url from its claim query into
// the platform publish call (a dropped column here silently publishes the post
// text-only). db.query is swapped for a fake; socialApi.publishPost is stubbed.
// ---------------------------------------------------------------------------
test("publishDuePosts forwards video_url to the Facebook publisher", async () => {
  const db = require("../config/db");
  const socialApi = require("../utils/socialApi");
  const { encrypt } = require("../utils/encryption");

  const duePost = {
    post_id: "p1",
    brand_id: "b1",
    platform: "facebook",
    post_content: "watch this",
    image_url: null,
    // Absolute URL so publishStoredPost needs no public base URL config.
    video_url: "https://example.com/uploads/media/clip.mp4",
    publish_attempts: 0,
  };

  const originalQuery = db.query;
  const originalPublish = socialApi.publishPost;
  let claimSql = "";
  let publishArgs = null;
  db.query = async (sql, params = []) => {
    if (/SET status = 'failed'/i.test(sql) && /updated_at </i.test(sql)) {
      return { rows: [] }; // rescue sweep: nothing stale
    }
    if (/SET status = 'publishing'/i.test(sql)) {
      claimSql = sql;
      return { rows: [duePost] };
    }
    if (/FROM social_accounts/i.test(sql)) {
      return {
        rows: [
          {
            account_id: "a1",
            platform_username: "page",
            connection_status: "connected",
            credentials_encrypted: encrypt(
              JSON.stringify({ accessToken: "tok", pageId: "page1" })
            ),
          },
        ],
      };
    }
    if (/SET status = 'published'/i.test(sql)) return { rows: [{}] };
    return { rows: [] };
  };
  socialApi.publishPost = async (platform, credentials, post) => {
    publishArgs = { platform, post };
    return { externalId: "fb_1" };
  };
  try {
    const { publishDuePosts } = require("../controllers/socialController");
    await publishDuePosts();
  } finally {
    db.query = originalQuery;
    socialApi.publishPost = originalPublish;
  }
  assert.match(claimSql, /RETURNING[^)]*video_url/i, "claim query must return video_url");
  assert.ok(publishArgs, "publishPost was called");
  assert.strictEqual(publishArgs.platform, "facebook");
  assert.strictEqual(publishArgs.post.videoUrl, duePost.video_url);
});
