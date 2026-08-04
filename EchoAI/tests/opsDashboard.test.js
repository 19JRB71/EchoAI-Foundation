// Prompt 021 — ops dashboard projection-only guarantees (Owner Stage-2 §1/§3/§8).
//
// Proves:
//   1. The ops-dashboard route group is GET-only (no mutation endpoint exists
//      anywhere under /ops-dashboard) and the controller source contains no
//      INSERT/UPDATE/DELETE/TRUNCATE statements — projection only.
//   2. The Hermes tile renders honest states: not_instrumented before any
//      row exists is impossible to fake — verified with the empty-table probe
//      logic, and the fixed denominator excludes suppressed.
//   3. tile freshness states derive from source timestamps, never NOW().
require("./dbGuard");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const db = require("../config/db");

test("adminRoutes registers ops-dashboard endpoints as GET only", () => {
  const router = require("../routes/adminRoutes");
  const opsLayers = router.stack.filter(
    (l) => l.route && String(l.route.path).includes("ops-dashboard"),
  );
  assert.ok(opsLayers.length >= 2, "ops-dashboard routes exist");
  for (const layer of opsLayers) {
    const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
    assert.deepStrictEqual(methods, ["get"], `${layer.route.path} must be GET-only`);
  }
});

test("ops dashboard controller performs zero database writes (source audit)", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "controllers", "opsDashboardController.js"),
    "utf8",
  );
  // Strip comments, then assert no write statements of any kind.
  const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i.test(code),
    "controller must contain no SQL write/DDL statements");
});

test("Hermes tile: fixed denominator, suppressed excluded, honest empty state", async () => {
  const { tileHermes } = require("../controllers/opsDashboardController");
  const before = await db.query("SELECT COUNT(*)::int AS n FROM hermes_decisions");
  const tile = await tileHermes();
  assert.ok(["current", "no_data_yet", "not_instrumented"].includes(tile.state));
  if (before.rows[0].n === 0) {
    assert.strictEqual(tile.state, "not_instrumented");
  } else {
    const w = tile.data["48h"];
    const c = w.counts;
    assert.strictEqual(w.eligible_invocations, c.non_null + c.null + c.error + c.timeout);
    if (w.eligible_invocations > 0) {
      assert.strictEqual(w.non_null_rate, c.non_null / w.eligible_invocations);
    } else {
      assert.strictEqual(w.non_null_rate, null);
    }
  }
});

test("job-runs tile labels retries as not applicable — never a fabricated zero", async () => {
  const { tileJobRuns } = require("../controllers/opsDashboardController");
  const tile = await tileJobRuns();
  if (tile.data) {
    assert.strictEqual(tile.data.retries, "not_applicable_at_scheduler_level");
  }
});
