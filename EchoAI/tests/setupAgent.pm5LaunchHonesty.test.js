// 026-C3-PM5 — post-launch honesty corrective (server side).
//
// Binds, against the real database and the real setup-agent recognizer:
//   R1  launch_failed + partial provider ids is NOT complete
//   R2  campaign-row existence alone is never success
//   R3  partial provider ids are never full-chain success
//   R4  MANUAL_REVIEW / failed-terminal ledger evidence never becomes
//       "already set up"
//   R5  the canonical positive fixture (full evidence chain) DOES complete
//   R6  dirty prior evidence blocks automatic re-execution
//   R7  completed_steps reconciliation removes an erroneous completion and
//       records the truthful failed/manual-review outcome
//   R8  the R7 correction preserves campaign/task/ledger evidence
//   R9  terminal provider permission failures classify provider_permission,
//       retryable false (and the campaignController predicate detects the
//       live incident shape: Graph code 200 subcode 1487194)
//   R12 mount/remount/reconcile with dirty terminal evidence causes ZERO
//       provider creation and ZERO external actions
//   R15 configuration truth and launch truth stay separate; recognition
//       never auto-executes
//   R17 the completed_steps correction is logged and idempotent
//   R18 the success recognizer requires the FULL canonical predicate —
//       every strict subset of the evidence chain is NOT complete
//
// DUPLICATE PREVENTION IS NOT SUCCESS EVIDENCE: the fixtures below make the
// two answers diverge and pin the divergence.

require("./dbGuard");

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const {
  ACTIONS,
  _facebookCampaignLaunchComplete,
  _reconcileCompletedSteps,
  _classifyStepError,
  STEP_FAILURE_TEMPLATES,
} = require("../controllers/setupAgentController");
const { isProviderPermissionError } = require("../controllers/campaignController");
const { db, createTestUser, createSetupSession, deleteUser } = require("./helpers");

const ACTION = ACTIONS.find((a) => a.key === "create_facebook_campaign");
const STEP = "create_facebook_campaign";

let userId;

before(async () => {
  userId = await createTestUser();
});

after(async () => {
  await deleteUser(userId);
  await db.pool.end();
});

async function makeBrand(name) {
  const { rows } = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, $2) RETURNING brand_id",
    [userId, name],
  );
  return rows[0].brand_id;
}

// Fixture writers — every column mirrors the REAL production writers:
// campaigns rows as facebookLaunchSafety/launchFacebookCampaign write them,
// agent_tasks as taskSpine writes them, external_actions as executeExternal
// writes them (idempotency_key `ad_launch:<campaign_id>`), external_proofs
// as externalProofs.recordExternalProof writes them (Mock-Fidelity: shapes
// verified against models/*.sql and the live staging specimen).
async function seedCampaign(brandId, { status, ids = 4 }) {
  const cols = [
    ids >= 1 ? "fb-camp-1" : null,
    ids >= 2 ? "fb-adset-1" : null,
    ids >= 3 ? "fb-creative-1" : null,
    ids >= 4 ? "fb-ad-1" : null,
  ];
  const { rows } = await db.query(
    `INSERT INTO campaigns (brand_id, user_id, campaign_name, budget, status,
        facebook_campaign_id, facebook_adset_id, facebook_creative_id, facebook_ad_id)
     VALUES ($1, $2, 'PM5 fixture', 20, $3, $4, $5, $6, $7)
     RETURNING campaign_id`,
    [brandId, userId, status, ...cols],
  );
  return rows[0].campaign_id;
}

async function seedProof(campaignId, brandId) {
  const { rows } = await db.query(
    `INSERT INTO external_proofs (run_key, provider, action, external_id, brand_id, user_id, environment, evidence)
     VALUES ($1, 'facebook', 'launch_readback', 'fb-camp-1', $2, $3, 'test', '{"effective_status":"PAUSED"}'::jsonb)
     RETURNING proof_id`,
    [`pm5-${campaignId}`, brandId, userId],
  );
  return rows[0].proof_id;
}

async function seedTask(campaignId, brandId, { status, proofId = null }) {
  const { rows } = await db.query(
    `INSERT INTO agent_tasks (brand_id, user_id, task_type, source_type, source_id, status, title, proof_id)
     VALUES ($1, $2, 'ad_launch', 'campaign', $3, $4, 'PM5 fixture launch', $5)
     RETURNING task_id`,
    [brandId, userId, String(campaignId), status, proofId],
  );
  return rows[0].task_id;
}

async function seedLedger(campaignId, brandId, { status, classification = null }) {
  await db.query(
    `INSERT INTO external_actions (idempotency_key, provider, action, brand_id, user_id, status, classification, finished_at)
     VALUES ($1, 'facebook', 'ad_launch', $2, $3, $4, $5, NOW())`,
    [`ad_launch:${campaignId}`, brandId, userId, status, classification],
  );
}

async function countRows(table, brandId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE brand_id = $1`,
    [brandId],
  );
  return rows[0].n;
}

// Replicates the LIVE SDS specimen: launch_failed, only two provider ids,
// failed/terminal ledger row, MANUAL_REVIEW task, no proof.
async function seedDirtySpecimen(brandId) {
  const campaignId = await seedCampaign(brandId, { status: "launch_failed", ids: 2 });
  await seedTask(campaignId, brandId, { status: "MANUAL_REVIEW" });
  await seedLedger(campaignId, brandId, { status: "failed", classification: "terminal" });
  return campaignId;
}

// ---------------------------------------------------------------------------
// R1 / R2 / R3 / R4 / R6 / R12 — dirty evidence is never success and never
// re-executes.
// ---------------------------------------------------------------------------

test("R1/R2/R3/R4: the live-specimen shape (launch_failed, partial ids, terminal ledger, MANUAL_REVIEW) is NOT complete and is DIRTY", async () => {
  const brandId = await makeBrand("PM5 Dirty Specimen");
  await seedDirtySpecimen(brandId);

  const evidence = await _facebookCampaignLaunchComplete(brandId);
  assert.equal(evidence.complete, false, "launch_failed + partial chain must never be complete (R1)");
  assert.equal(evidence.dirty, true, "prior attempt evidence must classify as dirty (D-40)");
});

test("R4/R6/R12: with dirty evidence the recognizer surfaces provider_manual_review and performs ZERO provider execution — across repeated runs (mount/remount)", async () => {
  const brandId = await makeBrand("PM5 Dirty NoRelaunch");
  await seedDirtySpecimen(brandId);
  const campaignsBefore = await countRows("campaigns", brandId);
  const actionsBefore = await countRows("external_actions", brandId);

  for (let i = 0; i < 2; i++) {
    let thrown = null;
    try {
      await ACTION.run({
        userId,
        session: { session_id: "pm5-s1", brand_id: brandId },
        answers: { budget: "$30/day" },
      });
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown, "dirty evidence must never return done");
    assert.equal(thrown.providerManualReview, true, "must carry the manual-review marker");
    const outcome = _classifyStepError(thrown);
    assert.equal(outcome.code, "provider_manual_review");
    assert.equal(outcome.retryable, false, "dirty terminal evidence is never retryable-as-is");
  }

  assert.equal(await countRows("campaigns", brandId), campaignsBefore, "no second local chain (R12)");
  assert.equal(await countRows("external_actions", brandId), actionsBefore, "zero new external actions (R12)");
});

test("R2: campaign-row existence alone (row with no ids, no task, no ledger) is NOT success — it is dirty prior evidence", async () => {
  const brandId = await makeBrand("PM5 BareRow");
  await seedCampaign(brandId, { status: "launch_failed", ids: 0 });
  const evidence = await _facebookCampaignLaunchComplete(brandId);
  assert.equal(evidence.complete, false);
  assert.equal(evidence.dirty, true);
});

// ---------------------------------------------------------------------------
// R5 / R18 — the FULL canonical evidence chain completes; every strict
// subset does not.
// ---------------------------------------------------------------------------

test("R5: the canonical positive fixture (success state + 4 ids + verified spine task with proof + succeeded ledger) IS complete and reports done", async () => {
  const brandId = await makeBrand("PM5 Verified");
  const campaignId = await seedCampaign(brandId, { status: "created_paused", ids: 4 });
  const proofId = await seedProof(campaignId, brandId);
  await seedTask(campaignId, brandId, { status: "EXTERNALLY_VERIFIED", proofId });
  await seedLedger(campaignId, brandId, { status: "succeeded" });

  const evidence = await _facebookCampaignLaunchComplete(brandId);
  assert.equal(evidence.complete, true, "full canonical chain must complete (R5)");

  const res = await ACTION.run({
    userId,
    session: { session_id: "pm5-s2", brand_id: brandId },
    answers: { budget: "$30/day" },
  });
  assert.equal(res.status, "done");
  assert.match(res.detail, /already set up/i);
});

test("R3/R18: EVERY strict subset of the canonical evidence chain is NOT complete", async () => {
  // Each case builds the full chain minus exactly one requirement.
  const cases = [
    {
      name: "missing one provider id (partial chain)",
      build: async (brandId) => {
        const campaignId = await seedCampaign(brandId, { status: "created_paused", ids: 3 });
        const proofId = await seedProof(campaignId, brandId);
        await seedTask(campaignId, brandId, { status: "EXTERNALLY_VERIFIED", proofId });
        await seedLedger(campaignId, brandId, { status: "succeeded" });
      },
    },
    {
      name: "campaign row not in a success state (launch_failed)",
      build: async (brandId) => {
        const campaignId = await seedCampaign(brandId, { status: "launch_failed", ids: 4 });
        const proofId = await seedProof(campaignId, brandId);
        await seedTask(campaignId, brandId, { status: "EXTERNALLY_VERIFIED", proofId });
        await seedLedger(campaignId, brandId, { status: "succeeded" });
      },
    },
    {
      name: "spine task short of EXTERNALLY_VERIFIED (PROVIDER_ACCEPTED)",
      build: async (brandId) => {
        const campaignId = await seedCampaign(brandId, { status: "created_paused", ids: 4 });
        await seedTask(campaignId, brandId, { status: "PROVIDER_ACCEPTED" });
        await seedLedger(campaignId, brandId, { status: "succeeded" });
      },
    },
    {
      name: "verified spine state but NO proof lineage (proof_id null)",
      build: async (brandId) => {
        const campaignId = await seedCampaign(brandId, { status: "created_paused", ids: 4 });
        await seedTask(campaignId, brandId, { status: "EXTERNALLY_VERIFIED", proofId: null });
        await seedLedger(campaignId, brandId, { status: "succeeded" });
      },
    },
    {
      name: "no spine task at all",
      build: async (brandId) => {
        const campaignId = await seedCampaign(brandId, { status: "created_paused", ids: 4 });
        await seedLedger(campaignId, brandId, { status: "succeeded" });
      },
    },
    {
      name: "failed/terminal ledger row (external action did not succeed)",
      build: async (brandId) => {
        const campaignId = await seedCampaign(brandId, { status: "created_paused", ids: 4 });
        const proofId = await seedProof(campaignId, brandId);
        await seedTask(campaignId, brandId, { status: "EXTERNALLY_VERIFIED", proofId });
        await seedLedger(campaignId, brandId, { status: "failed", classification: "terminal" });
      },
    },
  ];

  for (const c of cases) {
    const brandId = await makeBrand(`PM5 Subset ${c.name}`);
    await c.build(brandId);
    const evidence = await _facebookCampaignLaunchComplete(brandId);
    assert.equal(evidence.complete, false, `subset must NOT complete: ${c.name} (R18)`);
    assert.equal(evidence.dirty, true, `subset is dirty prior evidence: ${c.name}`);
  }
});

// ---------------------------------------------------------------------------
// R7 / R8 / R17 — completed_steps reconciliation.
// ---------------------------------------------------------------------------

test("R7/R8/R17: reconciliation removes the erroneous completion once, records the truthful outcome with a ref, preserves all evidence, and is idempotent", async () => {
  const brandId = await makeBrand("PM5 Reconcile");
  const campaignId = await seedDirtySpecimen(brandId);
  let session = await createSetupSession(userId);
  // Stage the live defect: the runner marked the step complete despite
  // launch_failed evidence.
  const staged = await db.query(
    `UPDATE setup_sessions
        SET brand_id = $2, completed_steps = '["create_brand_profile","create_facebook_campaign"]'::jsonb
      WHERE session_id = $1 RETURNING *`,
    [session.session_id, brandId],
  );
  session = staged.rows[0];

  // First reconciliation corrects.
  const corrected = await _reconcileCompletedSteps(session);
  assert.deepEqual(
    corrected.completed_steps,
    ["create_brand_profile"],
    "the erroneous marker is removed — other steps untouched (R7)",
  );
  const outcome = corrected.answers.step_outcomes[STEP];
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.code, "provider_manual_review");
  assert.equal(outcome.retryable, false);
  assert.equal(outcome.message, STEP_FAILURE_TEMPLATES.provider_manual_review);
  assert.ok(outcome.ref, "the correction carries a correlation ref (R17 logging)");
  assert.equal(outcome.correctedFrom, "completed_steps");

  // R8 — all evidence preserved.
  assert.equal(await countRows("campaigns", brandId), 1, "campaign row preserved");
  const camp = await db.query("SELECT status, facebook_campaign_id, facebook_adset_id FROM campaigns WHERE campaign_id = $1", [campaignId]);
  assert.equal(camp.rows[0].status, "launch_failed", "history status untouched");
  assert.equal(camp.rows[0].facebook_campaign_id, "fb-camp-1", "provider ids untouched");
  assert.equal(await countRows("external_actions", brandId), 1, "ledger preserved");
  assert.equal(await countRows("agent_tasks", brandId), 1, "task preserved");

  // R17 — second reconciliation is a stable no-op (same ref, no re-correction).
  const again = await _reconcileCompletedSteps(corrected);
  assert.deepEqual(again.completed_steps, ["create_brand_profile"]);
  assert.equal(again.answers.step_outcomes[STEP].ref, outcome.ref, "no second correction, ref stable");
  const persisted = await db.query("SELECT completed_steps, answers FROM setup_sessions WHERE session_id = $1", [session.session_id]);
  assert.deepEqual(persisted.rows[0].completed_steps, ["create_brand_profile"]);
  assert.equal(persisted.rows[0].answers.step_outcomes[STEP].ref, outcome.ref);
});

test("R7 guard: reconciliation does NOT correct when the launch evidence is genuinely complete", async () => {
  const brandId = await makeBrand("PM5 Reconcile Clean");
  const campaignId = await seedCampaign(brandId, { status: "created_paused", ids: 4 });
  const proofId = await seedProof(campaignId, brandId);
  await seedTask(campaignId, brandId, { status: "EXTERNALLY_VERIFIED", proofId });
  await seedLedger(campaignId, brandId, { status: "succeeded" });
  let session = await createSetupSession(userId);
  const staged = await db.query(
    `UPDATE setup_sessions SET brand_id = $2, completed_steps = '["create_facebook_campaign"]'::jsonb
      WHERE session_id = $1 RETURNING *`,
    [session.session_id, brandId],
  );
  const result = await _reconcileCompletedSteps(staged.rows[0]);
  assert.deepEqual(result.completed_steps, ["create_facebook_campaign"], "verified completion stays");
});

// ---------------------------------------------------------------------------
// R9 / R13 / R14 (server half) — classification.
// ---------------------------------------------------------------------------

test("R9: the live Meta rejection shape (Graph code 200, subcode 1487194) classifies provider_permission, retryable false — and never as an AI outage", () => {
  const graphErr = Object.assign(new Error("Ad account restricted — permissions error (code 200, subcode 1487194)"), {
    status: 400,
    fbCode: 200,
    fbSubcode: 1487194,
    statusCode: 500, // even with a 5xx-ish surface, the marker must win
  });
  assert.equal(isProviderPermissionError(graphErr), true);

  const marked = Object.assign(new Error("x"), { providerPermission: true, statusCode: 502 });
  const outcome = _classifyStepError(marked);
  assert.equal(outcome.code, "provider_permission", "marker beats the 5xx AI-outage branch (R10 server half)");
  assert.equal(outcome.retryable, false);
  assert.ok(
    !/AI service/i.test(STEP_FAILURE_TEMPLATES.provider_permission),
    "provider-permission copy never claims an AI outage",
  );
  assert.ok(
    !/1487194|subcode|code 200/i.test(STEP_FAILURE_TEMPLATES.provider_permission),
    "no raw provider internals in owner-facing copy",
  );
});

test("R9 negatives: ordinary failures are NOT provider-permission", () => {
  assert.equal(isProviderPermissionError(new Error("network reset")), false);
  assert.equal(isProviderPermissionError(Object.assign(new Error("Invalid parameter"), { fbCode: 100 })), false);
  assert.equal(isProviderPermissionError(null), false);
});

test("R13/R14 server half: unknown errors stay neutral (internal_error); a genuine 5xx still classifies provider_unavailable", () => {
  const unknown = _classifyStepError(new Error("boom"));
  assert.equal(unknown.code, "internal_error");
  assert.ok(!/AI service|facebook|provider/i.test(STEP_FAILURE_TEMPLATES.internal_error), "neutral copy invents no cause (R13)");
  const upstream = _classifyStepError(Object.assign(new Error("bad gateway"), { statusCode: 502 }));
  assert.equal(upstream.code, "provider_unavailable", "genuinely classified unavailability keeps its class (R14)");
});

// ---------------------------------------------------------------------------
// R15 — configuration truth vs launch truth.
// ---------------------------------------------------------------------------

test("R15: a fully CONFIGURED brand (page + destination) with no launch evidence is neither complete nor dirty — and recognition never auto-executes", async () => {
  const brandId = await makeBrand("PM5 ConfigOnly");
  await db.query(
    "UPDATE brands SET facebook_page_id = '140006069194366', ad_link_url = 'https://example.test/' WHERE brand_id = $1",
    [brandId],
  );
  const evidence = await _facebookCampaignLaunchComplete(brandId);
  assert.equal(evidence.complete, false, "configuration is never launch success (R15)");
  assert.equal(evidence.dirty, false, "configuration alone is not attempt evidence");

  // Recognition path never launches: with no Facebook integration the step
  // rests at needs_connection and creates nothing.
  const res = await ACTION.run({
    userId,
    session: { session_id: "pm5-s3", brand_id: brandId },
    answers: { budget: "$30/day" },
  });
  assert.equal(res.status, "needs_connection");
  assert.equal(await countRows("campaigns", brandId), 0, "zero provider/local creation");
  assert.equal(await countRows("external_actions", brandId), 0);
});
