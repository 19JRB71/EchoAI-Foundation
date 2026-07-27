// Task: don't lose setup progress when a user hard-closes the browser tab.
//
// A React unmount effect can't be relied on during a real tab/window close, so
// the client fires a `navigator.sendBeacon` to /pause-beacon on `pagehide`. The
// Beacon API can't set an Authorization header, so that endpoint authenticates
// from a JWT carried in the request body instead of the auth middleware.
//
// This pins the security- and correctness-sensitive parts of that handler:
//  - a VALID token pauses the caller's own in-progress session (progress kept),
//  - an INVALID/absent token is a silent no-op (can't pause via forged body),
//  - it never resurrects a session that isn't in_progress (dismissed/completed),
//  - it always answers 204 so a fire-and-forget beacon never blocks the unload.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { pauseSessionBeacon } = require("../controllers/setupAgentController");
const { db, createTestUser, createSetupSession, deleteUser } = require("./helpers");

function mockRes() {
  const res = { statusCode: null, ended: false };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.end = () => {
    res.ended = true;
    return res;
  };
  return res;
}

async function statusOf(sessionId) {
  const { rows } = await db.query(
    "SELECT status, paused_at FROM setup_sessions WHERE session_id = $1",
    [sessionId],
  );
  return rows[0];
}

let userId;

before(async () => {
  userId = await createTestUser();
});

after(async () => {
  await deleteUser(userId);
  await db.pool.end();
});

test("a valid token pauses the caller's own in-progress session", async () => {
  const session = await createSetupSession(userId, { status: "in_progress" });
  const token = jwt.sign({ userId }, process.env.JWT_SECRET);
  const res = mockRes();

  await pauseSessionBeacon({ body: { sessionId: session.session_id, token } }, res);

  assert.equal(res.statusCode, 204, "beacon must answer 204 (fire-and-forget)");
  const row = await statusOf(session.session_id);
  assert.equal(row.status, "paused", "the session must be flipped to paused");
  assert.ok(row.paused_at, "paused_at must be stamped so resume UX is accurate");
});

test("an invalid token is a silent no-op — no pause via a forged body", async () => {
  const session = await createSetupSession(userId, { status: "in_progress" });
  const res = mockRes();

  await pauseSessionBeacon(
    { body: { sessionId: session.session_id, token: "not-a-real-jwt" } },
    res,
  );

  assert.equal(res.statusCode, 204, "still 204 — never blocks the unload");
  const row = await statusOf(session.session_id);
  assert.equal(row.status, "in_progress", "a forged/invalid token must not pause anything");
});

test("a token for a different user can't pause someone else's session", async () => {
  const session = await createSetupSession(userId, { status: "in_progress" });
  const otherUserId = await createTestUser();
  const token = jwt.sign({ userId: otherUserId }, process.env.JWT_SECRET);
  const res = mockRes();

  try {
    await pauseSessionBeacon({ body: { sessionId: session.session_id, token } }, res);
    const row = await statusOf(session.session_id);
    assert.equal(row.status, "in_progress", "ownership is enforced — foreign session untouched");
  } finally {
    await deleteUser(otherUserId);
  }
});

test("never resurrects a session that isn't in_progress (dismissed stays dismissed)", async () => {
  const session = await createSetupSession(userId, { status: "dismissed" });
  const token = jwt.sign({ userId }, process.env.JWT_SECRET);
  const res = mockRes();

  await pauseSessionBeacon({ body: { sessionId: session.session_id, token } }, res);

  const row = await statusOf(session.session_id);
  assert.equal(row.status, "dismissed", "a dismissed session must not be flipped back to paused");
});

test("missing sessionId or token still answers 204 without throwing", async () => {
  const res = mockRes();
  await pauseSessionBeacon({ body: {} }, res);
  assert.equal(res.statusCode, 204);

  const res2 = mockRes();
  await pauseSessionBeacon({}, res2);
  assert.equal(res2.statusCode, 204, "a bodyless beacon must not throw");
});
