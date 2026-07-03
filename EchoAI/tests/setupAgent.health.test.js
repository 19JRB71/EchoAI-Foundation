// Task: catch onboarding failures automatically before every release. Fast,
// deterministic structural checks that fail loudly when the setup agent's schema
// or action wiring regresses (the exact class of bug that breaks onboarding),
// with no AI calls so it is safe to run on every release.

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  ACTIONS,
  EXECUTION_LEASE_SECONDS,
  EXECUTION_HEARTBEAT_MS,
} = require("../controllers/setupAgentController");
const { FEATURES } = require("../config/tiers");
const { db } = require("./helpers");

after(async () => {
  await db.pool.end();
});

test("setup_sessions has every lifecycle + concurrency column the agent relies on", async () => {
  const required = [
    // 041 base
    "session_id", "user_id", "status", "answers", "messages", "completed_steps",
    "current_field", "interview_complete", "consent_granted", "consent_at",
    "brand_id", "created_at", "updated_at", "completed_at",
    // 042 concurrency
    "executing", "executing_at",
    // 043 lifecycle
    "started_at", "paused_at", "resumed_at", "discovery_session_id",
    // 044 lease fencing token
    "executing_token",
  ];
  const { rows } = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'setup_sessions'",
  );
  const have = new Set(rows.map((r) => r.column_name));
  for (const col of required) {
    assert.ok(
      have.has(col),
      `setup_sessions is missing "${col}" — a migration likely failed to apply`,
    );
  }
});

test("every setup action is well-formed (unique key, label, run())", () => {
  assert.ok(ACTIONS.length > 0, "there should be setup actions");
  const seen = new Set();
  for (const a of ACTIONS) {
    assert.ok(a.key && typeof a.key === "string", "each action needs a string key");
    assert.ok(!seen.has(a.key), `duplicate action key "${a.key}"`);
    seen.add(a.key);
    assert.ok(a.label && typeof a.label === "string", `${a.key} needs a label`);
    assert.equal(typeof a.run, "function", `${a.key} needs a run() function`);
  }
});

test("every gated action references a real feature (gate cannot silently fail open)", () => {
  for (const a of ACTIONS) {
    if (a.feature) {
      assert.ok(FEATURES[a.feature], `"${a.key}" references unknown feature "${a.feature}"`);
    }
  }
});

test("heartbeat fires well within the lease window", () => {
  assert.ok(
    EXECUTION_HEARTBEAT_MS * 2 < EXECUTION_LEASE_SECONDS * 1000,
    "heartbeat must be much smaller than the lease window or a live step could be reclaimed",
  );
});
