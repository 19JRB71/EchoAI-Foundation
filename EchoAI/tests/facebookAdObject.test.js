// Prompt 003: after creative creation, both launch paths must create the
// actual Facebook ad object — POST act_<id>/ads { name, adset_id,
// creative:{creative_id}, status:"PAUSED" } — and persist facebook_ad_id.
//
// All Facebook Graph traffic is intercepted by a fetch mock: these tests prove
// the FOUR linked POSTs (campaign → ad set → creative → ad), the PAUSED-only
// safeguard, the fail-fast guard, the duplicate-ad guard, honest partial-chain
// recording, and that the Autopilot approve path shares the same
// launchFacebookCampaign implementation (no duplicate code path).

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { db, createTestUser, deleteUser } = require("./helpers");
const { encrypt } = require("../utils/encryption");
const campaignController = require("../controllers/campaignController");

const { launchFacebookCampaign } = campaignController;

let userId;
let otherUserId;
let brand;

// ---- Graph API fetch mock -------------------------------------------------
const realFetch = global.fetch;
let graphCalls; // [{ method, path, params }]
let failOnPath = null; // e.g. "/ads" — that call rejects with an FB error

function installFetchMock() {
  graphCalls = [];
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    if (!u.hostname.endsWith("graph.facebook.com")) {
      throw new Error(`Unexpected non-Graph fetch in test: ${u.hostname}`);
    }
    const pathName = u.pathname.replace(/^\/v[\d.]+/, "");
    const params = {};
    for (const [k, v] of u.searchParams.entries()) params[k] = v;
    graphCalls.push({ method: opts.method || "GET", path: pathName, params });

    if (failOnPath && pathName.endsWith(failOnPath)) {
      return {
        ok: false,
        status: 400,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({ error: { message: "Simulated ad creation failure", code: 100 } }),
      };
    }

    let id = "unknown";
    if (pathName.endsWith("/campaigns")) id = "cmp_1";
    else if (pathName.endsWith("/adsets")) id = "as_1";
    else if (pathName.endsWith("/adcreatives")) id = "cr_1";
    else if (pathName.endsWith("/ads")) id = "ad_1";
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ id }),
    };
  };
}

async function connectFacebook(uid, { pageRef = "1400123456789" } = {}) {
  await db.query(
    `INSERT INTO api_integrations
       (user_id, platform, api_token_encrypted, account_ref, page_ref, connection_status)
     VALUES ($1, 'facebook', $2, $3, $4, 'connected')
     ON CONFLICT (user_id, platform) DO UPDATE
       SET api_token_encrypted = EXCLUDED.api_token_encrypted,
           account_ref = EXCLUDED.account_ref,
           page_ref = EXCLUDED.page_ref,
           connection_status = 'connected'`,
    [uid, encrypt(`token-for-${uid}`), "act_999001", pageRef],
  );
}

before(async () => {
  userId = await createTestUser();
  otherUserId = await createTestUser();
  const { rows } = await db.query(
    `INSERT INTO brands (user_id, brand_name) VALUES ($1, 'Ad Object Test Brand') RETURNING *`,
    [userId],
  );
  brand = rows[0];
  await connectFacebook(userId);
  process.env.FACEBOOK_LINK_URL = "https://example.test/landing";
});

after(async () => {
  global.fetch = realFetch;
  delete process.env.FACEBOOK_LINK_URL;
  await deleteUser(userId);
  await deleteUser(otherUserId);
  await db.pool.end();
});

beforeEach(async () => {
  installFetchMock();
  failOnPath = null;
  await db.query("DELETE FROM campaigns WHERE user_id = $1", [userId]);
});

test("happy path: four linked Graph POSTs including /ads with PAUSED, ids persisted", async () => {
  const launched = await launchFacebookCampaign({
    userId,
    brand,
    goal: "leads",
    budget: 10,
    creativeOverride: { headline: "H", primaryText: "P" },
  });

  const posts = graphCalls.filter((c) => c.method === "POST");
  assert.deepEqual(
    posts.map((c) => c.path),
    [
      "/act_999001/campaigns",
      "/act_999001/adsets",
      "/act_999001/adcreatives",
      "/act_999001/ads",
    ],
    "exactly four Graph POSTs, in chain order",
  );

  // Linkage assertions.
  const adSetPost = posts[1];
  assert.equal(adSetPost.params.campaign_id, "cmp_1", "ad set links the campaign");
  const adPost = posts[3];
  assert.equal(adPost.params.adset_id, "as_1", "ad links the ad set");
  assert.deepEqual(JSON.parse(adPost.params.creative), { creative_id: "cr_1" }, "ad links the creative");
  assert.equal(adPost.params.status, "PAUSED", "the ad object is created PAUSED");
  // Every object in the chain is created PAUSED (spending safeguard).
  for (const p of [posts[0], posts[1], posts[3]]) {
    assert.equal(p.params.status, "PAUSED", `${p.path} must be PAUSED`);
  }

  // Tenant isolation: the chain used THIS user's stored token, nobody else's.
  for (const c of graphCalls) {
    assert.equal(c.params.access_token, `token-for-${userId}`);
  }

  // facebook_ad_id persisted only from Facebook's returned id.
  assert.equal(launched.facebookAdId, "ad_1");
  const { rows } = await db.query(
    `SELECT facebook_campaign_id, facebook_adset_id, facebook_creative_id, facebook_ad_id, status
     FROM campaigns WHERE campaign_id = $1`,
    [launched.campaignId],
  );
  assert.deepEqual(rows[0], {
    facebook_campaign_id: "cmp_1",
    facebook_adset_id: "as_1",
    facebook_creative_id: "cr_1",
    facebook_ad_id: "ad_1",
    status: "active",
  });
});

test("fail-fast: missing Page/link errors BEFORE any Facebook object is created", async () => {
  await connectFacebook(otherUserId, { pageRef: null });
  const { rows } = await db.query(
    `INSERT INTO brands (user_id, brand_name) VALUES ($1, 'No Page Brand') RETURNING *`,
    [otherUserId],
  );
  const savedLink = process.env.FACEBOOK_LINK_URL;
  const savedPage = process.env.FACEBOOK_PAGE_ID;
  delete process.env.FACEBOOK_PAGE_ID;
  try {
    await assert.rejects(
      launchFacebookCampaign({
        userId: otherUserId,
        brand: rows[0],
        goal: "leads",
        budget: 5,
        creativeOverride: { headline: "H", primaryText: "P" },
      }),
      /No Facebook Page is connected/,
    );
    assert.equal(graphCalls.length, 0, "no Graph call may happen before the guard");

    // Same guard for a missing destination link.
    delete process.env.FACEBOOK_LINK_URL;
    await assert.rejects(
      launchFacebookCampaign({
        userId, // has a page_ref
        brand,
        goal: "leads",
        budget: 5,
        creativeOverride: { headline: "H", primaryText: "P" },
      }),
      /FACEBOOK_LINK_URL/,
    );
    assert.equal(graphCalls.length, 0);
    const n = await db.query(
      "SELECT COUNT(*)::int AS n FROM campaigns WHERE user_id = ANY($1::uuid[])",
      [[userId, otherUserId]],
    );
    assert.equal(n.rows[0].n, 0, "fail-fast must not record any campaign row");
  } finally {
    process.env.FACEBOOK_LINK_URL = savedLink;
    if (savedPage) process.env.FACEBOOK_PAGE_ID = savedPage;
  }
});

test("partial failure on /ads: recorded as launch_failed with partial ids, error surfaced", async () => {
  failOnPath = "/ads";
  let thrown;
  try {
    await launchFacebookCampaign({
      userId,
      brand,
      goal: "leads",
      budget: 10,
      creativeOverride: { headline: "H", primaryText: "P" },
    });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, "a partial chain must surface the failure, never a success");
  assert.match(thrown.message, /Simulated ad creation failure/);
  assert.deepEqual(thrown.partialChain, {
    campaignId: "cmp_1",
    adSetId: "as_1",
    creativeId: "cr_1",
    adId: null,
  });

  const { rows } = await db.query(
    `SELECT facebook_campaign_id, facebook_adset_id, facebook_creative_id, facebook_ad_id, status
     FROM campaigns WHERE user_id = $1`,
    [userId],
  );
  assert.equal(rows.length, 1, "the partial chain is recorded exactly once for cleanup");
  assert.deepEqual(rows[0], {
    facebook_campaign_id: "cmp_1",
    facebook_adset_id: "as_1",
    facebook_creative_id: "cr_1",
    facebook_ad_id: null,
    status: "launch_failed",
  });
});

test("duplicate guard: an existing facebook_ad_id for the campaign prevents a second /ads POST", async () => {
  await db.query(
    `INSERT INTO campaigns
       (brand_id, user_id, campaign_name, budget, facebook_campaign_id, facebook_ad_id, status)
     VALUES ($1, $2, 'Prior attempt', 10, 'cmp_1', 'ad_prev', 'launch_failed')`,
    [brand.brand_id, userId],
  );

  const launched = await launchFacebookCampaign({
    userId,
    brand,
    goal: "leads",
    budget: 10,
    creativeOverride: { headline: "H", primaryText: "P" },
  });

  const adPosts = graphCalls.filter((c) => c.method === "POST" && c.path.endsWith("/ads"));
  assert.equal(adPosts.length, 0, "no duplicate /ads POST when an ad already exists");
  assert.equal(launched.facebookAdId, "ad_prev", "the existing ad id is reused");
});

// ---- Ad Creative Studio path ----------------------------------------------
const adCreativeStudioController = require("../controllers/adCreativeStudioController");

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  return res;
}

async function insertStudioCreative() {
  const { rows } = await db.query(
    `INSERT INTO ad_creatives (brand_id, campaign_goal, creative_concept, status)
     VALUES ($1, 'lead_generation', $2, 'draft') RETURNING creative_id`,
    [
      brand.brand_id,
      JSON.stringify({
        packages: [
          {
            conceptName: "Concept A",
            angle: "angle",
            headline: "Studio H",
            bodyCopyVariations: ["Studio body copy"],
            callToAction: "LEARN_MORE",
          },
        ],
      }),
    ],
  );
  return rows[0].creative_id;
}

test("studio path: four linked POSTs incl. PAUSED /ads, ids persisted, response carries facebookAdId", async () => {
  const creativeId = await insertStudioCreative();
  const res = fakeRes();
  await adCreativeStudioController.launchCreative(
    { user: { userId }, body: { creativeId, packageIndex: 0, budget: 12 } },
    res,
  );
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));

  const posts = graphCalls.filter((c) => c.method === "POST");
  assert.deepEqual(
    posts.map((c) => c.path),
    ["/act_999001/campaigns", "/act_999001/adsets", "/act_999001/adcreatives", "/act_999001/ads"],
  );
  const adPost = posts[3];
  assert.equal(adPost.params.status, "PAUSED");
  assert.equal(adPost.params.adset_id, "as_1");
  assert.deepEqual(JSON.parse(adPost.params.creative), { creative_id: "cr_1" });
  assert.equal(res.body.facebookAdId, "ad_1");

  const { rows } = await db.query(
    `SELECT facebook_creative_id, facebook_ad_id, status FROM campaigns WHERE campaign_id = $1`,
    [res.body.campaignId],
  );
  assert.deepEqual(rows[0], { facebook_creative_id: "cr_1", facebook_ad_id: "ad_1", status: "active" });
});

test("studio path partial failure on /ads: 502 with partialChain + launch_failed row", async () => {
  failOnPath = "/ads";
  const creativeId = await insertStudioCreative();
  const res = fakeRes();
  await adCreativeStudioController.launchCreative(
    { user: { userId }, body: { creativeId, packageIndex: 0, budget: 12 } },
    res,
  );
  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /Simulated ad creation failure/);
  assert.match(res.body.error, /recorded for cleanup/i);
  assert.deepEqual(res.body.partialChain, {
    campaignId: "cmp_1",
    adSetId: "as_1",
    creativeId: "cr_1",
    adId: null,
  });

  const { rows } = await db.query(
    `SELECT status, facebook_ad_id FROM campaigns WHERE user_id = $1`,
    [userId],
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { status: "launch_failed", facebook_ad_id: null });

  // The creative was NOT marked launched on a failed chain.
  const cr = await db.query("SELECT status FROM ad_creatives WHERE creative_id = $1", [creativeId]);
  assert.equal(cr.rows[0].status, "draft");
});

test("manual API path surfaces partialChain in the error response body", async () => {
  failOnPath = "/ads";
  const res = fakeRes();
  await campaignController.createCampaign(
    {
      user: { userId },
      body: { brandId: brand.brand_id, goal: "leads", budget: 10, targetAudience: {} },
    },
    res,
  );
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body.partialChain, {
    campaignId: "cmp_1",
    adSetId: "as_1",
    creativeId: "cr_1",
    adId: null,
  });
});

test("single launch path: Autopilot approve and manual create both use launchFacebookCampaign", () => {
  const autopilotSrc = fs.readFileSync(
    path.join(__dirname, "..", "controllers", "autopilotController.js"),
    "utf8",
  );
  assert.match(
    autopilotSrc,
    /require\("\.\/campaignController"\)/,
    "Autopilot must import from campaignController",
  );
  assert.match(autopilotSrc, /launchFacebookCampaign\(/, "Autopilot calls the shared launcher");
  assert.doesNotMatch(
    autopilotSrc,
    /\/ads["'`]/,
    "Autopilot must not contain its own /ads POST",
  );
  assert.equal(
    typeof campaignController.launchFacebookCampaign,
    "function",
    "the shared launcher is exported for both paths",
  );
});
