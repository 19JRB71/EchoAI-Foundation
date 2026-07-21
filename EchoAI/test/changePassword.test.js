const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const bcrypt = require("bcrypt");

const db = require("../config/db");

// ---------------------------------------------------------------------------
// Change-password endpoint regressions (PUT /api/auth/profile/password).
// db.query is swapped per-test with in-memory fakes, mirroring guidedSetup.test.js.
// ---------------------------------------------------------------------------

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const jwt = require("jsonwebtoken");
const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/auth");

const realQuery = db.query;

beforeEach(() => {
  db.query = realQuery;
});

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

const req = (body, user = { userId: "u1" }) => ({ user, body });

test("rejects when fields are missing", async () => {
  const res = mockRes();
  await authController.changePassword(req({ currentPassword: "", newPassword: "" }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /required/i);
});

test("rejects a new password shorter than 8 characters", async () => {
  const res = mockRes();
  await authController.changePassword(
    req({ currentPassword: "old-secret", newPassword: "short" }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /at least 8/i);
});

test("rejects reusing the current password", async () => {
  const res = mockRes();
  await authController.changePassword(
    req({ currentPassword: "same-password", newPassword: "same-password" }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /different/i);
});

test("401 when the current password is wrong", async () => {
  const hash = await bcrypt.hash("real-password", 4);
  db.query = async (sql) => {
    if (/SELECT password_hash/i.test(sql)) return { rows: [{ password_hash: hash }] };
    throw new Error(`unexpected query: ${sql}`);
  };
  const res = mockRes();
  await authController.changePassword(
    req({ currentPassword: "wrong-guess", newPassword: "brand-new-pass" }),
    res,
  );
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /incorrect/i);
});

test("updates the hash for the REAL authenticated user (actualUserId wins)", async () => {
  const hash = await bcrypt.hash("real-password", 4);
  let updatedUserId = null;
  let storedHash = null;
  db.query = async (sql, params) => {
    if (/SELECT password_hash/i.test(sql)) {
      assert.equal(params[0], "member-7"); // actualUserId, not remapped owner
      return { rows: [{ password_hash: hash }] };
    }
    if (/UPDATE users/i.test(sql)) {
      assert.match(sql, /password_changed_at = NOW\(\)/i); // old sessions invalidated
      storedHash = params[0];
      updatedUserId = params[1];
      return { rows: [{ email: "member@x.com" }] };
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  const res = mockRes();
  await authController.changePassword(
    req(
      { currentPassword: "real-password", newPassword: "brand-new-pass" },
      { userId: "owner-1", actualUserId: "member-7" },
    ),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(updatedUserId, "member-7");
  assert.ok(storedHash && storedHash !== hash);
  assert.ok(await bcrypt.compare("brand-new-pass", storedHash));
  // A fresh token is issued for THIS device (old tokens are now invalid).
  assert.ok(res.body.token);
  const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
  assert.equal(decoded.userId, "member-7");
});

// ---------------------------------------------------------------------------
// Session invalidation: authMiddleware rejects tokens issued BEFORE the
// password was last changed, and accepts tokens issued after.
// ---------------------------------------------------------------------------

function middlewareReq(token) {
  return { headers: { authorization: `Bearer ${token}` }, baseUrl: "/api/roi" };
}

function stubUserRow(row) {
  db.query = async (sql) => {
    if (/FROM users u/i.test(sql)) return { rows: [row] };
    return { rows: [] };
  };
}

test("authMiddleware rejects a token issued before the password change", async () => {
  const oldToken = jwt.sign(
    { userId: "u1", email: "a@x.com", iat: Math.floor(Date.now() / 1000) - 3600 },
    process.env.JWT_SECRET,
  );
  stubUserRow({
    platform_role: "user",
    password_changed_at: new Date(), // changed just now — old token predates it
    owner_id: null,
    team_role: null,
  });
  const res = mockRes();
  let nextCalled = false;
  await authMiddleware(middlewareReq(oldToken), res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /password was changed/i);
});

test("authMiddleware accepts a token issued after the password change", async () => {
  const freshToken = jwt.sign({ userId: "u1", email: "a@x.com" }, process.env.JWT_SECRET);
  stubUserRow({
    platform_role: "user",
    password_changed_at: new Date(Date.now() - 60_000), // changed a minute ago
    owner_id: null,
    team_role: null,
  });
  const res = mockRes();
  let nextCalled = false;
  await authMiddleware(middlewareReq(freshToken), res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test("authMiddleware still accepts tokens when password was never changed", async () => {
  const token = jwt.sign(
    { userId: "u1", email: "a@x.com", iat: Math.floor(Date.now() / 1000) - 86400 },
    process.env.JWT_SECRET,
  );
  stubUserRow({ platform_role: "user", password_changed_at: null, owner_id: null, team_role: null });
  const res = mockRes();
  let nextCalled = false;
  await authMiddleware(middlewareReq(token), res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test("404 when the user row is gone", async () => {
  db.query = async () => ({ rows: [] });
  const res = mockRes();
  await authController.changePassword(
    req({ currentPassword: "real-password", newPassword: "brand-new-pass" }),
    res,
  );
  assert.equal(res.statusCode, 404);
});
