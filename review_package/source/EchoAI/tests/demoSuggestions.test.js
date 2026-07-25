// The five live demo suggestions are the heart of Sales Presentation Mode: each
// must map to a real demo step, carry the spoken pitch + accept/dismiss lines,
// and personalize the prospect's name. We also pin the adapted-set validator,
// since AI output for the free-form scenario mode flows through it before it can
// ever reach a live demo — a bad shape must throw, never leak silently.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSuggestions,
  validateAdaptedSuggestions,
  SUGGESTION_DEFS,
  SUGGESTION_STEPS,
} = require("../config/demoSuggestions");

const REQUIRED_STEPS = ["campaigns", "competitor", "social", "hotLeads", "roi"];

test("buildSuggestions returns exactly the five wired steps", () => {
  const s = buildSuggestions({});
  assert.equal(s.length, 5);
  assert.deepEqual([...s.map((x) => x.step)].sort(), [...REQUIRED_STEPS].sort());
  assert.deepEqual([...SUGGESTION_STEPS].sort(), [...REQUIRED_STEPS].sort());
});

test("every suggestion carries spoken pitch + accept + dismiss lines", () => {
  for (const s of buildSuggestions({ businessName: "Test Co" })) {
    for (const field of ["text", "acceptLine", "dismissLine", "title", "action", "agent", "id"]) {
      assert.equal(typeof s[field], "string", `${s.id}.${field} should be a string`);
      assert.ok(s[field].trim().length > 0, `${s.id}.${field} should be non-empty`);
    }
    assert.match(s.text, /\?\s*$/, `${s.id}.text should end with a question`);
  }
});

test("buildSuggestions personalizes the prospect name and business", () => {
  const named = buildSuggestions({ prospectName: "Dave", businessName: "Sunset Motors" });
  const budget = named.find((s) => s.step === "campaigns");
  assert.match(budget.text, /^Dave, /, "budget pitch should open with the prospect name");
  const competitor = named.find((s) => s.step === "competitor");
  assert.match(competitor.text, /Sunset Motors/, "competitor pitch should reference the business");

  const anon = buildSuggestions({ businessName: "Sunset Motors" });
  const anonBudget = anon.find((s) => s.step === "campaigns");
  assert.doesNotMatch(anonBudget.text, /^, /, "no leading comma when prospect name is absent");
});

test("validateAdaptedSuggestions accepts a well-formed adapted set", () => {
  const adapted = SUGGESTION_DEFS.map((d) => ({
    id: d.id,
    title: "Adapted " + d.title,
    action: "Doing the thing…",
    text: "Here is an adapted idea for you?",
    acceptLine: "Executing that now.",
    dismissLine: "No problem, standing by.",
  }));
  const out = validateAdaptedSuggestions(adapted);
  assert.equal(out.length, 5);
  // Step/agent are re-derived from the built-ins, not taken from AI output.
  for (const o of out) {
    const base = SUGGESTION_DEFS.find((d) => d.id === o.id);
    assert.equal(o.step, base.step);
    assert.equal(o.agent, base.agent);
    assert.ok(o.agentColor);
  }
});

test("validateAdaptedSuggestions rejects wrong count", () => {
  assert.throws(() => validateAdaptedSuggestions([{ id: "budget-reallocation" }]));
});

test("validateAdaptedSuggestions rejects an item missing spoken text", () => {
  const adapted = SUGGESTION_DEFS.map((d, i) => ({
    id: d.id,
    text: i === 0 ? "" : "An idea?",
    acceptLine: "Executing.",
    dismissLine: "Okay.",
  }));
  assert.throws(() => validateAdaptedSuggestions(adapted), /missing spoken text/);
});

test("validateAdaptedSuggestions rejects a duplicated id", () => {
  // Right count + all-known ids, but one id repeated (so another is missing).
  const adapted = SUGGESTION_DEFS.map(() => ({
    id: SUGGESTION_DEFS[0].id,
    text: "An idea?",
    acceptLine: "Executing.",
    dismissLine: "Okay.",
  }));
  assert.throws(() => validateAdaptedSuggestions(adapted), /Duplicate suggestion id/);
});

test("validateAdaptedSuggestions rejects an unknown id", () => {
  const adapted = SUGGESTION_DEFS.map((d) => ({
    id: d.id,
    text: "An idea?",
    acceptLine: "Executing.",
    dismissLine: "Okay.",
  }));
  adapted[2].id = "totally-made-up";
  assert.throws(() => validateAdaptedSuggestions(adapted), /Unknown suggestion id/);
});
