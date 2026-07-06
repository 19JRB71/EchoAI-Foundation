const { test } = require("node:test");
const assert = require("node:assert");

// apiQuotaMonitor uses the shared db singleton; swap db.query with a stub per
// test so these stay pure unit tests (no real rows, no network for the DB path).
const db = require("../config/db");
const monitor = require("../utils/apiQuotaMonitor");

function withStub(handler, fn) {
  const original = db.query;
  db.query = handler;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      db.query = original;
    });
}

// --- Honesty rule: unavailable/not-configured providers must not fabricate numbers ---

test("checkOpenAI / checkAnthropic report unavailable with null numeric fields", async () => {
  for (const check of [monitor.checkOpenAI, monitor.checkAnthropic]) {
    const c = await check();
    assert.strictEqual(c.status, "unavailable");
    assert.strictEqual(c.used, null);
    assert.strictEqual(c.remaining, null);
    assert.strictEqual(c.pctRemaining, null);
    assert.ok(typeof c.detail === "string" && c.detail.length > 0);
  }
});

test("the sweep persists NULL (never 0) for providers with no real numbers", async () => {
  const upserts = [];
  await withStub(
    async (sql, params) => {
      if (/INSERT INTO api_quota_snapshots/i.test(sql)) {
        upserts.push({ sql, params });
        return { rows: [] };
      }
      // resolveAdmin + any alert claim: no admin, nothing to alert.
      return { rows: [] };
    },
    async () => {
      await monitor.runApiQuotaSweep({ notify: false });
    },
  );

  // upsertSnapshot params: [provider,label,status,used,limit_total,remaining,pct_remaining,unit,detail]
  const openai = upserts.find((u) => u.params[0] === "openai");
  assert.ok(openai, "openai snapshot should have been upserted");
  // used, limit_total, remaining, pct_remaining must be null — not 0.
  assert.strictEqual(openai.params[3], null, "used must be null, not 0");
  assert.strictEqual(openai.params[4], null, "limit_total must be null, not 0");
  assert.strictEqual(openai.params[5], null, "remaining must be null, not 0");
  assert.strictEqual(openai.params[6], null, "pct_remaining must be null, not 0");
});

// --- Threshold classification ---

test("classify returns critical/low/ok around the configured thresholds", () => {
  assert.strictEqual(monitor.classify(3, 100), "critical"); // <= 5%
  assert.strictEqual(monitor.classify(15, 100), "low"); // <= 20%
  assert.strictEqual(monitor.classify(50, 100), "ok");
  // Absolute critical floor still fires even at a healthy percentage.
  assert.strictEqual(monitor.classify(80, 1500, { criticalAbs: 2000 }), "critical");
});

test("classifyBalance flags low/critical account balances and errors on NaN", () => {
  assert.strictEqual(monitor.classifyBalance(3, { criticalAbs: 5, lowAbs: 20 }), "critical");
  assert.strictEqual(monitor.classifyBalance(15, { criticalAbs: 5, lowAbs: 20 }), "low");
  assert.strictEqual(monitor.classifyBalance(100, { criticalAbs: 5, lowAbs: 20 }), "ok");
  assert.strictEqual(monitor.classifyBalance(NaN, { criticalAbs: 5, lowAbs: 20 }), "error");
});
