// Task: the Setup Agent should set up a Google Ads campaign plan when — and only
// when — the user opts in to Google ads during the interview, using the real AI
// keyword generator (never mocked). The interview also captures a monthly
// advertising budget that sizes the first Facebook campaign so it never exceeds
// what the user specified.
//
// The opted-in happy path issues a live Anthropic keyword call (covered by the
// SEO controller's own tests / manual verification), so here we pin the parts
// that must hold without touching Anthropic:
//  - the step appears in the checklist with the exact user-facing label,
//  - it is a baseline (non-gated) step so every paid plan runs it,
//  - it skips gracefully when the user did NOT opt in,
//  - it skips when there is no brand yet,
//  - it is idempotent: if the brand already has a plan it reports done without
//    regenerating (and so without calling the AI),
//  - the budget helpers derive a monthly ceiling + a daily figure that, over a
//    ~30-day month, never exceeds that ceiling.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  ACTIONS,
  pickAdBudget,
  pickMonthlyAdBudget,
  wantsGoogleAds,
} = require("../controllers/setupAgentController");
const { db, createTestUser, deleteUser } = require("./helpers");

const ACTION = ACTIONS.find((a) => a.key === "setup_google_ads");

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
  await db.query("DELETE FROM google_ad_plans WHERE brand_id = $1", [brandId]);
  await deleteUser(userId);
  await db.pool.end();
});

test("the step exists with the exact checklist label and is baseline (non-gated)", () => {
  assert.ok(ACTION, "setup_google_ads action must be registered");
  assert.equal(ACTION.label, "Setting up your Google Ads campaign");
  assert.equal(ACTION.feature, null, "Google Ads setup runs on every paid plan");
});

test("skips gracefully when the user did not opt in to Google ads", async () => {
  const res = await ACTION.run({
    userId,
    session: { session_id: "s1", brand_id: brandId },
    answers: { google_ads: "No thanks, not right now." },
  });
  assert.equal(res.status, "skipped");
  assert.match(res.detail, /google ads/i);

  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS n FROM google_ad_plans WHERE brand_id = $1",
    [brandId],
  );
  assert.equal(rows[0].n, 0, "a skipped step must not create a plan");
});

test("skips when there is no brand yet", async () => {
  const res = await ACTION.run({
    userId,
    session: { session_id: "s2", brand_id: null },
    answers: { google_ads: "Yes please" },
  });
  assert.equal(res.status, "skipped");
  assert.match(res.detail, /no brand/i);
});

test("is idempotent: reports done without regenerating when a plan exists", async () => {
  // Pre-insert a plan so the idempotency guard short-circuits BEFORE any AI call.
  await db.query(
    `INSERT INTO google_ad_plans (brand_id, location, monthly_budget, keywords, status)
     VALUES ($1, $2, $3, $4, 'draft')
     ON CONFLICT (brand_id) DO NOTHING`,
    [brandId, "Florida", 1500, JSON.stringify([{ keyword: "home kits florida", volume: "high", intent: "commercial" }])],
  );

  const res = await ACTION.run({
    userId,
    session: { session_id: "s3", brand_id: brandId },
    answers: { google_ads: "Yes please", advertising_budget: "$1500+ per month" },
  });
  assert.equal(res.status, "done");
  assert.match(res.detail, /already set up/i);

  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS n FROM google_ad_plans WHERE brand_id = $1",
    [brandId],
  );
  assert.equal(rows[0].n, 1, "idempotent step must not create a duplicate plan");
});

test("wantsGoogleAds only accepts an explicit affirmative", () => {
  assert.equal(wantsGoogleAds({ google_ads: "Yes please" }), true);
  assert.equal(wantsGoogleAds({ google_ads: "Sure, sounds good" }), true);
  assert.equal(wantsGoogleAds({ google_ads: "No thanks" }), false);
  assert.equal(wantsGoogleAds({ google_ads: "Maybe later" }), false);
  assert.equal(wantsGoogleAds({}), false);
});

test("budget helpers derive a monthly ceiling and a daily figure within it", () => {
  // Range answers resolve to the TOP of the range as the monthly ceiling.
  assert.equal(pickMonthlyAdBudget({ advertising_budget: "$200–$500/month" }), 500);
  assert.equal(pickMonthlyAdBudget({ advertising_budget: "$500-$1500 per month" }), 1500);
  assert.equal(pickMonthlyAdBudget({ advertising_budget: "$1500+ per month" }), 1500);
  // A per-day figure scales up to a ~30-day monthly ceiling.
  assert.equal(pickMonthlyAdBudget({ advertising_budget: "$30/day" }), 900);
  // Nothing usable → null (monthly) / conservative $20/day fallback.
  assert.equal(pickMonthlyAdBudget({}), null);
  assert.equal(pickAdBudget({}), 20);

  // The daily figure, spent for ~30 days, never exceeds the monthly ceiling.
  for (const answer of ["$200–$500/month", "$500-$1500 per month", "$1500+ per month"]) {
    const monthly = pickMonthlyAdBudget({ advertising_budget: answer });
    const daily = pickAdBudget({ advertising_budget: answer });
    assert.ok(daily >= 1, `daily budget must be at least $1 for "${answer}"`);
    assert.ok(daily * 30 <= monthly, `daily×30 ($${daily * 30}) must stay within $${monthly} for "${answer}"`);
  }
});
