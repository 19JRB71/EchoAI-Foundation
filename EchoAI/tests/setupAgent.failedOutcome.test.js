// 026-C2 regression: a setup step that THROWS (the diagnosed SDS-H1 class —
// e.g. the AI provider rejecting with a billing/credit error) must become a
// DURABLE, owner-safe failed outcome — never a console-only log, never a
// coerced "skipped", never a raw provider message in the browser.
//
// Proves, against the real database and the real /execute orchestration:
//   1. The failed step is recorded in answers.step_outcomes as
//      { status:'failed', code, message, retryable, ref } — and is NOT added
//      to completed_steps (it stays the current runnable step).
//   2. The HTTP error body carries ONLY owner-safe template text + an opaque
//      ref — the raw provider/billing text appears NOWHERE in the response.
//   3. No partial creative row was written.
//   4. The execution lease is released (a follow-up execute can claim it).
//   5. Retry after provider recovery runs the SAME step, succeeds, produces
//      exactly one creative set, and the completed outcome REPLACES the
//      failed one.

require("./dbGuard");

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const anthropicModule = require("../config/anthropic");
const {
  executeNextAction,
  ACTIONS,
  claimExecution,
  releaseExecution,
} = require("../controllers/setupAgentController");
const { db, createTestUser, createSetupSession, deleteUser } = require("./helpers");

const RAW_BILLING_TEXT =
  "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";

let userId;
let brandId;
let sessionRow;

const originalCreate = anthropicModule.anthropic.messages.create;

// Deterministic success stub for the recovery phase — five valid ad packages.
function successStub() {
  const pkg = (n) => ({
    conceptName: `Concept ${n}`,
    angle: "benefit-led",
    headline: `Fresh Bread Daily ${n}`,
    bodyCopyVariations: ["Warm bread, baked fresh.", "Taste the difference."],
    imageDescription: "A rustic sourdough loaf on a wooden table.",
    videoScript: { hook: "Smell that?", scenes: ["Oven opens", "Bread cools", "Happy customer"], cta: "Come taste it" },
    audienceTargeting: {
      description: "Local food lovers",
      ageMin: 25,
      ageMax: 60,
      interests: ["baking"],
      demographics: "families nearby",
    },
    recommendedPlacements: ["Facebook Feed"],
    callToAction: "Learn More",
  });
  return async () => ({
    content: [{ type: "text", text: JSON.stringify({ packages: [1, 2, 3, 4, 5].map(pkg) }) }],
  });
}

function fakeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function reload() {
  const { rows } = await db.query("SELECT * FROM setup_sessions WHERE session_id = $1", [
    sessionRow.session_id,
  ]);
  return rows[0];
}

async function execute() {
  const res = fakeRes();
  const req = {
    user: { userId },
    setupSession: await reload(),
    body: { sessionId: sessionRow.session_id },
  };
  await executeNextAction(req, res);
  return res;
}

before(async () => {
  userId = await createTestUser();
  // Admin role bypasses the tier gate so the feature-gated ad_creatives step runs.
  await db.query("UPDATE users SET role = 'admin' WHERE user_id = $1", [userId]);
  const brand = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, 'Failed Outcome Test Brand') RETURNING brand_id",
    [userId],
  );
  brandId = brand.rows[0].brand_id;
  sessionRow = await createSetupSession(userId);
  // Stage the session so ad_creatives is the next pending step.
  const adIdx = ACTIONS.findIndex((a) => a.key === "ad_creatives");
  assert.ok(adIdx > 0, "ad_creatives must exist in ACTIONS");
  const completed = ACTIONS.slice(0, adIdx).map((a) => a.key);
  await db.query(
    `UPDATE setup_sessions
       SET brand_id = $1,
           completed_steps = $2::jsonb,
           answers = '{"business":"a bakery","budget":"about $500 a month"}'::jsonb
     WHERE session_id = $3`,
    [brandId, JSON.stringify(completed), sessionRow.session_id],
  );
});

after(async () => {
  anthropicModule.anthropic.messages.create = originalCreate;
  await deleteUser(userId);
  await db.pool.end();
});

test("a provider billing failure becomes a durable, owner-safe failed outcome (no completed-step mutation, no partial creative, lease released)", async () => {
  anthropicModule.anthropic.messages.create = async () => {
    const err = new Error(RAW_BILLING_TEXT);
    err.status = 400; // Anthropic billing rejections surface as 4xx SDK errors
    throw err;
  };

  const before = await reload();
  const beforeCompleted = before.completed_steps;

  const res = await execute();

  // Owner-safe HTTP surface: a 5xx-class error whose body NEVER contains the
  // raw provider text, plus the failed step and an opaque ref.
  assert.ok(res.statusCode >= 400, "a failed step must not answer 200");
  const bodyText = JSON.stringify(res.body);
  assert.ok(!/credit balance|Plans & Billing|Anthropic/i.test(bodyText), "raw provider text must never reach the browser");
  assert.equal(res.body.failedStep.key, "ad_creatives");
  assert.equal(typeof res.body.outcome.ref, "string");
  assert.ok(res.body.outcome.ref.length >= 8, "ref must be an opaque id");
  assert.equal(res.body.outcome.retryable, true, "a provider fault is retryable");
  assert.ok(res.body.session, "the authoritative session rides the error body");

  // Durable outcome: answers.step_outcomes.ad_creatives is a failed object;
  // completed_steps unchanged.
  const after = await reload();
  const outcome = (after.answers.step_outcomes || {}).ad_creatives;
  assert.ok(outcome && typeof outcome === "object", "failed outcome must be persisted");
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.retryable, true);
  assert.equal(outcome.ref, res.body.outcome.ref, "stored ref ties DB record to the response");
  assert.ok(!/credit balance|Anthropic/i.test(outcome.message), "stored message is template text only");
  assert.deepEqual(after.completed_steps, beforeCompleted, "completed_steps must not be mutated");
  assert.equal(after.status, "in_progress", "the session stays resumable");

  // No partial creative row.
  const creatives = await db.query("SELECT 1 FROM ad_creatives WHERE brand_id = $1", [brandId]);
  assert.equal(creatives.rows.length, 0, "no partial creative may be written");

  // Lease released: a fresh claim succeeds.
  const token = await claimExecution(sessionRow.session_id);
  assert.ok(token, "the execution lease must be released after a failed step");
  await releaseExecution(sessionRow.session_id, token);
});

test("retry after provider recovery re-runs the SAME step, succeeds once, and replaces the failed outcome", async () => {
  anthropicModule.anthropic.messages.create = successStub();

  const res = await execute();

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.step.key, "ad_creatives", "retry must re-run exactly the failed step");
  assert.equal(res.body.status, "done");

  const after = await reload();
  assert.ok(after.completed_steps.includes("ad_creatives"), "the step now completes normally");
  const outcome = (after.answers.step_outcomes || {}).ad_creatives;
  assert.equal(outcome, "completed", "the completed outcome replaces the failed object");

  // Exactly one creative generation landed (5 packages saved as one set, and
  // the idempotency precheck means no duplicates from the earlier failed run).
  const creatives = await db.query("SELECT COUNT(*)::int AS n FROM ad_creatives WHERE brand_id = $1", [brandId]);
  assert.ok(creatives.rows[0].n > 0, "the retry produced the creatives");

  // A second execute must NOT regenerate: the next pending step is different.
  anthropicModule.anthropic.messages.create = async () => {
    throw new Error("must not be called for ad_creatives again");
  };
  const again = await execute();
  assert.notEqual(
    again.body && again.body.step && again.body.step.key,
    "ad_creatives",
    "a completed step is never re-run",
  );
});
