/**
 * Tenant-isolation regression suite (REPLIT_PROMPT_014).
 *
 * A dedicated, cross-cutting suite that probes several product surfaces for
 * cross-tenant leaks. The invariant under test everywhere:
 *
 *   When tenant A asks for tenant B's resource by a direct id, the response is
 *   a 403 or 404 AND the body never contains any of B's data. Every surface is
 *   also exercised on its happy path (A reading A's own resource) at least once,
 *   so the 404s prove isolation rather than a broken query.
 *
 * Surfaces covered:
 *   1. Email marketing  — getOwnedCampaign consumers (getCampaignDetail,
 *      setCampaignStatus/pause, cancelCampaign) + getOwnedBrand consumer
 *      (getCampaigns). Includes a recipients-level probe (detail leaks
 *      recipient rows only for owned campaigns).
 *   2. Integrations     — google connection-status is user-scoped (keyed by
 *      req.user.userId only). A's status must never reflect B's row; there is
 *      no id param to smuggle a foreign row through.
 *   3. Setup sessions   — setup_sessions are user-scoped; B's sessionId under A
 *      is a 404 (submitAnswer/grantConsent). setupStatusRoutes is brand-scoped;
 *      B's brandId under A is a 404.
 *   4. Guided setup     — guided_setup_progress is keyed purely by user_id; the
 *      read/write queries never accept a foreign user/brand id (A only ever
 *      sees/writes its own row).
 *   5. Sage             — getOwnedBrand consumers (getBrief/getFeed/getInsights,
 *      dismissFeedItems): B's brandId under A ⇒ 404, body carries no data.
 *   6. Team-member remap correctness — a real HTTP server with the production
 *      auth + rolePermissions middleware: a 'viewer' team member V of owner O
 *      (a) remaps to O's workspace (can READ O's brand) and (b) cannot perform
 *      admin actions (requireRole('admin') team route) or mutate a
 *      denyReadOnlyMutations-guarded route (both 403).
 *
 * Requires the DB guard exactly like companyTruth.test.js.
 */
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");

require("./dbGuard");
const db = require("../config/db");

const emailController = require("../controllers/emailMarketingController");
const guidedController = require("../controllers/guidedSetupController");
const setupAgentController = require("../controllers/setupAgentController");
const googleController = require("../controllers/googleController");
const sageController = require("../controllers/sageController");

// --- helpers (mirrors companyTruth.test.js conventions) ----------------------

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

let seq = 0;
function uniqueEmail(tag) {
  seq += 1;
  return `tenant-iso-${tag}-${Date.now()}-${seq}-${Math.random()
    .toString(36)
    .slice(2)}@example.test`;
}

// Create a fresh tenant: one user + one brand. Raw SQL inserts, like the
// existing createUserBrand helper. Returns ids for probing + cleanup.
async function createTenant(tag, brandName) {
  const email = uniqueEmail(tag);
  const u = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING user_id",
    [email, "test-not-a-real-hash"],
  );
  const userId = u.rows[0].user_id;
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, $2) RETURNING brand_id",
    [userId, brandName],
  );
  return { userId, email, brandId: b.rows[0].brand_id };
}

// FK order matters: children before parents. brands and everything keyed to the
// user cascade from users, but we delete explicitly created rows in dependency
// order and finish with the user (which cascades brands/sessions/etc.).
async function dropTenant(t) {
  if (!t) return;
  // guided_setup_progress + google_integrations + setup_sessions cascade from
  // users; email campaigns/recipients cascade from brands (→ users). Deleting
  // the user removes them all, but we delete children first for clarity/safety.
  await db.query("DELETE FROM email_marketing_recipients r USING email_marketing_campaigns c WHERE r.campaign_id = c.campaign_id AND c.brand_id = $1", [t.brandId]).catch(() => {});
  await db.query("DELETE FROM email_marketing_campaigns WHERE brand_id = $1", [t.brandId]).catch(() => {});
  await db.query("DELETE FROM sage_intelligence_profiles WHERE brand_id = $1", [t.brandId]).catch(() => {});
  await db.query("DELETE FROM guided_setup_progress WHERE user_id = $1", [t.userId]).catch(() => {});
  await db.query("DELETE FROM google_integrations WHERE user_id = $1", [t.userId]).catch(() => {});
  await db.query("DELETE FROM setup_sessions WHERE user_id = $1", [t.userId]).catch(() => {});
  await db.query("DELETE FROM users WHERE user_id = $1", [t.userId]).catch(() => {});
}

// A minimal req.user for controller-level calls (self-owned workspace, exactly
// what the auth middleware produces for a normal owner).
function ownerUser(userId) {
  return {
    userId,
    actualUserId: userId,
    workspaceRole: "owner",
    isTeamMember: false,
    isPlatformAdmin: false,
  };
}

// Deep-scan a response body for a needle (any of B's identifying values). Used
// to prove a 404 body never smuggles B's data.
function bodyContains(body, needle) {
  if (needle == null) return false;
  return JSON.stringify(body || {}).includes(String(needle));
}

// --- 1. Email marketing ------------------------------------------------------

test("email marketing: A cannot read/mutate B's campaign; recipients never leak", async () => {
  const A = await createTenant("emA", "Email Tenant A");
  const B = await createTenant("emB", "Email Tenant B");
  try {
    // B owns a campaign with a distinctive name + a recipient row.
    const bCampaign = await db.query(
      `INSERT INTO email_marketing_campaigns (brand_id, campaign_name, campaign_type, goal, status)
       VALUES ($1, 'B-SECRET-CAMPAIGN', 'drip', 'B private goal', 'sending')
       RETURNING campaign_id`,
      [B.brandId],
    );
    const bCampaignId = bCampaign.rows[0].campaign_id;
    await db.query(
      `INSERT INTO email_marketing_recipients (campaign_id, email_address, delivery_status)
       VALUES ($1, 'b-secret-recipient@example.test', 'pending')`,
      [bCampaignId],
    );

    // A owns its own campaign (happy path anchor).
    const aCampaign = await db.query(
      `INSERT INTO email_marketing_campaigns (brand_id, campaign_name, campaign_type, goal, status)
       VALUES ($1, 'A-OWN-CAMPAIGN', 'drip', 'A goal', 'sending')
       RETURNING campaign_id`,
      [A.brandId],
    );
    const aCampaignId = aCampaign.rows[0].campaign_id;

    // Happy path: A reads its own campaign detail (proves the 404s below mean
    // isolation, not a broken query).
    let res = mockRes();
    await emailController.getCampaignDetail(
      { user: ownerUser(A.userId), params: { campaignId: aCampaignId } },
      res,
    );
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.campaign.campaign_id, aCampaignId);

    // A reads its own brand's campaign list (getOwnedBrand consumer happy path).
    res = mockRes();
    await emailController.getCampaigns(
      { user: ownerUser(A.userId), params: { brandId: A.brandId } },
      res,
    );
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.campaigns.some((c) => c.campaignId === aCampaignId));
    assert.ok(!bodyContains(res.body, "B-SECRET-CAMPAIGN"));

    // Probe 1: A reads B's campaign detail by direct id ⇒ 404, no recipients.
    res = mockRes();
    await emailController.getCampaignDetail(
      { user: ownerUser(A.userId), params: { campaignId: bCampaignId } },
      res,
    );
    assert.strictEqual(res.statusCode, 404);
    assert.ok(!bodyContains(res.body, "B-SECRET-CAMPAIGN"));
    assert.ok(!bodyContains(res.body, "b-secret-recipient@example.test"));
    assert.strictEqual(res.body.recipients, undefined);

    // Probe 2: A lists campaigns for B's brand id ⇒ 404 (getOwnedBrand).
    res = mockRes();
    await emailController.getCampaigns(
      { user: ownerUser(A.userId), params: { brandId: B.brandId } },
      res,
    );
    assert.strictEqual(res.statusCode, 404);
    assert.ok(!bodyContains(res.body, "B-SECRET-CAMPAIGN"));

    // Probe 3: A mutates B's campaign (pause) ⇒ 404, and B's row is untouched.
    res = mockRes();
    await emailController.pauseCampaign(
      { user: ownerUser(A.userId), params: { campaignId: bCampaignId } },
      res,
    );
    assert.strictEqual(res.statusCode, 404);
    assert.ok(!bodyContains(res.body, "B-SECRET-CAMPAIGN"));

    // Probe 4: A deletes/cancels B's campaign ⇒ 404, and it still exists.
    res = mockRes();
    await emailController.cancelCampaign(
      { user: ownerUser(A.userId), params: { campaignId: bCampaignId } },
      res,
    );
    assert.strictEqual(res.statusCode, 404);
    const stillThere = await db.query(
      "SELECT status FROM email_marketing_campaigns WHERE campaign_id = $1",
      [bCampaignId],
    );
    assert.strictEqual(stillThere.rows.length, 1, "A must not be able to delete B's campaign");
    assert.strictEqual(stillThere.rows[0].status, "sending", "A must not be able to pause B's campaign");
  } finally {
    await dropTenant(A);
    await dropTenant(B);
  }
});

// --- 2. Integrations (user-scoped api/google integration) --------------------

test("integrations: google connection-status reflects only the caller's row, never B's", async () => {
  const A = await createTenant("intA", "Integ Tenant A");
  const B = await createTenant("intB", "Integ Tenant B");
  try {
    // B connected Google with a distinctive account email; A connected nothing.
    await db.query(
      `INSERT INTO google_integrations (user_id, google_account_email, scope, connection_status)
       VALUES ($1, 'b-google-secret@example.test', 'openid email', 'connected')`,
      [B.userId],
    );

    // Happy path: B sees its own connection.
    let res = mockRes();
    await googleController.getConnectionStatus({ user: ownerUser(B.userId) }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.connected, true);
    assert.strictEqual(res.body.email, "b-google-secret@example.test");

    // Isolation: A (no integration) must see connected=false, no B email. The
    // endpoint is user-scoped (WHERE user_id = caller) — there is no id param to
    // smuggle B's row through, so this asserts A never reflects B's data.
    res = mockRes();
    await googleController.getConnectionStatus({ user: ownerUser(A.userId) }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.connected, false);
    assert.strictEqual(res.body.email, null);
    assert.ok(!bodyContains(res.body, "b-google-secret@example.test"));
  } finally {
    await dropTenant(A);
    await dropTenant(B);
  }
});

// --- 3. Setup sessions -------------------------------------------------------

test("setup sessions: B's sessionId under A is a 404; B's brandId under A is a 404", async () => {
  const A = await createTenant("ssA", "Setup Tenant A");
  const B = await createTenant("ssB", "Setup Tenant B");
  try {
    // B owns an in-progress setup session tied to B's brand.
    const bSession = await db.query(
      `INSERT INTO setup_sessions (user_id, status, brand_id, interview_complete)
       VALUES ($1, 'in_progress', $2, FALSE)
       RETURNING session_id`,
      [B.userId, B.brandId],
    );
    const bSessionId = bSession.rows[0].session_id;

    // A owns its own session (happy path anchor for grantConsent).
    const aSession = await db.query(
      `INSERT INTO setup_sessions (user_id, status, brand_id, interview_complete)
       VALUES ($1, 'in_progress', $2, FALSE)
       RETURNING session_id`,
      [A.userId, A.brandId],
    );
    const aSessionId = aSession.rows[0].session_id;

    // Happy path: A grants consent on its OWN session.
    let res = mockRes();
    await setupAgentController.grantConsent(
      { user: ownerUser(A.userId), body: { sessionId: aSessionId } },
      res,
    );
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.session.consentGranted, true);

    // Probe 1: A grants consent on B's session id ⇒ 404, B not consented.
    res = mockRes();
    await setupAgentController.grantConsent(
      { user: ownerUser(A.userId), body: { sessionId: bSessionId } },
      res,
    );
    assert.strictEqual(res.statusCode, 404);
    assert.ok(!bodyContains(res.body, bSessionId));
    const bAfter = await db.query(
      "SELECT consent_granted FROM setup_sessions WHERE session_id = $1",
      [bSessionId],
    );
    assert.strictEqual(bAfter.rows[0].consent_granted, false, "A must not grant consent on B's session");

    // Probe 2: A submits an answer to B's session id ⇒ 404 (user-scoped read).
    res = mockRes();
    await setupAgentController.submitAnswer(
      { user: ownerUser(A.userId), body: { sessionId: bSessionId, answer: "trying to hijack" } },
      res,
    );
    assert.strictEqual(res.statusCode, 404);
    assert.ok(!bodyContains(res.body, bSessionId));

    // Probe 3: setupStatusRoutes (onboarding checklist) is brand-scoped. Mount
    // the REAL router (which pins its own auth + lockout) and drive it with A's
    // real JWT to prove B's brandId under A is a 404 through the true handler.
    const secret = process.env.JWT_SECRET;
    assert.ok(secret, "JWT_SECRET must be set");
    const setupStatusRoutes = require("../routes/setupStatusRoutes");
    const app = express();
    app.use(express.json());
    app.use("/api/setup", setupStatusRoutes);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    try {
      const base = `http://127.0.0.1:${server.address().port}/api/setup`;
      const aToken = jwt.sign({ userId: A.userId }, secret, { expiresIn: "1h" });
      const authHeaders = { Authorization: `Bearer ${aToken}` };
      // Happy path: A reads its own brand's status.
      const okResp = await fetch(`${base}/status/${A.brandId}`, { headers: authHeaders });
      assert.strictEqual(okResp.status, 200);
      // Probe: A reads B's brand status ⇒ 404, no B data.
      const foreign = await fetch(`${base}/status/${B.brandId}`, { headers: authHeaders });
      assert.strictEqual(foreign.status, 404);
      const foreignBody = await foreign.json().catch(() => ({}));
      assert.ok(!bodyContains(foreignBody, B.brandId));
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    await dropTenant(A);
    await dropTenant(B);
  }
});

// --- 4. Guided setup progress (keyed purely by user_id) ----------------------

test("guided setup: progress is keyed by user_id; A never reads/writes B's row", async () => {
  const A = await createTenant("gsA", "Guided Tenant A");
  const B = await createTenant("gsB", "Guided Tenant B");
  try {
    // Seed B's progress with a distinctive step + connection flag.
    await db.query(
      `INSERT INTO guided_setup_progress (user_id, current_step, connections)
       VALUES ($1, 'connections', '{"facebook":{"skipped":true}}'::jsonb)`,
      [B.userId],
    );

    // A saves its OWN progress (happy path). Note guided setup takes NO brand id
    // at all — it is purely user-scoped, so there is no foreign id to smuggle.
    let res = mockRes();
    await guidedController.saveProgress(
      { user: ownerUser(A.userId), body: { currentStep: "profile", connections: {} } },
      res,
    );
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.currentStep, "profile");

    // A reads state: sees ONLY its own row (current_step 'profile'), never B's
    // 'connections' step. probe* helpers key on req.user.userId as well.
    res = mockRes();
    await guidedController.getState(
      { user: ownerUser(A.userId), query: {} },
      res,
    );
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.progress.currentStep, "profile");
    assert.ok(!bodyContains(res.body.progress, "connections") || res.body.progress.currentStep !== "connections");

    // B's row is unchanged by A's writes (A's upsert only touched A's row).
    const bRow = await db.query(
      "SELECT current_step FROM guided_setup_progress WHERE user_id = $1",
      [B.userId],
    );
    assert.strictEqual(bRow.rows.length, 1);
    assert.strictEqual(bRow.rows[0].current_step, "connections", "A's save must not touch B's progress");

    // And A has exactly one row of its own.
    const aRow = await db.query(
      "SELECT current_step FROM guided_setup_progress WHERE user_id = $1",
      [A.userId],
    );
    assert.strictEqual(aRow.rows.length, 1);
    assert.strictEqual(aRow.rows[0].current_step, "profile");
  } finally {
    await dropTenant(A);
    await dropTenant(B);
  }
});

// --- 5. Sage (getOwnedBrand consumers) ---------------------------------------

test("sage: B's brandId under A ⇒ 404 across brief/feed/insights; body has no data", async () => {
  const A = await createTenant("sageA", "Sage Tenant A");
  const B = await createTenant("sageB", "Sage Tenant B");
  try {
    // B has an intelligence profile with a distinctive summary.
    await db.query(
      `INSERT INTO sage_intelligence_profiles (brand_id, industry, summary)
       VALUES ($1, 'B-SECRET-INDUSTRY', 'B-SECRET-SUMMARY')`,
      [B.brandId],
    );

    // Happy path: A reads its OWN brief (owned brand ⇒ 200, brief may be null).
    let res = mockRes();
    await sageController.getBrief(
      { user: ownerUser(A.userId), query: { brandId: A.brandId }, body: {} },
      res,
    );
    assert.strictEqual(res.statusCode, 200);
    assert.ok("brief" in res.body);

    // Probe getBrief: A reads B's brief by brandId ⇒ 404, no B summary.
    res = mockRes();
    await sageController.getBrief(
      { user: ownerUser(A.userId), query: { brandId: B.brandId }, body: {} },
      res,
    );
    assert.strictEqual(res.statusCode, 404);
    assert.ok(!bodyContains(res.body, "B-SECRET-SUMMARY"));
    assert.ok(!bodyContains(res.body, "B-SECRET-INDUSTRY"));

    // Probe getFeed: A reads B's feed by brandId ⇒ 404.
    res = mockRes();
    await sageController.getFeed(
      { user: ownerUser(A.userId), query: { brandId: B.brandId }, body: {} },
      res,
    );
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.feed, undefined);

    // Probe getInsights: A reads B's insights by brandId ⇒ 404.
    res = mockRes();
    await sageController.getInsights(
      { user: ownerUser(A.userId), query: { brandId: B.brandId }, body: {} },
      res,
    );
    assert.strictEqual(res.statusCode, 404);
    assert.ok(!bodyContains(res.body, "B-SECRET-SUMMARY"));

    // Probe dismissFeedItems (mutation): A dismisses B's feed by brandId ⇒ 404.
    res = mockRes();
    await sageController.dismissFeedItems(
      { user: ownerUser(A.userId), body: { brandId: B.brandId, all: true }, query: {} },
      res,
    );
    assert.strictEqual(res.statusCode, 404);
  } finally {
    await dropTenant(A);
    await dropTenant(B);
  }
});

// --- 6. Team-member remap correctness (real auth + rolePermissions) ----------

test("team remap: viewer V reads owner O's data but is denied admin actions + mutations", async () => {
  const secret = process.env.JWT_SECRET;
  assert.ok(secret, "JWT_SECRET must be set for the remap test");

  // Owner O with a brand + a sage profile to read; team member V (a real user)
  // linked to O as an ACTIVE 'viewer'.
  const O = await createTenant("teamO", "Owner Workspace Brand");
  const V = await createTenant("teamV", "Viewer Own Brand");
  let server;
  try {
    await db.query(
      `INSERT INTO sage_intelligence_profiles (brand_id, industry, summary)
       VALUES ($1, 'O-INDUSTRY', 'O-BRIEF-SUMMARY')`,
      [O.brandId],
    );
    await db.query(
      `INSERT INTO team_members
         (account_owner_user_id, invited_user_id, email, role, status, accepted_at)
       VALUES ($1, $2, $3, 'viewer', 'active', NOW())`,
      [O.userId, V.userId, `viewer-${V.userId}@example.test`],
    );

    // Real middleware stack: auth (does the remap) → lockout → route guards.
    const auth = require("../middleware/auth");
    const lockout = require("../middleware/lockout");
    const { requireRole, denyReadOnlyMutations } = require("../middleware/rolePermissions");
    const sageRoutes = require("../routes/sageRoutes");
    const teamController = require("../controllers/teamController");

    const app = express();
    app.use(express.json());
    // Sage read surface — proves the remap: V's userId resolves to O.
    app.use("/api/sage", sageRoutes);
    // requireRole('admin') surface (team management): viewer must be blocked.
    const teamRouter = express.Router();
    teamRouter.use(auth, lockout, requireRole("admin"));
    teamRouter.get("/", teamController.listMembers);
    app.use("/api/team", teamRouter);
    // denyReadOnlyMutations surface: a read-only role cannot POST.
    const guardedRouter = express.Router();
    guardedRouter.use(auth, lockout, denyReadOnlyMutations);
    guardedRouter.post("/mutate", (_req, res) => res.json({ mutated: true }));
    app.use("/api/guarded", guardedRouter);

    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;

    const vToken = jwt.sign({ userId: V.userId }, secret, { expiresIn: "1h" });
    const authGet = (path) =>
      fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${vToken}` } });
    const authPost = (path) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${vToken}`, "Content-Type": "application/json" },
        body: "{}",
      });

    // (a) Remap works: V reads O's brand brief via O's brandId. The remap makes
    // req.user.userId === O.userId, so getOwnedBrand(O.userId, O.brandId) hits.
    const briefResp = await authGet(`/api/sage/brief?brandId=${O.brandId}`);
    assert.strictEqual(briefResp.status, 200, "viewer should read owner's brand (remap)");
    const briefBody = await briefResp.json();
    assert.ok(briefBody.brief, "viewer should see owner's sage brief via remap");
    assert.strictEqual(briefBody.brief.summary, "O-BRIEF-SUMMARY");

    // Sanity: V cannot read its OWN brand through the remapped identity (its
    // requests are now scoped to O, not V) — a 404 confirms the remap is total.
    const ownBrand = await authGet(`/api/sage/brief?brandId=${V.brandId}`);
    assert.strictEqual(ownBrand.status, 404, "remapped viewer is scoped to owner, not self");

    // (b1) Admin action denied: requireRole('admin') team route rejects viewer.
    const teamResp = await authGet("/api/team/");
    assert.strictEqual(teamResp.status, 403, "viewer must not access team management");
    const teamBody = await teamResp.json();
    assert.strictEqual(teamBody.requiredRole, "admin");
    assert.strictEqual(teamBody.currentRole, "viewer");

    // (b2) Mutation denied: denyReadOnlyMutations blocks viewer POST.
    const mutResp = await authPost("/api/guarded/mutate");
    assert.strictEqual(mutResp.status, 403, "viewer must not mutate a read-only route group");
    const mutBody = await mutResp.json();
    assert.strictEqual(mutBody.currentRole, "viewer");
    assert.ok(/read-only/i.test(mutBody.error || ""));
  } finally {
    if (server) await new Promise((r) => server.close(r));
    // team_members cascades from users; delete explicitly then the tenants.
    await db.query("DELETE FROM team_members WHERE account_owner_user_id = $1", [O.userId]).catch(() => {});
    await dropTenant(O);
    await dropTenant(V);
  }
});

test.after(async () => {
  await db.pool.end();
});
