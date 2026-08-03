// Prompt 009 — task spine (agent_tasks / agent_task_events).
//
// Proves the Stage-1 commitments + Stage-2 binding additions:
//  1. TRANSACTIONAL PAIRING (Stage-2 addition 1), both failure directions:
//     an event-insert failure rolls back the state change; a state-update
//     failure leaves no orphan event. Also proven with a caller-supplied
//     transaction client (the sweep's own-transaction case).
//  2. Legal-transition table: illegal targets throw, guarded misses return
//     null (recorder semantics), PROVIDER_ACCEPTED -> REPORTED only with the
//     explicit verification='unavailable' marker, CANCELLED reachable from
//     pre-execution states, MANUAL_REVIEW only from its three legal sources.
//  3. Source idempotency (Addendum G): one canonical row per attempt; a
//     terminal CANCELLED predecessor yields attempt+1; concurrent creates
//     collapse to one row.
//  4. Addendum F: a spine failure after provider success creates a
//     MANUAL_REVIEW reconciliation task and NEVER retries the provider.
//  5. SCAN-BASED RECONCILIATION (Stage-2 addition 2): posts carrying provider
//     ids with no canonical task are discovered by scanForMissingTasks and
//     repaired deterministically via reconstructTrail — zero provider calls.
//  6. Append-only trigger on agent_task_events.
//  7. Full-flow sweep integration: schedule -> claim -> publish (stubbed
//     provider) -> verified trail through COMPLETED; transient retry and
//     hard-failure classification; stale rescue -> MANUAL_REVIEW.
//  8. Read-only activity endpoints enforce brand/task ownership.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { db, createTestUser, deleteUser } = require("./helpers");
const { encrypt } = require("../utils/encryption");
const taskSpine = require("../utils/taskSpine");
const socialApi = require("../utils/socialApi");
const socialController = require("../controllers/socialController");
const activityController = require("../controllers/taskActivityController");

let userId;
let brandId;
let otherUserId;

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(p) {
      this.body = p;
      return this;
    },
  };
}

async function insertPost(overrides = {}) {
  const {
    status = "scheduled",
    platform = "facebook",
    // Future-dated by default so OTHER test files' publishDuePosts sweeps
    // (files run in parallel processes against the shared test DB) never
    // claim these rows. Sweep tests below pass an explicitly due time.
    scheduled = "NOW() + INTERVAL '1 hour'",
    externalId = null,
    content = "spine test post",
    brand = brandId,
  } = overrides;
  const { rows } = await db.query(
    `INSERT INTO social_posts (brand_id, platform, post_content, scheduled_time, status, external_post_id)
     VALUES ($1, $2, $3, ${scheduled}, $4, $5)
     RETURNING post_id`,
    [brand, platform, content, status, externalId]
  );
  return rows[0].post_id;
}

async function taskOf(postId, taskType = "social_publish") {
  return taskSpine.findTaskBySource({ taskType, sourceId: postId });
}

async function eventsOf(taskId) {
  const { rows } = await db.query(
    "SELECT * FROM agent_task_events WHERE task_id = $1 ORDER BY created_at ASC, event_id ASC",
    [taskId]
  );
  return rows;
}

async function makeTask(postId, status = "APPROVED") {
  const { task } = await taskSpine.createTask({
    brandId,
    userId,
    sourceId: String(postId),
    title: "Publish to Facebook: spine test post",
    status,
    actor: `owner:${userId}`,
  });
  return task;
}

before(async () => {
  userId = await createTestUser();
  otherUserId = await createTestUser();
  const brand = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, 'Spine Test Brand') RETURNING brand_id",
    [userId]
  );
  brandId = brand.rows[0].brand_id;
  await db.query(
    `INSERT INTO social_accounts (brand_id, platform, platform_username, credentials_encrypted, connection_status)
     VALUES ($1, 'facebook', 'spine-test', $2, 'connected')`,
    [brandId, encrypt(JSON.stringify({ accessToken: "spine-test-token" }))]
  );
});

after(async () => {
  // agent_tasks/agent_task_events have no FKs by design; clean up explicitly.
  const { rows } = await db.query("SELECT task_id FROM agent_tasks WHERE brand_id = $1", [brandId]);
  for (const r of rows) {
    await db.query("ALTER TABLE agent_task_events DISABLE TRIGGER trg_agent_task_events_immutable");
    await db.query("DELETE FROM agent_task_events WHERE task_id = $1", [r.task_id]);
    await db.query("ALTER TABLE agent_task_events ENABLE TRIGGER trg_agent_task_events_immutable");
  }
  await db.query("DELETE FROM agent_tasks WHERE brand_id = $1", [brandId]);
  await deleteUser(userId);
  await deleteUser(otherUserId);
  await db.pool.end();
});

// --- 1. Creation + pairing ---------------------------------------------------

test("createTask writes the row and its creation event in one transaction", async () => {
  const postId = await insertPost();
  const { task, created } = await taskSpine.createTask({
    brandId,
    userId,
    sourceId: String(postId),
    title: "Publish to Facebook: spine test post",
    status: "APPROVED",
    actor: `owner:${userId}`,
    meta: { platform: "facebook" },
  });
  assert.equal(created, true);
  assert.equal(task.status, "APPROVED");
  assert.equal(task.attempt, 1);
  const events = await eventsOf(task.task_id);
  assert.equal(events.length, 1);
  assert.equal(events[0].from_status, null);
  assert.equal(events[0].to_status, "APPROVED");
  assert.equal(events[0].actor, `owner:${userId}`);
});

test("pairing: event-insert failure rolls back the state change (own transaction)", async () => {
  const postId = await insertPost();
  const task = await makeTask(postId);
  // Break event inserts at the database level — nothing to monkeypatch.
  await db.query(`
    CREATE OR REPLACE FUNCTION spine_test_break_events() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'spine-test: event insert broken'; END;
    $$ LANGUAGE plpgsql`);
  await db.query(`
    CREATE TRIGGER trg_spine_test_break_events BEFORE INSERT ON agent_task_events
    FOR EACH ROW EXECUTE FUNCTION spine_test_break_events()`);
  try {
    await assert.rejects(
      taskSpine.transition({ taskId: task.task_id, to: "QUEUED", actor: "system:test" }),
      /event insert broken/
    );
  } finally {
    await db.query("DROP TRIGGER trg_spine_test_break_events ON agent_task_events");
  }
  const { rows } = await db.query("SELECT status FROM agent_tasks WHERE task_id = $1", [task.task_id]);
  assert.equal(rows[0].status, "APPROVED", "state change must roll back with its event");
  assert.equal((await eventsOf(task.task_id)).length, 1, "only the creation event remains");
});

test("pairing: state-update failure leaves no orphan event (own transaction)", async () => {
  const postId = await insertPost();
  const task = await makeTask(postId);
  await db.query(`
    CREATE OR REPLACE FUNCTION spine_test_break_tasks() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'spine-test: task update broken'; END;
    $$ LANGUAGE plpgsql`);
  await db.query(`
    CREATE TRIGGER trg_spine_test_break_tasks BEFORE UPDATE ON agent_tasks
    FOR EACH ROW EXECUTE FUNCTION spine_test_break_tasks()`);
  try {
    await assert.rejects(
      taskSpine.transition({ taskId: task.task_id, to: "QUEUED", actor: "system:test" }),
      /task update broken/
    );
  } finally {
    await db.query("DROP TRIGGER trg_spine_test_break_tasks ON agent_tasks");
  }
  assert.equal((await eventsOf(task.task_id)).length, 1, "no orphan event may exist");
});

test("pairing: caller-supplied transaction client — caller rollback discards both", async () => {
  const postId = await insertPost();
  const task = await makeTask(postId);
  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    const moved = await taskSpine.transition({
      client,
      taskId: task.task_id,
      to: "QUEUED",
      actor: "system:test",
    });
    assert.equal(moved.status, "QUEUED");
    await client.query("ROLLBACK"); // caller owns the transaction
  } finally {
    client.release();
  }
  const { rows } = await db.query("SELECT status FROM agent_tasks WHERE task_id = $1", [task.task_id]);
  assert.equal(rows[0].status, "APPROVED");
  assert.equal((await eventsOf(task.task_id)).length, 1, "event vanished with the caller rollback");
});

// --- 2. Legal-transition table -----------------------------------------------

test("illegal transition target throws; guarded miss returns null", async () => {
  const postId = await insertPost();
  const task = await makeTask(postId);
  await assert.rejects(
    taskSpine.transition({ taskId: task.task_id, to: "NOT_A_STATE", actor: "system:test" }),
    /not a legal transition target/
  );
  // APPROVED is not a legal source of EXECUTING -> guarded miss, null, no event.
  const miss = await taskSpine.transition({ taskId: task.task_id, to: "EXECUTING", actor: "system:test" });
  assert.equal(miss, null);
  assert.equal((await eventsOf(task.task_id)).length, 1);
});

test("PROVIDER_ACCEPTED -> REPORTED requires the explicit verification-unavailable marker", async () => {
  const postId = await insertPost();
  const task = await makeTask(postId);
  for (const to of ["QUEUED", "EXECUTING", "PROVIDER_ACCEPTED"]) {
    assert.ok(await taskSpine.transition({ taskId: task.task_id, to, actor: "system:test" }));
  }
  // Without the marker: legal source is EXTERNALLY_VERIFIED only -> miss.
  const refused = await taskSpine.transition({ taskId: task.task_id, to: "REPORTED", actor: "system:test" });
  assert.equal(refused, null, "trail must never claim verification that did not happen");
  const reported = await taskSpine.transition({
    taskId: task.task_id,
    to: "REPORTED",
    actor: "system:test",
    meta: { verification: "unavailable" },
  });
  assert.equal(reported.status, "REPORTED");
});

test("CANCELLED is reachable from pre-execution states; MANUAL_REVIEW only from its legal sources", async () => {
  // APPROVED -> CANCELLED
  const p1 = await insertPost();
  const t1 = await makeTask(p1);
  assert.ok(await taskSpine.transition({ taskId: t1.task_id, to: "CANCELLED", actor: `owner:${userId}` }));
  // QUEUED -> CANCELLED
  const p2 = await insertPost();
  const t2 = await makeTask(p2);
  await taskSpine.transition({ taskId: t2.task_id, to: "QUEUED", actor: "system:test" });
  assert.ok(await taskSpine.transition({ taskId: t2.task_id, to: "CANCELLED", actor: `owner:${userId}` }));
  // Terminal: nothing leaves CANCELLED.
  assert.equal(await taskSpine.transition({ taskId: t2.task_id, to: "QUEUED", actor: "system:test" }), null);
  // MANUAL_REVIEW is NOT reachable from QUEUED (only EXECUTING,
  // PROVIDER_ACCEPTED, RETRY_SCHEDULED).
  const p3 = await insertPost();
  const t3 = await makeTask(p3);
  await taskSpine.transition({ taskId: t3.task_id, to: "QUEUED", actor: "system:test" });
  assert.equal(
    await taskSpine.transition({ taskId: t3.task_id, to: "MANUAL_REVIEW", actor: "system:test" }),
    null
  );
  assert.deepEqual(taskSpine.LEGAL_SOURCES.MANUAL_REVIEW, [
    "EXECUTING",
    "PROVIDER_ACCEPTED",
    "RETRY_SCHEDULED",
  ]);
});

// --- 3. Source idempotency (Addendum G) ---------------------------------------

test("createTask is get-or-create; CANCELLED predecessor yields attempt+1", async () => {
  const postId = await insertPost();
  const first = await taskSpine.createTask({
    brandId,
    userId,
    sourceId: String(postId),
    title: "t",
    actor: "system:test",
  });
  const again = await taskSpine.createTask({
    brandId,
    userId,
    sourceId: String(postId),
    title: "t",
    actor: "system:test",
  });
  assert.equal(again.created, false);
  assert.equal(again.task.task_id, first.task.task_id);

  await taskSpine.transition({ taskId: first.task.task_id, to: "CANCELLED", actor: `owner:${userId}` });
  const fresh = await taskSpine.createTask({
    brandId,
    userId,
    sourceId: String(postId),
    title: "t",
    actor: "system:test",
  });
  assert.equal(fresh.created, true);
  assert.equal(fresh.task.attempt, 2);

  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS n FROM agent_tasks WHERE task_type='social_publish' AND source_id = $1",
    [String(postId)]
  );
  assert.equal(rows[0].n, 2, "exactly one row per attempt, never duplicates");
});

// --- 4. Addendum F: write-time reconciliation fast path ------------------------

test("safeSpine after provider success: failure creates a MANUAL_REVIEW reconciliation task, never rethrows", async () => {
  const postId = await insertPost({ status: "published", externalId: "prov_123" });
  const out = await taskSpine.safeSpine(
    async () => {
      throw new Error("simulated spine write failure");
    },
    {
      providerSucceeded: true,
      source: { sourceId: String(postId), sourceType: "social_post", brandId, userId },
    }
  );
  assert.equal(out, null);
  const recon = await taskSpine.findTaskBySource({ taskType: "reconciliation", sourceId: postId });
  assert.ok(recon, "reconciliation task must exist");
  assert.equal(recon.status, "MANUAL_REVIEW");
  assert.equal(recon.meta.severity, "high");
});

// --- 5. Scan-based reconciliation (Stage-2 addition 2) --------------------------

test("scanForMissingTasks discovers provider-id rows without tasks and rebuilds the trail — zero provider calls", async () => {
  const publishedId = await insertPost({ status: "published", externalId: "prov_scan_1" });
  const failedId = await insertPost({ status: "failed" });
  await db.query(
    "UPDATE social_posts SET engagement_metrics = $1 WHERE post_id = $2",
    [JSON.stringify({ error: "Platform said no (test)" }), failedId]
  );
  const realFetch = global.fetch;
  const realPublish = socialApi.publishPost;
  const realMetrics = socialApi.fetchMetrics;
  const realVerify = socialApi.verifyPostExists;
  let providerTouched = 0;
  global.fetch = async () => {
    providerTouched += 1;
    throw new Error("scan must never touch the provider");
  };
  socialApi.publishPost = async () => {
    providerTouched += 1;
    throw new Error("scan must never publish");
  };
  socialApi.fetchMetrics = socialApi.publishPost;
  socialApi.verifyPostExists = socialApi.publishPost;
  try {
    const result = await taskSpine.scanForMissingTasks({ lookbackHours: 1 });
    assert.ok(result.repaired >= 2);
  } finally {
    global.fetch = realFetch;
    socialApi.publishPost = realPublish;
    socialApi.fetchMetrics = realMetrics;
    socialApi.verifyPostExists = realVerify;
  }
  assert.equal(providerTouched, 0);

  const publishedTask = await taskOf(publishedId);
  assert.equal(publishedTask.status, "COMPLETED");
  assert.equal(publishedTask.external_ref, "prov_scan_1");
  const trail = (await eventsOf(publishedTask.task_id)).map((e) => e.to_status);
  assert.deepEqual(trail, [
    "APPROVED",
    "QUEUED",
    "EXECUTING",
    "PROVIDER_ACCEPTED",
    "REPORTED", // no proof row existed -> honest verification-unavailable marker
    "COMPLETED",
  ]);
  const reportedEvent = (await eventsOf(publishedTask.task_id)).find((e) => e.to_status === "REPORTED");
  assert.equal(reportedEvent.meta.verification, "unavailable");

  const failedTask = await taskOf(failedId);
  assert.equal(failedTask.status, "EXTERNAL_FAILURE");
  assert.match(failedTask.last_error, /Platform said no/);

  // Idempotent: a second scan finds nothing new for these posts.
  const again = await taskSpine.scanForMissingTasks({ lookbackHours: 1 });
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS n FROM agent_tasks WHERE source_id = $1 AND task_type='social_publish'",
    [String(publishedId)]
  );
  assert.equal(rows[0].n, 1);
  assert.ok(again.found >= 0);
});

test("scan per-row guard: one bad row never aborts the sweep", async () => {
  const a = await insertPost({ status: "published", externalId: "prov_guard_a" });
  const b = await insertPost({ status: "published", externalId: "prov_guard_b" });
  const realRepair = taskSpine.repairOne;
  taskSpine.repairOne = async (postId) => {
    if (String(postId) === String(a)) throw new Error("boom for row A");
    return realRepair(postId);
  };
  try {
    const result = await taskSpine.scanForMissingTasks({ lookbackHours: 1 });
    assert.ok(result.found >= 2);
    assert.ok(result.repaired >= 1, "row B repaired despite row A throwing");
  } finally {
    taskSpine.repairOne = realRepair;
  }
  assert.ok(await taskOf(b));
  assert.equal(await taskOf(a), null);
});

// --- 6. Append-only trigger -----------------------------------------------------

test("agent_task_events rejects UPDATE and DELETE", async () => {
  const postId = await insertPost();
  const task = await makeTask(postId);
  const [event] = await eventsOf(task.task_id);
  await assert.rejects(
    db.query("UPDATE agent_task_events SET actor = 'evil' WHERE event_id = $1", [event.event_id]),
    /append-only/
  );
  await assert.rejects(
    db.query("DELETE FROM agent_task_events WHERE event_id = $1", [event.event_id]),
    /append-only/
  );
});

// --- 7. Full-flow sweep integration ----------------------------------------------

function stubPublish(impl) {
  const real = socialApi.publishPost;
  socialApi.publishPost = impl;
  return () => {
    socialApi.publishPost = real;
  };
}
function stubMetrics(impl) {
  const real = socialApi.verifyPostExists;
  socialApi.verifyPostExists = impl;
  return () => {
    socialApi.verifyPostExists = real;
  };
}

test("sweep happy path: verified Facebook trail through COMPLETED with a proof reference", async () => {
  const postId = await insertPost({ scheduled: "NOW() - INTERVAL '1 minute'" });
  // Owner schedules -> APPROVED + QUEUED (the schedulePost adopter path is
  // exercised via its helper here; the endpoint test lives below).
  const task = await makeTask(postId);
  await taskSpine.transition({ taskId: task.task_id, to: "QUEUED", actor: `owner:${userId}` });

  const restorePublish = stubPublish(async () => ({ externalId: "fb_post_777" }));
  const restoreMetrics = stubMetrics(async () => ({ id: "fb_post_777", createdTime: "2026-08-01T00:00:00+0000", permalinkUrl: "https://facebook.com/x" }));
  try {
    const result = await socialController.publishDuePosts();
    assert.ok(result.published >= 1);
  } finally {
    restorePublish();
    restoreMetrics();
  }

  const done = await taskOf(postId);
  assert.equal(done.status, "COMPLETED");
  assert.equal(done.external_ref, "fb_post_777");
  assert.ok(done.proof_id, "EXTERNALLY_VERIFIED must reference an external_proofs row");
  const proof = await db.query("SELECT * FROM external_proofs WHERE proof_id = $1", [done.proof_id]);
  assert.equal(proof.rows[0].action, "publish_readback");
  assert.equal(proof.rows[0].external_id, "fb_post_777");

  const trail = (await eventsOf(done.task_id)).map((e) => `${e.from_status || "∅"}→${e.to_status}`);
  assert.deepEqual(trail, [
    "∅→APPROVED",
    "APPROVED→QUEUED",
    "QUEUED→EXECUTING",
    "EXECUTING→PROVIDER_ACCEPTED",
    "PROVIDER_ACCEPTED→EXTERNALLY_VERIFIED",
    "EXTERNALLY_VERIFIED→REPORTED",
    "REPORTED→COMPLETED",
  ]);
  // Cleanup: the proof row is immutable; leave it (test DB) but delete the post.
  await db.query("DELETE FROM social_posts WHERE post_id = $1", [postId]);
});

test("failed Facebook read-back parks the task at MANUAL_REVIEW — publish is not retried", async () => {
  const postId = await insertPost({ scheduled: "NOW() - INTERVAL '1 minute'" });
  const task = await makeTask(postId);
  await taskSpine.transition({ taskId: task.task_id, to: "QUEUED", actor: `owner:${userId}` });
  let publishCalls = 0;
  const restorePublish = stubPublish(async () => {
    publishCalls += 1;
    return { externalId: "fb_post_888" };
  });
  const restoreMetrics = stubMetrics(async () => {
    throw new Error("Graph read-back down (test)");
  });
  try {
    await socialController.publishDuePosts();
  } finally {
    restorePublish();
    restoreMetrics();
  }
  assert.equal(publishCalls, 1, "provider action never retried (Addendum F)");
  const parked = await taskOf(postId);
  assert.equal(parked.status, "MANUAL_REVIEW");
  assert.equal(parked.external_ref, "fb_post_888");
  assert.match(parked.last_error, /read-back failed/i);
  // The post itself is published exactly as before — spine recorded, feature untouched.
  const { rows } = await db.query("SELECT status FROM social_posts WHERE post_id = $1", [postId]);
  assert.equal(rows[0].status, "published");
});

test("transient failure records RETRY_SCHEDULED; the retry claim re-queues; exhaustion classifies", async () => {
  const postId = await insertPost({ scheduled: "NOW() - INTERVAL '1 minute'" });
  const task = await makeTask(postId);
  await taskSpine.transition({ taskId: task.task_id, to: "QUEUED", actor: `owner:${userId}` });

  const transientErr = Object.assign(new Error("socket hang up"), { transient: true });
  let restore = stubPublish(async () => {
    throw transientErr;
  });
  try {
    await socialController.publishDuePosts();
  } finally {
    restore();
  }
  let t = await taskOf(postId);
  assert.equal(t.status, "RETRY_SCHEDULED");
  // Feature behavior byte-identical: post back to scheduled, +5 min, attempts=1.
  const post = await db.query(
    "SELECT status, publish_attempts FROM social_posts WHERE post_id = $1",
    [postId]
  );
  assert.equal(post.rows[0].status, "scheduled");
  assert.equal(post.rows[0].publish_attempts, 1);

  // Pull the retry due now and exhaust it with a hard auth error.
  await db.query("UPDATE social_posts SET scheduled_time = NOW() - INTERVAL '1 minute' WHERE post_id = $1", [postId]);
  const authErr = Object.assign(new Error("The access token has expired"), { statusCode: 401 });
  restore = stubPublish(async () => {
    throw authErr;
  });
  try {
    await socialController.publishDuePosts();
  } finally {
    restore();
  }
  t = await taskOf(postId);
  // Prompt 020: terminal failures now park at MANUAL_REVIEW via the shared
  // execution gateway (the Approvals Inbox IS the failure queue, D-30 §3);
  // the feature's later classified transition is a harmless guarded null.
  assert.equal(t.status, "MANUAL_REVIEW", "hard failure parks for the owner");
  const trail = (await eventsOf(t.task_id)).map((e) => e.to_status);
  assert.deepEqual(trail, [
    "APPROVED",
    "QUEUED",
    "EXECUTING",
    "RETRY_SCHEDULED",
    "QUEUED", // the re-claim's RETRY_SCHEDULED -> QUEUED edge
    "EXECUTING",
    "MANUAL_REVIEW",
  ]);
});

test("stale-publishing rescue records MANUAL_REVIEW (actor system:stale-rescue)", async () => {
  const postId = await insertPost({ status: "publishing" });
  const task = await makeTask(postId);
  await taskSpine.transition({ taskId: task.task_id, to: "QUEUED", actor: "system:test" });
  await taskSpine.transition({ taskId: task.task_id, to: "EXECUTING", actor: "system:test" });
  // The updated_at trigger would override a staged stale timestamp — disable
  // it while staging (test-only; the app never does this).
  await db.query("ALTER TABLE social_posts DISABLE TRIGGER trg_social_posts_updated_at");
  try {
    await db.query(
      "UPDATE social_posts SET updated_at = NOW() - INTERVAL '11 minutes' WHERE post_id = $1",
      [postId]
    );
  } finally {
    await db.query("ALTER TABLE social_posts ENABLE TRIGGER trg_social_posts_updated_at");
  }
  await socialController.publishDuePosts();
  const t = await taskOf(postId);
  assert.equal(t.status, "MANUAL_REVIEW");
  const rescueEvent = (await eventsOf(t.task_id)).find((e) => e.to_status === "MANUAL_REVIEW");
  assert.equal(rescueEvent.actor, "system:stale-rescue");
});

test("spine failure never breaks publishing (recording is best-effort)", async () => {
  const postId = await insertPost({ scheduled: "NOW() - INTERVAL '1 minute'" });
  const realTransition = taskSpine.transition;
  const realCreate = taskSpine.createTask;
  taskSpine.transition = async () => {
    throw new Error("spine down (test)");
  };
  taskSpine.createTask = async () => {
    throw new Error("spine down (test)");
  };
  const restorePublish = stubPublish(async () => ({ externalId: "fb_ok_999" }));
  try {
    const result = await socialController.publishDuePosts();
    assert.ok(result.published >= 1, "publish succeeds although the spine is down");
  } finally {
    restorePublish();
    taskSpine.transition = realTransition;
    taskSpine.createTask = realCreate;
  }
  const { rows } = await db.query(
    "SELECT status, external_post_id FROM social_posts WHERE post_id = $1",
    [postId]
  );
  assert.equal(rows[0].status, "published");
  assert.equal(rows[0].external_post_id, "fb_ok_999");
  // The scan discovers and repairs the missing trail afterwards.
  await taskSpine.scanForMissingTasks({ lookbackHours: 1 });
  const repaired = await taskOf(postId);
  assert.ok(repaired, "scan rebuilt the canonical task");
});

// --- 8. Activity endpoints ------------------------------------------------------

test("activity endpoints are read-only and ownership-scoped", async () => {
  const postId = await insertPost();
  const task = await makeTask(postId);

  // Owner sees the task.
  let res = mockRes();
  await activityController.getActivity({ user: { userId }, query: { brandId } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.tasks.some((t) => t.task_id === task.task_id));

  // A different user gets 404 for the brand and the trail.
  res = mockRes();
  await activityController.getActivity({ user: { userId: otherUserId }, query: { brandId } }, res);
  assert.equal(res.statusCode, 404);

  res = mockRes();
  await activityController.getTaskEvents(
    { user: { userId: otherUserId }, params: { taskId: task.task_id } },
    res
  );
  assert.equal(res.statusCode, 404);

  // Owner reads the full trail.
  res = mockRes();
  await activityController.getTaskEvents({ user: { userId }, params: { taskId: task.task_id } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.events.length, 1);

  // Malformed ids are clean 400s.
  res = mockRes();
  await activityController.getTaskEvents({ user: { userId }, params: { taskId: "nope" } }, res);
  assert.equal(res.statusCode, 400);
});

// --- 9. schedulePost endpoint adopter -------------------------------------------

test("schedulePost records APPROVED -> QUEUED with the owner actor", async () => {
  const res = mockRes();
  await socialController.schedulePost(
    {
      user: { userId },
      body: {
        brandId,
        platform: "facebook",
        postContent: "endpoint adopter test",
        scheduledTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    },
    res
  );
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  const postId = res.body.post.post_id;
  const task = await taskOf(postId);
  assert.ok(task);
  assert.equal(task.status, "QUEUED");
  const events = await eventsOf(task.task_id);
  assert.equal(events[0].actor, `owner:${userId}`);
  assert.deepEqual(events.map((e) => e.to_status), ["APPROVED", "QUEUED"]);
});
