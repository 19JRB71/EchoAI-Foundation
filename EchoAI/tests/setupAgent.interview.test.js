/**
 * Prompt 023 — adaptive interview integration tests (DB-backed).
 *
 * Covers: governed AI routing (feature 'setup_interview', aiGate-block
 * surfaced honestly), the four-state inventory assembly, canonical-boundary
 * write semantics for every resolution kind (owner-stated, legacy confirm,
 * pending approve, draft adopt+approve with frozen provenance, defer,
 * stale-base 409 → premise_changed re-present), engine-decided completion +
 * continue-anyway, knowledge-read failure degradation (never "all missing"),
 * and the structural no-direct-brands-write regression.
 */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("./dbGuard");
const db = require("../config/db");
const knowledge = require("../utils/brandKnowledge");
const controller = require("../controllers/setupAgentController");
const gapEngine = require("../utils/interviewGapEngine");
const { createTestUser, deleteUser } = require("./helpers");

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(p) {
      this.body = p;
      return this;
    },
  };
}

async function createBrand(userId, name = "Interview Test Brand", extra = {}) {
  const cols = ["user_id", "brand_name"];
  const vals = [userId, name];
  for (const [k, v] of Object.entries(extra)) {
    cols.push(k);
    vals.push(v);
  }
  const { rows } = await db.query(
    `INSERT INTO brands (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
    vals,
  );
  return rows[0];
}

// Stub the governed AI seam: returns a canned decision and records the call.
const aiCalls = [];
function stubAi(decision = null) {
  controller._createMessage = async (params, opts) => {
    aiCalls.push({ params, opts });
    const d =
      decision || { message: "Next question?", suggestion: "", collects: "primary_goal", complete: false };
    return { content: [{ type: "text", text: JSON.stringify(d) }] };
  };
}
const realCreateMessage = controller._createMessage;

const users = [];
after(async () => {
  for (const u of users) await deleteUser(u).catch(() => {});
  controller._createMessage = realCreateMessage;
  await db.pool.end().catch(() => {});
});

async function newUser() {
  const u = await createTestUser();
  users.push(u);
  return u;
}

async function startSession(userId) {
  const res = mockRes();
  await controller.initiateSession({ user: { userId }, body: {} }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}

async function answer(userId, sessionId, text, extras = {}) {
  const res = mockRes();
  await controller.submitAnswer(
    { user: { userId }, body: { sessionId, answer: text, ...extras } },
    res,
  );
  return res;
}

// ---------------------------------------------------------------------------

test("interview AI runs through the governed chokepoint with feature=setup_interview", async () => {
  const userId = await newUser();
  aiCalls.length = 0;
  stubAi();
  const started = await startSession(userId);
  assert.ok(started.session.sessionId);
  assert.equal(aiCalls.length, 1);
  assert.equal(aiCalls[0].opts.feature, "setup_interview");
  assert.equal(aiCalls[0].opts.userId, userId);
});

test("aiGate block surfaces as its own honest status, never a masked 502", async () => {
  const userId = await newUser();
  controller._createMessage = async () => {
    const err = new Error("AI is disabled by the emergency switch.");
    err.aiBlocked = true;
    err.statusCode = 503;
    throw err;
  };
  const res = mockRes();
  await controller.initiateSession({ user: { userId }, body: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /emergency switch/);
});

test("malformed AI output still yields the honest 502 (never guessed)", async () => {
  const userId = await newUser();
  controller._createMessage = async () => ({ content: [{ type: "text", text: "not json at all" }] });
  const res = mockRes();
  await controller.initiateSession({ user: { userId }, body: {} }, res);
  assert.equal(res.statusCode, 502);
});

test("loadInterviewInventory assembles the four-state projection", async () => {
  const userId = await newUser();
  const brand = await createBrand(userId, "Four State Co", { tagline: "Legacy tagline" });
  await knowledge.ownerEditFields({
    brandId: brand.brand_id,
    userId,
    fields: [{ fieldKey: "business_name", value: "Four State Co" }],
  });
  await knowledge.proposeRevision({
    brandId: brand.brand_id,
    fieldKey: "description",
    proposedValue: "Pending description",
    provenance: { sources: [{ source: "website", url: "https://example.test" }], confidence: "medium", conflict: false, alternatives: [] },
    sourceKind: "website",
    proposedBy: "sage_research",
  });
  await db.query(
    `INSERT INTO sage_research_drafts (brand_id, user_id, run_id, status, fields)
     VALUES ($1, $2, gen_random_uuid(), 'complete', $3::jsonb)`,
    [brand.brand_id, userId, JSON.stringify({ services: { value: "Barn kits", confidence: "high", sources: [{ source: "website", url: "https://example.test" }], conflict: false, alternatives: [] } })],
  );

  const inv = await controller.loadInterviewInventory(userId, null);
  assert.equal(inv.brandId, brand.brand_id);
  assert.ok(inv.inventory.approved.business_name);
  assert.ok(inv.inventory.pending.description);
  assert.equal(inv.inventory.legacy.tagline.value, "Legacy tagline");
  assert.equal(inv.inventory.draft.services.value, "Barn kits");
  // And the engine reads it as the accepted matrix dictates.
  const plan = gapEngine.buildPlan(inv.inventory);
  const byField = Object.fromEntries(plan.map((e) => [e.fieldKey, e]));
  assert.equal(byField.business_name.action, "skip");
  assert.equal(byField.description.action, "confirm");
  assert.equal(byField.services.action, "confirm");
  assert.equal(byField.tagline.action, "confirm");
  assert.equal(byField.phone.action, "ask");
});

test("engine-targeted answers write through the canonical boundary (stated, legacy, pending, draft, defer)", async () => {
  const userId = await newUser();
  const brand = await createBrand(userId, "Writes Co", { tagline: "Old tag" });
  const { revision: rev } = await knowledge.proposeRevision({
    brandId: brand.brand_id,
    fieldKey: "description",
    proposedValue: "Proposed desc",
    provenance: { sources: [{ source: "website", url: "https://w.test" }], confidence: "medium", conflict: false, alternatives: [] },
    sourceKind: "website",
    proposedBy: "sage_research",
  });
  const draftIns = await db.query(
    `INSERT INTO sage_research_drafts (brand_id, user_id, run_id, status, fields)
     VALUES ($1, $2, gen_random_uuid(), 'complete', $3::jsonb) RETURNING draft_id`,
    [brand.brand_id, userId, JSON.stringify({ services: { value: "Draft services", confidence: "high", sources: [{ source: "website", url: "https://w.test" }], conflict: false, alternatives: [] } })],
  );
  const draftId = draftIns.rows[0].draft_id;

  // Owner-stated free text (missing field).
  let r = await controller.resolveKnowledgeAnswer({
    userId,
    brandId: brand.brand_id,
    draftId,
    target: { fieldKey: "business_name", action: "ask", evidence: {} },
    answerText: "Stated Name LLC",
    resolution: null,
  });
  assert.equal(r.resolvedKind, "owner_stated");
  let appr = await knowledge.getApprovedKnowledge(brand.brand_id);
  assert.equal(appr.business_name.value, "Stated Name LLC");
  assert.equal(appr.business_name.sourceKind, "stated");

  // Legacy confirm → v1 stated version of the legacy value.
  r = await controller.resolveKnowledgeAnswer({
    userId,
    brandId: brand.brand_id,
    draftId,
    target: { fieldKey: "tagline", action: "confirm", evidence: { legacyValue: "Old tag" } },
    answerText: "Yes, that's correct.",
    resolution: { kind: "confirm" },
  });
  assert.equal(r.resolvedKind, "owner_stated");
  appr = await knowledge.getApprovedKnowledge(brand.brand_id);
  assert.equal(appr.tagline.value, "Old tag");

  // Pending confirm → canonical approveRevision.
  r = await controller.resolveKnowledgeAnswer({
    userId,
    brandId: brand.brand_id,
    draftId,
    target: { fieldKey: "description", action: "confirm", evidence: { pendingValue: "Proposed desc" } },
    answerText: "Yes, that's correct.",
    resolution: { kind: "confirm", revisionId: rev.revision_id },
  });
  assert.equal(r.resolvedKind, "approved_pending");
  appr = await knowledge.getApprovedKnowledge(brand.brand_id);
  assert.equal(appr.description.value, "Proposed desc");

  // Draft confirm → adopt (frozen real provenance, server-re-read) + approve.
  r = await controller.resolveKnowledgeAnswer({
    userId,
    brandId: brand.brand_id,
    draftId,
    target: { fieldKey: "services", action: "confirm", evidence: { draftValue: "Draft services" } },
    answerText: "Yes, that's correct.",
    resolution: { kind: "confirm" },
  });
  assert.equal(r.resolvedKind, "approved_draft");
  appr = await knowledge.getApprovedKnowledge(brand.brand_id);
  assert.equal(appr.services.value, "Draft services");
  assert.equal(appr.services.sourceKind, "website");
  const hist = await knowledge.getFieldHistory(brand.brand_id, "services");
  const cur = hist.find((v) => v.status === "current");
  assert.equal(cur.provenance.sources[0].url, "https://w.test");

  // Defer → recorded, nothing written.
  r = await controller.resolveKnowledgeAnswer({
    userId,
    brandId: brand.brand_id,
    draftId,
    target: { fieldKey: "phone", action: "ask", evidence: {} },
    answerText: "Skip this one for now.",
    resolution: { kind: "defer" },
  });
  assert.equal(r.resolvedKind, "deferred");
  appr = await knowledge.getApprovedKnowledge(brand.brand_id);
  assert.equal(appr.phone, undefined);
});

test("stale-base 409 on confirm becomes premise_changed, never a force-write", async () => {
  const userId = await newUser();
  const brand = await createBrand(userId, "Stale Co");
  const { revision: rev } = await knowledge.proposeRevision({
    brandId: brand.brand_id,
    fieldKey: "description",
    proposedValue: "Old proposal",
    provenance: { sources: [{ source: "website", url: "https://w.test" }], confidence: "medium", conflict: false, alternatives: [] },
    sourceKind: "website",
    proposedBy: "sage_research",
  });
  // The premise changes mid-interview: owner edits the field elsewhere.
  await knowledge.ownerEditFields({
    brandId: brand.brand_id,
    userId,
    fields: [{ fieldKey: "description", value: "Edited elsewhere" }],
  });
  const r = await controller.resolveKnowledgeAnswer({
    userId,
    brandId: brand.brand_id,
    draftId: null,
    target: { fieldKey: "description", action: "confirm", evidence: { pendingValue: "Old proposal" } },
    answerText: "Yes, that's correct.",
    resolution: { kind: "confirm", revisionId: rev.revision_id },
  });
  assert.equal(r.resolvedKind, "premise_changed");
  const appr = await knowledge.getApprovedKnowledge(brand.brand_id);
  assert.equal(appr.description.value, "Edited elsewhere");
});

test("full turn: answer resolves, engine directs next field, completion stays engine-owned", async () => {
  const userId = await newUser();
  stubAi();
  const started = await startSession(userId);
  const sid = started.session.sessionId;

  // AI claims complete=true immediately — the ENGINE must overrule it while
  // knowledge gaps remain (no brand yet → all 12 fields are open).
  aiCalls.length = 0;
  controller._createMessage = async (params, opts) => {
    aiCalls.push({ params, opts });
    return {
      content: [
        { type: "text", text: JSON.stringify({ message: "All done!", suggestion: "", collects: "", complete: true }) },
      ],
    };
  };
  const res = await answer(userId, sid, "We are a small bakery.");
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.question.complete, false, "AI complete boolean must be advisory only");
  assert.ok(res.body.question.targetField, "engine should be directing a knowledge field");
  // The engine-selected field is enforced on collects.
  assert.equal(res.body.question.collects, res.body.question.targetField);
  // The director note reached the AI verbatim, including the governing sentence.
  const sent = aiCalls[0].params.messages.map((m) => m.content).join("\n");
  assert.ok(sent.includes("Interview action precedence is question selection, not an authority ranking."));
});

test("continueAnyway exits honestly: gaps recorded deferred, interview completes", async () => {
  const userId = await newUser();
  stubAi();
  const started = await startSession(userId);
  const sid = started.session.sessionId;
  controller._createMessage = async () => ({
    content: [
      { type: "text", text: JSON.stringify({ message: "Okay — moving on to setup.", suggestion: "", collects: "", complete: true }) },
    ],
  });
  const res = await answer(userId, sid, "Let's continue with setup anyway.", { continueAnyway: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.question.complete, true);
  const s = await db.query("SELECT answers, interview_complete FROM setup_sessions WHERE session_id = $1", [sid]);
  assert.equal(s.rows[0].interview_complete, true);
  const st = s.rows[0].answers._interview;
  assert.equal(st.continueAnyway, true);
  const deferredCount = Object.keys(st.deferred || {}).length;
  assert.ok(deferredCount > 0, "open gaps must be recorded as deferred, never fabricated as resolved");
});

test("knowledge-read failure degrades to the plain interview — never 'all missing'", async () => {
  const userId = await newUser();
  stubAi();
  const started = await startSession(userId);
  const sid = started.session.sessionId;
  // Force the inventory read to fail.
  const realLoad = controller.loadInterviewInventory;
  const origQuery = db.query.bind(db);
  stubAi();
  aiCalls.length = 0;
  db.query = async (sql, params) => {
    if (typeof sql === "string" && sql.includes("FROM brands WHERE user_id")) {
      throw new Error("simulated knowledge read outage");
    }
    return origQuery(sql, params);
  };
  try {
    const res = await answer(userId, sid, "We sell candles.");
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    // No director note (no fabricated all-missing plan): the AI got only the
    // user's answer, and no knowledge field was force-targeted.
    const sent = aiCalls.at(-1).params.messages.map((m) => m.content).join("\n");
    assert.ok(!sent.includes("Target brand field THIS TURN"));
    assert.equal(res.body.question.targetField, undefined);
  } finally {
    db.query = origQuery;
    assert.equal(controller.loadInterviewInventory, realLoad);
  }
});

test("structural regression: the interview path never writes brands knowledge columns directly", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "controllers", "setupAgentController.js"), "utf8");
  // The Prompt-023 resolution helper region must contain no direct brands
  // UPDATE. (applyOnlinePresence/profile setters are owner-ruled Class-B
  // operational writes outside the knowledge field set — they set only
  // website/facebook/profile columns, never the 12 knowledge fields.)
  const region = src.slice(src.indexOf("resolveKnowledgeAnswer"), src.indexOf("Session serialization"));
  assert.ok(!/UPDATE\s+brands/i.test(region), "knowledge resolutions must go through utils/brandKnowledge only");
  // And the governed AI seam is the ONLY interview AI path: no raw SDK usage.
  assert.ok(!src.includes("anthropic.messages.create"), "interview must use config/anthropic.createMessage");
  assert.ok(src.includes('feature: "setup_interview"'));
});
