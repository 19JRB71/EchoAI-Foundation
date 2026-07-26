/**
 * Tenant-isolation regression suite — BACKGROUND paths (REPLIT_PROMPT_014).
 *
 * These are the unattended sweeps the scheduler fires on a timer. Nobody is
 * holding a request, so the ONLY thing standing between one tenant's data and
 * another's is the SQL the sweep runs. This file proves two invariants against
 * a REAL (isolated) test database:
 *
 *  1. is_demo gating — demo brands are sample data; a background sweep must
 *     never process a demo brand's due row (no real send, no real snapshot,
 *     no owner alert). We seed a real tenant's due row AND a demo tenant's due
 *     row, run the sweep, and assert only the real one moved.
 *       - publishDuePosts (social scheduler, every minute)
 *       - runDailyGoalTracking (goal tracker, daily)
 *
 *  2. Sage per-brand delivery — Sage workers run once per brand. A scan for
 *     brand X must read/write ONLY brand X's rows, never leaking into brand Y.
 *     We seed two real brands, run the urgent worker for X, and assert every
 *     row it created is scoped to X and NOTHING was created for Y.
 *
 * Conventions mirror tests/companyTruth.test.js exactly: dbGuard preload redirects
 * to the isolated test DB, the Anthropic SDK seam is stubbed so no credits are
 * spent, raw-SQL fixtures create two tenants, and after() hooks delete everything
 * created in FK-safe order. Network seams (socialApi.publishPost, the Anthropic
 * client) are stubbed; everything else hits the real test DB so the actual SQL
 * gating is what is under test.
 */
const test = require("node:test");
const assert = require("node:assert");

require("./dbGuard");
const db = require("../config/db");
const anthropicModule = require("../config/anthropic");
const socialApi = require("../utils/socialApi");
const { encrypt } = require("../utils/encryption");

const { publishDuePosts } = require("../controllers/socialController");
const { runDailyGoalTracking } = require("../utils/goalAlerts");
const { runUrgentScanForBrand } = require("../controllers/sageController");

// --- fixtures ----------------------------------------------------------------

let seq = 0;
async function createTenant({ isDemo = false, name = "Iso Test Brand" } = {}) {
  seq += 1;
  const email = `iso-bg-${Date.now()}-${seq}-${Math.random()
    .toString(36)
    .slice(2)}@example.test`;
  const u = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING user_id",
    [email, "test-not-a-real-hash"]
  );
  const userId = u.rows[0].user_id;
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name, is_demo) VALUES ($1, $2, $3) RETURNING brand_id",
    [userId, name, isDemo]
  );
  return { userId, brandId: b.rows[0].brand_id };
}

// Delete a tenant's rows in FK-safe order (children before parents), scoped to
// the ids we created so a shared test DB stays clean.
async function dropTenant({ userId, brandId }) {
  await db.query("DELETE FROM social_posts WHERE brand_id = $1", [brandId]);
  await db.query("DELETE FROM social_accounts WHERE brand_id = $1", [brandId]);
  await db.query("DELETE FROM goal_snapshots WHERE brand_id = $1", [brandId]);
  await db.query("DELETE FROM brand_goals WHERE brand_id = $1", [brandId]);
  // Sage tables — best-effort (a table may be absent depending on migration
  // level); the canonical + legacy feed, alert ledger, and run claims.
  for (const sql of [
    "DELETE FROM sage_intel_items WHERE brand_id = $1",
    "DELETE FROM sage_intelligence_feed WHERE brand_id = $1",
    "DELETE FROM sage_alert_log WHERE brand_id = $1",
    "DELETE FROM sage_research_runs WHERE brand_id = $1",
  ]) {
    try {
      await db.query(sql, [brandId]);
    } catch (_e) {
      /* table not present at this migration level — ignore */
    }
  }
  await db.query("DELETE FROM brands WHERE brand_id = $1", [brandId]);
  await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
}

// A connected social account whose credentials decrypt cleanly and carry an
// accessToken so loadConnectedAccount never touches the Facebook-page resolve
// path. socialApi.publishPost is stubbed, so the token value is irrelevant.
async function seedConnectedAccount(brandId, platform = "facebook") {
  await db.query(
    `INSERT INTO social_accounts
       (brand_id, platform, platform_username, credentials_encrypted, connection_status)
     VALUES ($1, $2, $3, $4, 'connected')`,
    [brandId, platform, "iso-test-user", encrypt(JSON.stringify({ accessToken: "iso-test-token" }))]
  );
}

// A text-only post already due (scheduled_time in the past) so publishDuePosts
// claims it. Text-only avoids getPublicBaseUrl / media fetch paths.
async function seedDuePost(brandId, platform = "facebook") {
  const r = await db.query(
    `INSERT INTO social_posts (brand_id, platform, post_content, scheduled_time, status)
     VALUES ($1, $2, $3, NOW() - INTERVAL '1 minute', 'scheduled')
     RETURNING post_id`,
    [brandId, platform, "iso-test post content"]
  );
  return r.rows[0].post_id;
}

async function postStatus(postId) {
  const r = await db.query(
    "SELECT status, external_post_id FROM social_posts WHERE post_id = $1",
    [postId]
  );
  return r.rows[0];
}

// --- Anthropic stub (companyTruth pattern) -----------------------------------

const originalCreate = anthropicModule.anthropic.messages.create;
function stubAi(impl) {
  anthropicModule.anthropic.messages.create = async (params) => impl(params);
}
function restoreAi() {
  anthropicModule.anthropic.messages.create = originalCreate;
}

// A well-formed urgent-scan response: one urgent item plus a real web-search
// citation (urgentScan drops items with no cited source). createMessage returns
// this raw response straight through to urgentScan.
function urgentResponse(summary) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          urgent: [
            {
              source_type: "regulation",
              summary,
              why_it_matters: "A new rule directly affects how this brand operates.",
            },
          ],
        }),
        citations: [
          {
            type: "web_search_result_location",
            url: "https://gov.example/new-rule",
            title: "New Rule Published",
          },
        ],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

// =============================================================================
// 1. publishDuePosts — demo brands are never published
// =============================================================================

test("publishDuePosts: a demo brand's due post is never published (is_demo gate)", async () => {
  const real = await createTenant({ isDemo: false, name: "Real Social Brand" });
  const demo = await createTenant({ isDemo: true, name: "Demo Social Brand" });

  await seedConnectedAccount(real.brandId);
  await seedConnectedAccount(demo.brandId);
  const realPost = await seedDuePost(real.brandId);
  const demoPost = await seedDuePost(demo.brandId);

  // Stub the ONLY network seam. Record which brands the publisher actually
  // attempted so we can prove the demo brand was never reached.
  const attempted = [];
  const originalPublish = socialApi.publishPost;
  socialApi.publishPost = async (_platform, _creds, _post) => {
    attempted.push(_post.content);
    return { externalId: `ext-${attempted.length}` };
  };

  try {
    await publishDuePosts();

    // Happy path: the real brand's post was published (so the 404-style gate on
    // the demo brand is meaningful, not a no-op sweep).
    const realAfter = await postStatus(realPost);
    assert.strictEqual(realAfter.status, "published", "real brand's due post must publish");
    assert.ok(realAfter.external_post_id, "real brand's post gets a platform id");

    // The demo brand's post is untouched — still scheduled, never attempted.
    const demoAfter = await postStatus(demoPost);
    assert.strictEqual(
      demoAfter.status,
      "scheduled",
      "demo brand's due post must remain untouched"
    );
    assert.strictEqual(demoAfter.external_post_id, null);
    assert.strictEqual(
      attempted.length,
      1,
      "publish must be attempted exactly once (the real brand only)"
    );
  } finally {
    socialApi.publishPost = originalPublish;
    await dropTenant(real);
    await dropTenant(demo);
  }
});

// =============================================================================
// 2. runDailyGoalTracking — demo brands are never snapshotted
// =============================================================================

async function seedActiveGoal(brandId) {
  const r = await db.query(
    `INSERT INTO brand_goals (brand_id, category, metric_key, label, target_value, status)
     VALUES ($1, 'lead', 'new_leads', 'New Leads', 100, 'active')
     RETURNING goal_id`,
    [brandId]
  );
  return r.rows[0].goal_id;
}

async function snapshotCount(brandId) {
  const r = await db.query(
    "SELECT COUNT(*)::int AS n FROM goal_snapshots WHERE brand_id = $1",
    [brandId]
  );
  return r.rows[0].n;
}

test("runDailyGoalTracking: a demo brand with an active goal is never snapshotted (is_demo gate)", async () => {
  const real = await createTenant({ isDemo: false, name: "Real Goal Brand" });
  const demo = await createTenant({ isDemo: true, name: "Demo Goal Brand" });

  await seedActiveGoal(real.brandId);
  await seedActiveGoal(demo.brandId);

  try {
    await runDailyGoalTracking();

    // Happy path: the real brand's active goal produced today's snapshot, so the
    // demo-brand assertion below is meaningful rather than an empty sweep.
    assert.ok(
      (await snapshotCount(real.brandId)) >= 1,
      "real brand's active goal must be snapshotted"
    );

    // The demo brand — despite an identical active goal — is excluded entirely.
    assert.strictEqual(
      await snapshotCount(demo.brandId),
      0,
      "demo brand's goal must never be snapshotted"
    );
  } finally {
    await dropTenant(real);
    await dropTenant(demo);
  }
});

// =============================================================================
// 3. Sage single-brand delivery — a scan for X touches only X
// =============================================================================

test("runUrgentScanForBrand(X): every row it writes is scoped to X, none to Y", async () => {
  const x = await createTenant({ isDemo: false, name: "Sage Brand X" });
  const y = await createTenant({ isDemo: false, name: "Sage Brand Y" });

  // A brand row shaped like activeBrandsForSage() returns (the worker reads
  // brand_id / user_id / industry off it).
  const brandX = {
    brand_id: x.brandId,
    user_id: x.userId,
    brand_name: "Sage Brand X",
    industry: "coffee shops",
  };

  const uniqueSummary = `X-only urgent signal ${Date.now()}`;
  stubAi(() => urgentResponse(uniqueSummary));

  try {
    const feed = await runUrgentScanForBrand(brandX);
    assert.ok(Array.isArray(feed) && feed.length >= 1, "worker returns the urgent feed for X");

    // Resolve whichever intelligence store the migration level uses. Every new
    // intelligence row (canonical sage_intel_items OR legacy feed) must be
    // scoped to X, and there must be ZERO rows for Y.
    const intelStore = require("../utils/intelStore");
    const target = await intelStore.feedTarget();
    const table = target.table; // trusted: from app code, not user input

    const xRows = await db.query(
      `SELECT summary FROM ${table} WHERE brand_id = $1`,
      [x.brandId]
    );
    assert.ok(
      xRows.rows.some((r) => r.summary === uniqueSummary),
      "the urgent finding was written for brand X"
    );

    const yRows = await db.query(
      `SELECT COUNT(*)::int AS n FROM ${table} WHERE brand_id = $1`,
      [y.brandId]
    );
    assert.strictEqual(yRows.rows[0].n, 0, "brand Y must have NO intelligence rows");

    // The urgent alert ledger is likewise per-brand: X may have an entry, Y none.
    const yAlerts = await db.query(
      "SELECT COUNT(*)::int AS n FROM sage_alert_log WHERE brand_id = $1",
      [y.brandId]
    );
    assert.strictEqual(yAlerts.rows[0].n, 0, "brand Y must have NO urgent alert-log rows");
  } finally {
    restoreAi();
    await dropTenant(x);
    await dropTenant(y);
  }
});
