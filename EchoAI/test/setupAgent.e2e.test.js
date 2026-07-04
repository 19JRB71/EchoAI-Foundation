/**
 * End-to-end test for the AI Setup Agent.
 *
 * Drives a fresh, non-admin user through the whole onboarding flow the way the
 * client does — interview → consent → the /execute action loop → completion —
 * against a real Express router (real auth, lockout, requireOwner, and
 * requireSetupConsent middleware) and the real orchestrated controllers writing
 * to the real database.
 *
 * Only the Anthropic client is stubbed (deterministic, offline, no spend): the
 * shared singleton's `messages.create` is replaced with a fake that returns
 * schema-valid JSON per system prompt, so every controller the setup agent
 * orchestrates (brand discovery, appointments, content calendar, ad creatives,
 * social schedule, email drip) runs for real.
 *
 * Coverage:
 *   - A Professional user completes every configuration step end-to-end, real DB
 *     rows are created, and consent is auto-revoked on completion.
 *   - An Enterprise user (which outranks Professional) also completes every step
 *     with nothing wrongly gated out, guarding tier-ranking regressions.
 *   - A Starter user's Pro-gated steps are skipped gracefully (flow still
 *     completes) while baseline steps run.
 *   - An invited team member is blocked (403) by requireOwner.
 *   - Consent is auto-revoked on dismiss, and a finished session can't be re-run.
 *
 * Run with:  node --test test/setupAgent.e2e.test.js   (from EchoAI/)
 */

require("dotenv").config();

// Runs before config/db opens a pool: prefers TEST_DATABASE_URL and hard-fails
// against anything that looks like production, so this destructive suite can
// never mutate real customer data.
require("../tests/dbGuard");

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const express = require("express");
const jwt = require("jsonwebtoken");

const db = require("../config/db");
const anthropicModule = require("../config/anthropic");
const setupAgentRoutes = require("../routes/setupAgentRoutes");
const {
  EXECUTION_LEASE_SECONDS,
  executeNextAction,
  ACTIONS,
} = require("../controllers/setupAgentController");

// ---------------------------------------------------------------------------
// Deterministic AI stub — replaces the shared Anthropic singleton's create().
// Branches on the system prompt so each orchestrated controller gets a valid
// response shape. Never calls the network.
// ---------------------------------------------------------------------------

function textResponse(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return { content: [{ type: "text", text }] };
}

const originalCreate = anthropicModule.anthropic.messages.create;

function installAiStub() {
  anthropicModule.anthropic.messages.create = async ({ system, messages }) => {
    const sys = String(system || "");

    // 1. Setup interview — complete after a couple of answers.
    if (sys.includes("You are EchoAI's Setup Agent")) {
      const userTurns = (messages || []).filter((m) => m.role === "user").length;
      const complete = userTurns >= 3;
      return textResponse({
        message: complete
          ? "Perfect, I have everything I need to set things up!"
          : "Got it — tell me a little more.",
        suggestion: "",
        collects: complete ? "" : `field_${userTurns}`,
        complete,
      });
    }

    // 2. Brand profile synthesis (brand discovery confirm path).
    if (sys.includes("extracting a structured brand profile")) {
      return textResponse({
        brand_name: "Test Bakery Co",
        brand_personality: "warm, artisanal, community-focused",
        voice_description: "friendly, inviting, and down-to-earth",
        visual_style_preferences: {
          description: "rustic warm tones with natural textures",
          palette: ["#8B4513", "#F5DEB3"],
          mood: "cozy",
        },
        target_audience: {
          description: "local families who value fresh, handmade food",
          demographics: "ages 25-55, local neighborhood",
          interests: ["baking", "local food", "community"],
        },
      });
    }

    // 3. Content calendar — return plenty of valid slots (mapped by index).
    if (sys.includes("AI Content Calendar agent")) {
      const posts = Array.from({ length: 250 }, (_, i) => ({
        slot: i + 1,
        contentType: "educational",
        postText: `Fresh from the oven: on-brand bakery post number ${i + 1}.`,
        hashtags: ["bakery", "local"],
        visualIdea: "A photo of fresh bread on a rustic table.",
        callToAction: "Visit us today!",
        bestPostingTime: "13:00",
      }));
      return textResponse(posts);
    }

    // 4. Ad creative director — exactly five complete packages.
    if (sys.includes("Ad Creative Director")) {
      const pkg = (n) => ({
        conceptName: `Concept ${n}`,
        angle: "benefit-led",
        headline: `Fresh Bread Daily ${n}`,
        bodyCopyVariations: [
          "Warm bread, baked fresh every morning.",
          "Taste the difference real ingredients make.",
        ],
        imageDescription:
          "A rustic sourdough loaf on a wooden table with warm morning light.",
        videoScript: {
          hook: "Smell that?",
          scenes: ["The oven opens", "Bread cooling on a rack", "A happy customer"],
          cta: "Come taste it today",
        },
        audienceTargeting: {
          description: "Local food lovers who value handmade quality",
          ageMin: 25,
          ageMax: 60,
          interests: ["baking", "local food"],
          demographics: "families in the neighborhood",
        },
        recommendedPlacements: ["Facebook Feed", "Instagram Stories"],
        callToAction: "Learn More",
      });
      return textResponse({ packages: [pkg(1), pkg(2), pkg(3), pkg(4), pkg(5)] });
    }

    // 5. Email drip designer — five valid drip emails.
    if (sys.includes("Drip Sequence Designer")) {
      const email = (i) => ({
        sendDelayDays: i === 0 ? 0 : i * 2,
        subjectVariations: [`Welcome ${i}`, `Hello there ${i}`, `Glad you're here ${i}`],
        previewText: "Thanks for joining our bakery family",
        bodyHtml: `<p>Welcome email number ${i} from Test Bakery Co.</p>`,
        bodyPlainText: `Welcome email number ${i} from Test Bakery Co.`,
      });
      return textResponse([email(0), email(1), email(2), email(3), email(4)]);
    }

    // 6. Survey designer — five on-brand questions, exactly one 1-10 rating.
    if (sys.includes("customer-experience researcher")) {
      return textResponse({
        questions: [
          {
            id: "satisfaction",
            question: "How satisfied were you overall? (1 = unhappy, 10 = delighted)",
            type: "rating",
          },
          { id: "what_we_did_well", question: "What did we do well?", type: "text" },
          { id: "what_to_improve", question: "What could we improve?", type: "text" },
          { id: "recommend", question: "Would you recommend us to a friend? Why?", type: "text" },
          { id: "anything_else", question: "Anything else you'd like us to know?", type: "text" },
        ],
      });
    }

    throw new Error(`Unexpected AI call in test for system prompt: ${sys.slice(0, 80)}`);
  };
}

function restoreAiStub() {
  anthropicModule.anthropic.messages.create = originalCreate;
}

// ---------------------------------------------------------------------------
// Test HTTP harness + fixtures
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

async function createUser({ tier = "pro", role = "user" } = {}) {
  const email = `setup-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, role, subscription_tier)
     VALUES ($1, $2, $3::user_role, $4::subscription_tier)
     RETURNING user_id`,
    [email, "not-a-real-hash", role, tier],
  );
  const userId = rows[0].user_id;
  createdUserIds.push(userId);

  // The tier source of truth is the subscriptions table (getUserTier reads it).
  await db.query(
    `INSERT INTO subscriptions (user_id, subscription_tier, payment_status, is_locked)
     VALUES ($1, $2::subscription_tier, 'active', FALSE)`,
    [userId, tier],
  );

  const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "1h" });
  return { userId, email, token };
}

async function createTeamMember(ownerId) {
  const { token, userId } = await createUser({ tier: "pro" });
  await db.query(
    `INSERT INTO team_members
       (account_owner_user_id, invited_user_id, email, role, status, accepted_at)
     VALUES ($1, $2, $3, 'manager', 'active', NOW())`,
    [ownerId, userId, `member-${userId}@example.com`],
  );
  return { token, userId };
}

// Drive the interview to completion, then return the session.
async function completeInterview(token) {
  let res = await apiRequest(token, "POST", "/session", {});
  assert.equal(res.status, 200, `initiateSession failed: ${JSON.stringify(res.body)}`);
  let session = res.body.session;
  let question = res.body.question;

  let guard = 0;
  while (question && !question.complete && guard++ < 15) {
    res = await apiRequest(token, "POST", "/answer", {
      sessionId: session.sessionId,
      answer: "We are a small local bakery selling fresh bread and pastries to families.",
    });
    assert.equal(res.status, 200, `submitAnswer failed: ${JSON.stringify(res.body)}`);
    session = res.body.session;
    question = res.body.question;
  }
  assert.ok(question && question.complete, "interview never completed");
  return session;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// /execute releases its concurrency claim in a `finally` that runs *after* the
// HTTP response is sent, so a tightly-sequenced next call can momentarily see
// the lock (409 "already running"). The real client retries; so do we.
async function executeStep(token, body) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await apiRequest(token, "POST", "/execute", body);
    if (res.status === 409 && res.body && /already running/i.test(res.body.error || "")) {
      await sleep(25);
      continue;
    }
    return res;
  }
  throw new Error("execute stayed locked after repeated retries");
}

// Run the /execute loop like the client: skip OAuth handoffs, collect outcomes.
async function runExecuteLoop(token, sessionId) {
  const steps = [];
  let finalSession = null;
  let guard = 0;
  while (guard++ < 25) {
    const res = await executeStep(token, { sessionId });
    assert.equal(res.status, 200, `execute failed: ${JSON.stringify(res.body)}`);
    const b = res.body;
    if (b.allComplete) {
      finalSession = b.session;
      break;
    }
    if (b.status === "needs_connection") {
      // Client resolves/declines the OAuth handoff; here we skip past it.
      const skipRes = await executeStep(token, { sessionId, skip: true });
      assert.equal(skipRes.status, 200, `skip failed: ${JSON.stringify(skipRes.body)}`);
      steps.push({ key: skipRes.body.step.key, status: skipRes.body.status });
      continue;
    }
    steps.push({ key: b.step.key, status: b.status });
  }
  assert.ok(finalSession, "execute loop never reached allComplete");
  return { steps, finalSession };
}

// Run the /execute loop like runExecuteLoop, but stop as soon as `stopKey` has
// been processed (without triggering the final allComplete finalization), so the
// session is left mid-flight with real side effects already written. Returns the
// collected steps and the last /execute response body (carries session.brandId).
async function runUntilStep(token, sessionId, stopKey) {
  const steps = [];
  let lastBody = null;
  let guard = 0;
  while (guard++ < 25) {
    const res = await executeStep(token, { sessionId });
    assert.equal(res.status, 200, `execute failed: ${JSON.stringify(res.body)}`);
    const b = res.body;
    lastBody = b;
    assert.ok(!b.allComplete, `reached allComplete before stop step "${stopKey}"`);
    if (b.status === "needs_connection") {
      const skipRes = await executeStep(token, { sessionId, skip: true });
      assert.equal(skipRes.status, 200, `skip failed: ${JSON.stringify(skipRes.body)}`);
      lastBody = skipRes.body;
      steps.push({ key: skipRes.body.step.key, status: skipRes.body.status });
      if (skipRes.body.step.key === stopKey) return { steps, lastBody };
      continue;
    }
    steps.push({ key: b.step.key, status: b.status });
    if (b.step.key === stopKey) return { steps, lastBody };
  }
  throw new Error(`runUntilStep never reached "${stopKey}"`);
}

// Count the three headline side effects for a brand, so a resumed step that
// re-runs its work can be proven idempotent (counts must not grow).
async function countSideEffects(brandId) {
  const [cal, creatives, series] = await Promise.all([
    db.query("SELECT COUNT(*)::int AS n FROM content_calendars WHERE brand_id = $1", [brandId]),
    db.query("SELECT COUNT(*)::int AS n FROM ad_creatives WHERE brand_id = $1", [brandId]),
    db.query(
      "SELECT COUNT(*)::int AS n FROM email_marketing_campaigns WHERE brand_id = $1 AND campaign_name = 'Welcome Series'",
      [brandId],
    ),
  ]);
  return { cal: cal.rows[0].n, creatives: creatives.rows[0].n, series: series.rows[0].n };
}

test.before(async () => {
  installAiStub();
  const app = express();
  app.use(express.json());
  app.use("/api/setup-agent", setupAgentRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/setup-agent`;
});

test.after(async () => {
  restoreAiStub();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (createdUserIds.length) {
    await db.query(`DELETE FROM users WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
  }
  await db.pool.end();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("Professional user completes the full setup flow end-to-end", async () => {
  const { userId, token } = await createUser({ tier: "pro" });

  const session = await completeInterview(token);
  assert.equal(session.interviewComplete, true);
  assert.equal(session.consentGranted, false);

  // Consent is required before any action runs.
  const denied = await apiRequest(token, "POST", "/execute", { sessionId: session.sessionId });
  assert.equal(denied.status, 403, "execute should be blocked before consent");
  assert.equal(denied.body.consentRequired, true);

  const consent = await apiRequest(token, "POST", "/consent", { sessionId: session.sessionId });
  assert.equal(consent.status, 200);
  assert.equal(consent.body.session.consentGranted, true);

  const { steps, finalSession } = await runExecuteLoop(token, session.sessionId);
  const byKey = Object.fromEntries(steps.map((s) => [s.key, s.status]));

  // Every configuration step ran; baseline + Pro-gated steps all executed.
  assert.equal(byKey.create_brand_profile, "done");
  assert.equal(byKey.set_availability, "done");
  assert.equal(byKey.connect_google, "skipped"); // OAuth handoff skipped in test
  assert.equal(byKey.content_calendar, "done");
  assert.equal(byKey.ad_creatives, "done");
  // No social account is connected in the test, so the connect handoff is skipped
  // (same class as connect_google) — the calendar still activates below.
  assert.equal(byKey.connect_social, "skipped");
  assert.equal(byKey.social_schedule, "done");
  assert.equal(byKey.email_preferences, "done");
  // The Enterprise-only survey step is gated above Professional, so it is skipped.
  assert.equal(byKey.create_survey, "skipped");

  // Completion state + consent auto-revoke.
  assert.equal(finalSession.status, "completed");
  assert.equal(finalSession.consentGranted, false);

  // Real rows were written by the orchestrated controllers.
  const brandId = finalSession.brandId;
  assert.ok(brandId, "a brand should have been created");

  const [cal, creatives, series, scheduled, avail, survey] = await Promise.all([
    db.query("SELECT 1 FROM content_calendars WHERE brand_id = $1", [brandId]),
    db.query("SELECT 1 FROM ad_creatives WHERE brand_id = $1", [brandId]),
    db.query(
      "SELECT 1 FROM email_marketing_campaigns WHERE brand_id = $1 AND campaign_name = 'Welcome Series'",
      [brandId],
    ),
    db.query("SELECT 1 FROM social_posts WHERE brand_id = $1 AND status = 'scheduled'", [brandId]),
    db.query("SELECT 1 FROM availability_schedules WHERE brand_id = $1", [brandId]),
    db.query("SELECT 1 FROM surveys WHERE brand_id = $1", [brandId]),
  ]);
  assert.ok(cal.rows.length > 0, "content calendar row missing");
  assert.ok(creatives.rows.length > 0, "ad creatives row missing");
  assert.ok(series.rows.length > 0, "welcome email series missing");
  assert.ok(scheduled.rows.length > 0, "social posts were not scheduled");
  assert.ok(avail.rows.length > 0, "availability schedule missing");
  // Professional is below Enterprise, so no survey was created.
  assert.equal(survey.rows.length, 0, "Professional should not get a survey");

  // A finished session can never be re-run without a fresh grant.
  const rerun = await apiRequest(token, "POST", "/execute", { sessionId: session.sessionId });
  assert.equal(rerun.status, 409, "finished session should reject further execution");

  // Sanity: the brand belongs to this user.
  const owned = await db.query("SELECT 1 FROM brands WHERE brand_id = $1 AND user_id = $2", [
    brandId,
    userId,
  ]);
  assert.ok(owned.rows.length > 0, "brand ownership mismatch");
});

test("Enterprise user completes every setup step (nothing wrongly gated)", async () => {
  // Enterprise outranks Professional (TIER_RANK: enterprise > pro), so every
  // Pro-gated action must still run for an Enterprise account — no step may be
  // skipped for tier reasons. This guards against a tier-ranking regression and
  // against any future Enterprise-only setup step being wrongly gated out.
  const { userId, token } = await createUser({ tier: "enterprise" });

  const session = await completeInterview(token);
  assert.equal(session.interviewComplete, true);
  assert.equal(session.consentGranted, false);

  const consent = await apiRequest(token, "POST", "/consent", { sessionId: session.sessionId });
  assert.equal(consent.status, 200);
  assert.equal(consent.body.session.consentGranted, true);

  const { steps, finalSession } = await runExecuteLoop(token, session.sessionId);
  const byKey = Object.fromEntries(steps.map((s) => [s.key, s.status]));

  // Every configuration step ran; baseline + Pro-gated steps all executed, just
  // like Professional. connect_google is the only OAuth handoff (skipped here).
  assert.equal(byKey.create_brand_profile, "done");
  assert.equal(byKey.set_availability, "done");
  assert.equal(byKey.connect_google, "skipped"); // OAuth handoff skipped in test
  assert.equal(byKey.content_calendar, "done");
  assert.equal(byKey.ad_creatives, "done");
  // No social account is connected in the test, so the connect handoff is skipped
  // (same class as connect_google) — the calendar still activates below.
  assert.equal(byKey.connect_social, "skipped");
  assert.equal(byKey.social_schedule, "done");
  assert.equal(byKey.email_preferences, "done");
  // The Enterprise-only survey step runs to completion for an Enterprise account.
  assert.equal(byKey.create_survey, "done");
  // The first-campaign step skips because no Facebook ad account is connected in
  // the test (a connection handoff, not a tier gate) — same class as connect_google.
  assert.equal(byKey.create_facebook_campaign, "skipped");
  // Google Ads setup skips because this interview didn't opt in (an opt-in
  // decision, not a tier gate).
  assert.equal(byKey.setup_google_ads, "skipped");

  // No step was skipped for a tier/gating reason — the only skips are the
  // connection-dependent ones (Google OAuth handoff + Facebook ad-account link)
  // and the opt-in-dependent Google Ads step.
  const CONNECTION_STEPS = new Set([
    "connect_google",
    "create_facebook_campaign",
    "connect_social",
    "setup_google_ads",
  ]);
  const gateSkipped = steps.filter((s) => s.status === "skipped" && !CONNECTION_STEPS.has(s.key));
  assert.equal(gateSkipped.length, 0, `Enterprise wrongly skipped: ${JSON.stringify(gateSkipped)}`);

  // Completion state + consent auto-revoke.
  assert.equal(finalSession.status, "completed");
  assert.equal(finalSession.consentGranted, false);

  // The Pro-gated resources were really created for the Enterprise account.
  const brandId = finalSession.brandId;
  assert.ok(brandId, "a brand should have been created");
  const [cal, creatives, series, scheduled, avail, survey] = await Promise.all([
    db.query("SELECT 1 FROM content_calendars WHERE brand_id = $1", [brandId]),
    db.query("SELECT 1 FROM ad_creatives WHERE brand_id = $1", [brandId]),
    db.query(
      "SELECT 1 FROM email_marketing_campaigns WHERE brand_id = $1 AND campaign_name = 'Welcome Series'",
      [brandId],
    ),
    db.query("SELECT 1 FROM social_posts WHERE brand_id = $1 AND status = 'scheduled'", [brandId]),
    db.query("SELECT 1 FROM availability_schedules WHERE brand_id = $1", [brandId]),
    db.query("SELECT 1 FROM surveys WHERE brand_id = $1", [brandId]),
  ]);
  assert.ok(cal.rows.length > 0, "content calendar row missing");
  assert.ok(creatives.rows.length > 0, "ad creatives row missing");
  assert.ok(series.rows.length > 0, "welcome email series missing");
  assert.ok(scheduled.rows.length > 0, "social posts were not scheduled");
  assert.ok(avail.rows.length > 0, "availability schedule missing");
  // The Enterprise-only survey was really created.
  assert.ok(survey.rows.length > 0, "Enterprise survey row missing");

  // A finished session can never be re-run without a fresh grant.
  const rerun = await apiRequest(token, "POST", "/execute", { sessionId: session.sessionId });
  assert.equal(rerun.status, 409, "finished session should reject further execution");

  // Sanity: the brand belongs to this Enterprise user.
  const owned = await db.query("SELECT 1 FROM brands WHERE brand_id = $1 AND user_id = $2", [
    brandId,
    userId,
  ]);
  assert.ok(owned.rows.length > 0, "brand ownership mismatch");
});

test("Starter user skips Pro-gated steps gracefully and still completes", async () => {
  const { token } = await createUser({ tier: "starter" });

  const session = await completeInterview(token);
  await apiRequest(token, "POST", "/consent", { sessionId: session.sessionId });

  const { steps, finalSession } = await runExecuteLoop(token, session.sessionId);
  const byKey = Object.fromEntries(steps.map((s) => [s.key, s.status]));

  // Baseline step still runs.
  assert.equal(byKey.create_brand_profile, "done");
  // Pro-gated steps are skipped gracefully rather than blocking the flow.
  assert.equal(byKey.set_availability, "skipped");
  assert.equal(byKey.content_calendar, "skipped");
  assert.equal(byKey.ad_creatives, "skipped");
  assert.equal(byKey.email_preferences, "skipped");
  // Social schedule is baseline but no-ops when there's no calendar to activate.
  assert.equal(byKey.social_schedule, "skipped");
  // The Enterprise-only survey step is gated above Starter, so it is skipped.
  assert.equal(byKey.create_survey, "skipped");

  assert.equal(finalSession.status, "completed");
  assert.equal(finalSession.consentGranted, false);

  // A Starter brand exists, but no Pro-gated or Enterprise-gated resources were created.
  const brandId = finalSession.brandId;
  const [cal, creatives, series, survey] = await Promise.all([
    db.query("SELECT 1 FROM content_calendars WHERE brand_id = $1", [brandId]),
    db.query("SELECT 1 FROM ad_creatives WHERE brand_id = $1", [brandId]),
    db.query("SELECT 1 FROM email_marketing_campaigns WHERE brand_id = $1", [brandId]),
    db.query("SELECT 1 FROM surveys WHERE brand_id = $1", [brandId]),
  ]);
  assert.equal(cal.rows.length, 0, "Starter should not get a content calendar");
  assert.equal(creatives.rows.length, 0, "Starter should not get ad creatives");
  assert.equal(series.rows.length, 0, "Starter should not get an email series");
  assert.equal(survey.rows.length, 0, "Starter should not get a survey");
});

test("Invited team member is blocked from the setup agent (403)", async () => {
  const { userId: ownerId } = await createUser({ tier: "pro" });
  const { token: memberToken } = await createTeamMember(ownerId);

  const res = await apiRequest(memberToken, "POST", "/session", {});
  assert.equal(res.status, 403, "team member should be blocked by requireOwner");
});

test("Consent is auto-revoked on dismiss and the session becomes unusable", async () => {
  const { token } = await createUser({ tier: "pro" });

  const session = await completeInterview(token);
  const consent = await apiRequest(token, "POST", "/consent", { sessionId: session.sessionId });
  assert.equal(consent.body.session.consentGranted, true);

  const dismiss = await apiRequest(token, "POST", "/dismiss", { sessionId: session.sessionId });
  assert.equal(dismiss.status, 200);
  assert.equal(dismiss.body.session.status, "dismissed");
  assert.equal(dismiss.body.session.consentGranted, false, "dismiss must revoke consent");

  // The dismissed session can no longer configure the account.
  const blocked = await apiRequest(token, "POST", "/execute", { sessionId: session.sessionId });
  assert.equal(blocked.status, 409, "dismissed session should reject execution");
});

test("Unauthenticated requests are rejected (401)", async () => {
  const res = await apiRequest(null, "POST", "/session", {});
  assert.equal(res.status, 401);
});

// Crash recovery: a holder that dies mid-step (never releases the lease, never
// heartbeats) must NOT let another /execute take over until the lease window has
// elapsed — but once it has, the next call must reclaim cleanly and resume, and
// every idempotent step's existence-check must prevent duplicate side effects.
test("a crashed holder's lease is reclaimed only after the window, and resume creates no duplicate side effects", async () => {
  const { token } = await createUser({ tier: "pro" });

  const session = await completeInterview(token);
  await apiRequest(token, "POST", "/consent", { sessionId: session.sessionId });
  const sessionId = session.sessionId;

  // Drive the flow to the last configuration step so all three headline side
  // effects (content calendar, ad creatives, welcome email series) are written,
  // but the session is left mid-flight (not finalized).
  const { steps, lastBody } = await runUntilStep(token, sessionId, "email_preferences");
  const byKey = Object.fromEntries(steps.map((s) => [s.key, s.status]));
  assert.equal(byKey.content_calendar, "done");
  assert.equal(byKey.ad_creatives, "done");
  assert.equal(byKey.email_preferences, "done");

  const brandId = lastBody.session.brandId;
  assert.ok(brandId, "a brand should have been created by the partial run");
  const before = await countSideEffects(brandId);
  assert.equal(before.cal, 1, "expected exactly one content calendar after the partial run");
  assert.equal(before.series, 1, "expected exactly one welcome series after the partial run");
  assert.ok(before.creatives > 0, "expected ad creatives after the partial run");

  // Simulate a crash: the process died holding the lease with the idempotent
  // steps' side effects already written, but their completion never recorded and
  // the lease never released — and, being dead, it never heartbeats. We drop the
  // three side-effect steps from completed_steps and re-assert a *fresh* held
  // lease (executing_at = NOW()) owned by a token nobody will release/heartbeat.
  const { rows } = await db.query(
    "SELECT completed_steps FROM setup_sessions WHERE session_id = $1",
    [sessionId],
  );
  const crashResume = ["content_calendar", "ad_creatives", "email_preferences"];
  const trimmed = (rows[0].completed_steps || []).filter((k) => !crashResume.includes(k));
  await db.query(
    `UPDATE setup_sessions
       SET completed_steps = $2::jsonb, executing = TRUE, executing_at = NOW(), executing_token = $3
     WHERE session_id = $1`,
    [sessionId, JSON.stringify(trimmed), crypto.randomUUID()],
  );

  // Within the lease window, the crashed holder's lease must NOT be reclaimable:
  // a fresh /execute is refused so a slow-but-alive step can never be run twice.
  const tooSoon = await apiRequest(token, "POST", "/execute", { sessionId });
  assert.equal(tooSoon.status, 409, "a lease still inside its window must not be reclaimable");
  assert.match(tooSoon.body.error || "", /already running/i);

  // Now let the lease window elapse with no heartbeat (the crashed process is
  // gone). The lease becomes dead and the next /execute reclaims it.
  await db.query(
    "UPDATE setup_sessions SET executing_at = NOW() - (($2::int + 60) || ' seconds')::interval WHERE session_id = $1",
    [sessionId, EXECUTION_LEASE_SECONDS],
  );

  // The reclaiming call resumes the pending steps; each idempotent step finds its
  // existing row and returns done without redoing the work, then setup finalizes.
  const { steps: resumeSteps, finalSession } = await runExecuteLoop(token, sessionId);
  const resumeByKey = Object.fromEntries(resumeSteps.map((s) => [s.key, s.status]));
  assert.equal(resumeByKey.content_calendar, "done", "content calendar step should resume");
  assert.equal(resumeByKey.ad_creatives, "done", "ad creatives step should resume");
  assert.equal(resumeByKey.email_preferences, "done", "welcome email step should resume");
  assert.equal(finalSession.status, "completed", "setup must reach completion after reclaim");
  assert.equal(finalSession.consentGranted, false, "consent is auto-revoked on completion");

  // The crash-recovery guarantee: resuming duplicated nothing.
  const after = await countSideEffects(brandId);
  assert.deepEqual(
    after,
    before,
    `resume duplicated side effects: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  );
});

// HTTP-layer concurrency guard: two (or more) /execute requests fired at the SAME
// in-progress session at once must resolve to a SINGLE step run — one performs the
// step (200), every other is refused (409 "already running"), nobody sees an error,
// and the step's side effect happens exactly once. This complements the DB-level
// lease suite (tests/setupAgent.lease.test.js) by driving the whole route wiring —
// auth, requireOwner, requireSetupConsent, claimExecution, the action runner,
// heartbeat, and releaseExecution — end-to-end, so a regression that reorders the
// claim after the side effect (reintroducing a double-run) fails loudly here.
test("concurrent /execute calls for one session run the step exactly once (HTTP layer)", async () => {
  const { userId, token } = await createUser({ tier: "pro" });

  const session = await completeInterview(token);
  await apiRequest(token, "POST", "/consent", { sessionId: session.sessionId });
  const sessionId = session.sessionId;

  // The first pending step (create_brand_profile) is the one all the concurrent
  // calls will contend for. Make it deliberately slow so every contender's lease
  // claim lands while the winner is still mid-step — this makes the overlap (and
  // thus the test) deterministic rather than dependent on scheduling luck. The
  // winner holds the renewable lease across this delay via its heartbeat.
  const stubbedCreate = anthropicModule.anthropic.messages.create;
  anthropicModule.anthropic.messages.create = async (args) => {
    if (String(args.system || "").includes("extracting a structured brand profile")) {
      await sleep(400);
    }
    return stubbedCreate(args);
  };

  let responses;
  try {
    const CONCURRENCY = 5;
    responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        apiRequest(token, "POST", "/execute", { sessionId }),
      ),
    );
  } finally {
    anthropicModule.anthropic.messages.create = stubbedCreate;
  }

  // No request may surface an error to the user: outcomes are only 200 or 409.
  const unexpected = responses.filter((r) => r.status !== 200 && r.status !== 409);
  assert.equal(
    unexpected.length,
    0,
    `concurrent /execute must never error, got: ${JSON.stringify(unexpected.map((r) => ({ status: r.status, body: r.body })))}`,
  );

  const ran = responses.filter((r) => r.status === 200);
  const refused = responses.filter((r) => r.status === 409);

  // Exactly one call performed the step; every other was refused (queued for retry).
  assert.equal(ran.length, 1, `exactly one concurrent /execute may run the step, got ${ran.length} (a double-run)`);
  assert.equal(
    refused.length,
    responses.length - 1,
    "every other concurrent call must be refused with 409",
  );
  refused.forEach((r) =>
    assert.match(r.body.error || "", /already running/i, "refusals must be the concurrency guard, not another error"),
  );

  // The single winner ran the first pending step to completion.
  assert.equal(ran[0].body.step.key, "create_brand_profile");
  assert.equal(ran[0].body.status, "done");

  // The step's side effect happened exactly once despite the concurrent burst.
  const brands = await db.query("SELECT brand_id FROM brands WHERE user_id = $1", [userId]);
  assert.equal(
    brands.rows.length,
    1,
    "concurrent /execute must create exactly one brand (no duplicated side effect)",
  );
});

// A single AI-heavy step failing (e.g. the drip designer erroring after all its
// upstream retries) must NEVER block setup completion: the step is recorded as
// skipped with a friendly, actionable message and the run continues to
// allComplete. This guards the "one failed step can't stop setup" guarantee.
test("a failing step (drip designer) is skipped with a friendly message and setup still completes", async () => {
  const { token } = await createUser({ tier: "pro" });
  const session = await completeInterview(token);
  await apiRequest(token, "POST", "/consent", { sessionId: session.sessionId });
  const sessionId = session.sessionId;

  // Force the Drip Sequence Designer to fail as if all retries were exhausted.
  const inner = anthropicModule.anthropic.messages.create;
  anthropicModule.anthropic.messages.create = async (args) => {
    if (String(args.system || "").includes("Drip Sequence Designer")) {
      const err = new Error("AI provider unavailable");
      err.status = 502;
      throw err;
    }
    return inner(args);
  };

  // Drive /execute like the client, capturing the email step's full outcome.
  let emailOutcome = null;
  let finalSession = null;
  let guard = 0;
  try {
    while (guard++ < 25) {
      const res = await executeStep(token, { sessionId });
      assert.equal(res.status, 200, `execute failed: ${JSON.stringify(res.body)}`);
      const b = res.body;
      if (b.allComplete) {
        finalSession = b.session;
        break;
      }
      if (b.status === "needs_connection") {
        const skipRes = await executeStep(token, { sessionId, skip: true });
        assert.equal(skipRes.status, 200, `skip failed: ${JSON.stringify(skipRes.body)}`);
        if (skipRes.body.step && skipRes.body.step.key === "email_preferences") {
          emailOutcome = skipRes.body;
        }
        continue;
      }
      if (b.step.key === "email_preferences") emailOutcome = b;
    }
  } finally {
    anthropicModule.anthropic.messages.create = inner;
  }

  // The whole run finished despite the failed step.
  assert.ok(finalSession, "setup should reach allComplete even when a step fails");

  // The email step ran, was marked skipped (not fatal), and carried the friendly
  // message pointing the user to the Email Marketing section.
  assert.ok(emailOutcome, "email_preferences step should have been attempted");
  assert.equal(emailOutcome.status, "skipped", "a failed drip step must be skipped, not fatal");
  assert.match(emailOutcome.detail, /Email Marketing section/);
});

// ---------------------------------------------------------------------------
// Lifecycle-vs-execute interleaving.
//
// /pause and /dismiss flip status (and dismiss revokes consent) with a plain
// UPDATE that does not consult the execution lease, while an in-flight /execute
// still writes completed_steps and — when the last step finishes — flips
// status='completed'. If those execute writes ignored the lifecycle status, a
// pause/dismiss that landed mid-step could be silently clobbered: a "dismissed"
// session could be resurrected to "completed", or a cancelled run could keep
// recording progress. These tests fire /pause and /dismiss while a step is
// genuinely mid-run (lease held via the AI-stub delay trick) and assert the
// resulting state is coherent under both orderings.
// ---------------------------------------------------------------------------

// Wrap the AI stub so create_brand_profile's synthesis call blocks for `ms`,
// holding the execution lease across the delay. Returns a restore fn.
function delayBrandSynthesis(ms) {
  const inner = anthropicModule.anthropic.messages.create;
  anthropicModule.anthropic.messages.create = async (args) => {
    if (String(args.system || "").includes("extracting a structured brand profile")) {
      await sleep(ms);
    }
    return inner(args);
  };
  return () => {
    anthropicModule.anthropic.messages.create = inner;
  };
}

// Read the raw setup_sessions row (as the requireSetupConsent middleware would).
async function loadSessionRow(sessionId) {
  const { rows } = await db.query("SELECT * FROM setup_sessions WHERE session_id = $1", [sessionId]);
  return rows[0];
}

// Invoke executeNextAction directly with a hand-built req/res, so we can hand it
// a *stale* in_progress session snapshot (exactly what the middleware attaches)
// and model the TOCTOU where a pause/dismiss commits after that read but before
// the handler's finalize UPDATE.
function invokeExecute({ userId, setupSession, body = {} }) {
  return new Promise((resolve, reject) => {
    const req = { user: { userId }, setupSession, body };
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
    Promise.resolve(executeNextAction(req, res)).catch(reject);
  });
}

test("dismiss during an in-flight step cancels coherently (no resurrection to completed)", async () => {
  const { userId, token } = await createUser({ tier: "pro" });
  const session = await completeInterview(token);
  await apiRequest(token, "POST", "/consent", { sessionId: session.sessionId });
  const sessionId = session.sessionId;

  // Make the first step (create_brand_profile) slow so the lease is genuinely
  // held mid-run when dismiss lands. Fire /execute without awaiting, wait for the
  // lease to be claimed and the step to be mid-flight, then /dismiss.
  const restore = delayBrandSynthesis(400);
  try {
    const executing = apiRequest(token, "POST", "/execute", { sessionId });
    await sleep(120); // lease claimed; step is inside the 400ms synthesis delay

    const dismiss = await apiRequest(token, "POST", "/dismiss", { sessionId });
    assert.equal(dismiss.status, 200, `dismiss failed: ${JSON.stringify(dismiss.body)}`);
    assert.equal(dismiss.body.session.status, "dismissed");
    assert.equal(dismiss.body.session.consentGranted, false, "dismiss must revoke consent");

    const execRes = await executing;
    // The in-flight step ran, but its completed_steps write is guarded on
    // status='in_progress', so it could not advance a cancelled run. It reports a
    // 409 conflict carrying the real (dismissed) session — never a false success.
    assert.equal(execRes.status, 409, `execute should conflict, got: ${JSON.stringify(execRes.body)}`);
    assert.equal(execRes.body.session.status, "dismissed");
  } finally {
    restore();
  }

  // Final state is coherent under this ordering: dismissed + consent revoked, and
  // NOT resurrected to completed by the in-flight step.
  const finalRow = await loadSessionRow(sessionId);
  assert.equal(finalRow.status, "dismissed", "an in-flight step must not un-dismiss the session");
  assert.equal(finalRow.consent_granted, false, "consent must stay revoked after dismiss");

  // The in-flight step's side effect (brand creation) is idempotent — exactly one
  // brand exists, never a duplicate.
  const brands = await db.query("SELECT brand_id FROM brands WHERE user_id = $1", [userId]);
  assert.equal(brands.rows.length, 1, "dismiss mid-step must not duplicate the brand side effect");

  // The dismissed session is terminal — a late /execute is refused by the guard.
  const late = await apiRequest(token, "POST", "/execute", { sessionId });
  assert.equal(late.status, 409, "a dismissed session must reject further execution");
});

test("pause during an in-flight step is preserved (not overwritten by the step)", async () => {
  const { userId, token } = await createUser({ tier: "pro" });
  const session = await completeInterview(token);
  await apiRequest(token, "POST", "/consent", { sessionId: session.sessionId });
  const sessionId = session.sessionId;

  const restore = delayBrandSynthesis(400);
  try {
    const executing = apiRequest(token, "POST", "/execute", { sessionId });
    await sleep(120);

    const pause = await apiRequest(token, "POST", "/pause", { sessionId });
    assert.equal(pause.status, 200, `pause failed: ${JSON.stringify(pause.body)}`);

    const execRes = await executing;
    // The step ran, but its guarded write can't advance a session the user paused.
    assert.equal(execRes.status, 409, `execute should conflict, got: ${JSON.stringify(execRes.body)}`);
    assert.equal(execRes.body.session.status, "paused");
  } finally {
    restore();
  }

  // The pause is preserved (not flipped to completed/in_progress by the step).
  const finalRow = await loadSessionRow(sessionId);
  assert.equal(finalRow.status, "paused", "an in-flight step must not overwrite a pause");
  assert.equal(finalRow.consent_granted, true, "pause must not revoke consent");

  // The paused session resumes cleanly and finishes — the idempotent steps find
  // the already-created brand and duplicate nothing.
  const resume = await apiRequest(token, "POST", "/session", {});
  assert.equal(resume.status, 200);
  assert.equal(resume.body.resumed, true);
  const { finalSession } = await runExecuteLoop(token, sessionId);
  assert.equal(finalSession.status, "completed", "a resumed paused session must complete");

  const brands = await db.query("SELECT brand_id FROM brands WHERE user_id = $1", [userId]);
  assert.equal(brands.rows.length, 1, "pause + resume must not duplicate the brand side effect");
});

// The finalize UPDATE (status → 'completed') is the sharpest corruption risk:
// the requireSetupConsent middleware reads the session at request start, so a
// dismiss that commits AFTER that read but BEFORE the handler's finalize UPDATE
// leaves the handler holding a stale in_progress snapshot. We reproduce that
// exact interleaving deterministically by invoking executeNextAction with the
// stale snapshot after committing the dismiss/pause, proving the finalize guard
// refuses to resurrect a cancelled session.
test("finalize can't resurrect a session dismissed after the consent-middleware read (TOCTOU)", async () => {
  const { userId, token } = await createUser({ tier: "pro" });
  const session = await completeInterview(token);
  await apiRequest(token, "POST", "/consent", { sessionId: session.sessionId });
  const sessionId = session.sessionId;

  // Bring the session to "every step done, still in_progress" so the next execute
  // would hit the finalize branch. Run through the real steps, then mark all
  // action keys complete (the pending gated survey included) so nothing is left.
  await runUntilStep(token, sessionId, "email_preferences");
  await db.query(
    `UPDATE setup_sessions
       SET completed_steps = $2::jsonb, status = 'in_progress', consent_granted = TRUE,
           executing = FALSE, executing_at = NULL, executing_token = NULL
     WHERE session_id = $1`,
    [sessionId, JSON.stringify(ACTIONS.map((a) => a.key))],
  );

  // Model the middleware read: a fresh in_progress snapshot the handler will act on.
  const staleSnapshot = await loadSessionRow(sessionId);
  assert.equal(staleSnapshot.status, "in_progress");

  // The user dismisses AFTER that read but BEFORE the finalize UPDATE.
  const dismiss = await apiRequest(token, "POST", "/dismiss", { sessionId });
  assert.equal(dismiss.status, 200);
  assert.equal(dismiss.body.session.status, "dismissed");

  // The in-flight finalize now runs against the stale in_progress snapshot.
  const execRes = await invokeExecute({ userId, setupSession: staleSnapshot, body: { sessionId } });
  // The finalize is guarded on status='in_progress', so it matches no row and
  // does NOT flip the dismissed session to completed. It reports the real state.
  assert.equal(execRes.status, 409, `finalize should conflict, got: ${JSON.stringify(execRes.body)}`);
  assert.notEqual(execRes.body.allComplete, true, "finalize must not claim completion of a dismissed run");
  assert.equal(execRes.body.session.status, "dismissed");

  const finalRow = await loadSessionRow(sessionId);
  assert.equal(finalRow.status, "dismissed", "finalize must never un-dismiss the session");
  assert.equal(finalRow.consent_granted, false, "consent must stay revoked after dismiss");
});

test("finalize can't complete a session paused after the consent-middleware read (TOCTOU)", async () => {
  const { userId, token } = await createUser({ tier: "pro" });
  const session = await completeInterview(token);
  await apiRequest(token, "POST", "/consent", { sessionId: session.sessionId });
  const sessionId = session.sessionId;

  await runUntilStep(token, sessionId, "email_preferences");
  await db.query(
    `UPDATE setup_sessions
       SET completed_steps = $2::jsonb, status = 'in_progress', consent_granted = TRUE,
           executing = FALSE, executing_at = NULL, executing_token = NULL
     WHERE session_id = $1`,
    [sessionId, JSON.stringify(ACTIONS.map((a) => a.key))],
  );

  const staleSnapshot = await loadSessionRow(sessionId);

  const pause = await apiRequest(token, "POST", "/pause", { sessionId });
  assert.equal(pause.status, 200);

  const execRes = await invokeExecute({ userId, setupSession: staleSnapshot, body: { sessionId } });
  assert.equal(execRes.status, 409, `finalize should conflict, got: ${JSON.stringify(execRes.body)}`);
  assert.notEqual(execRes.body.allComplete, true, "finalize must not complete a paused run");
  assert.equal(execRes.body.session.status, "paused");

  const finalRow = await loadSessionRow(sessionId);
  assert.equal(finalRow.status, "paused", "finalize must not overwrite a pause with completion");
  assert.equal(finalRow.consent_granted, true, "pause must not revoke consent");
});
