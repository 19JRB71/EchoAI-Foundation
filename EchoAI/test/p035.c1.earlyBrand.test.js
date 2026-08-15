/**
 * Prompt 035 correction 035-C1 — conversational-path early brand creation.
 *
 * The four MANDATORY C1 regressions (Section G), driven end-to-end against a
 * real Express router and the real database, with only the AI stubbed:
 *
 *   1. c1.brandCreatedAtNameConfirmation — the onboarding brand is created at
 *      the business-name confirmation boundary (the first engine-directed
 *      business_name turn the owner resolves), NOT at consent/execution.
 *   2. c1.anchorsFireMidInterview — a website anchor supplied LATER in the
 *      same ongoing interview reaches anchorOrchestrator.onAnchorArrival
 *      before the interview completes.
 *   3. c1.abandonedResumeReusesBrand — abandoning after early creation and
 *      resuming binds back to the SAME brand; no duplicate is created.
 *   4. c1.entryChoiceWithIncompleteBrand — with an incomplete interview-created
 *      brand, the probe reports the open (resumable) session, and an explicit
 *      intent:"new_business" still starts unbound (no inherited brand, no
 *      duplicate of the incomplete one).
 *
 * Run with:  node --test test/p035.c1.earlyBrand.test.js   (from EchoAI/)
 */

require("dotenv").config();
require("../tests/dbGuard");

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");

const db = require("../config/db");
const anthropicModule = require("../config/anthropic");
const setupAgentRoutes = require("../routes/setupAgentRoutes");
const anchorOrchestrator = require("../utils/anchorOrchestrator");

// ---------------------------------------------------------------------------
// AI stub — interview turns only (no execution happens in this suite).
// ---------------------------------------------------------------------------

function textResponse(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

const originalCreate = anthropicModule.anthropic.messages.create;

function installAiStub() {
  anthropicModule.anthropic.messages.create = async ({ system, messages }) => {
    const sys = String(system || "");
    if (sys.includes("Setup Agent")) {
      const userTurns = (messages || []).filter((m) => m.role === "user").length;
      return textResponse({
        message: "Got it — tell me more.",
        suggestion: "",
        collects: `field_${userTurns}`,
        complete: false, // completion is engine-decided; the AI never ends it here
      });
    }
    throw new Error(`Unexpected AI call in C1 test: ${sys.slice(0, 60)}`);
  };
}

// ---------------------------------------------------------------------------
// Anchor-orchestrator spy: record arrivals instead of running research.
// ---------------------------------------------------------------------------

const originalOnAnchorArrival = anchorOrchestrator.onAnchorArrival;
let anchorCalls;

// ---------------------------------------------------------------------------
// Harness
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
  const email = `p035c1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function brandCount(userId) {
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS n FROM brands WHERE user_id = $1",
    [userId],
  );
  return rows[0].n;
}

// Start a session and answer questions until the engine-directed current
// field has been business_name and it was answered; returns the session as
// reported by the API after that answer.
async function answerUntil(token, sessionRes, predicate, answerFor) {
  let session = sessionRes.session;
  let question = sessionRes.question;
  let guard = 0;
  while (question && !question.complete && guard++ < 15) {
    const field = session.currentField;
    const res = await apiRequest(token, "POST", "/answer", {
      sessionId: session.sessionId,
      answer: answerFor(field),
    });
    assert.equal(res.status, 200, `answer failed: ${JSON.stringify(res.body)}`);
    session = res.body.session;
    question = res.body.question;
    if (predicate(field, session)) return { session, question, answeredField: field };
  }
  throw new Error("predicate never satisfied in interview loop");
}

test.before(async () => {
  installAiStub();
  anchorOrchestrator.onAnchorArrival = (args) => {
    anchorCalls.push(args);
    return Promise.resolve({ spied: true });
  };
  const app = express();
  app.use(express.json());
  app.use("/api/setup-agent", setupAgentRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/setup-agent`;
});

test.beforeEach(() => {
  anchorCalls = [];
});

test.after(async () => {
  anthropicModule.anthropic.messages.create = originalCreate;
  anchorOrchestrator.onAnchorArrival = originalOnAnchorArrival;
  if (server) await new Promise((resolve) => server.close(resolve));
  if (createdUserIds.length) {
    await db.query(`DELETE FROM brands WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
    await db.query(`DELETE FROM users WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
  }
  await db.pool.end();
});

// ---------------------------------------------------------------------------
// 1. Brand created at name confirmation (Section G1)
// ---------------------------------------------------------------------------

test("c1.brandCreatedAtNameConfirmation — brand exists right after the business_name turn, before consent/execution", async () => {
  const { userId, token } = await createUser();
  const start = await apiRequest(token, "POST", "/session", {});
  assert.equal(start.status, 200);

  assert.equal(await brandCount(userId), 0, "no brand may exist before the name turn");

  const { session } = await answerUntil(
    token,
    start.body,
    (field, s) => field === "business_name" && Boolean(s.brandId),
    (field) => (field === "business_name" ? "South Dixie Storage" : "A small local business."),
  );

  // The brand exists NOW — the interview is still running, no consent given.
  assert.equal(session.interviewComplete, false, "interview must still be in progress");
  assert.equal(session.consentGranted, false);
  assert.ok(session.brandId, "session must be bound to the early-created brand");
  assert.equal(await brandCount(userId), 1, "exactly one brand created at the boundary");

  const { rows } = await db.query(
    "SELECT brand_name FROM brands WHERE brand_id = $1 AND user_id = $2",
    [session.brandId, userId],
  );
  assert.equal(rows[0].brand_name, "South Dixie Storage", "verbatim owner-stated name");

  // Creation counts as an anchor arrival (candidate discovery may begin).
  assert.ok(
    anchorCalls.some((c) => c.brandId === session.brandId && c.reason === "setup_interview"),
    "early creation must reach the anchor machinery",
  );
});

// ---------------------------------------------------------------------------
// 2. Anchors fire mid-interview (Section G2)
// ---------------------------------------------------------------------------

test("c1.anchorsFireMidInterview — a later website answer in the SAME interview reaches onAnchorArrival before completion", async () => {
  const { userId, token } = await createUser();
  const start = await apiRequest(token, "POST", "/session", {});
  assert.equal(start.status, 200);

  const { session } = await answerUntil(
    token,
    start.body,
    (field, s) => field === "business_name" && Boolean(s.brandId),
    (field) => (field === "business_name" ? "South Dixie Storage" : "A small local business."),
  );
  const brandId = session.brandId;
  anchorCalls = []; // isolate: only arrivals AFTER creation count below

  // Supply the website as a verbatim URL answer on the very NEXT turn of the
  // same conversation (the ruling's "later owner supplies:
  // southdixiestorage.com" case). Strict whole-answer URL detection routes
  // it through the existing presence path and fires the anchor machinery.
  const res = await apiRequest(token, "POST", "/answer", {
    sessionId: session.sessionId,
    answer: "https://southdixiestorage.com",
  });
  assert.equal(res.status, 200);
  const s = res.body.session;

  assert.equal(s.interviewComplete, false, "interview must still be running when the anchor fires");
  assert.ok(
    anchorCalls.some((c) => c.brandId === brandId),
    "the mid-interview website anchor must reach onAnchorArrival",
  );
  const { rows } = await db.query(
    "SELECT website_url FROM brands WHERE brand_id = $1",
    [brandId],
  );
  // normalizeWebsiteUrl canonicalizes (adds the trailing slash) — the brand
  // stores the normalized form, the verbatim answer stays in session.answers.
  assert.equal(rows[0].website_url, "https://southdixiestorage.com/", "anchor persisted to the brand");
});

// ---------------------------------------------------------------------------
// 3. Abandoned interview resume reuses the brand — no duplicate (Section G3)
// ---------------------------------------------------------------------------

test("c1.abandonedResumeReusesBrand — resume binds the SAME brand and never creates another", async () => {
  const { userId, token } = await createUser();
  const start = await apiRequest(token, "POST", "/session", {});
  const { session } = await answerUntil(
    token,
    start.body,
    (field, s) => field === "business_name" && Boolean(s.brandId),
    (field) => (field === "business_name" ? "Abandoned Storage Co" : "A small local business."),
  );
  const firstBrandId = session.brandId;
  assert.ok(firstBrandId);
  assert.equal(await brandCount(userId), 1);

  // Abandon: the owner walks away mid-interview (no pause, no dismiss —
  // just absence). Later they come back and start setup again (default path).
  const resume = await apiRequest(token, "POST", "/session", {});
  assert.equal(resume.status, 200);
  assert.equal(
    resume.body.session.sessionId,
    session.sessionId,
    "default re-entry must resume the open session, not start a new one",
  );
  assert.equal(
    resume.body.session.brandId,
    firstBrandId,
    "resume must bind back to the SAME interview-created brand",
  );
  assert.equal(await brandCount(userId), 1, "no duplicate brand on resume");
});

// ---------------------------------------------------------------------------
// 4. Entry choice remains correct with an incomplete brand (Section G4)
// ---------------------------------------------------------------------------

test("c1.entryChoiceWithIncompleteBrand — probe reports the resumable session; new_business starts unbound with no duplicate of the incomplete brand", async () => {
  const { userId, token } = await createUser();
  const start = await apiRequest(token, "POST", "/session", {});
  const { session } = await answerUntil(
    token,
    start.body,
    (field, s) => field === "business_name" && Boolean(s.brandId),
    (field) => (field === "business_name" ? "Unfinished Storage LLC" : "A small local business."),
  );
  const incompleteBrandId = session.brandId;

  // The read-only probe must report the open session so the client offers
  // RESUME UNFINISHED ONBOARDING — never "create another business" as the
  // only path. (Contract: { openSession: boolean } — the default POST
  // /session then resumes that session with its brand, proven in test 3.)
  const probe = await apiRequest(token, "POST", "/session", { probe: true });
  assert.equal(probe.status, 200);
  assert.equal(probe.body.openSession, true, "probe must report the resumable open session");

  // Explicit second-business intent still works and stays unbound: it must
  // NOT inherit the incomplete brand and must NOT have created a brand.
  const brandsBefore = await brandCount(userId);
  const nb = await apiRequest(token, "POST", "/session", { intent: "new_business" });
  assert.equal(nb.status, 200);
  assert.notEqual(nb.body.session.sessionId, session.sessionId);
  assert.equal(nb.body.session.brandId, null, "new_business session must start unbound");
  assert.equal(await brandCount(userId), brandsBefore, "new_business start creates no brand");

  // And the abandoned session is still resumable afterwards (paused, its
  // brand intact) — the incomplete brand was not deleted or rebound.
  const { rows } = await db.query(
    "SELECT status, brand_id FROM setup_sessions WHERE session_id = $1",
    [session.sessionId],
  );
  assert.equal(rows[0].brand_id, incompleteBrandId);
  assert.notEqual(rows[0].status, "dismissed");
});
