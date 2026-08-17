/**
 * 026-C3 — owner-action pauses for the ads-destination step (I-61 / I-62 /
 * AM-C3-1 / AM-C3-2).
 *
 * Binds, against the real test database (only external launch controllers
 * stubbed — NO Facebook/Meta object is ever created by this suite):
 *
 *   A. Step-6 preflight pause (I-62): Facebook connected but STORE 3
 *      (brands.facebook_page_id / ad_link_url) incomplete → a re-derived
 *      { status:"owner_action_required", action.code:"missing_ad_destination" }
 *      pause with exact missing flags — never needs_connection, never a
 *      durable failure, never a launch attempt, nothing marked complete.
 *   B. Launch authorization pause (AM-C3-2): configuration alone NEVER
 *      launches. With STORE 3 complete and no valid confirm, Step 6 pauses at
 *      action.code:"confirm_campaign_launch" whose summary/digest come from
 *      CURRENT SERVER TRUTH ("created PAUSED", "$0 at creation" included);
 *      stale digests re-pause with changed:true; only a matching digest
 *      reaches the (stubbed) launch branch exactly once; a duplicate execute
 *      with the same consumed confirm is idempotent (campaigns-exist check).
 *   C. Marker-first classification (I-61): resolveBrandAdDestination's guard
 *      throws carry ownerActionRequired/ownerActionCode/safeMessage;
 *      classifyStepError maps marked errors to owner_action_required
 *      retryable:false BEFORE billing/status heuristics; unmarked errors keep
 *      their C2 classes; only authored safeMessage text may surface.
 *   D. AM-C3-1 dual-writer pinning: brandController.updateBrand's
 *      facebookPageId path (granted-list validation, ungranted rejection,
 *      blank-clears, non-string 400, ownership) is pinned exactly as-is —
 *      the validated secondary server writer next to the select-page product
 *      writer. STORE 2 (social_accounts) stays untouched by all of the above.
 *
 * Run with:  node --test test/setupAgent.owneraction.test.js   (from EchoAI/)
 */

require("dotenv").config();
require("../tests/dbGuard");

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const express = require("express");
const jwt = require("jsonwebtoken");

const db = require("../config/db");
const setupAgent = require("../controllers/setupAgentController");
const campaignController = require("../controllers/campaignController");
const adCreativeStudioController = require("../controllers/adCreativeStudioController");
const brandRoutes = require("../routes/brandRoutes");

const stepAction = setupAgent.ACTIONS.find((a) => a.key === "create_facebook_campaign");
assert.ok(stepAction, "create_facebook_campaign action must exist");

// ---------------------------------------------------------------------------
// Harness — real express router for the updateBrand pinning; direct run()
// invocation for the step (the execute loop's own plumbing is covered by the
// existing C1/C2 suites).
// ---------------------------------------------------------------------------

let server;
let baseUrl;
const createdUserIds = [];

function apiRequest(token, method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));
}

async function createUser() {
  const email = `c3oa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, role, subscription_tier)
     VALUES ($1, 'not-a-real-hash', 'user'::user_role, 'pro'::subscription_tier)
     RETURNING user_id`,
    [email],
  );
  const userId = rows[0].user_id;
  createdUserIds.push(userId);
  await db.query(
    `INSERT INTO subscriptions (user_id, subscription_tier, payment_status, is_locked)
     VALUES ($1, 'pro'::subscription_tier, 'active', FALSE)`,
    [userId],
  );
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "1h" });
  return { userId, token };
}

async function createBrand(userId, cols = {}) {
  const { rows } = await db.query(
    `INSERT INTO brands (user_id, brand_name, facebook_page_id, ad_link_url, website_url)
     VALUES ($1, $2, $3, $4, $5) RETURNING brand_id`,
    [
      userId,
      cols.name || "C3 Test Brand",
      cols.facebookPageId || null,
      cols.adLinkUrl || null,
      cols.websiteUrl || null,
    ],
  );
  return rows[0].brand_id;
}

const GRANTED_PAGES = [
  { id: "111000111", name: "Main Street Storage" },
  { id: "222000222", name: "Second Page" },
];

async function connectFacebook(userId, { pages = GRANTED_PAGES, accountRef = "act_987654" } = {}) {
  await db.query(
    `INSERT INTO api_integrations
       (user_id, platform, api_token_encrypted, connection_status, facebook_pages, account_ref)
     VALUES ($1, 'facebook', 'enc-test-token', 'connected', $2::jsonb, $3)`,
    [userId, JSON.stringify(pages), accountRef],
  );
}

function fakeSession(brandId) {
  return { session_id: crypto.randomUUID(), brand_id: brandId };
}

async function runStep({ userId, brandId, answers = {}, confirm = null }) {
  return stepAction.run({ userId, session: fakeSession(brandId), answers, confirm });
}

// Launch stubs — installed per-test; assert NO provider path runs unless the
// test explicitly authorizes it. They stand in for the externally-capable
// controllers, so no Facebook object can ever be created here.
const originalLaunchCreative = adCreativeStudioController.launchCreative;
const originalCreateCampaign = campaignController.createCampaign;
let launchCalls;

function installLaunchStubs({ succeed = true } = {}) {
  launchCalls = [];
  const stub = (name) => async (req, res) => {
    launchCalls.push({ name, body: req.body });
    if (!succeed) return res.status(502).json({ error: "stubbed provider failure" });
    // Mimic the real side effect the idempotency precheck looks for.
    await db.query(
      `INSERT INTO campaigns (brand_id, user_id, campaign_name, budget)
       VALUES ($1, $2, 'C3 stub campaign', 10)`,
      [req.body.brandId || req.body.brand_id, req.user.userId],
    );
    return res.json({ success: true });
  };
  campaignController.createCampaign = stub("createCampaign");
  adCreativeStudioController.launchCreative = async (req, res) => {
    launchCalls.push({ name: "launchCreative", body: req.body });
    return res.status(502).json({ error: "no creative expected in this suite" });
  };
}

function restoreLaunchStubs() {
  campaignController.createCampaign = originalCreateCampaign;
  adCreativeStudioController.launchCreative = originalLaunchCreative;
}

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/brands", brandRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  restoreLaunchStubs();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (createdUserIds.length) {
    await db.query(`DELETE FROM brands WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
    await db.query(`DELETE FROM users WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
  }
});

// ---------------------------------------------------------------------------
// A. Preflight pause — missing_ad_destination
// ---------------------------------------------------------------------------

test("A1: connected + nothing configured → pause with both missing flags, no launch, no campaign row", async () => {
  installLaunchStubs();
  const { userId } = await createUser();
  await connectFacebook(userId);
  const brandId = await createBrand(userId);

  const out = await runStep({ userId, brandId });
  assert.equal(out.status, "owner_action_required");
  assert.equal(out.action.code, "missing_ad_destination");
  assert.deepEqual(out.action.missing, { page: true, destination: true });
  assert.equal(launchCalls.length, 0);
  const { rows } = await db.query("SELECT 1 FROM campaigns WHERE brand_id = $1", [brandId]);
  assert.equal(rows.length, 0);

  // Re-derived, not persisted: an identical second execute converges to the
  // exact same pause (reload/remount/resume behavior).
  const again = await runStep({ userId, brandId });
  assert.equal(again.status, "owner_action_required");
  assert.deepEqual(again.action.missing, { page: true, destination: true });
  restoreLaunchStubs();
});

test("A2: page saved but destination missing → only missing.destination (honest partial state)", async () => {
  installLaunchStubs();
  const { userId } = await createUser();
  await connectFacebook(userId);
  const brandId = await createBrand(userId, { facebookPageId: GRANTED_PAGES[0].id });

  const out = await runStep({ userId, brandId });
  assert.equal(out.status, "owner_action_required");
  assert.equal(out.action.code, "missing_ad_destination");
  assert.deepEqual(out.action.missing, { page: false, destination: true });
  assert.equal(launchCalls.length, 0);
  restoreLaunchStubs();
});

test("A3: destination present but page missing → only missing.page", async () => {
  installLaunchStubs();
  const { userId } = await createUser();
  await connectFacebook(userId);
  const brandId = await createBrand(userId, { adLinkUrl: "https://example.com/" });

  const out = await runStep({ userId, brandId });
  assert.deepEqual(out.action.missing, { page: true, destination: false });
  assert.equal(launchCalls.length, 0);
  restoreLaunchStubs();
});

test("A4: not connected still yields needs_connection (unchanged C1 contract, pause ordering preserved)", async () => {
  installLaunchStubs();
  const { userId } = await createUser(); // no api_integrations row
  const brandId = await createBrand(userId);

  const out = await runStep({ userId, brandId });
  assert.equal(out.status, "needs_connection");
  assert.equal(out.connect, "facebook");
  assert.equal(launchCalls.length, 0);
  restoreLaunchStubs();
});

// ---------------------------------------------------------------------------
// B. Launch authorization pause — confirm_campaign_launch
// ---------------------------------------------------------------------------

test("B1: fully configured, no confirm → confirm_campaign_launch pause from server truth; nothing launched", async () => {
  installLaunchStubs();
  const { userId } = await createUser();
  await connectFacebook(userId);
  const brandId = await createBrand(userId, {
    facebookPageId: GRANTED_PAGES[0].id,
    adLinkUrl: "https://example.com/offer",
  });

  const out = await runStep({ userId, brandId });
  assert.equal(out.status, "owner_action_required");
  assert.equal(out.action.code, "confirm_campaign_launch");
  const s = out.action.summary;
  assert.equal(s.pageId, GRANTED_PAGES[0].id);
  assert.equal(s.pageName, GRANTED_PAGES[0].name);
  assert.equal(s.adAccount, "act_987654");
  assert.equal(s.destination, "https://example.com/offer");
  assert.equal(s.createdPaused, true);
  assert.equal(s.initialSpend, 0);
  assert.match(out.detail, /PAUSED/);
  assert.match(out.detail, /\$0/);
  assert.ok(typeof out.action.digest === "string" && out.action.digest.length === 64);
  assert.equal(out.action.changed, false);
  assert.equal(launchCalls.length, 0);
  const { rows } = await db.query("SELECT 1 FROM campaigns WHERE brand_id = $1", [brandId]);
  assert.equal(rows.length, 0);

  // Re-derived on every execute; same truth → same digest.
  const again = await runStep({ userId, brandId });
  assert.equal(again.action.digest, out.action.digest);
  assert.equal(launchCalls.length, 0);
  restoreLaunchStubs();
});

test("B2: stale/mismatched digest → fresh pause with changed:true, never a launch", async () => {
  installLaunchStubs();
  const { userId } = await createUser();
  await connectFacebook(userId);
  const brandId = await createBrand(userId, {
    facebookPageId: GRANTED_PAGES[0].id,
    adLinkUrl: "https://example.com/a",
  });
  const first = await runStep({ userId, brandId });

  // The configuration changes between review and approval.
  await db.query("UPDATE brands SET ad_link_url = 'https://example.com/b' WHERE brand_id = $1", [
    brandId,
  ]);
  const out = await runStep({
    userId,
    brandId,
    confirm: { step: "create_facebook_campaign", digest: first.action.digest },
  });
  assert.equal(out.status, "owner_action_required");
  assert.equal(out.action.code, "confirm_campaign_launch");
  assert.equal(out.action.changed, true);
  assert.equal(out.action.summary.destination, "https://example.com/b");
  assert.notEqual(out.action.digest, first.action.digest);
  assert.equal(launchCalls.length, 0);
  restoreLaunchStubs();
});

test("B3: wrong confirm.step is ignored (no cross-step confirm bleed)", async () => {
  installLaunchStubs();
  const { userId } = await createUser();
  await connectFacebook(userId);
  const brandId = await createBrand(userId, {
    facebookPageId: GRANTED_PAGES[0].id,
    adLinkUrl: "https://example.com/",
  });
  const first = await runStep({ userId, brandId });
  const out = await runStep({
    userId,
    brandId,
    confirm: { step: "social_schedule", digest: first.action.digest },
  });
  assert.equal(out.status, "owner_action_required");
  assert.equal(out.action.code, "confirm_campaign_launch");
  // A foreign-step confirm is not "stale review" — it simply doesn't count.
  assert.equal(out.action.changed, false);
  assert.equal(launchCalls.length, 0);
  restoreLaunchStubs();
});

test("B4: matching digest → exactly one launch attempt; consumed confirm cannot replay (idempotency)", async () => {
  installLaunchStubs();
  const { userId } = await createUser();
  await connectFacebook(userId);
  const brandId = await createBrand(userId, {
    facebookPageId: GRANTED_PAGES[0].id,
    adLinkUrl: "https://example.com/",
  });
  const pause = await runStep({ userId, brandId });
  const confirm = { step: "create_facebook_campaign", digest: pause.action.digest };

  const out = await runStep({ userId, brandId, confirm });
  assert.equal(out.status, "done");
  assert.equal(launchCalls.length, 1);
  assert.equal(launchCalls[0].name, "createCampaign");

  // Replay (duplicate execute still carrying the consumed confirm): the
  // campaigns-exist precheck answers done WITHOUT a second provider attempt.
  const replay = await runStep({ userId, brandId, confirm });
  assert.equal(replay.status, "done");
  assert.equal(launchCalls.length, 1);
  restoreLaunchStubs();
});

test("B5: STORE 2 (social_accounts) is never written by preflight, pause, or authorized launch", async () => {
  installLaunchStubs();
  const { userId } = await createUser();
  await connectFacebook(userId);
  const brandId = await createBrand(userId, {
    facebookPageId: GRANTED_PAGES[0].id,
    adLinkUrl: "https://example.com/",
  });
  await runStep({ userId, brandId });
  const pause = await runStep({ userId, brandId });
  await runStep({
    userId,
    brandId,
    confirm: { step: "create_facebook_campaign", digest: pause.action.digest },
  });
  const { rows } = await db.query("SELECT 1 FROM social_accounts WHERE brand_id = $1", [brandId]);
  assert.equal(rows.length, 0);
  restoreLaunchStubs();
});

// ---------------------------------------------------------------------------
// C. Marker-first classification (I-61)
// ---------------------------------------------------------------------------

function captureGuardThrow(brand, grantedPages) {
  try {
    campaignController.resolveBrandAdDestination(brand, grantedPages);
    assert.fail("guard should have thrown");
  } catch (err) {
    return err;
  }
}

test("C1: guard throws carry the owner-action marker and authored safeMessage (guard behavior unchanged)", () => {
  const missing = captureGuardThrow({ facebook_page_id: null, ad_link_url: null }, []);
  assert.equal(missing.statusCode, 503);
  assert.equal(missing.ownerActionRequired, true);
  assert.equal(missing.ownerActionCode, "missing_ad_destination");
  assert.equal(missing.safeMessage, missing.message);
  assert.match(missing.safeMessage, /no Facebook Page selected/);

  const revoked = captureGuardThrow(
    { facebook_page_id: "999", ad_link_url: "https://x.com/" },
    GRANTED_PAGES,
  );
  assert.equal(revoked.statusCode, 503);
  assert.equal(revoked.ownerActionRequired, true);
  assert.equal(revoked.ownerActionCode, "missing_ad_destination");
  assert.match(revoked.safeMessage, /no longer available/);

  // Configured + granted still resolves (defense-in-depth intact).
  const ok = campaignController.resolveBrandAdDestination(
    { facebook_page_id: GRANTED_PAGES[0].id, ad_link_url: "https://x.com/" },
    GRANTED_PAGES,
  );
  assert.deepEqual(ok, { pageId: GRANTED_PAGES[0].id, linkUrl: "https://x.com/" });
});

test("C2: classifyStepError checks the marker FIRST — before billing regex and status-code classes", () => {
  // Marked error whose text would otherwise trip the billing heuristics.
  const trap = new Error("credit balance is too low to run ads");
  trap.statusCode = 503;
  trap.ownerActionRequired = true;
  trap.ownerActionCode = "missing_ad_destination";
  trap.safeMessage = "Authored owner-safe text.";
  const marked = setupAgent.classifyStepError(trap);
  assert.equal(marked.code, "owner_action_required");
  assert.equal(marked.retryable, false);
  assert.equal(marked.safeMessage, "Authored owner-safe text.");

  // Real guard throw classifies the same way.
  const guardErr = captureGuardThrow({ facebook_page_id: null, ad_link_url: null }, []);
  const cls = setupAgent.classifyStepError(guardErr);
  assert.equal(cls.code, "owner_action_required");
  assert.equal(cls.retryable, false);
  assert.equal(cls.safeMessage, guardErr.message);

  // Unmarked errors keep their C2 classes: a plain 503 is NOT owner_action_required.
  const plain503 = new Error("upstream had a bad day");
  plain503.statusCode = 503;
  const c2 = setupAgent.classifyStepError(plain503);
  assert.notEqual(c2.code, "owner_action_required");
  assert.equal(c2.retryable, true);

  // Unmarked billing text keeps the billing class.
  const billing = new Error("Your credit balance is too low to access the Anthropic API");
  const b = setupAgent.classifyStepError(billing);
  assert.notEqual(b.code, "owner_action_required");

  // And the bounded template exists so an unexpected marked error without
  // safeMessage still surfaces owner-safe text, never raw err.message.
  assert.ok(setupAgent.STEP_FAILURE_TEMPLATES.owner_action_required);
  assert.doesNotMatch(setupAgent.STEP_FAILURE_TEMPLATES.owner_action_required, /AI service/i);
});

// ---------------------------------------------------------------------------
// D. AM-C3-1 — updateBrand facebookPageId pinning (validated secondary writer)
// ---------------------------------------------------------------------------

test("D1: updateBrand accepts a granted Page, rejects an ungranted one, blank clears, non-string 400, ownership enforced", async () => {
  const { userId, token } = await createUser();
  await connectFacebook(userId);
  const brandId = await createBrand(userId);

  // Granted Page saves.
  let res = await apiRequest(token, "PUT", `/api/brands/${brandId}`, {
    facebookPageId: GRANTED_PAGES[1].id,
  });
  assert.equal(res.status, 200);
  let row = await db.query("SELECT facebook_page_id FROM brands WHERE brand_id = $1", [brandId]);
  assert.equal(row.rows[0].facebook_page_id, GRANTED_PAGES[1].id);

  // Ungranted Page is rejected and nothing changes.
  res = await apiRequest(token, "PUT", `/api/brands/${brandId}`, { facebookPageId: "555000555" });
  assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
  row = await db.query("SELECT facebook_page_id FROM brands WHERE brand_id = $1", [brandId]);
  assert.equal(row.rows[0].facebook_page_id, GRANTED_PAGES[1].id);

  // Non-string is a 400.
  res = await apiRequest(token, "PUT", `/api/brands/${brandId}`, { facebookPageId: 12345 });
  assert.equal(res.status, 400);

  // Blank clears.
  res = await apiRequest(token, "PUT", `/api/brands/${brandId}`, { facebookPageId: "" });
  assert.equal(res.status, 200);
  row = await db.query("SELECT facebook_page_id FROM brands WHERE brand_id = $1", [brandId]);
  assert.equal(row.rows[0].facebook_page_id, null);

  // Another user cannot write this brand.
  const intruder = await createUser();
  await connectFacebook(intruder.userId);
  res = await apiRequest(intruder.token, "PUT", `/api/brands/${brandId}`, {
    facebookPageId: GRANTED_PAGES[0].id,
  });
  assert.ok(res.status === 404 || res.status === 403, `expected 403/404, got ${res.status}`);
  row = await db.query("SELECT facebook_page_id FROM brands WHERE brand_id = $1", [brandId]);
  assert.equal(row.rows[0].facebook_page_id, null);
});

// ---------------------------------------------------------------------------
// E. 026-C3-PM1 — spine-level regression (Citation 3).
//
// Drives the REAL runner (executeNextAction, the same handler the /execute
// route calls, with the session row exactly as requireSetupConsent attaches
// it) — NOT the isolated Step-6 run() — and binds at the persistence
// boundary that the missing_ad_destination pause creates NO agent_tasks
// spine row (in particular none with status = 'VALIDATION_FAILED'), marks
// nothing complete, creates no campaign, and reaches no launch path.
// ---------------------------------------------------------------------------

test("E1: missing ad destination pauses before the spine and creates no VALIDATION_FAILED agent_task (real runner path)", async () => {
  installLaunchStubs();
  const { userId } = await createUser();
  await connectFacebook(userId);
  // STORE 3 incomplete: no facebook_page_id, no ad_link_url.
  const brandId = await createBrand(userId);

  // Real setup_sessions row positioned so create_facebook_campaign is the
  // current runnable action (all prior steps recorded complete).
  const stepIndex = setupAgent.ACTIONS.findIndex((a) => a.key === "create_facebook_campaign");
  assert.ok(stepIndex > 0, "create_facebook_campaign must not be the first action");
  const priorKeys = setupAgent.ACTIONS.slice(0, stepIndex).map((a) => a.key);
  const inserted = await db.query(
    `INSERT INTO setup_sessions
       (user_id, brand_id, status, interview_complete, consent_granted, consent_at, completed_steps)
     VALUES ($1, $2, 'in_progress', TRUE, TRUE, NOW(), $3::jsonb)
     RETURNING *`,
    [userId, brandId, JSON.stringify(priorKeys)],
  );
  const sessionRow = inserted.rows[0];

  // Invoke the real handler with a hand-built req/res, exactly as the
  // /execute route would after requireSetupConsent attached the session row.
  const result = await new Promise((resolve, reject) => {
    const req = { user: { userId }, setupSession: sessionRow, body: {} };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
      },
    };
    Promise.resolve(setupAgent.executeNextAction(req, res)).catch(reject);
  });

  // 1–2. The runner reports the owner-action pause with the exact code.
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "owner_action_required");
  assert.equal(result.body.step.key, "create_facebook_campaign");
  assert.equal(result.body.action.code, "missing_ad_destination");
  assert.deepEqual(result.body.action.missing, { page: true, destination: true });

  // 3. Step 6 is NOT added to completed_steps (re-read from the DB, not the
  //    response).
  const after = await db.query(
    "SELECT status, completed_steps FROM setup_sessions WHERE session_id = $1",
    [sessionRow.session_id],
  );
  assert.equal(after.rows[0].status, "in_progress");
  assert.deepEqual(after.rows[0].completed_steps, priorKeys);

  // 4. No campaign row was created.
  const campaigns = await db.query("SELECT 1 FROM campaigns WHERE brand_id = $1", [brandId]);
  assert.equal(campaigns.rows.length, 0);

  // 5. DIRECT DB assertion at the spine's persistence boundary: zero
  //    agent_tasks rows with status = 'VALIDATION_FAILED' attributable to
  //    this brand/user/run.
  const validationFailed = await db.query(
    `SELECT 1 FROM agent_tasks
      WHERE (brand_id = $1 OR user_id = $2) AND status = 'VALIDATION_FAILED'`,
    [brandId, userId],
  );
  assert.equal(validationFailed.rows.length, 0);

  // 6. Stronger still: NO ad-launch spine attempt of any status was created
  //    merely because prerequisites were missing.
  const anySpineRow = await db.query(
    "SELECT 1 FROM agent_tasks WHERE brand_id = $1 OR user_id = $2",
    [brandId, userId],
  );
  assert.equal(anySpineRow.rows.length, 0);

  // 7. No provider/external path was reached (stubs untouched).
  assert.equal(launchCalls.length, 0);

  restoreLaunchStubs();
});
