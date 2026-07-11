/**
 * Voice-driven content creation tests.
 *
 * - proposeScheduledTime: proposed slots are always meaningfully in the future
 *   and later drafts land on later days.
 * - buildVoiceDraftPrompt: grounded in REAL data only (honest empty states),
 *   restricted to connected platforms, and carries the ask-vs-draft contract.
 * - approveDraft (DB): the pending→approved flip is atomic — a double approve
 *   schedules exactly ONE social_posts row; skip-after-approve conflicts.
 * - Ownership: a foreign user's session/draft reads as 404.
 */
const test = require("node:test");
const assert = require("node:assert");

require("./dbGuard");
const db = require("../config/db");
const {
  proposeScheduledTime,
  approveDraft,
  skipDraft,
  getSession,
} = require("../controllers/voiceContentController");
const { buildVoiceDraftPrompt } = require("../prompts/voiceContentPrompt");

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

// ---------------------------------------------------------------------------
// proposeScheduledTime
// ---------------------------------------------------------------------------

test("proposeScheduledTime always lands at least 30 minutes in the future", () => {
  const now = new Date();
  for (let pos = 0; pos < 5; pos += 1) {
    const t = proposeScheduledTime(pos, "00:01", "facebook", "America/New_York", now);
    assert.ok(
      t.getTime() - now.getTime() >= 30 * 60 * 1000,
      `draft ${pos} scheduled only ${(t - now) / 60000} min out`
    );
  }
});

test("proposeScheduledTime spreads consecutive drafts across later days", () => {
  const now = new Date();
  const first = proposeScheduledTime(0, "12:00", "facebook", "America/New_York", now);
  const third = proposeScheduledTime(2, "12:00", "facebook", "America/New_York", now);
  assert.ok(third.getTime() > first.getTime());
  assert.ok(third.getTime() - first.getTime() >= 24 * 60 * 60 * 1000);
});

test("proposeScheduledTime falls back to the platform default on bad input", () => {
  const now = new Date();
  const t = proposeScheduledTime(0, "nonsense", "twitter", "America/New_York", now);
  assert.ok(t instanceof Date && !Number.isNaN(t.getTime()));
});

// ---------------------------------------------------------------------------
// buildVoiceDraftPrompt (honesty + platform restriction)
// ---------------------------------------------------------------------------

const promptBrand = {
  brand_name: "Riverside Realty",
  brand_personality: "warm and knowledgeable",
  voice_description: "friendly local expert",
  target_audience: { description: "first-time home buyers" },
};

test("prompt is honest when there is no performance or competitor data", () => {
  const prompt = buildVoiceDraftPrompt(
    promptBrand,
    {
      businessType: "real estate",
      connectedPlatforms: ["facebook"],
      recentPosts: [],
      competitorAds: [],
      competitorReport: null,
    },
    { requestText: "let's create some content" }
  );
  assert.ok(prompt.includes("No published posts with performance data yet"));
  assert.ok(prompt.includes("No competitor data is available"));
  assert.ok(prompt.includes("never invent competitor claims"));
});

test("prompt cites real performance and competitor intel when present", () => {
  const prompt = buildVoiceDraftPrompt(
    promptBrand,
    {
      businessType: "real estate",
      connectedPlatforms: ["facebook", "linkedin"],
      recentPosts: [
        {
          platform: "facebook",
          content: "Open house this Saturday on Maple Street!",
          metrics: { likes: 42, comments: 7, shares: 3 },
        },
      ],
      competitorAds: [
        {
          competitorName: "BigCity Homes",
          headline: "Zero commission til June",
          bodyText: "List with us",
          threatLevel: "aggressive",
        },
      ],
      competitorReport: { summary: "Competitors push discounts.", gaps: ["no local stories"] },
    },
    { requestText: "something about the weekend" }
  );
  assert.ok(prompt.includes("42 likes"));
  assert.ok(prompt.includes("BigCity Homes"));
  assert.ok(prompt.includes("threat: aggressive"));
  assert.ok(prompt.includes("Competitors push discounts."));
  assert.ok(prompt.includes("no local stories"));
  assert.ok(prompt.includes("ONLY these): facebook, linkedin"));
  assert.ok(prompt.includes('"something about the weekend"'));
});

test("prompt includes answered clarifying questions and the JSON contract", () => {
  const prompt = buildVoiceDraftPrompt(
    promptBrand,
    {
      businessType: null,
      connectedPlatforms: ["facebook"],
      recentPosts: [],
      competitorAds: [],
      competitorReport: null,
    },
    {
      requestText: "promote the special",
      answers: [{ question: "What is the special?", answer: "Free staging consult" }],
    }
  );
  assert.ok(prompt.includes("Q: What is the special? A: Free staging consult"));
  assert.ok(prompt.includes('{"questions"'));
  assert.ok(prompt.includes('{"posts"'));
});

// ---------------------------------------------------------------------------
// DB-backed: approve atomicity, skip conflicts, ownership
// ---------------------------------------------------------------------------

async function createFixture() {
  const email = `voice-content-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const user = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING user_id",
    [email]
  );
  const userId = user.rows[0].user_id;
  const brand = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, 'Voice Test Brand') RETURNING brand_id",
    [userId]
  );
  const brandId = brand.rows[0].brand_id;
  const session = await db.query(
    `INSERT INTO voice_content_sessions (brand_id, user_id, status)
     VALUES ($1, $2, 'reviewing') RETURNING session_id`,
    [brandId, userId]
  );
  const sessionId = session.rows[0].session_id;
  const draft = await db.query(
    `INSERT INTO voice_content_drafts
       (session_id, position, platform, post_content, visual_idea, scheduled_time)
     VALUES ($1, 1, 'facebook', 'Test post copy #local', 'a sunny porch', NOW() + interval '2 hours')
     RETURNING draft_id`,
    [sessionId]
  );
  return { userId, brandId, sessionId, draftId: draft.rows[0].draft_id };
}

async function cleanup(userId) {
  await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
}

test("approveDraft schedules exactly one post; a second approve conflicts", async () => {
  const fx = await createFixture();
  try {
    const req = {
      user: { userId: fx.userId },
      params: { sessionId: fx.sessionId, draftId: fx.draftId },
      body: {},
    };

    const res1 = mockRes();
    await approveDraft(req, res1);
    assert.strictEqual(res1.statusCode, 200);
    assert.ok(res1.body.postId, "first approve returns the scheduled post id");

    const res2 = mockRes();
    await approveDraft(req, res2);
    assert.strictEqual(res2.statusCode, 409, "second approve must conflict");

    const posts = await db.query(
      "SELECT post_id, status, image_url FROM social_posts WHERE brand_id = $1",
      [fx.brandId]
    );
    assert.strictEqual(posts.rows.length, 1, "exactly one scheduled post");
    assert.strictEqual(posts.rows[0].status, "scheduled");

    const draft = await db.query(
      "SELECT status, posted_post_id FROM voice_content_drafts WHERE draft_id = $1",
      [fx.draftId]
    );
    assert.strictEqual(draft.rows[0].status, "approved");
    assert.strictEqual(draft.rows[0].posted_post_id, posts.rows[0].post_id);
  } finally {
    await cleanup(fx.userId);
  }
});

test("approved draft carries its image into the scheduled post", async () => {
  const fx = await createFixture();
  try {
    await db.query(
      "UPDATE voice_content_drafts SET image_url = '/uploads/images/test.png' WHERE draft_id = $1",
      [fx.draftId]
    );
    const req = {
      user: { userId: fx.userId },
      params: { sessionId: fx.sessionId, draftId: fx.draftId },
      body: {},
    };
    const res = mockRes();
    await approveDraft(req, res);
    assert.strictEqual(res.statusCode, 200);
    const posts = await db.query(
      "SELECT image_url FROM social_posts WHERE brand_id = $1",
      [fx.brandId]
    );
    assert.strictEqual(posts.rows[0].image_url, "/uploads/images/test.png");
  } finally {
    await cleanup(fx.userId);
  }
});

test("a past proposed time is backstopped to the near future on approve", async () => {
  const fx = await createFixture();
  try {
    await db.query(
      "UPDATE voice_content_drafts SET scheduled_time = NOW() - interval '3 hours' WHERE draft_id = $1",
      [fx.draftId]
    );
    const req = {
      user: { userId: fx.userId },
      params: { sessionId: fx.sessionId, draftId: fx.draftId },
      body: {},
    };
    const res = mockRes();
    await approveDraft(req, res);
    assert.strictEqual(res.statusCode, 200);
    const posts = await db.query(
      "SELECT scheduled_time FROM social_posts WHERE brand_id = $1",
      [fx.brandId]
    );
    assert.ok(
      new Date(posts.rows[0].scheduled_time).getTime() > Date.now(),
      "scheduled_time must be in the future"
    );
  } finally {
    await cleanup(fx.userId);
  }
});

test("skip after approve conflicts and never unschedules", async () => {
  const fx = await createFixture();
  try {
    const req = {
      user: { userId: fx.userId },
      params: { sessionId: fx.sessionId, draftId: fx.draftId },
      body: {},
    };
    const resA = mockRes();
    await approveDraft(req, resA);
    assert.strictEqual(resA.statusCode, 200);

    const resS = mockRes();
    await skipDraft(req, resS);
    assert.strictEqual(resS.statusCode, 409);

    const posts = await db.query("SELECT 1 FROM social_posts WHERE brand_id = $1", [fx.brandId]);
    assert.strictEqual(posts.rows.length, 1, "approved post stays scheduled");
  } finally {
    await cleanup(fx.userId);
  }
});

test("a foreign user's session and draft read as 404", async () => {
  const fx = await createFixture();
  const stranger = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING user_id",
    [`voice-content-stranger-${Date.now()}@example.test`]
  );
  const strangerId = stranger.rows[0].user_id;
  try {
    const resGet = mockRes();
    await getSession(
      { user: { userId: strangerId }, params: { sessionId: fx.sessionId } },
      resGet
    );
    assert.strictEqual(resGet.statusCode, 404);

    const resApprove = mockRes();
    await approveDraft(
      {
        user: { userId: strangerId },
        params: { sessionId: fx.sessionId, draftId: fx.draftId },
        body: {},
      },
      resApprove
    );
    assert.strictEqual(resApprove.statusCode, 404);

    const posts = await db.query("SELECT 1 FROM social_posts WHERE brand_id = $1", [fx.brandId]);
    assert.strictEqual(posts.rows.length, 0, "nothing was scheduled by the stranger");
  } finally {
    await cleanup(fx.userId);
    await cleanup(strangerId);
  }
});
