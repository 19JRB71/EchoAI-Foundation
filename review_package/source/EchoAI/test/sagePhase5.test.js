const { test } = require("node:test");
const assert = require("node:assert");

const {
  computeConfidence,
  buildConfidenceExplanation,
} = require("../utils/confidenceExplanation");
const { decomposeWeeks, weekStartOf } = require("../utils/changeDiagnostics");
const {
  validateProposal,
  attachConstraintFlags,
  bucketRank,
  contentKeyOf,
} = require("../utils/opportunitySynthesis");
const {
  validateInstruction,
  buildInstructionFromOpportunity,
} = require("../utils/directiveBus");

// ---------------------------------------------------------------------------
// confidenceExplanation — deterministic tier explanation (CEO refinement W4).
// Honesty invariants: min-of-evidence, unknown tier => null, NO fabricated %.
// ---------------------------------------------------------------------------

test("computeConfidence: min of evidence tiers", () => {
  assert.strictEqual(
    computeConfidence([{ confidence: "verified" }, { confidence: "reported" }]),
    "reported",
  );
  assert.strictEqual(computeConfidence([{ confidence: "verified" }]), "verified");
  assert.strictEqual(
    computeConfidence([{ confidence: "inferred" }, { confidence: "verified" }]),
    "inferred",
  );
});

test("computeConfidence: empty or unknown tier => null (cannot claim confidence)", () => {
  assert.strictEqual(computeConfidence([]), null);
  assert.strictEqual(computeConfidence(null), null);
  assert.strictEqual(
    computeConfidence([{ confidence: "verified" }, { confidence: "high" }]),
    null,
  );
});

test("buildConfidenceExplanation: deterministic reasons, no percentage on the tier", () => {
  const exp = buildConfidenceExplanation(
    [
      {
        item_id: "a",
        source: "Facebook Ads",
        confidence: "verified",
        created_at: "2026-07-13T00:00:00Z",
        claim: "CPL dropped 20%",
      },
      { item_id: "b", source: "News scan", confidence: "reported", created_at: "2026-07-14T00:00:00Z", summary: "Competitor raised prices" },
    ],
    { outcome_coverage_pct: 42.4 },
  );
  assert.strictEqual(exp.tier, "reported");
  assert.strictEqual(exp.label, "Reported");
  assert.strictEqual(exp.method, "min_of_evidence");
  assert.strictEqual(exp.reasons.length, 3);
  assert.match(exp.reasons[0], /CPL dropped 20%.*Facebook Ads, 2026-07-13, Verified/);
  assert.match(exp.reasons[2], /42% of leads/);
  // The tier itself carries no invented numeric confidence.
  assert.strictEqual(/\d+%/.test(exp.label), false);
});

test("buildConfidenceExplanation: null when evidence tier unknown", () => {
  assert.strictEqual(buildConfidenceExplanation([{ confidence: "maybe" }]), null);
});

// ---------------------------------------------------------------------------
// changeDiagnostics.decomposeWeeks — deterministic arithmetic, honest coverage.
// ---------------------------------------------------------------------------

test("decomposeWeeks: missing week => null terms with an explicit coverage reason", () => {
  const r = decomposeWeeks(null, { total_spend: 10, total_leads: 5, conversions: 1 });
  assert.strictEqual(r.terms, null);
  assert.strictEqual(r.coverage.reason, "no_previous_week_analytics");
  const r2 = decomposeWeeks({ total_spend: 10, total_leads: 5, conversions: 1 }, null);
  assert.strictEqual(r2.terms, null);
  assert.strictEqual(r2.coverage.reason, "no_current_week_analytics");
});

test("decomposeWeeks: computes lead/conversion deltas from real rows", () => {
  const prev = { total_spend: 100, total_leads: 10, conversions: 2 };
  const curr = { total_spend: 200, total_leads: 30, conversions: 5 };
  const r = decomposeWeeks(prev, curr);
  assert.ok(r.terms);
  assert.strictEqual(r.terms.delta_leads, 20);
  assert.strictEqual(r.terms.delta_conversions, 3);
  assert.strictEqual(r.coverage.previous_week, true);
  assert.strictEqual(r.coverage.current_week, true);
});

test("decomposeWeeks: zero spend never divides — efficiency guarded honestly", () => {
  const r = decomposeWeeks(
    { total_spend: 0, total_leads: 4, conversions: 0 },
    { total_spend: 0, total_leads: 6, conversions: 1 },
  );
  assert.ok(r.terms);
  assert.strictEqual(r.terms.delta_leads, 2);
  // No NaN/Infinity anywhere in the terms (nulls are the honest "unknown").
  for (const v of Object.values(r.terms)) {
    if (typeof v === "number") assert.ok(Number.isFinite(v), `non-finite term ${v}`);
  }
});

test("weekStartOf: returns a Monday", () => {
  const d = weekStartOf(new Date("2026-07-16T12:00:00Z")); // Thursday
  assert.strictEqual(new Date(d).getUTCDay(), 1);
});

// ---------------------------------------------------------------------------
// opportunitySynthesis.validateProposal — the honesty chokepoint.
// ---------------------------------------------------------------------------

function ctxWith(evidence, { coveragePct = 50, recentDeclines = [] } = {}) {
  return {
    evidenceById: new Map(evidence.map((e) => [String(e.item_id), e])),
    coverage: { coveragePct, totalLeads: 40, withOutcome: 20, sufficient: coveragePct >= 30 },
    recentDeclines,
  };
}

const EV = {
  item_id: "e1",
  source: "Facebook Ads",
  confidence: "verified",
  created_at: "2026-07-15T00:00:00Z",
  summary: "CPL down",
};

const GOOD = {
  title: "Shift budget to lookalike audience",
  thesis: "Verified ad data shows the lookalike audience converts at half the CPL.",
  category: "growth",
  recommended_department: "atlas",
  evidence_item_ids: ["e1"],
  expected_impact_cents: 50_000,
  impact_basis: "Based on last 4 weeks of recorded lead outcomes",
};

test("validateProposal: rejects fabricated/uncited evidence", () => {
  const r = validateProposal({ ...GOOD, evidence_item_ids: ["ghost"] }, ctxWith([EV]));
  assert.deepStrictEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: "no_valid_evidence" });
});

test("validateProposal: impact requires basis AND >=30% outcome coverage — else null", () => {
  const low = validateProposal(GOOD, ctxWith([EV], { coveragePct: 10 }));
  assert.strictEqual(low.ok, true);
  assert.strictEqual(low.record.expected_impact_cents, null);
  assert.strictEqual(low.record.impact_basis, null);

  const noBasis = validateProposal({ ...GOOD, impact_basis: "  " }, ctxWith([EV]));
  assert.strictEqual(noBasis.ok, true);
  assert.strictEqual(noBasis.record.expected_impact_cents, null);

  const good = validateProposal(GOOD, ctxWith([EV]));
  assert.strictEqual(good.ok, true);
  assert.strictEqual(good.record.expected_impact_cents, 50_000);
});

test("validateProposal: confidence recomputed from cited evidence, not AI-claimed", () => {
  const inferred = { ...EV, item_id: "e2", confidence: "inferred" };
  const r = validateProposal(
    { ...GOOD, evidence_item_ids: ["e1", "e2"], confidence: "verified" },
    ctxWith([EV, inferred]),
  );
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.record.confidence, "inferred");
});

test("validateProposal: declined <90d only re-proposable with NEWER evidence", () => {
  const decline = {
    content_key: contentKeyOf("growth", GOOD.title),
    decided_at: "2026-07-16T00:00:00Z",
    owner_decision_note: "not now",
  };
  const stale = validateProposal(GOOD, ctxWith([EV], { recentDeclines: [decline] }));
  assert.strictEqual(stale.ok, false);
  const newer = validateProposal(
    GOOD,
    ctxWith([{ ...EV, created_at: "2026-07-18T00:00:00Z" }], { recentDeclines: [decline] }),
  );
  assert.strictEqual(newer.ok, true);
});

test("validateProposal: bad category/department rejected", () => {
  assert.strictEqual(validateProposal({ ...GOOD, category: "ads" }, ctxWith([EV])).ok, false);
  assert.strictEqual(
    validateProposal({ ...GOOD, recommended_department: "hermes" }, ctxWith([EV])).ok,
    false,
  );
});

test("bucketRank: verified sorts before reported before inferred (no numeric scores)", () => {
  const recs = [
    { confidence: "inferred", impact_basis: "x", effort: "s", category: "ads" },
    { confidence: "verified", impact_basis: null, effort: "l", category: "ads" },
    { confidence: "reported", impact_basis: "x", effort: "s", category: "ads" },
  ];
  const sorted = bucketRank(recs);
  assert.deepStrictEqual(
    sorted.map((r) => r.confidence),
    ["verified", "reported", "inferred"],
  );
});

test("attachConstraintFlags: no constraints row => honest 'unknown', no invented limits", () => {
  const record = {
    recommended_department: "atlas",
    cost_estimate_cents: 100_00,
    constraint_flags: [],
  };
  const out = attachConstraintFlags(record, null);
  // Never claims a budget/capacity violation when constraints are unknown.
  assert.deepStrictEqual(out.constraint_flags, []);
});

test("attachConstraintFlags: cost over stated monthly budget is surfaced as a fact", () => {
  const out = attachConstraintFlags(
    { recommended_department: "pulse", cost_estimate_cents: 200_00, constraint_flags: [] },
    { monthly_budget_cents: 100_00, weekly_capacity: null, blackout_dates: [] },
  );
  assert.strictEqual(
    out.constraint_flags.some((f) => /exceeds the owner's stated monthly budget/i.test(f)),
    true,
  );
});

// ---------------------------------------------------------------------------
// directiveBus — instruction schema chokepoint.
// ---------------------------------------------------------------------------

test("validateInstruction: rejects unknown department and non-object instructions", () => {
  // Returns an error string on failure, null on success.
  assert.match(String(validateInstruction("owner", {})), /Unknown department/);
  assert.match(String(validateInstruction("nova", null)), /must be an object/);
});

test("buildInstructionFromOpportunity: produces a valid instruction for its department", () => {
  const base = {
    opportunity_id: "00000000-0000-0000-0000-000000000001",
    title: GOOD.title,
    thesis: GOOD.thesis,
    category: "growth",
    rationale: {},
  };
  for (const dept of ["nova", "atlas", "forge", "pulse", "voice"]) {
    const instr = buildInstructionFromOpportunity({
      ...base,
      recommended_department: dept,
      cost_estimate_cents: 20_000,
    });
    const err = validateInstruction(dept, instr);
    assert.strictEqual(err, null, `${dept}: ${err}`);
  }
});
