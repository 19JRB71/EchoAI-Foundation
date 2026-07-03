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
  await db.query(
    `INSERT INTO campaigns (brand_id, user_id, campaign_name, budget, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [brandId, userId, "Existing Campaign", 20],
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
