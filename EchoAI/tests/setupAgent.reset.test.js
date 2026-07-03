// Task: let a user reset their setup-agent status so they can re-experience the
// full new-user flow (the automatic greeting + a fresh interview).
//
// POST /api/setup-agent/reset deletes the caller's setup_sessions rows. This
// pins the correctness- and ownership-sensitive parts of that handler:
//  - it clears ALL of the caller's sessions regardless of status, so
//    getLatestSession then returns null (the brand-new-user state),
//  - it reports how many rows were cleared,
//  - it never touches another user's sessions (user-scoped delete),
//  - a caller with no sessions gets a clean { cleared: 0 } (no throw).

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetSetup } = require("../controllers/setupAgentController");
const { db, createTestUser, createSetupSession, deleteUser } = require("./helpers");

function mockRes() {
  const res = { statusCode: 200, payload: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.payload = payload;
    return res;
  };
  return res;
}

async function sessionCount(userId) {
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS n FROM setup_sessions WHERE user_id = $1",
    [userId],
  );
  return rows[0].n;
}

let userId;

before(async () => {
  userId = await createTestUser();
});

after(async () => {
  await deleteUser(userId);
  await db.pool.end();
});

test("clears all of the caller's sessions regardless of status", async () => {
  await createSetupSession(userId, { status: "completed" });
  await createSetupSession(userId, { status: "dismissed" });
  await createSetupSession(userId, { status: "in_progress" });
  const res = mockRes();

  await resetSetup({ user: { userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.cleared, 3, "every session for the user must be cleared");
  assert.equal(await sessionCount(userId), 0, "no sessions should remain");
});

test("does not touch another user's sessions", async () => {
  const otherUserId = await createTestUser();
  try {
    await createSetupSession(otherUserId, { status: "in_progress" });
    await createSetupSession(userId, { status: "completed" });
    const res = mockRes();

    await resetSetup({ user: { userId } }, res);

    assert.equal(res.payload.cleared, 1, "only the caller's own session is cleared");
    assert.equal(
      await sessionCount(otherUserId),
      1,
      "a different user's session must be left intact",
    );
  } finally {
    await deleteUser(otherUserId);
  }
});

test("a caller with no sessions gets cleared: 0 without throwing", async () => {
  assert.equal(await sessionCount(userId), 0, "precondition: no sessions");
  const res = mockRes();

  await resetSetup({ user: { userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.cleared, 0);
});
