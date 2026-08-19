// 026-C3-PM6 — failed/manual-review owner deferral semantics (server).
require("./dbGuard");

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const setupAgent = require("../controllers/setupAgentController");
const { db, createTestUser, createSetupSession, deleteUser } = require("./helpers");

const STEP = "create_facebook_campaign";
const ORIGINAL = {
  status: "failed",
  code: "provider_manual_review",
  message: "The partial launch needs manual review.",
  retryable: false,
  ref: "original-correlation-ref",
  at: "2026-08-19T14:38:15.312Z",
  correctedFrom: "completed_steps",
  nestedEvidence: { preserved: true },
};

let userId;

before(async () => {
  userId = await createTestUser();
  await db.query("UPDATE users SET role = 'admin' WHERE user_id = $1", [userId]);
});

after(async () => {
  await deleteUser(userId);
  await db.pool.end();
});

async function makeDirtyBrand(name) {
  const brand = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, $2) RETURNING brand_id",
    [userId, name],
  );
  const brandId = brand.rows[0].brand_id;
  const campaign = await db.query(
    `INSERT INTO campaigns
       (brand_id,user_id,campaign_name,budget,status,facebook_campaign_id,facebook_adset_id)
     VALUES ($1,$2,'PM6 partial chain',20,'launch_failed','fb-campaign','fb-adset')
     RETURNING campaign_id`,
    [brandId, userId],
  );
  const campaignId = campaign.rows[0].campaign_id;
  await db.query(
    `INSERT INTO agent_tasks
       (brand_id,user_id,task_type,source_type,source_id,status,title)
     VALUES ($1,$2,'ad_launch','campaign',$3,'MANUAL_REVIEW','PM6 launch')`,
    [brandId, userId, String(campaignId)],
  );
  await db.query(
    `INSERT INTO external_actions
       (idempotency_key,provider,action,brand_id,user_id,status,classification,finished_at)
     VALUES ($1,'facebook','ad_launch',$2,$3,'failed','terminal',NOW())`,
    [`ad_launch:${campaignId}`, brandId, userId],
  );
  return brandId;
}

async function stageSession({ brandId = null, nextKey = STEP, outcome = null, completed = false }) {
  const session = await createSetupSession(userId);
  const index = setupAgent.ACTIONS.findIndex((a) => a.key === nextKey);
  const prior = setupAgent.ACTIONS.slice(0, index).map((a) => a.key);
  if (completed) prior.push(nextKey);
  const stepOutcomes = outcome ? { [nextKey]: outcome } : {};
  const { rows } = await db.query(
    `UPDATE setup_sessions
        SET brand_id=$2, interview_complete=TRUE, consent_granted=TRUE,
            completed_steps=$3::jsonb,
            answers=jsonb_build_object('step_outcomes',$4::jsonb)
      WHERE session_id=$1 RETURNING *`,
    [session.session_id, brandId, JSON.stringify(prior), JSON.stringify(stepOutcomes)],
  );
  return rows[0];
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function execute(sessionId, skip) {
  const current = await db.query("SELECT * FROM setup_sessions WHERE session_id=$1", [sessionId]);
  const res = fakeRes();
  await setupAgent.executeNextAction(
    { user: { userId }, setupSession: current.rows[0], body: { sessionId, skip } },
    res,
  );
  return res;
}

test("R1/R2/R3/R5/R6: owner deferral enriches in place, preserves the full failure, survives reconciliation, and is never rerun", async () => {
  const brandId = await makeDirtyBrand("PM6 enriched deferral");
  const session = await stageSession({ brandId, outcome: ORIGINAL });
  const beforeCounts = await db.query(
    `SELECT
       (SELECT row_to_json(c) FROM
          (SELECT status,budget,facebook_campaign_id,facebook_adset_id FROM campaigns WHERE brand_id=$1) c) campaign,
       (SELECT COUNT(*) FROM campaigns WHERE brand_id=$1)::int campaigns,
       (SELECT COUNT(*) FROM external_actions WHERE brand_id=$1)::int actions,
       (SELECT COUNT(*) FROM agent_tasks WHERE brand_id=$1)::int tasks`,
    [brandId],
  );

  const res = await execute(session.session_id, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, "deferred");
  const row = await db.query("SELECT * FROM setup_sessions WHERE session_id=$1", [session.session_id]);
  const persisted = row.rows[0];
  const enriched = persisted.answers.step_outcomes[STEP];
  assert.ok(persisted.completed_steps.includes(STEP), "terminal for runner purposes");
  for (const [key, value] of Object.entries(ORIGINAL)) {
    assert.deepEqual(enriched[key], value, `original field ${key} must survive byte-for-byte`);
  }
  assert.deepEqual(
    Object.keys(enriched).filter((key) => !(key in ORIGINAL)).sort(),
    ["deferred_at", "deferred_reason", "journey_disposition", "owner_directed"],
  );
  assert.equal(enriched.journey_disposition, "deferred");
  assert.equal(enriched.deferred_reason, "pending_provider_review");
  assert.equal(enriched.owner_directed, true);
  assert.ok(Number.isFinite(Date.parse(enriched.deferred_at)));
  assert.equal(enriched.ref, ORIGINAL.ref, "no new correlation ref");

  const reconciled = await setupAgent._reconcileCompletedSteps(persisted);
  assert.ok(reconciled.completed_steps.includes(STEP), "valid deferral survives PM5 reconciliation");
  assert.deepEqual(reconciled.answers.step_outcomes[STEP], enriched);

  const campaignAction = setupAgent.ACTIONS.find((a) => a.key === STEP);
  const nextAction = setupAgent.ACTIONS[setupAgent.ACTIONS.findIndex((a) => a.key === STEP) + 1];
  const originalCampaignRun = campaignAction.run;
  const originalNextRun = nextAction.run;
  let campaignRuns = 0;
  campaignAction.run = async () => { campaignRuns += 1; throw new Error("must not rerun"); };
  nextAction.run = async () => ({ status: "skipped", detail: "PM6 next-step sentinel" });
  try {
    const again = await execute(session.session_id, false);
    assert.equal(again.body.step.key, nextAction.key);
    assert.equal(campaignRuns, 0, "deferred campaign is never automatically rerun");
  } finally {
    campaignAction.run = originalCampaignRun;
    nextAction.run = originalNextRun;
  }

  const afterCounts = await db.query(
    `SELECT
       (SELECT row_to_json(c) FROM
          (SELECT status,budget,facebook_campaign_id,facebook_adset_id FROM campaigns WHERE brand_id=$1) c) campaign,
       (SELECT COUNT(*) FROM campaigns WHERE brand_id=$1)::int campaigns,
       (SELECT COUNT(*) FROM external_actions WHERE brand_id=$1)::int actions,
       (SELECT COUNT(*) FROM agent_tasks WHERE brand_id=$1)::int tasks`,
    [brandId],
  );
  assert.deepEqual(afterCounts.rows[0], beforeCounts.rows[0], "zero provider/evidence path delta");
});

test("R4: PM5 still strips false completion when no valid owner-directed deferral exists", async () => {
  const brandId = await makeDirtyBrand("PM6 false completion");
  const session = await stageSession({ brandId, outcome: ORIGINAL, completed: true });
  const corrected = await setupAgent._reconcileCompletedSteps(session);
  assert.ok(!corrected.completed_steps.includes(STEP));
  assert.equal(corrected.answers.step_outcomes[STEP].code, "provider_manual_review");
  assert.notEqual(corrected.answers.step_outcomes[STEP].ref, ORIGINAL.ref);
});

test("R7: ordinary pre-attempt Skip keeps the existing string outcome", async () => {
  const session = await stageSession({ nextKey: "setup_google_ads" });
  const res = await execute(session.session_id, true);
  assert.equal(res.body.status, "skipped");
  const row = await db.query("SELECT completed_steps,answers FROM setup_sessions WHERE session_id=$1", [session.session_id]);
  assert.ok(row.rows[0].completed_steps.includes("setup_google_ads"));
  assert.equal(row.rows[0].answers.step_outcomes.setup_google_ads, "skipped");
});

test("R10: all six outcome states remain distinguishable", () => {
  const deferred = setupAgent._enrichOwnerDirectedDeferral(ORIGINAL, "2026-08-19T20:00:00.000Z");
  const cases = [
    ["never_attempted", false, null, false],
    ["skipped_before_attempt", true, "skipped", false],
    ["succeeded", true, "completed", false],
    ["failed_retryable", false, { ...ORIGINAL, retryable: true }, false],
    ["failed_manual_review", false, ORIGINAL, false],
    ["failed_then_deferred", true, deferred, true],
  ];
  const signatures = cases.map(([name, completed, outcome, valid]) => {
    assert.equal(setupAgent._isValidOwnerDirectedDeferral(outcome), valid, name);
    return JSON.stringify([
      completed,
      typeof outcome,
      typeof outcome === "string" ? outcome : outcome && outcome.status,
      outcome && outcome.retryable,
      valid,
    ]);
  });
  assert.equal(new Set(signatures).size, cases.length, "no state aliases another");
});