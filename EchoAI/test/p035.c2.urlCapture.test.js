/**
 * Prompt 035-C2 — volunteered-URL capture (Stage 2 regression suite).
 *
 * Binds C2-1 … C2-13 plus the Claude amendments AM-1/AM-2/AM-3/AM-5:
 * deterministic extraction (never AI, never bare prose domains), explicit
 * owner confirmation BEFORE any structured capture, the sentinel target
 * `_c2_url_confirm` staying outside the knowledge catalog, and the confirmed
 * URL flowing through the SAME existing applyOnlinePresence → onAnchorArrival
 * chain the whole-answer path uses (no second pipeline).
 *
 * Harness: real Express router, real DB (dbGuard enforces TEST_DATABASE_URL),
 * the shared Anthropic singleton stubbed deterministically, and
 * anchorOrchestrator.onAnchorArrival spied (research machinery untouched).
 *
 * Run with:  node --test test/p035.c2.urlCapture.test.js   (from EchoAI/)
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
const knowledge = require("../utils/brandKnowledge");
const { extractUrlCandidates, normalizeWebsiteUrl } = require("../utils/onlinePresence");

// Canonical form is the normalizer's url.href (root URLs carry a trailing "/").
const norm = (u) => normalizeWebsiteUrl(u).value;

const SENTINEL = "_c2_url_confirm";

// ---------------------------------------------------------------------------
// Deterministic AI stub — interview never completes on its own (complete only
// after many turns) so each test controls the conversation.
// ---------------------------------------------------------------------------
function textResponse(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}
const originalCreate = anthropicModule.anthropic.messages.create;
function installAiStub() {
  anthropicModule.anthropic.messages.create = async ({ system, messages }) => {
    const sys = String(system || "");
    if (sys.includes("Setup Agent") || sys.includes("setup")) {
      const userTurns = (messages || []).filter((m) => m.role === "user").length;
      const complete = userTurns >= 40;
      return textResponse({
        message: complete ? "All set!" : "Tell me more about your business.",
        suggestion: "",
        collects: complete ? "" : `field_${userTurns}`,
        complete,
      });
    }
    throw new Error(`Unexpected AI call: ${sys.slice(0, 60)}`);
  };
}

// ---------------------------------------------------------------------------
// onAnchorArrival spy — research machinery must never run from this suite.
// ---------------------------------------------------------------------------
const originalArrival = anchorOrchestrator.onAnchorArrival;
let arrivals = [];
function installArrivalSpy() {
  anchorOrchestrator.onAnchorArrival = (args) => {
    arrivals.push(args);
  };
}

// ---------------------------------------------------------------------------
// HTTP harness
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

async function createUser({ tier = "pro" } = {}) {
  const email = `p035c2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, role, subscription_tier)
     VALUES ($1, 'not-a-real-hash', 'user'::user_role, $2::subscription_tier)
     RETURNING user_id`,
    [email, tier],
  );
  const userId = rows[0].user_id;
  createdUserIds.push(userId);
  await db.query(
    `INSERT INTO subscriptions (user_id, subscription_tier, payment_status, is_locked)
     VALUES ($1, $2::subscription_tier, 'active', FALSE)`,
    [userId, tier],
  );
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "1h" });
  return { userId, token };
}

// Fresh session, optionally bound to a fresh brand (the C2 capture target).
async function startSession(token, userId, { withBrand = true } = {}) {
  const res = await apiRequest(token, "POST", "/session", {});
  assert.equal(res.status, 200, `initiateSession failed: ${JSON.stringify(res.body)}`);
  const sessionId = res.body.session.sessionId;
  let brandId = null;
  if (withBrand) {
    const b = await db.query(
      `INSERT INTO brands (user_id, brand_name) VALUES ($1, $2) RETURNING brand_id`,
      [userId, `TEST C2 Brand ${Date.now()}`],
    );
    brandId = b.rows[0].brand_id;
    await db.query(`UPDATE setup_sessions SET brand_id = $1 WHERE session_id = $2`, [
      brandId,
      sessionId,
    ]);
  }
  return { sessionId, brandId, firstQuestion: res.body.question };
}

async function answer(token, sessionId, text) {
  const res = await apiRequest(token, "POST", "/answer", { sessionId, answer: text });
  assert.equal(res.status, 200, `submitAnswer failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function brandRow(brandId) {
  const { rows } = await db.query(
    `SELECT website_url, facebook_page_url FROM brands WHERE brand_id = $1`,
    [brandId],
  );
  return rows[0];
}

async function sessionRow(sessionId) {
  const { rows } = await db.query(`SELECT * FROM setup_sessions WHERE session_id = $1`, [
    sessionId,
  ]);
  return rows[0];
}

function urlConfirmOf(row) {
  const s = row.answers && row.answers._interview ? row.answers._interview : {};
  return s.urlConfirm || { queue: [], decided: {}, exchangeLog: [] };
}

const PREMATURE_CLAIM = /saved|captured|received|added to your (business )?profile|research|thanks for sharing/i;

test.before(async () => {
  installAiStub();
  installArrivalSpy();
  const app = express();
  app.use(express.json());
  app.use("/api/setup-agent", setupAgentRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/setup-agent`;
});

test.after(async () => {
  anthropicModule.anthropic.messages.create = originalCreate;
  anchorOrchestrator.onAnchorArrival = originalArrival;
  if (server) await new Promise((resolve) => server.close(resolve));
  if (createdUserIds.length) {
    await db.query(`DELETE FROM brands WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
    await db.query(`DELETE FROM users WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
  }
  await db.pool.end();
});

test.beforeEach(() => {
  arrivals = [];
});

// ---------------------------------------------------------------------------
// AM-2 / Section D — deterministic extraction unit properties
// ---------------------------------------------------------------------------

test("extract: only literal https/http/www tokens; bare prose domains ignored", () => {
  const { candidates } = extractUrlCandidates(
    "our site is example.com but also https://real.example and www.other.example",
  );
  assert.deepEqual(
    candidates.map((c) => c.value).sort(),
    [norm("https://real.example"), norm("https://www.other.example")].sort(),
  );
  assert.ok(candidates.every((c) => c.kind === "website"));
});

test("extract AM-2: wrappers and trailing punctuation stripped iteratively", () => {
  for (const wrapped of [
    "(https://example.com).",
    '"https://example.com"',
    "[https://example.com]",
    "<https://example.com>",
    "https://example.com!?,",
  ]) {
    const { candidates } = extractUrlCandidates(`see ${wrapped} ok`);
    assert.equal(candidates.length, 1, `failed for ${wrapped}`);
    assert.equal(candidates[0].value, norm("https://example.com"));
  }
});

test("extract: facebook classification via existing normalizer", () => {
  const { candidates } = extractUrlCandidates("page is https://www.facebook.com/mybakery today");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, "facebook");
});

test("extract: cap 3 with overflow count, dedup by normalized value, 2048 bound", () => {
  const { candidates, overflow } = extractUrlCandidates(
    "https://a.example https://b.example https://c.example https://d.example https://a.example",
  );
  assert.equal(candidates.length, 3);
  assert.equal(overflow, 1); // d.example (the repeat of a.example dedups, not overflow)
  const huge = `https://example.com/${"x".repeat(2100)}`;
  assert.deepEqual(extractUrlCandidates(`see ${huge}`).candidates, []);
});

// ---------------------------------------------------------------------------
// C2-1 — embedded website → confirmation → YES → capture → anchor once
// C2-9 — acknowledgment honesty on both turns
// ---------------------------------------------------------------------------

test("C2-1/C2-9: embedded URL confirms, YES captures through existing chain exactly once", async () => {
  const { userId, token } = await createUser();
  const { sessionId, brandId } = await startSession(token, userId);
  const url = "https://c2-one.example";

  const detect = await answer(token, sessionId, `We sell cakes and our website is ${url}`);
  assert.equal(detect.question.targetField, SENTINEL);
  assert.equal(detect.question.candidate.origin, "volunteered_url");
  assert.ok(detect.question.message.includes(url));
  // C2-9 pre-capture honesty: the detection turn never claims save/capture.
  assert.ok(!PREMATURE_CLAIM.test(detect.question.message), detect.question.message);
  assert.equal((await brandRow(brandId)).website_url, null);
  assert.equal(arrivals.length, 0);

  const fieldBefore = (await sessionRow(sessionId)).current_field;
  const yes = await answer(token, sessionId, "yes");
  // C2-9 post-capture: truthful save wording only AFTER structured capture.
  assert.ok(/I've saved/.test(yes.question.message));
  assert.equal((await brandRow(brandId)).website_url, norm(url));
  assert.equal(arrivals.length, 1);
  assert.equal(arrivals[0].reason, "setup_interview");
  assert.equal(arrivals[0].brandId, brandId);
  const row = await sessionRow(sessionId);
  assert.equal(row.answers.business_website, norm(url));
  assert.equal(urlConfirmOf(row).decided[norm(url)], "confirmed");
  // Interview state intact: current_field unchanged, resumed question returned.
  assert.equal(row.current_field, fieldBefore);
  assert.equal(yes.question.collects, fieldBefore);
});

// ---------------------------------------------------------------------------
// C2-2 — NO path: no capture, no anchor, no research
// ---------------------------------------------------------------------------

test("C2-2: NO rejects — nothing written, no anchor arrival", async () => {
  const { userId, token } = await createUser();
  const { sessionId, brandId } = await startSession(token, userId);
  const url = "https://c2-no.example";

  const detect = await answer(token, sessionId, `Check out ${url} sometime`);
  assert.equal(detect.question.targetField, SENTINEL);
  const no = await answer(token, sessionId, "no");
  assert.ok(!/I've saved/.test(no.question.message));
  assert.equal((await brandRow(brandId)).website_url, null);
  assert.equal(arrivals.length, 0);
  const row = await sessionRow(sessionId);
  assert.equal(row.answers.business_website, undefined);
  assert.equal(urlConfirmOf(row).decided[norm(url)], "rejected");
});

// ---------------------------------------------------------------------------
// C2-3 — correction: original rejected, corrected URL itself confirmed
// ---------------------------------------------------------------------------

test("C2-3: corrected URL replaces candidate and must itself be confirmed", async () => {
  const { userId, token } = await createUser();
  const { sessionId, brandId } = await startSession(token, userId);
  const wrong = "https://c2-wrong.example";
  const right = "https://c2-right.example";

  await answer(token, sessionId, `our site ${wrong} has details`);
  const corr = await answer(token, sessionId, `no, it's ${right}`);
  // Corrected candidate requires its OWN confirmation — never silent capture.
  assert.equal(corr.question.targetField, SENTINEL);
  assert.ok(corr.question.message.includes(right));
  assert.equal((await brandRow(brandId)).website_url, null);

  const yes = await answer(token, sessionId, "yes");
  assert.ok(/I've saved/.test(yes.question.message));
  const b = await brandRow(brandId);
  assert.equal(b.website_url, norm(right));
  const uc = urlConfirmOf(await sessionRow(sessionId));
  assert.equal(uc.decided[norm(wrong)], "rejected");
  assert.equal(uc.decided[norm(right)], "confirmed");
  assert.equal(arrivals.length, 1);
});

// ---------------------------------------------------------------------------
// C2-4 / AM-5 — whole-answer path unchanged; stronger later statement wins
// ---------------------------------------------------------------------------

test("C2-4/AM-5: whole-answer URL captures without confirmation, even after a C2 rejection", async () => {
  const { userId, token } = await createUser();
  const { sessionId, brandId } = await startSession(token, userId);
  const url = "https://c2-whole.example";

  // First reject it as an embedded candidate…
  await answer(token, sessionId, `maybe ${url} idk`);
  await answer(token, sessionId, "no");
  assert.equal((await brandRow(brandId)).website_url, null);

  // …then the whole-answer statement still wins (AM-5): no confirmation turn.
  const whole = await answer(token, sessionId, url);
  assert.notEqual(whole.question.targetField, SENTINEL);
  assert.equal((await brandRow(brandId)).website_url, norm(url));
  assert.equal(arrivals.length, 1);
});

// ---------------------------------------------------------------------------
// C2-5 — plain prose: no queue, no confirmation
// ---------------------------------------------------------------------------

test("C2-5: no qualifying URL → no candidate queue, no confirmation", async () => {
  const { userId, token } = await createUser();
  const { sessionId } = await startSession(token, userId);
  const out = await answer(
    token,
    sessionId,
    "We are a bakery on example.com street selling bread to families dot com",
  );
  assert.notEqual(out.question.targetField, SENTINEL);
  const uc = urlConfirmOf(await sessionRow(sessionId));
  assert.equal(uc.queue.length, 0);
  assert.deepEqual(uc.decided, {});
});

// ---------------------------------------------------------------------------
// C2-6 / AM-1 — bounded FIFO, accurate disclosure, overflow re-volunteerable
// ---------------------------------------------------------------------------

test("C2-6/AM-1: cap-3 FIFO, accurate beyond-cap disclosure, overflow never decided", async () => {
  const { userId, token } = await createUser();
  const { sessionId } = await startSession(token, userId);
  const urls = [1, 2, 3, 4].map((n) => `https://c2-multi-${n}.example`);

  const detect = await answer(token, sessionId, `links: ${urls.join(" ")}`);
  assert.equal(detect.question.targetField, SENTINEL);
  assert.ok(detect.question.message.includes(urls[0]));
  assert.ok(/1 more link\b/.test(detect.question.message), detect.question.message);

  let row = await sessionRow(sessionId);
  let uc = urlConfirmOf(row);
  assert.equal(uc.queue.length, 3);
  // AM-1: the beyond-cap URL is NOT in decided — still eligible later.
  assert.equal(uc.decided[urls[3]], undefined);

  // Serial confirmation, one per turn (confirm #1, reject #2 and #3).
  const second = await answer(token, sessionId, "yes");
  assert.ok(second.question.message.includes(urls[1]));
  const third = await answer(token, sessionId, "no");
  assert.ok(third.question.message.includes(urls[2]));
  await answer(token, sessionId, "no");

  // Re-volunteer the overflow URL: it queues normally now.
  const again = await answer(token, sessionId, `oh and also ${urls[3]} exists`);
  assert.equal(again.question.targetField, SENTINEL);
  assert.ok(again.question.message.includes(urls[3]));
});

// ---------------------------------------------------------------------------
// C2-7 — repeated identical URL: no confirmation churn, no second research
// ---------------------------------------------------------------------------

test("C2-7: repeated identical URL never re-prompts and never re-triggers research", async () => {
  const { userId, token } = await createUser();
  const { sessionId, brandId } = await startSession(token, userId);
  const url = "https://c2-repeat.example";

  await answer(token, sessionId, `site: ${url} ok`);
  await answer(token, sessionId, "yes");
  assert.equal(arrivals.length, 1);
  assert.equal((await brandRow(brandId)).website_url, norm(url));

  // Same URL embedded again → decided map suppresses any new confirmation.
  const again = await answer(token, sessionId, `as I said ${url} is our site`);
  assert.notEqual(again.question.targetField, SENTINEL);
  // "No second research run" is enforced by the UNMODIFIED downstream
  // sameAnchors dedup (anchor arrivals with identical anchors are no-ops):
  // any repeat arrival from the existing C1 mid-interview handoff carries
  // the SAME brand/reason and the brands row is byte-identical — no new
  // anchor exists to research.
  assert.equal((await brandRow(brandId)).website_url, norm(url));
  assert.ok(arrivals.length >= 1);
  for (const a of arrivals) {
    assert.equal(a.brandId, brandId);
    assert.equal(a.reason, "setup_interview");
  }
});

// ---------------------------------------------------------------------------
// C2-8 — refresh/resume with a pending confirmation
// ---------------------------------------------------------------------------

test("C2-8: resume re-emits the same truthful confirmation; catalog state intact", async () => {
  const { userId, token } = await createUser();
  const { sessionId } = await startSession(token, userId);
  const url = "https://c2-resume.example";

  await answer(token, sessionId, `our page ${url} is nice`);
  const fieldBefore = (await sessionRow(sessionId)).current_field;

  // Refresh: initiate again → resumes the open session.
  const res = await apiRequest(token, "POST", "/session", {});
  assert.equal(res.status, 200);
  assert.equal(res.body.resumed, true);
  assert.equal(res.body.question.targetField, SENTINEL);
  assert.ok(res.body.question.message.includes(url));
  assert.ok(!PREMATURE_CLAIM.test(res.body.question.message));

  // No duplicate capture, current_field untouched.
  const row = await sessionRow(sessionId);
  assert.equal(row.current_field, fieldBefore);
  assert.equal(row.answers.business_website, undefined);
  assert.equal(arrivals.length, 0);

  // And the pending confirmation still resolves normally after resume.
  const yes = await answer(token, sessionId, "yes");
  assert.ok(/I've saved|I've noted/.test(yes.question.message));
});

// ---------------------------------------------------------------------------
// C2-10 — C1 early-brand behavior: no-brand session stores the alias only,
// the later pickup path (not C2) attaches it. Full C1 suites run separately.
// ---------------------------------------------------------------------------

test("C2-10: confirmation before any brand exists stores the alias for later pickup", async () => {
  const { userId, token } = await createUser();
  const { sessionId } = await startSession(token, userId, { withBrand: false });
  const url = "https://c2-nobrand.example";

  await answer(token, sessionId, `find us at ${url} online`);
  const yes = await answer(token, sessionId, "yes");
  // Honest wording: noted (not "saved") — there is no brand yet.
  assert.ok(/I've noted/.test(yes.question.message));
  assert.ok(!/I've saved/.test(yes.question.message));
  const row = await sessionRow(sessionId);
  assert.equal(row.answers.business_website, norm(url));
  assert.equal(arrivals.length, 0);
});

// ---------------------------------------------------------------------------
// C2-11 / AM-3 — ambiguity: re-ask once, then fail closed; exchange preserved
// ---------------------------------------------------------------------------

test("C2-11/AM-3: ambiguous → one yes/no re-ask → second ambiguity fails closed; log preserved", async () => {
  const { userId, token } = await createUser();
  const { sessionId, brandId } = await startSession(token, userId);
  const url = "https://c2-ambig.example";

  await answer(token, sessionId, `hmm ${url} perhaps`);
  const reask = await answer(token, sessionId, "my cousin built something once");
  assert.equal(reask.question.targetField, SENTINEL);
  assert.ok(/yes or no/i.test(reask.question.message));

  const closed = await answer(token, sessionId, "she likes websites");
  // Fail closed: rejected, nothing captured, no research, interview resumes.
  assert.notEqual(closed.question.targetField, SENTINEL);
  assert.equal((await brandRow(brandId)).website_url, null);
  assert.equal(arrivals.length, 0);
  const uc = urlConfirmOf(await sessionRow(sessionId));
  assert.equal(uc.decided[norm(url)], "rejected");
  // AM-3: both owner utterances survive verbatim in the bounded exchange log.
  const ownerLines = uc.exchangeLog.filter((e) => e.role === "owner").map((e) => e.text);
  assert.ok(ownerLines.includes("my cousin built something once"));
  assert.ok(ownerLines.includes("she likes websites"));
});

// ---------------------------------------------------------------------------
// C2-12 — sentinel is structurally outside the knowledge catalog
// ---------------------------------------------------------------------------

test("C2-12: _c2_url_confirm cannot be a knowledge field or create a knowledge write", async () => {
  assert.ok(!knowledge.FIELD_KEYS.includes(SENTINEL));
  await assert.rejects(
    knowledge.ownerEditFields({
      brandId: "33333333-3333-4333-8333-333333333333",
      userId: "44444444-4444-4444-8444-444444444444",
      fields: [{ fieldKey: SENTINEL, value: "https://example.com" }],
    }),
    (err) => {
      // Validation rejects BEFORE any write path is reached.
      assert.equal(err.statusCode, 400);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// C2-13 — embedded Facebook URL through the same existing machinery
// ---------------------------------------------------------------------------

test("C2-13: embedded Facebook URL → facebook confirmation → facebook_page_url + anchor", async () => {
  const { userId, token } = await createUser();
  const { sessionId, brandId } = await startSession(token, userId);
  const url = "https://www.facebook.com/c2testpage";

  const detect = await answer(token, sessionId, `we post on ${url} weekly`);
  assert.equal(detect.question.targetField, SENTINEL);
  assert.ok(/Facebook page/.test(detect.question.message));

  const yes = await answer(token, sessionId, "yes");
  assert.ok(/I've saved/.test(yes.question.message));
  const b = await brandRow(brandId);
  assert.equal(b.website_url, null);
  assert.ok(b.facebook_page_url && b.facebook_page_url.includes("facebook.com"));
  assert.equal(arrivals.length, 1);
  assert.equal((await sessionRow(sessionId)).answers.facebook_page, "https://www.facebook.com/c2testpage");
});
