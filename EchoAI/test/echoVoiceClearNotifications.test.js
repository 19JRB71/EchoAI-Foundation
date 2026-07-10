const { test } = require("node:test");
const assert = require("node:assert");

const db = require("../config/db");
const controller = require("../controllers/echoVoiceController");

// ---------------------------------------------------------------------------
// clearNotifications must only dismiss notifications that are actually surfaced
// right now — the same ready/non-expired window that summary + list use — so a
// bulk "clear" can never silently dismiss a future-scheduled reminder the owner
// has not seen yet. We stub db.query on the shared module object (the controller
// calls db.query(...)), capture the SQL, and assert the predicate is present.
// ---------------------------------------------------------------------------

function fakeRes() {
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

async function withStubbedQuery(recorder, fn) {
  const orig = db.query;
  db.query = recorder;
  try {
    return await fn();
  } finally {
    db.query = orig;
  }
}

test("clearNotifications (clear-all) restricts to the ready, non-expired window", async () => {
  const calls = [];
  await withStubbedQuery(
    async (sql, params) => {
      calls.push({ sql, params });
      return { rowCount: 3 };
    },
    async () => {
      const res = fakeRes();
      await controller.clearNotifications(
        { user: { userId: "u1" }, body: {} },
        res,
      );
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body, { ok: true, cleared: 3 });
    },
  );

  assert.strictEqual(calls.length, 1);
  const { sql } = calls[0];
  assert.match(sql, /status = 'pending'/i);
  assert.match(sql, /deliver_after <= NOW\(\)/i);
  assert.match(sql, /expires_at IS NULL OR expires_at > NOW\(\)/i);
});

test("clearNotifications (per-brand) scopes to the brand AND the ready window", async () => {
  const calls = [];
  await withStubbedQuery(
    async (sql, params) => {
      calls.push({ sql, params });
      return { rowCount: 1 };
    },
    async () => {
      const res = fakeRes();
      await controller.clearNotifications(
        { user: { userId: "u1" }, body: { brandId: "b42" } },
        res,
      );
      assert.deepStrictEqual(res.body, { ok: true, cleared: 1 });
    },
  );

  const { sql, params } = calls[0];
  assert.deepStrictEqual(params, ["u1", "b42"]);
  assert.match(sql, /brand_id = \$2 OR payload->>'brandId' = \$2/i);
  assert.match(sql, /deliver_after <= NOW\(\)/i);
  assert.match(sql, /expires_at IS NULL OR expires_at > NOW\(\)/i);
});

test("clearNotifications (general) targets only non-brand rows in the ready window", async () => {
  const calls = [];
  await withStubbedQuery(
    async (sql, params) => {
      calls.push({ sql, params });
      return { rowCount: 0 };
    },
    async () => {
      const res = fakeRes();
      await controller.clearNotifications(
        { user: { userId: "u1" }, body: { brandId: "general" } },
        res,
      );
      assert.deepStrictEqual(res.body, { ok: true, cleared: 0 });
    },
  );

  const { sql } = calls[0];
  assert.match(sql, /brand_id IS NULL AND payload->>'brandId' IS NULL/i);
  assert.match(sql, /deliver_after <= NOW\(\)/i);
  assert.match(sql, /expires_at IS NULL OR expires_at > NOW\(\)/i);
});
