// Task: a slow setup step can never run twice at once, AND setup never stalls when
// the server crashes mid-step. Verifies the renewable, token-fenced execution lease
// end-to-end against the real database using the controller's own claim/heartbeat/
// release SQL.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  claimExecution,
  heartbeatExecution,
  releaseExecution,
  EXECUTION_LEASE_SECONDS,
} = require("../controllers/setupAgentController");
const { db, createTestUser, createSetupSession, deleteUser } = require("./helpers");

let userId;
let sessionId;

// Age the lease past the reclaim window without any heartbeat (simulates a crash).
async function expireLease() {
  await db.query(
    "UPDATE setup_sessions SET executing_at = NOW() - (($1 + 60) || ' seconds')::interval WHERE session_id = $2",
    [String(EXECUTION_LEASE_SECONDS), sessionId],
  );
}

before(async () => {
  userId = await createTestUser();
  sessionId = (await createSetupSession(userId)).session_id;
});

after(async () => {
  await deleteUser(userId);
  await db.pool.end();
});

test("only one executor can hold the lease — a second concurrent claim is refused", async () => {
  const first = await claimExecution(sessionId);
  const second = await claimExecution(sessionId);
  assert.ok(first, "the first executor should acquire the lease (a token)");
  assert.equal(second, null, "a second overlapping executor must be blocked (no double-run)");
  await releaseExecution(sessionId, first);
});

test("a heartbeated (still-running) lease is never reclaimed, even past the lease window", async () => {
  const token = await claimExecution(sessionId);
  assert.ok(token);

  // Simulate a genuinely slow step: the lease would look expired...
  await db.query(
    "UPDATE setup_sessions SET executing_at = NOW() - INTERVAL '30 minutes' WHERE session_id = $1",
    [sessionId],
  );
  // ...but the running step heartbeats, refreshing the lease.
  await heartbeatExecution(sessionId, token);

  assert.equal(
    await claimExecution(sessionId),
    null,
    "a live, heartbeated lease must not be reclaimable",
  );
  await releaseExecution(sessionId, token);
});

test("a dead lease (crashed process, no heartbeat past the window) is reclaimable so setup never stalls", async () => {
  const dead = await claimExecution(sessionId);
  assert.ok(dead);

  // Simulate a crash: the lease is still held but no heartbeat has landed for
  // longer than the lease window (the heartbeat interval stopped with the process).
  await expireLease();

  const reclaimed = await claimExecution(sessionId);
  assert.ok(reclaimed, "an expired lease from a crashed process must be reclaimable");
  await releaseExecution(sessionId, reclaimed);
});

test("a revived crashed executor cannot release the lease another executor reclaimed", async () => {
  const tokenA = await claimExecution(sessionId);
  assert.ok(tokenA, "A acquires the lease");

  // A's process hangs/crashes: its lease expires with no heartbeat, so B reclaims.
  await expireLease();
  const tokenB = await claimExecution(sessionId);
  assert.ok(tokenB, "B reclaims the dead lease");

  // A revives and runs its stale finally-block release with its old token.
  await releaseExecution(sessionId, tokenA);

  // B must still hold a live lease — A's stale release must be a no-op.
  assert.equal(
    await claimExecution(sessionId),
    null,
    "A's stale release must not free B's live lease",
  );
  await releaseExecution(sessionId, tokenB);
});

test("release frees the slot immediately for the next executor", async () => {
  const token = await claimExecution(sessionId);
  assert.ok(token);
  await releaseExecution(sessionId, token);

  const next = await claimExecution(sessionId);
  assert.ok(next, "after an explicit release the slot is claimable again");
  await releaseExecution(sessionId, next);
});
