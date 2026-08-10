// Prompt 023 — pure gap-engine tests. No DB, no AI.
//
// "Interview action precedence is question selection, not an authority ranking."

const { test } = require("node:test");
const assert = require("node:assert/strict");

const engine = require("../utils/interviewGapEngine");
const { ACTIONS, REASONS, NOTICES } = engine;

// ---------------------------------------------------------------------------
// Closed vocabularies (regression-locked; additions require owner approval).
// ---------------------------------------------------------------------------

test("REASONS is exactly the owner-approved 9-code closed vocabulary", () => {
  assert.deepEqual(Object.values(REASONS).sort(), [
    "approved_current",
    "deferred_by_owner",
    "draft_conflict",
    "draft_high_confidence",
    "draft_low_confidence",
    "legacy_unreviewed",
    "missing",
    "pending_revision",
    "premise_changed",
  ]);
  assert.ok(Object.isFrozen(REASONS));
});

test("ACTIONS and NOTICES are the closed owner-approved sets", () => {
  assert.deepEqual(Object.values(ACTIONS).sort(), ["arbitrate", "ask", "confirm", "skip"]);
  assert.deepEqual(Object.values(NOTICES).sort(), ["draft_differs", "none", "pending_review_exists"]);
  assert.ok(Object.isFrozen(ACTIONS));
  assert.ok(Object.isFrozen(NOTICES));
});

test("FIELD_ORDER is the closed 12-key knowledge universe", () => {
  assert.equal(engine.FIELD_ORDER.length, 12);
  const knowledge = require("../utils/brandKnowledge");
  assert.deepEqual([...engine.FIELD_ORDER].sort(), [...knowledge.FIELD_KEYS].sort());
});

// ---------------------------------------------------------------------------
// Collision table (Stage-1 accepted matrix incl. Approved+Pending+Draft).
// ---------------------------------------------------------------------------

const F = "description";
const approved = { value: "We build pole barns." };
const pending = { revisionId: "r1", proposedValue: "We build custom pole barns.", sourceKind: "website" };
const legacy = { value: "Old unversioned blurb" };
const draftHigh = { value: "Amish-built pole barns.", confidence: "high" };
const draftLow = { value: "Some barn company?", confidence: "low" };
const draftConflict = { value: "Barns Inc.", confidence: "medium", conflict: true, alternatives: [{ value: "Barn Co." }] };

test("approved only → skip/approved_current, notice none", () => {
  const r = engine.evaluateField({ fieldKey: F, approved });
  assert.deepEqual([r.action, r.reason, r.notice], [ACTIONS.SKIP, REASONS.APPROVED_CURRENT, NOTICES.NONE]);
});

test("approved + pending → skip with pending_review_exists notice (never re-litigated)", () => {
  const r = engine.evaluateField({ fieldKey: F, approved, pending });
  assert.deepEqual([r.action, r.reason, r.notice], [ACTIONS.SKIP, REASONS.APPROVED_CURRENT, NOTICES.PENDING_REVIEW_EXISTS]);
});

test("approved + materially different draft → skip with draft_differs notice", () => {
  const r = engine.evaluateField({ fieldKey: F, approved, draft: draftHigh });
  assert.deepEqual([r.action, r.reason, r.notice], [ACTIONS.SKIP, REASONS.APPROVED_CURRENT, NOTICES.DRAFT_DIFFERS]);
});

test("approved + draft equal after normalization → notice none", () => {
  const r = engine.evaluateField({
    fieldKey: F,
    approved: { value: "We build pole barns." },
    draft: { value: "  we build   POLE barns. ", confidence: "high" },
  });
  assert.equal(r.notice, NOTICES.NONE);
});

test("approved + pending + draft → pending notice wins (single closed notice)", () => {
  const r = engine.evaluateField({ fieldKey: F, approved, pending, draft: draftHigh });
  assert.deepEqual([r.action, r.notice], [ACTIONS.SKIP, NOTICES.PENDING_REVIEW_EXISTS]);
});

test("pending only → confirm/pending_revision", () => {
  const r = engine.evaluateField({ fieldKey: F, pending });
  assert.deepEqual([r.action, r.reason], [ACTIONS.CONFIRM, REASONS.PENDING_REVISION]);
});

test("pending + agreeing draft → confirm (no false conflict)", () => {
  const r = engine.evaluateField({
    fieldKey: F,
    pending,
    draft: { value: "we build custom pole barns.", confidence: "high" },
  });
  assert.deepEqual([r.action, r.reason], [ACTIONS.CONFIRM, REASONS.PENDING_REVISION]);
});

test("pending + materially different draft → arbitrate/draft_conflict with both candidates", () => {
  const r = engine.evaluateField({ fieldKey: F, pending, draft: draftHigh });
  assert.deepEqual([r.action, r.reason], [ACTIONS.ARBITRATE, REASONS.DRAFT_CONFLICT]);
  assert.equal(r.evidence.candidates.length, 2);
  assert.deepEqual(
    r.evidence.candidates.map((c) => c.origin).sort(),
    ["pending_revision", "research_draft"],
  );
});

test("draft high confidence → confirm/draft_high_confidence", () => {
  const r = engine.evaluateField({ fieldKey: F, draft: draftHigh });
  assert.deepEqual([r.action, r.reason], [ACTIONS.CONFIRM, REASONS.DRAFT_HIGH_CONFIDENCE]);
});

test("draft low/medium confidence → ask/draft_low_confidence", () => {
  const r = engine.evaluateField({ fieldKey: F, draft: draftLow });
  assert.deepEqual([r.action, r.reason], [ACTIONS.ASK, REASONS.DRAFT_LOW_CONFIDENCE]);
});

test("draft with conflict flag → arbitrate with alternatives as candidates", () => {
  const r = engine.evaluateField({ fieldKey: F, draft: draftConflict });
  assert.deepEqual([r.action, r.reason], [ACTIONS.ARBITRATE, REASONS.DRAFT_CONFLICT]);
  assert.equal(r.evidence.candidates.length, 2);
});

test("legacy only → confirm/legacy_unreviewed", () => {
  const r = engine.evaluateField({ fieldKey: F, legacy });
  assert.deepEqual([r.action, r.reason], [ACTIONS.CONFIRM, REASONS.LEGACY_UNREVIEWED]);
});

test("nothing anywhere → ask/missing", () => {
  const r = engine.evaluateField({ fieldKey: F });
  assert.deepEqual([r.action, r.reason], [ACTIONS.ASK, REASONS.MISSING]);
});

test("empty-string values are treated as absent, never as evidence", () => {
  const r = engine.evaluateField({
    fieldKey: F,
    approved: { value: "" },
    pending: { proposedValue: "   " },
    legacy: { value: "" },
    draft: { value: null, confidence: "high" },
  });
  assert.deepEqual([r.action, r.reason], [ACTIONS.ASK, REASONS.MISSING]);
});

// ---------------------------------------------------------------------------
// Deterministic normalized comparison (Section B2): formatting only, no
// semantic equivalence; unsure = different.
// ---------------------------------------------------------------------------

test("normalization: whitespace/case collapse equal; wording differences stay different", () => {
  assert.equal(engine.materiallyDiffers(F, "Pole  Barns\nLLC", "pole barns llc"), false);
  assert.equal(engine.materiallyDiffers(F, "Pole Barns LLC", "Pole Barn Kits LLC"), true);
});

test("normalization: phone compares digits only; email lowercases", () => {
  assert.equal(engine.materiallyDiffers("phone", "(555) 010-2030", "555.010.2030"), false);
  assert.equal(engine.materiallyDiffers("phone", "555 010 2030", "555 010 2031"), true);
  assert.equal(engine.materiallyDiffers("email", " Sales@X.com ", "sales@x.com"), false);
});

test("normalization: objects compare via canonical sorted-key JSON; different shapes differ", () => {
  assert.equal(engine.materiallyDiffers("hours", { mon: "9-5", tue: "9-5" }, { tue: "9-5", mon: "9-5" }), false);
  assert.equal(engine.materiallyDiffers("hours", { mon: "9-5" }, { mon: "9-6" }), true);
  // Not safely normalizable as equivalent (string vs object) → DIFFERENT.
  assert.equal(engine.materiallyDiffers("hours", "9-5 weekdays", { mon: "9-5" }), true);
});

// ---------------------------------------------------------------------------
// Plan, ceiling, completion, continue-anyway.
// ---------------------------------------------------------------------------

test("buildPlan covers all 12 fields in deterministic order", () => {
  const plan = engine.buildPlan({});
  assert.deepEqual(plan.map((e) => e.fieldKey), [...engine.FIELD_ORDER]);
  assert.ok(plan.every((e) => e.action === ACTIONS.ASK && e.reason === REASONS.MISSING));
});

test("nextField skips approved fields and honors resolutions/deferrals/ceiling", () => {
  const plan = engine.buildPlan({ approved: { business_name: { value: "X" } } });
  assert.equal(engine.nextField(plan, {}).fieldKey, "address");
  const state = { resolved: { address: true }, deferred: { service_area: true }, surfaces: { description: 2 } };
  assert.equal(engine.nextField(plan, state).fieldKey, "services");
});

test("each field may surface at most twice; ceiling is a hard bound", () => {
  assert.equal(engine.MAX_SURFACES_PER_FIELD, 2);
  assert.equal(engine.HARD_QUESTION_CEILING, 24);
  const plan = engine.buildPlan({});
  const surfaces = {};
  let turns = 0;
  // Simulate an owner who never resolves anything: the interview still ends.
  for (;;) {
    const next = engine.nextField(plan, { surfaces });
    if (!next) break;
    surfaces[next.fieldKey] = (surfaces[next.fieldKey] || 0) + 1;
    turns += 1;
    assert.ok(turns <= engine.HARD_QUESTION_CEILING, "exceeded hard ceiling");
  }
  assert.equal(turns, engine.HARD_QUESTION_CEILING);
  assert.equal(engine.interviewComplete(plan, { surfaces }), true);
});

test("interviewComplete is engine-decided: false with open gaps, true when settled", () => {
  const plan = engine.buildPlan({ approved: { business_name: { value: "X" } } });
  assert.equal(engine.interviewComplete(plan, {}), false);
  const resolved = {};
  for (const e of plan) if (e.action !== ACTIONS.SKIP) resolved[e.fieldKey] = true;
  assert.equal(engine.interviewComplete(plan, { resolved }), true);
});

test("continueAnyway defers remaining gaps as deferred_by_owner and lists unresolved important fields honestly", () => {
  const plan = engine.buildPlan({});
  const state = { resolved: { business_name: true, tagline: true } };
  const exit = engine.continueAnyway(plan, state);
  assert.ok(exit.deferred.every((d) => d.reason === REASONS.DEFERRED_BY_OWNER));
  assert.ok(!exit.deferred.some((d) => d.fieldKey === "business_name"));
  // Required (description, services) + strategic (service_area, address, email, phone) open gaps are named.
  for (const k of ["description", "services", "service_area", "address", "email", "phone"]) {
    assert.ok(exit.unresolvedImportant.includes(k), `${k} should be reported unresolved`);
  }
  assert.ok(!exit.unresolvedImportant.includes("tagline"));
});

test("required/strategic field sets match the owner-accepted A6 lists", () => {
  assert.deepEqual([...engine.REQUIRED_FIELDS], ["business_name", "description", "services"]);
  assert.deepEqual([...engine.STRATEGIC_FIELDS], ["service_area", "address", "email", "phone"]);
});

test("the governing sentence is present verbatim in the engine source", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("../utils/interviewGapEngine.js"), "utf8");
  assert.ok(src.includes("Interview action precedence is question selection, not an authority ranking."));
});
