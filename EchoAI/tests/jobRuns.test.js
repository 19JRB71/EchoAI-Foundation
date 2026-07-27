// Prompt 010 — scheduler replica gate + job_runs claim/telemetry tests.
//
// Runs against the isolated test database (dbGuard). Proves:
//   1. Two concurrent callers racing the same (job, tick): exactly one
//      executes AND exactly one canonical job_runs row exists.
//   2. A thrown job error is recorded (outcome 'failed', error text), never
//      re-thrown out of the wrapper.
//   3. A claimed tick that existing AI gating declines records 'skipped' —
//      never 'success'.
//   4. The RUN_SCHEDULER boot gate parses defaults and off-values correctly.
require("./dbGuard");

const test = require("node:test");
const assert = require("node:assert");
const db = require("../config/db");
const scheduler = require("../utils/scheduler");
const controls = require("../config/aiControls");

const TEST_PREFIX = "jobruns-test-";

async function rowsFor(name, tickKey) {
  const r = await db.query(
    "SELECT * FROM job_runs WHERE job_name = $1 AND tick_key = $2",
    [name, tickKey],
  );
  return r.rows;
}

test.after(async () => {
  await db.query("DELETE FROM job_runs WHERE job_name LIKE $1", [`${TEST_PREFIX}%`]);
});

test("two concurrent callers: exactly one executes, exactly one job_runs row", async () => {
  const name = `${TEST_PREFIX}race`;
  const tickKey = scheduler.tickKeyFor(new Date("2026-07-27T12:00:00Z"));
  let executions = 0;
  const run = async () => {
    executions += 1;
  };
  const [a, b] = await Promise.all([
    scheduler.runClaimedJob({ name, ai: false, control: null, run, tickKey }),
    scheduler.runClaimedJob({ name, ai: false, control: null, run, tickKey }),
  ]);
  assert.equal(executions, 1, "exactly one caller must execute the job");
  const outcomes = [a, b];
  assert.equal(outcomes.filter((o) => o.reason === "duplicate-claim").length, 1);
  assert.equal(outcomes.filter((o) => o.outcome === "success").length, 1);
  const rows = await rowsFor(name, tickKey);
  assert.equal(rows.length, 1, "the loser must not insert a second row");
  assert.equal(rows[0].outcome, "success");
  assert.ok(rows[0].finished_at, "row must be finalized");
  assert.equal(typeof rows[0].duration_ms, "number");
});

test("a thrown job error is recorded as 'failed', not thrown", async () => {
  const name = `${TEST_PREFIX}fail`;
  const tickKey = scheduler.tickKeyFor(new Date("2026-07-27T12:01:00Z"));
  const result = await scheduler.runClaimedJob({
    name,
    ai: false,
    control: null,
    tickKey,
    run: async () => {
      throw new Error("boom from job");
    },
  });
  assert.equal(result.outcome, "failed");
  const rows = await rowsFor(name, tickKey);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, "failed");
  assert.match(rows[0].error, /boom from job/);
  assert.ok(rows[0].finished_at);
});

test("a claimed but AI-gated tick records 'skipped', never 'success'", async () => {
  // Outside production with dev AI off, executeJob declines ai:true jobs.
  delete process.env.DEVELOPMENT_AI_ENABLED;
  controls._resetCacheForTests();
  const name = `${TEST_PREFIX}skip`;
  const tickKey = scheduler.tickKeyFor(new Date("2026-07-27T12:02:00Z"));
  let ran = false;
  const result = await scheduler.runClaimedJob({
    name,
    ai: true,
    control: null,
    tickKey,
    run: async () => {
      ran = true;
    },
  });
  assert.equal(ran, false, "gated job body must not run");
  assert.equal(result.outcome, "skipped");
  const rows = await rowsFor(name, tickKey);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, "skipped");
  assert.ok(rows[0].error, "skip reason is recorded in the row");
});

test("tick keys bucket to the minute so replicas race for the same claim", () => {
  assert.equal(
    scheduler.tickKeyFor(new Date("2026-07-27T12:00:03.500Z")),
    scheduler.tickKeyFor(new Date("2026-07-27T12:00:58.000Z")),
  );
  assert.notEqual(
    scheduler.tickKeyFor(new Date("2026-07-27T12:00:00Z")),
    scheduler.tickKeyFor(new Date("2026-07-27T12:01:00Z")),
  );
});

test("RUN_SCHEDULER gate: default on, explicit off-values disable", () => {
  assert.equal(scheduler.schedulerEnabled(undefined), true);
  assert.equal(scheduler.schedulerEnabled(""), true);
  assert.equal(scheduler.schedulerEnabled("true"), true);
  assert.equal(scheduler.schedulerEnabled("1"), true);
  assert.equal(scheduler.schedulerEnabled("false"), false);
  assert.equal(scheduler.schedulerEnabled("FALSE"), false);
  assert.equal(scheduler.schedulerEnabled("0"), false);
  assert.equal(scheduler.schedulerEnabled("off"), false);
  assert.equal(scheduler.schedulerEnabled("no"), false);
});
