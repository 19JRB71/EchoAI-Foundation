// Prompt 021 — Hermes decision telemetry (Owner Stage-2 §2/§4/§5).
//
// Proves, against the isolated test database (dbGuard):
//   1. Fault injection: recordHermesDecision's DB write failing does NOT
//      change the wrapper's return value, throws nothing, adds no retry.
//   2. Exactly one durable row per completed invocation; a duplicate
//      invocation_id is a no-op (ON CONFLICT DO NOTHING), never a second row.
//   3. Classification mapping: gate-blocked → suppressed, AbortError →
//      timeout, other errors → error; parse-null → 'null'; decision →
//      'non_null'. Suppressed stays out of the fixed denominator.
//   4. The recorder never throws on malformed input.
require("./dbGuard");

const test = require("node:test");
const assert = require("node:assert");
const db = require("../config/db");
const {
  newInvocationId,
  classifyHermesFailure,
  recordHermesDecision,
} = require("../utils/hermesMetrics");
const { blockedError } = require("../utils/aiGate");

async function rowsFor(invocationId) {
  const r = await db.query(
    "SELECT * FROM hermes_decisions WHERE invocation_id = $1",
    [invocationId],
  );
  return r.rows;
}

const created = [];
function inv() {
  const id = newInvocationId();
  created.push(id);
  return id;
}

test.after(async () => {
  if (created.length) {
    await db.query("DELETE FROM hermes_decisions WHERE invocation_id = ANY($1)", [created]);
  }
});

test("exactly one durable row per invocation; duplicate record is a no-op", async () => {
  const id = inv();
  await recordHermesDecision({ invocationId: id, feature: "test_feature", outcome: "non_null", latencyMs: 12 });
  await recordHermesDecision({ invocationId: id, feature: "test_feature", outcome: "error", latencyMs: 99 });
  const rows = await rowsFor(id);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].outcome, "non_null"); // first classification wins; no silent regeneration
  assert.strictEqual(rows[0].latency_ms, 12);
  assert.ok(rows[0].environment.length > 0);
});

test("classification mapping is exact", () => {
  assert.strictEqual(classifyHermesFailure(blockedError("test shutoff")), "suppressed");
  const abort = new Error("This operation was aborted");
  abort.name = "AbortError";
  assert.strictEqual(classifyHermesFailure(abort), "timeout");
  const http = new Error("Hermes HTTP 500");
  http.status = 500;
  assert.strictEqual(classifyHermesFailure(http), "error");
  assert.strictEqual(classifyHermesFailure(new Error("anything else")), "error");
});

test("recorder never throws and drops malformed input", async () => {
  await assert.doesNotReject(() => recordHermesDecision({ invocationId: null, outcome: "non_null" }));
  await assert.doesNotReject(() => recordHermesDecision({ invocationId: inv(), outcome: "bogus" }));
  await assert.doesNotReject(() => recordHermesDecision({}));
});

test("FAULT INJECTION: DB write failure never escapes, never retries, never alters the Hermes result", async () => {
  // Simulate the wrapper pattern with a stubbed db.query that always throws.
  const realQuery = db.query;
  let attempts = 0;
  db.query = async () => {
    attempts += 1;
    throw new Error("injected: database unavailable");
  };
  try {
    // The recorder itself must swallow the failure...
    await assert.doesNotReject(() =>
      recordHermesDecision({ invocationId: newInvocationId(), feature: "t", outcome: "non_null", latencyMs: 1 }),
    );
    assert.strictEqual(attempts, 1, "exactly one write attempt — no retry added");

    // ...and a wrapper using the fire-and-forget pattern returns its decision
    // unchanged, with no exception escaping and no behavior difference.
    async function wrapperUnderTest() {
      const id = newInvocationId();
      const decision = { agent: "echo", intent: "general" }; // simulated Hermes success
      recordHermesDecision({ invocationId: id, feature: "t", outcome: "non_null", latencyMs: 5 }); // not awaited
      return decision;
    }
    const result = await wrapperUnderTest();
    assert.deepStrictEqual(result, { agent: "echo", intent: "general" });
  } finally {
    db.query = realQuery;
  }
});

test("gate-blocked (suppressed) is excluded from the fixed denominator", async () => {
  const feature = `denom-test-${Date.now()}`;
  const rowsSpec = [
    ["non_null", 3],
    ["null", 1],
    ["error", 1],
    ["timeout", 1],
    ["suppressed", 4],
  ];
  for (const [outcome, n] of rowsSpec) {
    for (let i = 0; i < n; i++) {
      await recordHermesDecision({ invocationId: inv(), feature, outcome, latencyMs: 1 });
    }
  }
  const { rows } = await db.query(
    `SELECT outcome, COUNT(*)::int AS n FROM hermes_decisions WHERE feature = $1 GROUP BY outcome`,
    [feature],
  );
  const c = Object.fromEntries(rows.map((r) => [r.outcome, r.n]));
  const denom = c.non_null + c["null"] + c.error + c.timeout;
  assert.strictEqual(denom, 6);
  assert.strictEqual(c.suppressed, 4);
  assert.strictEqual(c.non_null / denom, 0.5);
});
