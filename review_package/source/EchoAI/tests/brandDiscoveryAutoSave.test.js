// Brand Discovery auto-save.
//
// The discovery agent appends a hidden [[PROFILE_CONFIRMED]] marker once the
// user confirms the reflected brand profile. The controller must:
//   - strip the marker from the reply shown/stored (users never see it),
//   - synthesize + save the brand in the SAME turn (no button click required),
//   - mark the session completed and return the saved brand,
//   - on a save failure, keep the session open and return an honest saveError
//     so the client can surface the explicit "Finish & save" retry,
//   - never auto-save when the marker is absent.
//
// Runs against the isolated test DB with a stubbed Anthropic client.

const { test, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const anthropicModule = require("../config/anthropic");
const { db, createTestUser, deleteUser } = require("./helpers");
const { discovery } = require("../controllers/brandDiscoveryController");

const originalCreate = anthropicModule.anthropic.messages.create;

const PROFILE_JSON = JSON.stringify({
  brand_name: "South Dixie Storage",
  brand_personality: "Reliable and neighborly",
  voice_description: "Plainspoken, warm",
  visual_style_preferences: { description: "clean", palette: ["navy"], mood: "trustworthy" },
  target_audience: { description: "local movers", demographics: "adults", interests: ["storage"] },
});

const userIds = [];

after(async () => {
  anthropicModule.anthropic.messages.create = originalCreate;
  for (const id of userIds) await deleteUser(id);
  await db.pool.end();
});

afterEach(() => {
  anthropicModule.anthropic.messages.create = originalCreate;
});

function stubReplies(replies) {
  let n = 0;
  anthropicModule.anthropic.messages.create = async () => ({
    content: [{ type: "text", text: replies[Math.min(n++, replies.length - 1)] }],
  });
}

function mockRes() {
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

async function startSession(userId) {
  const { rows } = await db.query(
    `INSERT INTO brand_discovery_sessions (user_id, messages)
     VALUES ($1, '[{"role":"user","content":"hi"},{"role":"assistant","content":"tell me about your business"}]'::jsonb)
     RETURNING *`,
    [userId]
  );
  return rows[0];
}

test("confirmed marker auto-saves the brand, strips the marker, completes the session", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const session = await startSession(userId);

  // 1st call = conversational reply w/ marker, 2nd call = synthesis JSON.
  stubReplies([
    "Wonderful — your brand profile is saved and you're all set! [[PROFILE_CONFIRMED]]",
    PROFILE_JSON,
  ]);

  const res = mockRes();
  await discovery(
    { user: { userId }, body: { sessionId: session.session_id, message: "yes, that's exactly right" } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, "completed");
  assert.ok(res.body.brand, "saved brand returned");
  assert.equal(res.body.brand.brand_name, "South Dixie Storage");
  assert.ok(!res.body.reply.includes("[[PROFILE_CONFIRMED]]"), "marker stripped from reply");

  const brands = await db.query("SELECT brand_name FROM brands WHERE user_id = $1", [userId]);
  assert.equal(brands.rows.length, 1);

  const s = await db.query(
    "SELECT status, messages FROM brand_discovery_sessions WHERE session_id = $1",
    [session.session_id]
  );
  assert.equal(s.rows[0].status, "completed");
  const stored = s.rows[0].messages;
  assert.ok(
    !JSON.stringify(stored).includes("[[PROFILE_CONFIRMED]]"),
    "marker never persisted in the transcript"
  );
});

test("no marker → normal reply, nothing saved", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const session = await startSession(userId);

  stubReplies(["Great — and who is your target audience?"]);

  const res = mockRes();
  await discovery(
    { user: { userId }, body: { sessionId: session.session_id, message: "we sell storage units" } },
    res
  );

  assert.equal(res.body.status, "active");
  assert.ok(!res.body.brand);
  const brands = await db.query("SELECT 1 FROM brands WHERE user_id = $1", [userId]);
  assert.equal(brands.rows.length, 0);
});

test("save failure after the marker keeps the session open and returns an honest saveError", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const session = await startSession(userId);

  // Synthesis returns unparseable output → auto-save fails → retryable state.
  stubReplies(["All set! [[PROFILE_CONFIRMED]]", "not valid json at all"]);

  const res = mockRes();
  await discovery(
    { user: { userId }, body: { sessionId: session.session_id, message: "yes" } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.notEqual(res.body.status, "completed");
  assert.ok(res.body.saveError, "client is told the save failed");
  assert.ok(res.body.reply, "the conversational reply still comes through");

  const s = await db.query(
    "SELECT status FROM brand_discovery_sessions WHERE session_id = $1",
    [session.session_id]
  );
  assert.notEqual(s.rows[0].status, "completed");
});
