// Prompt 020 — shared executeExternal() invariants (D-30):
//
//   §11 one gateway: exactly one provider call per idempotency key —
//       duplicate fires return the prior action without executing.
//   §13 caller-owned keys: a missing key throws before any ledger write or
//       provider call; the helper never generates a replacement.
//   §8  classified retry: only explicitly transient errors AND caller-granted
//       budget mark 'transient'; everything else is 'terminal'.
//   §3  terminal failures land in MANUAL_REVIEW (the Approvals Inbox IS the
//       failure queue) — record_only leaves handling to the feature.
//   §5  one owner alert per failure (atomic CAS); alert failures never alert.
//   §12 provider success survives bookkeeping failure — never re-executed.
//   §14 reconciliation is bookkeeping only, and throws if handed anything
//       executable.
//   §16 metrics come from the ledger only.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

// Stub the email transport BEFORE requiring the module under test (it
// destructures sendEmail at require time). No test may send real email.
const emailModule = require("../utils/email");
const sentAlerts = [];
let failNextAlertEmail = false;
emailModule.sendEmail = async (opts) => {
  if (failNextAlertEmail) {
    failNextAlertEmail = false;
    const err = new Error("stubbed alert transport failure");
    throw err;
  }
  sentAlerts.push(opts);
  return { messageId: `<stub-${sentAlerts.length}@test>` };
};

const { db, createTestUser, deleteUser } = require("./helpers");
const taskSpine = require("../utils/taskSpine");
const {
  executeExternal,
  isTransientProviderError,
  reconcileStaleActions,
  getExecutionMetrics,
} = require("../utils/executeExternal");

let userId;
let brandId;
const runTag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const key = (name) => `test:${runTag}:${name}`;

async function makeTask(name, status = "EXECUTING") {
  const { task } = await taskSpine.createTask({
    brandId,
    userId,
    sourceType: "social_post",
    sourceId: `exec-ext-${runTag}-${name}`,
    title: `executeExternal test task ${name}`,
    status,
    actor: "system:test",
  });
  return task;
}

before(async () => {
  userId = await createTestUser();
  const { rows } = await db.query(
    `INSERT INTO brands (user_id, brand_name) VALUES ($1, $2) RETURNING brand_id`,
    [userId, `ExecExternal Test Brand ${runTag}`]
  );
  brandId = rows[0].brand_id;
});

after(async () => {
  // agent_task_events is append-only (immutability trigger) and agent_tasks /
  // external_actions rows are keyed with per-run-unique ids, so they are left
  // in place (isolated test DB) — same convention as the spine suites.
  await db.query(`DELETE FROM external_actions WHERE idempotency_key LIKE $1`, [
    `test:${runTag}:%`,
  ]);
  await deleteUser(userId);
  await db.pool.end();
});

test("a caller-owned idempotency key is required — never generated (§13)", async () => {
  let calls = 0;
  await assert.rejects(
    executeExternal({
      provider: "stub",
      action: "email_send",
      execute: async () => {
        calls += 1;
      },
    }),
    /idempotencyKey is required/
  );
  await assert.rejects(
    executeExternal({
      idempotencyKey: "   ",
      provider: "stub",
      action: "email_send",
      execute: async () => {
        calls += 1;
      },
    }),
    /idempotencyKey is required/
  );
  assert.equal(calls, 0, "no provider call may happen without a key");
});

test("duplicate fire = exactly one provider call; dedup returns the prior action (§11)", async () => {
  let calls = 0;
  const opts = {
    idempotencyKey: key("dup"),
    provider: "stub",
    action: "email_send",
    brandId,
    userId,
    execute: async () => {
      calls += 1;
      return { externalId: "prov-1" };
    },
  };
  const first = await executeExternal(opts);
  assert.equal(first.deduplicated, false);
  assert.equal(first.result.externalId, "prov-1");

  const second = await executeExternal(opts);
  assert.equal(second.deduplicated, true);
  assert.equal(second.priorAction.action_id, first.actionId);
  assert.equal(second.priorAction.status, "succeeded");
  assert.equal(second.priorAction.external_ref, "prov-1");
  assert.equal(calls, 1, "the provider must be called exactly once");

  const { rows } = await db.query(
    "SELECT dedup_count FROM external_actions WHERE action_id = $1",
    [first.actionId]
  );
  assert.equal(rows[0].dedup_count, 1);
});

test("concurrent duplicate fires: one execution, the rest dedup (§11)", async () => {
  let calls = 0;
  const opts = () => ({
    idempotencyKey: key("race"),
    provider: "stub",
    action: "email_send",
    brandId,
    userId,
    execute: async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 50));
      return { externalId: "prov-race" };
    },
  });
  const results = await Promise.all([
    executeExternal(opts()),
    executeExternal(opts()),
    executeExternal(opts()),
  ]);
  assert.equal(calls, 1);
  assert.equal(results.filter((r) => !r.deduplicated).length, 1);
  assert.equal(results.filter((r) => r.deduplicated).length, 2);
});

test("transient classifier is the extracted publish policy (§8)", () => {
  assert.equal(isTransientProviderError(Object.assign(new Error("x"), { transient: true })), true);
  assert.equal(isTransientProviderError(Object.assign(new Error("x"), { statusCode: 429 })), true);
  assert.equal(isTransientProviderError(Object.assign(new Error("x"), { statusCode: 503 })), true);
  assert.equal(isTransientProviderError(Object.assign(new Error("x"), { statusCode: 400 })), false);
  assert.equal(isTransientProviderError(new Error("unclassified")), false);
});

test("transient failure with caller-granted budget: 'transient' row, no MANUAL_REVIEW, next attempt allowed", async () => {
  const task = await makeTask("transient");
  const boom = Object.assign(new Error("rate limited"), { statusCode: 429 });
  await assert.rejects(
    executeExternal({
      idempotencyKey: key("transient"),
      provider: "stub",
      action: "social_publish",
      taskId: task.task_id,
      brandId,
      userId,
      allowTransientRetry: true,
      execute: async () => {
        throw boom;
      },
    }),
    /rate limited/
  );
  const { rows } = await db.query(
    "SELECT status, classification, attempt, alerted_at FROM external_actions WHERE idempotency_key = $1",
    [key("transient")]
  );
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].classification, "transient");
  assert.equal(rows[0].alerted_at, null, "transient failures never alert");
  const t = await db.query("SELECT status FROM agent_tasks WHERE task_id = $1", [task.task_id]);
  assert.equal(t.rows[0].status, "EXECUTING", "transient failures never park the task");

  // The failed row does NOT block: the feature's retry becomes attempt 2.
  const retry = await executeExternal({
    idempotencyKey: key("transient"),
    provider: "stub",
    action: "social_publish",
    taskId: task.task_id,
    brandId,
    userId,
    execute: async () => ({ externalId: "after-retry" }),
  });
  assert.equal(retry.deduplicated, false);
  const attempt2 = await db.query(
    "SELECT attempt, status FROM external_actions WHERE action_id = $1",
    [retry.actionId]
  );
  assert.equal(attempt2.rows[0].attempt, 2);
  assert.equal(attempt2.rows[0].status, "succeeded");
});

test("terminal failure: MANUAL_REVIEW + exactly one owner alert email (§3, §5)", async () => {
  const task = await makeTask("terminal");
  const alertsBefore = sentAlerts.length;
  await assert.rejects(
    executeExternal({
      idempotencyKey: key("terminal"),
      provider: "stub",
      action: "social_publish",
      taskId: task.task_id,
      brandId,
      userId,
      allowTransientRetry: true, // budget granted, but the error is not transient
      execute: async () => {
        const err = new Error("permission revoked");
        err.statusCode = 403;
        throw err;
      },
    }),
    /permission revoked/
  );
  const t = await db.query("SELECT status, last_error FROM agent_tasks WHERE task_id = $1", [
    task.task_id,
  ]);
  assert.equal(t.rows[0].status, "MANUAL_REVIEW");
  const a = await db.query(
    "SELECT classification, alerted_at FROM external_actions WHERE idempotency_key = $1",
    [key("terminal")]
  );
  assert.equal(a.rows[0].classification, "terminal");
  assert.notEqual(a.rows[0].alerted_at, null);
  assert.equal(sentAlerts.length, alertsBefore + 1, "exactly one alert email");
  assert.match(sentAlerts[sentAlerts.length - 1].subject, /Action needed/);
});

test("record_only terminal failure: ledger row only, task untouched, no alert", async () => {
  const task = await makeTask("record-only");
  const alertsBefore = sentAlerts.length;
  await assert.rejects(
    executeExternal({
      idempotencyKey: key("record-only"),
      provider: "smtp",
      action: "email_send",
      taskId: task.task_id,
      brandId,
      userId,
      onTerminal: "record_only",
      execute: async () => {
        throw new Error("mailbox unavailable");
      },
    }),
    /mailbox unavailable/
  );
  const t = await db.query("SELECT status FROM agent_tasks WHERE task_id = $1", [task.task_id]);
  assert.equal(t.rows[0].status, "EXECUTING", "record_only never parks the task");
  assert.equal(sentAlerts.length, alertsBefore, "record_only never alerts");
  const a = await db.query(
    "SELECT status, classification FROM external_actions WHERE idempotency_key = $1",
    [key("record-only")]
  );
  assert.equal(a.rows[0].status, "failed");
  assert.equal(a.rows[0].classification, "terminal");
});

test("alert transport failure is swallowed and never re-alerts (§5)", async () => {
  const task = await makeTask("alert-fail");
  failNextAlertEmail = true;
  const alertsBefore = sentAlerts.length;
  await assert.rejects(
    executeExternal({
      idempotencyKey: key("alert-fail"),
      provider: "stub",
      action: "social_publish",
      taskId: task.task_id,
      brandId,
      userId,
      execute: async () => {
        throw new Error("hard failure");
      },
    }),
    /hard failure/ // the alert failure must NOT replace the provider error
  );
  assert.equal(sentAlerts.length, alertsBefore, "the failed alert sent nothing");
  // alerted_at is still claimed by the CAS — the failure is recorded, not retried.
  const a = await db.query(
    "SELECT alerted_at FROM external_actions WHERE idempotency_key = $1",
    [key("alert-fail")]
  );
  assert.notEqual(a.rows[0].alerted_at, null);
});

test("provider success survives a bookkeeping failure — never re-executed (§12)", async () => {
  let calls = 0;
  const first = await executeExternal({
    idempotencyKey: key("book-fail"),
    provider: "stub",
    action: "email_send",
    brandId,
    userId,
    externalRefOf: () => {
      // Simulated bookkeeping fault AFTER the provider accepted.
      throw new Error("bookkeeping exploded");
    },
    execute: async () => {
      calls += 1;
      return { externalId: "prov-book" };
    },
  });
  // The call reports success to the caller (the provider action DID happen)…
  assert.equal(first.deduplicated, false);
  assert.equal(calls, 1);
  // …and a re-fire must NOT re-execute: the in_progress row still blocks.
  const second = await executeExternal({
    idempotencyKey: key("book-fail"),
    provider: "stub",
    action: "email_send",
    brandId,
    userId,
    execute: async () => {
      calls += 1;
      return { externalId: "should-never-happen" };
    },
  });
  assert.equal(second.deduplicated, true);
  assert.equal(calls, 1, "bookkeeping failure must never cause re-execution");
});

test("reconciliation closes stale rows as 'interrupted' and refuses anything executable (§14)", async () => {
  const task = await makeTask("stale");
  // Stage a stranded in_progress row (crash between insert and finalize).
  const staged = await db.query(
    `INSERT INTO external_actions (idempotency_key, provider, action, task_id, brand_id, user_id, started_at)
     VALUES ($1, 'stub', 'social_publish', $2, $3, $4, NOW() - INTERVAL '30 minutes')
     RETURNING action_id`,
    [key("stale"), task.task_id, brandId, userId]
  );
  const alertsBefore = sentAlerts.length;

  await assert.rejects(
    reconcileStaleActions({ execute: async () => {} }),
    /NEVER execute/
  );

  const { reconciled } = await reconcileStaleActions({ olderThanMinutes: 10 });
  assert.ok(reconciled >= 1);
  const a = await db.query("SELECT * FROM external_actions WHERE action_id = $1", [
    staged.rows[0].action_id,
  ]);
  assert.equal(a.rows[0].status, "failed");
  assert.equal(a.rows[0].classification, "interrupted");
  assert.notEqual(a.rows[0].reconciled_at, null);
  assert.match(a.rows[0].error, /Never re-executed/);
  const t = await db.query("SELECT status FROM agent_tasks WHERE task_id = $1", [task.task_id]);
  assert.equal(t.rows[0].status, "MANUAL_REVIEW");
  assert.equal(sentAlerts.length, alertsBefore + 1, "interrupted rows alert once");

  // A second sweep finds nothing new and never re-alerts (CAS already won).
  await reconcileStaleActions({ olderThanMinutes: 10 });
  assert.equal(sentAlerts.length, alertsBefore + 1);
});

test("metrics are derived from the ledger only (§16)", async () => {
  const m = await getExecutionMetrics();
  for (const field of [
    "total_attempts",
    "retries",
    "deduplicated_executions",
    "terminal_failures",
    "reconciliations",
    "alerts_sent",
  ]) {
    assert.equal(typeof m[field], "number", `${field} must be a number`);
  }
  assert.ok(m.total_attempts >= 5);
  assert.ok(m.retries >= 1);
  assert.ok(m.deduplicated_executions >= 3);
  assert.ok(m.terminal_failures >= 3);
  assert.ok(m.reconciliations >= 1);
  assert.ok(m.alerts_sent >= 3);
});
