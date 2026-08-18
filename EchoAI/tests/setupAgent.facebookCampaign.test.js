// Task: the Setup Agent should create the user's first Facebook ad campaign as
// part of "Yes, set up my account", wired into the real campaign controller.
//
// The happy path issues live Facebook Graph API calls (covered by the campaign
// controller's own tests / manual verification), so here we pin the parts that
// must hold without touching Facebook:
//  - the step appears in the checklist with the exact user-facing label,
//  - it is a baseline (non-gated) step so every paid plan runs it,
//  - with NO connected Facebook account it hands off to Facebook OAuth inside
//    the setup flow (needs_connection, never fakes a campaign, never fails the
//    whole setup),
//  - it is idempotent: if the brand already has a campaign it reports done
//    without creating a duplicate.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { ACTIONS } = require("../controllers/setupAgentController");
const { db, createTestUser, deleteUser } = require("./helpers");

const ACTION = ACTIONS.find((a) => a.key === "create_facebook_campaign");

let userId;
let brandId;

before(async () => {
  userId = await createTestUser();
  const { rows } = await db.query(
    `INSERT INTO brands (user_id, brand_name) VALUES ($1, $2) RETURNING brand_id`,
    [userId, "Blacor Homes"],
  );
  brandId = rows[0].brand_id;
});

after(async () => {
  await deleteUser(userId);
  await db.pool.end();
});

test("the step exists with the exact checklist label and is baseline (non-gated)", () => {
  assert.ok(ACTION, "create_facebook_campaign action must be registered");
  assert.equal(ACTION.label, "Creating your first Facebook ad campaign");
  assert.equal(ACTION.feature, null, "campaign creation runs on every paid plan");
});

test("hands off to Facebook OAuth when no Facebook ad account is connected", async () => {
  const res = await ACTION.run({
    userId,
    session: { session_id: "s1", brand_id: brandId },
    answers: { budget: "$30/day" },
  });
  assert.equal(res.status, "needs_connection");
  assert.equal(res.connect, "facebook", "must point the client at the Facebook OAuth handoff");
  assert.match(res.detail, /connect your facebook/i);

  // Nothing was created — the campaign only launches after the connection.
  const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM campaigns WHERE brand_id = $1", [
    brandId,
  ]);
  assert.equal(rows[0].n, 0, "a needs_connection step must not create a campaign");
});

test("skips when there is no brand yet", async () => {
  const res = await ACTION.run({ userId, session: { session_id: "s1", brand_id: null }, answers: {} });
  assert.equal(res.status, "skipped");
  assert.match(res.detail, /no brand/i);
});

test("idempotent: reports done without duplicating when a campaign already exists", async () => {
  // 026-C3-PM5 fixture correction (D-32 disclosure, no assertion weakened):
  //   OLD fixture: a 'created_paused' row with NO provider ids, no spine
  //   task, no ledger — a shape the real success writer never produces
  //   (launchFacebookCampaign persists all four Graph ids, the ad_launch
  //   spine task reaches EXTERNALLY_VERIFIED with a proof row, and the
  //   executeExternal ledger records 'succeeded').
  //   REAL shape: verified via the staging specimen and utils/adLaunchSpine —
  //   success rows always carry the full id chain + verified task + proof.
  //   CORRECTED: the fixture now seeds the full canonical evidence chain, so
  //   this test keeps binding the true behavior ("a genuinely completed
  //   launch reports done and never duplicates") under the PM5 canonical
  //   success predicate; the old id-less shape is now (correctly) treated as
  //   dirty failed-attempt evidence and is bound separately in
  //   tests/setupAgent.pm5LaunchHonesty.test.js.
  const inserted = await db.query(
    `INSERT INTO campaigns (brand_id, user_id, campaign_name, budget, status,
        facebook_campaign_id, facebook_adset_id, facebook_creative_id, facebook_ad_id)
     VALUES ($1, $2, $3, $4, 'created_paused', 'fb-camp-x', 'fb-adset-x', 'fb-creative-x', 'fb-ad-x')
     RETURNING campaign_id`,
    [brandId, userId, "Existing Campaign", 20],
  );
  const campaignId = inserted.rows[0].campaign_id;
  const proof = await db.query(
    `INSERT INTO external_proofs (run_key, provider, action, external_id, brand_id, user_id, environment, evidence)
     VALUES ($1, 'facebook', 'launch_readback', 'fb-camp-x', $2, $3, 'test', '{"effective_status":"PAUSED"}'::jsonb)
     RETURNING proof_id`,
    [`fbcamp-idem-${campaignId}`, brandId, userId],
  );
  await db.query(
    `INSERT INTO agent_tasks (brand_id, user_id, task_type, source_type, source_id, status, title, proof_id)
     VALUES ($1, $2, 'ad_launch', 'campaign', $3, 'EXTERNALLY_VERIFIED', 'Existing launch', $4)`,
    [brandId, userId, String(campaignId), proof.rows[0].proof_id],
  );
  await db.query(
    `INSERT INTO external_actions (idempotency_key, provider, action, brand_id, user_id, status, finished_at)
     VALUES ($1, 'facebook', 'ad_launch', $2, $3, 'succeeded', NOW())`,
    [`ad_launch:${campaignId}`, brandId, userId],
  );

  const res = await ACTION.run({
    userId,
    session: { session_id: "s1", brand_id: brandId },
    answers: { budget: "$30/day" },
  });
  assert.equal(res.status, "done");
  assert.match(res.detail, /already set up/i);

  const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM campaigns WHERE brand_id = $1", [
    brandId,
  ]);
  assert.equal(rows[0].n, 1, "idempotent path must not create a second campaign");
});
