/**
 * Tenant-isolation regression suite (REPLIT_PROMPT_014).
 *
 * A dedicated, controller-level suite that probes each owned-resource surface
 * by DIRECT id across a tenant boundary. Two full tenants are seeded (user A +
 * brand A with its own campaign / lead / scheduled post / ad creative, and the
 * same for user B). For every surface we assert:
 *
 *   1. Tenant A reading/updating A's OWN resource works (the happy path — so a
 *      cross-tenant 404 is meaningful and not a blanket failure).
 *   2. Tenant A probing B's resource by direct id gets 403 or 404 (or an empty
 *      list for list endpoints), and the response body NEVER contains B's data.
 *
 * Surfaces covered (controller-level, mockRes pattern):
 *   - brands:       getBrandProfile, updateBrand
 *   - campaigns:    createCampaign (create under foreign brand),
 *                   getCampaignPerformance (brandId-scoped read)
 *   - leads:        getLeads (brandId=B), convertLead (lead-by-id path)
 *   - social_posts: reschedulePost, publishPostNow (JOIN brands on user_id)
 *   - ad_creatives: getCreativeLibrary (brandId), launchCreative (creative-by-id)
 *
 * This file makes NO application-code changes. If a surface leaked B's data it
 * would be reported as a defect (see the summary in the delegating agent's
 * report); as written every surface isolates correctly.
 *
 * Run with:
 *   node --require ./tests/dbGuard.js --test tests/tenantIsolation.core.test.js
 */
const test = require("node:test");
const assert = require("node:assert");

require("./dbGuard");
const db = require("../config/db");

const brandController = require("../controllers/brandController");
const campaignController = require("../controllers/campaignController");
const leadController = require("../controllers/leadController");
const socialController = require("../controllers/socialController");
const adStudioController = require("../controllers/adCreativeStudioController");

// --- helpers -----------------------------------------------------------------

function mockRes() {
  const res = {
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
  return res;
}

/**
 * Serializes a controller's JSON body and asserts none of the tenant's secret
 * markers appear anywhere in it. This is the core cross-tenant leak assertion.
 */
function assertNoLeak(res, secrets) {
  const blob = JSON.stringify(res.body || {});
  for (const secret of secrets) {
    assert.ok(
      !blob.includes(secret),
      `cross-tenant leak: response body contained "${secret}" -> ${blob}`
    );
  }
}

let seq = 0;
function uniq(prefix) {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Seeds a complete tenant: user + brand + one campaign, one lead, one scheduled
 * social post, and one draft ad creative. All markers carry the tenant tag so a
 * leak into the other tenant's response is unambiguous.
 */
async function seedTenant(tag) {
  const email = `${uniq("tenant-iso-" + tag)}@example.test`;
  const u = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING user_id",
    [email, "test-not-a-real-hash"]
  );
  const userId = u.rows[0].user_id;

  const brandName = `Tenant ${tag} Brand ${uniq("bn")}`;
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name, voice_description) VALUES ($1, $2, $3) RETURNING brand_id",
    [userId, brandName, `voice-secret-${tag}`]
  );
  const brandId = b.rows[0].brand_id;

  const campaignName = `Campaign-secret-${tag}-${uniq("c")}`;
  const c = await db.query(
    `INSERT INTO campaigns (brand_id, user_id, campaign_name, budget, status, facebook_campaign_id)
     VALUES ($1, $2, $3, $4, 'created_paused', $5)
     RETURNING campaign_id`,
    [brandId, userId, campaignName, 50, `fbcamp-secret-${tag}`]
  );
  const campaignId = c.rows[0].campaign_id;

  const leadName = `Lead-secret-${tag}-${uniq("l")}`;
  const lead = await db.query(
    "INSERT INTO leads (brand_id, lead_name, email) VALUES ($1, $2, $3) RETURNING lead_id",
    [brandId, leadName, `lead-${tag}@example.test`]
  );
  const leadId = lead.rows[0].lead_id;

  const postContent = `Post-secret-${tag}-${uniq("p")}`;
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  // Seed one 'scheduled' post (for publishPostNow) and one 'failed' post (for
  // reschedulePost, which only acts on the failed->scheduled transition).
  const scheduled = await db.query(
    `INSERT INTO social_posts (brand_id, platform, post_content, scheduled_time, status)
     VALUES ($1, 'facebook', $2, $3, 'scheduled') RETURNING post_id`,
    [brandId, postContent, future]
  );
  const scheduledPostId = scheduled.rows[0].post_id;

  const failedContent = `FailedPost-secret-${tag}-${uniq("fp")}`;
  const failed = await db.query(
    `INSERT INTO social_posts (brand_id, platform, post_content, scheduled_time, status)
     VALUES ($1, 'facebook', $2, $3, 'failed') RETURNING post_id`,
    [brandId, failedContent, future]
  );
  const failedPostId = failed.rows[0].post_id;

  const creativeGoal = "lead_generation";
  const concept = {
    packages: [
      {
        conceptName: `Creative-secret-${tag}`,
        angle: `angle-secret-${tag}`,
        headline: `headline-secret-${tag}`,
        cta: "Learn More",
      },
    ],
    budgetRange: null,
    productFocus: null,
  };
  const creative = await db.query(
    `INSERT INTO ad_creatives (brand_id, campaign_goal, creative_concept, status)
     VALUES ($1, $2, $3, 'draft') RETURNING creative_id`,
    [brandId, creativeGoal, JSON.stringify(concept)]
  );
  const creativeId = creative.rows[0].creative_id;

  return {
    tag,
    userId,
    brandId,
    brandName,
    campaignId,
    campaignName,
    leadId,
    leadName,
    scheduledPostId,
    failedPostId,
    postContent,
    failedContent,
    creativeId,
    // Every string that uniquely identifies this tenant's data. Used to prove
    // it never surfaces in the OTHER tenant's responses.
    secrets: [
      brandName,
      `voice-secret-${tag}`,
      campaignName,
      `fbcamp-secret-${tag}`,
      leadName,
      postContent,
      failedContent,
      `Creative-secret-${tag}`,
      `headline-secret-${tag}`,
    ],
  };
}

async function destroyTenant(t) {
  if (!t) return;
  // FK order: children before parents. leads/campaigns/social_posts/ad_creatives
  // all cascade off brands, but we delete explicitly for clarity + speed.
  await db.query("DELETE FROM crm_interactions WHERE lead_id = $1", [t.leadId]);
  await db.query("DELETE FROM ad_creatives WHERE brand_id = $1", [t.brandId]);
  await db.query("DELETE FROM social_posts WHERE brand_id = $1", [t.brandId]);
  await db.query("DELETE FROM leads WHERE brand_id = $1", [t.brandId]);
  await db.query("DELETE FROM campaigns WHERE brand_id = $1", [t.brandId]);
  await db.query("DELETE FROM brands WHERE brand_id = $1", [t.brandId]);
  await db.query("DELETE FROM users WHERE user_id = $1", [t.userId]);
}

// Two tenants shared across the whole suite. Seeded once, torn down once.
let A;
let B;

test.before(async () => {
  A = await seedTenant("A");
  B = await seedTenant("B");
});

test.after(async () => {
  await destroyTenant(A);
  await destroyTenant(B);
});

// --- brands ------------------------------------------------------------------

test("brands: getBrandProfile — A reads A (happy), A probing B's brand_id is 404 with no leak", async () => {
  // Happy path.
  let res = mockRes();
  await brandController.getBrandProfile(
    { user: { userId: A.userId }, params: { brandId: A.brandId } },
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.brand_id, A.brandId);

  // Cross-tenant probe: A asks for B's brand by direct id.
  res = mockRes();
  await brandController.getBrandProfile(
    { user: { userId: A.userId }, params: { brandId: B.brandId } },
    res
  );
  assert.strictEqual(res.statusCode, 404);
  assertNoLeak(res, B.secrets);
});

test("brands: updateBrand — A updates A (happy), A updating B's brand_id is 404 with no leak", async () => {
  // Happy path.
  let res = mockRes();
  await brandController.updateBrand(
    {
      user: { userId: A.userId },
      params: { brandId: A.brandId },
      body: { voiceDescription: "voice-secret-A" },
    },
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.brand_id, A.brandId);

  // Cross-tenant probe: A tries to overwrite B's brand voice.
  res = mockRes();
  await brandController.updateBrand(
    {
      user: { userId: A.userId },
      params: { brandId: B.brandId },
      body: { voiceDescription: "pwned-by-A" },
    },
    res
  );
  assert.strictEqual(res.statusCode, 404);
  assertNoLeak(res, B.secrets);

  // And B's row is untouched.
  const check = await db.query(
    "SELECT voice_description FROM brands WHERE brand_id = $1",
    [B.brandId]
  );
  assert.strictEqual(check.rows[0].voice_description, "voice-secret-B");
});

// --- campaigns ---------------------------------------------------------------

test("campaigns: getCampaignPerformance — A reads A's brand (happy), A probing B's brand_id returns empty, no leak", async () => {
  // Happy path: A sees A's own active campaign.
  let res = mockRes();
  await campaignController.getCampaignPerformance(
    { user: { userId: A.userId }, query: { brandId: A.brandId } },
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.campaigns.some((c) => c.name === A.campaignName));

  // Cross-tenant probe: A queries B's brand_id. Ownership JOIN yields nothing.
  res = mockRes();
  await campaignController.getCampaignPerformance(
    { user: { userId: A.userId }, query: { brandId: B.brandId } },
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.count, 0);
  assert.deepStrictEqual(res.body.campaigns, []);
  assertNoLeak(res, B.secrets);
});

test("campaigns: createCampaign under B's brand_id (as A) is 404 and creates nothing for B", async () => {
  const before = await db.query(
    "SELECT COUNT(*)::int AS n FROM campaigns WHERE brand_id = $1",
    [B.brandId]
  );

  const res = mockRes();
  await campaignController.createCampaign(
    {
      user: { userId: A.userId },
      body: { brandId: B.brandId, goal: "lead_generation", budget: 25, name: "sneaky" },
    },
    res
  );
  assert.strictEqual(res.statusCode, 404);
  assertNoLeak(res, B.secrets);

  const after = await db.query(
    "SELECT COUNT(*)::int AS n FROM campaigns WHERE brand_id = $1",
    [B.brandId]
  );
  assert.strictEqual(after.rows[0].n, before.rows[0].n);
});

// --- leads -------------------------------------------------------------------

test("leads: getLeads — A lists A's brand (happy), A probing B's brand_id is 404 with no leak", async () => {
  // Happy path.
  let res = mockRes();
  await leadController.getLeads(
    { user: { userId: A.userId }, query: { brandId: A.brandId } },
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.leads.some((l) => l.lead_name === A.leadName));

  // Cross-tenant probe: A lists B's brand_id.
  res = mockRes();
  await leadController.getLeads(
    { user: { userId: A.userId }, query: { brandId: B.brandId } },
    res
  );
  assert.strictEqual(res.statusCode, 404);
  assertNoLeak(res, B.secrets);
});

test("leads: convertLead (lead-by-id) — A converts A's lead (happy), A converting B's lead_id is 404 and B's lead untouched", async () => {
  // Happy path: A converts A's own lead.
  let res = mockRes();
  await leadController.convertLead(
    { user: { userId: A.userId }, params: { leadId: A.leadId }, body: {} },
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.lead.lead_id, A.leadId);
  assert.strictEqual(res.body.lead.conversion_status, "converted");

  // Cross-tenant probe: A converts B's lead by direct id.
  res = mockRes();
  await leadController.convertLead(
    { user: { userId: A.userId }, params: { leadId: B.leadId }, body: {} },
    res
  );
  assert.strictEqual(res.statusCode, 404);
  assertNoLeak(res, B.secrets);

  // B's lead never flipped to converted.
  const check = await db.query(
    "SELECT conversion_status FROM leads WHERE lead_id = $1",
    [B.leadId]
  );
  assert.notStrictEqual(check.rows[0].conversion_status, "converted");
});

// --- social_posts ------------------------------------------------------------

test("social: reschedulePost (post-by-id) — A reschedules A's failed post (happy), A probing B's post_id is 404 and B untouched", async () => {
  const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  // Happy path: A reschedules A's own failed post.
  let res = mockRes();
  await socialController.reschedulePost(
    {
      user: { userId: A.userId },
      params: { postId: A.failedPostId },
      body: { scheduledTime: future },
    },
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.post.post_id, A.failedPostId);
  assert.strictEqual(res.body.post.status, "scheduled");

  // Cross-tenant probe: A reschedules B's failed post by direct id.
  res = mockRes();
  await socialController.reschedulePost(
    {
      user: { userId: A.userId },
      params: { postId: B.failedPostId },
      body: { scheduledTime: future },
    },
    res
  );
  assert.strictEqual(res.statusCode, 404);
  assertNoLeak(res, B.secrets);

  // B's failed post never moved to scheduled.
  const check = await db.query(
    "SELECT status FROM social_posts WHERE post_id = $1",
    [B.failedPostId]
  );
  assert.strictEqual(check.rows[0].status, "failed");
});

test("social: publishPostNow (post-by-id) — A probing B's scheduled post_id is 404 and B stays scheduled", async () => {
  // Cross-tenant probe only (the happy path performs a real publish which hits
  // the social API; the ownership branch fires BEFORE any publish work, so the
  // 404 here fully exercises the isolation guard).
  const res = mockRes();
  await socialController.publishPostNow(
    { user: { userId: A.userId }, params: { postId: B.scheduledPostId } },
    res
  );
  assert.strictEqual(res.statusCode, 404);
  assertNoLeak(res, B.secrets);

  // B's post was never claimed into 'publishing'.
  const check = await db.query(
    "SELECT status FROM social_posts WHERE post_id = $1",
    [B.scheduledPostId]
  );
  assert.strictEqual(check.rows[0].status, "scheduled");
});

// --- ad_creatives ------------------------------------------------------------

test("ad_studio: getCreativeLibrary — A reads A's brand (happy), A probing B's brand_id is 404 with no leak", async () => {
  // Happy path: A sees A's own creative.
  let res = mockRes();
  await adStudioController.getCreativeLibrary(
    { user: { userId: A.userId }, params: { brandId: A.brandId } },
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.ok(
    res.body.creatives.some(
      (c) =>
        c.creative_concept &&
        Array.isArray(c.creative_concept.packages) &&
        c.creative_concept.packages.some((p) => p.conceptName === "Creative-secret-A")
    )
  );

  // Cross-tenant probe: A reads B's creative library by brand_id.
  res = mockRes();
  await adStudioController.getCreativeLibrary(
    { user: { userId: A.userId }, params: { brandId: B.brandId } },
    res
  );
  assert.strictEqual(res.statusCode, 404);
  assertNoLeak(res, B.secrets);
});

test("ad_studio: launchCreative (creative-by-id) — A launching B's creative_id is 404 with no leak, B's creative untouched", async () => {
  // Cross-tenant probe: A launches B's creative by direct id. The ownership
  // JOIN (ad_creatives -> brands on user_id) fires before any Facebook work.
  const res = mockRes();
  await adStudioController.launchCreative(
    {
      user: { userId: A.userId },
      body: { creativeId: B.creativeId, packageIndex: 0, budget: 10 },
    },
    res
  );
  assert.strictEqual(res.statusCode, 404);
  assertNoLeak(res, B.secrets);

  // B's creative is still a draft (never flipped to launched).
  const check = await db.query(
    "SELECT status FROM ad_creatives WHERE creative_id = $1",
    [B.creativeId]
  );
  assert.strictEqual(check.rows[0].status, "draft");
});
