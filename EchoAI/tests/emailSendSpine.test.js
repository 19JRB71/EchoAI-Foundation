// Prompt 019 (D-28 §9-§10, §13; addendum) — task-spine adoption for email
// sends + the unified Approvals Inbox.
//
// Pins the binding requirements:
//  1. A manual blast runs through the ONE canonical email_send task:
//     APPROVED → QUEUED → EXECUTING (the atomic claim) → PROVIDER_ACCEPTED
//     (only with a provider Message-ID) → proof row 'send_accept'
//     (Message-IDs + counts, REFERENCED never copied, no recipient
//     addresses) → EXTERNALLY_VERIFIED (explicit message-id-only marker —
//     delivery webhooks are future work) → REPORTED → COMPLETED.
//  2. §10 gate: a "success" with no Message-ID can never reach
//     PROVIDER_ACCEPTED — it records EXTERNAL_FAILURE.
//  3. Duplicate-send regression (addendum §13), BOTH halves:
//     a) atomic-claim race: two concurrent sends → exactly one SMTP pass;
//     b) spine-write failure AFTER SMTP accept → the request still succeeds,
//        NO second email, and reconciliation rebuilds bookkeeping only
//        (zero provider calls).
//  4. Total SMTP failure → EXTERNAL_FAILURE with the provider error; the
//     campaign is not consumed.
//  5. Reconciliation (D-28 §13): sent blasts with no task get an honest
//     rebuilt trail (REPORTED via verification-unavailable — reconstruction
//     cannot invent Message-IDs); stale EXECUTING email_send tasks →
//     MANUAL_REVIEW; never a resend.
//  6. Approvals Inbox: live projection of spine MANUAL_REVIEW + adapter
//     queues, badged by class; tenant isolation; MANUAL_REVIEW resolution is
//     a recorded owner transition (I-31) — COMPLETED/CANCELLED with actor
//     owner:<userId>, system actors CANNOT complete from MANUAL_REVIEW.

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { db, createTestUser, deleteUser } = require("./helpers");

// ---- sendEmail stub (installed BEFORE the controllers bind it) -------------
const emailModule = require("../utils/email");
const realSendEmail = emailModule.sendEmail;
let sendCalls; // [{ to, subject }]
let sendBehavior; // (call) => { messageId } | throws

emailModule.sendEmail = async (opts) => {
  sendCalls.push({ to: opts.to, subject: opts.subject });
  return sendBehavior(opts);
};

const taskSpine = require("../utils/taskSpine");
const emailSendSpine = require("../utils/emailSendSpine");
const emailMarketingController = require("../controllers/emailMarketingController");
const approvalsController = require("../controllers/approvalsController");

let userId;
let brandId;
let otherUserId;
let otherBrandId;

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

async function createBlast(bId = brandId, recipients = 2) {
  const c = await db.query(
    `INSERT INTO email_marketing_campaigns (brand_id, campaign_name, campaign_type, goal, status)
     VALUES ($1, 'Spine Blast', 'one-time', 'test', 'draft') RETURNING campaign_id`,
    [bId]
  );
  const campaignId = c.rows[0].campaign_id;
  await db.query(
    `INSERT INTO email_marketing_emails (campaign_id, sequence_position, subject_line, body_html, send_delay_days)
     VALUES ($1, 0, 'Hello', '<p>Hi</p>', 0)`,
    [campaignId]
  );
  for (let i = 0; i < recipients; i += 1) {
    await db.query(
      `INSERT INTO email_marketing_recipients (campaign_id, email_address, delivery_status)
       VALUES ($1, $2, 'pending')`,
      [campaignId, `r${i}-${Date.now()}@example.test`]
    );
  }
  return campaignId;
}

async function trail(sourceType, sourceId) {
  const t = await db.query(
    `SELECT * FROM agent_tasks
      WHERE task_type = 'email_send' AND source_type = $1 AND source_id = $2
      ORDER BY attempt DESC LIMIT 1`,
    [sourceType, String(sourceId)]
  );
  const task = t.rows[0] || null;
  if (!task) return { task: null, events: [] };
  const ev = await db.query(
    `SELECT * FROM agent_task_events WHERE task_id = $1 ORDER BY created_at ASC, event_id ASC`,
    [task.task_id]
  );
  return { task, events: ev.rows };
}

before(async () => {
  userId = await createTestUser();
  otherUserId = await createTestUser();
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, 'Spine Email Brand') RETURNING brand_id",
    [userId]
  );
  brandId = b.rows[0].brand_id;
  const ob = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, 'Other Brand') RETURNING brand_id",
    [otherUserId]
  );
  otherBrandId = ob.rows[0].brand_id;
});

after(async () => {
  emailModule.sendEmail = realSendEmail;
  await deleteUser(userId).catch(() => {});
  await deleteUser(otherUserId).catch(() => {});
});

beforeEach(() => {
  sendCalls = [];
  let n = 0;
  sendBehavior = () => ({ success: true, messageId: `<mid-${Date.now()}-${(n += 1)}@test>` });
});

// ---------------------------------------------------------------------------
// 1. Happy path: full trail + proof row
// ---------------------------------------------------------------------------
test("manual blast records the full email_send trail with Message-ID proof", async () => {
  const campaignId = await createBlast();
  const res = mockRes();
  await emailMarketingController.sendCampaign(
    { user: { userId }, params: { campaignId }, headers: {}, protocol: "https" },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sent, 2);
  assert.equal(sendCalls.length, 2);

  const { task, events } = await trail("email_marketing_campaign", campaignId);
  assert.ok(task, "canonical email_send task exists");
  assert.equal(task.status, "COMPLETED");
  assert.match(task.external_ref || "", /^<mid-/);
  assert.ok(task.proof_id, "proof referenced from the task");

  const order = events.map((e) => e.to_status);
  assert.deepEqual(order, [
    "APPROVED",
    "QUEUED",
    "EXECUTING",
    "PROVIDER_ACCEPTED",
    "EXTERNALLY_VERIFIED",
    "REPORTED",
    "COMPLETED",
  ]);
  const approvedEv = events.find((e) => e.to_status === "APPROVED");
  assert.equal(approvedEv.actor, `owner:${userId}`);
  const verifiedEv = events.find((e) => e.to_status === "EXTERNALLY_VERIFIED");
  assert.equal(verifiedEv.meta.verification, "message_id_recorded");
  assert.equal(verifiedEv.meta.deliveryConfirmation, "unavailable");

  const proof = await db.query("SELECT * FROM external_proofs WHERE proof_id = $1", [task.proof_id]);
  assert.equal(proof.rows[0].action, "send_accept");
  assert.equal(proof.rows[0].provider, "email");
  const evidence = proof.rows[0].evidence;
  assert.equal(evidence.messageIds.length, 2);
  assert.equal(evidence.sentCount, 2);
  // D-23: no recipient addresses copied into evidence.
  assert.ok(!JSON.stringify(evidence).includes("@example.test"));
});

// ---------------------------------------------------------------------------
// 2. §10 gate: no Message-ID -> never PROVIDER_ACCEPTED
// ---------------------------------------------------------------------------
test("a success without a provider Message-ID cannot reach PROVIDER_ACCEPTED", async () => {
  sendBehavior = () => ({ success: true }); // provider gave no Message-ID
  const campaignId = await createBlast();
  const res = mockRes();
  await emailMarketingController.sendCampaign(
    { user: { userId }, params: { campaignId }, headers: {}, protocol: "https" },
    res
  );
  assert.equal(res.statusCode, 200); // feature-level send still succeeded
  const { task, events } = await trail("email_marketing_campaign", campaignId);
  assert.equal(task.status, "EXTERNAL_FAILURE");
  assert.ok(!events.some((e) => e.to_status === "PROVIDER_ACCEPTED"));
});

// ---------------------------------------------------------------------------
// 3a. Duplicate-send regression: atomic claim race
// ---------------------------------------------------------------------------
test("two concurrent blast sends produce exactly one SMTP pass", async () => {
  const campaignId = await createBlast();
  const r1 = mockRes();
  const r2 = mockRes();
  await Promise.all([
    emailMarketingController.sendCampaign(
      { user: { userId }, params: { campaignId }, headers: {}, protocol: "https" },
      r1
    ),
    emailMarketingController.sendCampaign(
      { user: { userId }, params: { campaignId }, headers: {}, protocol: "https" },
      r2
    ),
  ]);
  const codes = [r1.statusCode, r2.statusCode].sort();
  assert.deepEqual(codes, [200, 400], "the losing racer is refused, never re-sent");
  assert.equal(sendCalls.length, 2, "each recipient emailed exactly once");
});

// ---------------------------------------------------------------------------
// 3b. Duplicate-send regression: spine-write failure after SMTP accept
// ---------------------------------------------------------------------------
test("spine persistence failure after SMTP accept never re-sends; reconciliation rebuilds bookkeeping only", async () => {
  const campaignId = await createBlast();
  // Break the spine's success recording AFTER the provider accepted.
  const realAccepted = emailSendSpine.recordSendAccepted;
  const realTransition = taskSpine.transition;
  taskSpine.transition = async (args) => {
    if (args.to === "PROVIDER_ACCEPTED") throw new Error("spine db down");
    return realTransition(args);
  };
  let res;
  try {
    res = mockRes();
    await emailMarketingController.sendCampaign(
      { user: { userId }, params: { campaignId }, headers: {}, protocol: "https" },
      res
    );
  } finally {
    taskSpine.transition = realTransition;
    emailSendSpine.recordSendAccepted = realAccepted;
  }
  // Feature outcome unaffected; exactly one SMTP pass.
  assert.equal(res.statusCode, 200);
  assert.equal(sendCalls.length, 2);
  const camp = await db.query(
    "SELECT status FROM email_marketing_campaigns WHERE campaign_id = $1",
    [campaignId]
  );
  assert.equal(camp.rows[0].status, "sent");

  // safeSpine filed a reconciliation task for owner attention.
  const recon = await db.query(
    `SELECT * FROM agent_tasks
      WHERE task_type = 'reconciliation' AND source_id = $1`,
    [String(campaignId)]
  );
  assert.equal(recon.rows.length, 1);
  assert.equal(recon.rows[0].status, "MANUAL_REVIEW");

  // Reconciliation sweep: rebuilds trails with ZERO provider calls.
  const callsBefore = sendCalls.length;
  await taskSpine.scanForMissingTasks({ lookbackHours: 1 });
  assert.equal(sendCalls.length, callsBefore, "reconciliation never re-sends");
});

// ---------------------------------------------------------------------------
// 4. Total SMTP failure -> EXTERNAL_FAILURE
// ---------------------------------------------------------------------------
test("total SMTP failure records EXTERNAL_FAILURE with the provider error", async () => {
  sendBehavior = () => {
    throw new Error("connect ECONNREFUSED smtp");
  };
  const campaignId = await createBlast();
  const res = mockRes();
  await emailMarketingController.sendCampaign(
    { user: { userId }, params: { campaignId }, headers: {}, protocol: "https" },
    res
  );
  assert.equal(res.statusCode, 502);
  const { task } = await trail("email_marketing_campaign", campaignId);
  assert.equal(task.status, "EXTERNAL_FAILURE");
  assert.match(task.last_error, /ECONNREFUSED/);
});

// ---------------------------------------------------------------------------
// 5. Reconciliation detections
// ---------------------------------------------------------------------------
test("a sent blast with no task gets an honest rebuilt trail (no invented verification)", async () => {
  const campaignId = await createBlast(brandId, 1);
  await db.query(
    `UPDATE email_marketing_campaigns
        SET status = 'sent', sent_count = 1, sent_at = NOW(), updated_at = NOW()
      WHERE campaign_id = $1`,
    [campaignId]
  );
  const out = await taskSpine.scanForMissingTasks({ lookbackHours: 1 });
  assert.ok(out.emailBlastsRepaired >= 1);
  const { task, events } = await trail("email_marketing_campaign", campaignId);
  assert.equal(task.status, "COMPLETED");
  assert.ok(!events.some((e) => e.to_status === "EXTERNALLY_VERIFIED"));
  const reported = events.find((e) => e.to_status === "REPORTED");
  assert.equal(reported.meta.verification, "unavailable");
  assert.equal(sendCalls.length, 0, "repair never sends email");
});

test("stale EXECUTING email_send tasks are rescued to MANUAL_REVIEW", async () => {
  const taskId = await emailSendSpine.beginSend({
    brandId,
    userId,
    actor: `owner:${userId}`,
    sourceType: "email_marketing_campaign",
    sourceId: `stale-${Date.now()}`,
    title: "Stale send",
  });
  await db.query("ALTER TABLE agent_tasks DISABLE TRIGGER USER").catch(() => {});
  await db.query(
    "UPDATE agent_tasks SET updated_at = NOW() - INTERVAL '2 hours' WHERE task_id = $1",
    [taskId]
  );
  await db.query("ALTER TABLE agent_tasks ENABLE TRIGGER USER").catch(() => {});
  await taskSpine.scanForMissingTasks({ lookbackHours: 1 });
  const t = await db.query("SELECT status, last_error FROM agent_tasks WHERE task_id = $1", [taskId]);
  assert.equal(t.rows[0].status, "MANUAL_REVIEW");
  assert.match(t.rows[0].last_error, /interrupted/);
});

// ---------------------------------------------------------------------------
// 6. Approvals Inbox: aggregation, badges, tenant isolation, resolution
// ---------------------------------------------------------------------------
test("inbox aggregates spine + adapter items with class badges and tenant isolation", async () => {
  // Spine item: a MANUAL_REVIEW email task for our user.
  const mrTask = await emailSendSpine.beginSend({
    brandId,
    userId,
    actor: `owner:${userId}`,
    sourceType: "email_marketing_campaign",
    sourceId: `inbox-${Date.now()}`,
    title: "Inbox review item",
  });
  await taskSpine.transition({
    taskId: mrTask,
    to: "MANUAL_REVIEW",
    actor: "system:test",
    lastError: "needs a look",
    meta: {},
  });
  // Adapter item: a pending Company Truth report for our brand.
  await db.query(
    `INSERT INTO company_truth_reports (brand_id, version, status, plain_summary)
     VALUES ($1, 999, 'pending_approval', 'test summary')`,
    [brandId]
  );
  // Foreign items that must NOT appear.
  const foreignTask = await emailSendSpine.beginSend({
    brandId: otherBrandId,
    userId: otherUserId,
    actor: `owner:${otherUserId}`,
    sourceType: "email_marketing_campaign",
    sourceId: `foreign-${Date.now()}`,
    title: "Foreign review item",
  });
  await taskSpine.transition({
    taskId: foreignTask,
    to: "MANUAL_REVIEW",
    actor: "system:test",
    meta: {},
  });

  const res = mockRes();
  await approvalsController.getInbox({ user: { userId }, query: {} }, res);
  assert.equal(res.statusCode, 200);
  const ids = res.body.items.map((i) => i.id);
  assert.ok(ids.includes(`task:${mrTask}`));
  assert.ok(!ids.includes(`task:${foreignTask}`), "tenant isolation");
  const spineItem = res.body.items.find((i) => i.id === `task:${mrTask}`);
  assert.equal(spineItem.source, "spine");
  const truthItem = res.body.items.find((i) => i.kind === "company_truth");
  assert.ok(truthItem);
  assert.equal(truthItem.source, "adapter");
  assert.ok(Array.isArray(res.body.adapterInventory) && res.body.adapterInventory.length === 4);

  // Deterministic projection: an identical second read returns the same items.
  const res2 = mockRes();
  await approvalsController.getInbox({ user: { userId }, query: {} }, res2);
  assert.deepEqual(
    res2.body.items.map((i) => i.id),
    res.body.items.map((i) => i.id)
  );

  // Resolution: foreign owner cannot touch our task.
  const deny = mockRes();
  await approvalsController.resolveTask(
    { user: { userId: otherUserId }, params: { taskId: mrTask }, body: { resolution: "dismiss" } },
    deny
  );
  assert.equal(deny.statusCode, 404);

  // Owner resolution is a recorded spine transition (I-31).
  const ok = mockRes();
  await approvalsController.resolveTask(
    {
      user: { userId },
      params: { taskId: mrTask },
      body: { resolution: "confirm_handled", note: "checked mailbox" },
    },
    ok
  );
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.status, "COMPLETED");
  const ev = await db.query(
    `SELECT * FROM agent_task_events WHERE task_id = $1 AND to_status = 'COMPLETED'`,
    [mrTask]
  );
  assert.equal(ev.rows[0].actor, `owner:${userId}`);
  assert.equal(ev.rows[0].meta.resolution, "confirm_handled");
  assert.equal(ev.rows[0].from_status, "MANUAL_REVIEW");

  // Double resolution loses the race honestly.
  const again = mockRes();
  await approvalsController.resolveTask(
    { user: { userId }, params: { taskId: mrTask }, body: { resolution: "dismiss" } },
    again
  );
  assert.equal(again.statusCode, 409);

  await db.query("DELETE FROM company_truth_reports WHERE brand_id = $1 AND version = 999", [brandId]);
});

test("system actors cannot complete from MANUAL_REVIEW; owner dismiss cancels", async () => {
  const t1 = await emailSendSpine.beginSend({
    brandId,
    userId,
    actor: `owner:${userId}`,
    sourceType: "email_marketing_campaign",
    sourceId: `edges-${Date.now()}`,
    title: "Edge case task",
  });
  await taskSpine.transition({ taskId: t1, to: "MANUAL_REVIEW", actor: "system:test", meta: {} });

  // Illegal: a system actor may not use the owner-resolution edge.
  const denied = await taskSpine.transition({
    taskId: t1,
    to: "COMPLETED",
    actor: "system:sweeper",
    meta: {},
  });
  assert.equal(denied, null);

  // Owner dismiss -> CANCELLED, recorded.
  const row = await taskSpine.transition({
    taskId: t1,
    to: "CANCELLED",
    actor: `owner:${userId}`,
    meta: { resolution: "dismiss", via: "approvals_inbox" },
  });
  assert.equal(row.status, "CANCELLED");
});
