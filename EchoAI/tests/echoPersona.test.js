// Echo's personality engine is the single source of truth for *who Echo is* and,
// critically, for the hard invariant that Echo speaks ONLY from real data. These
// tests pin (a) the invariant survives in every composed system prompt, (b) each
// briefing kind gets its own goal clause, (c) the empty-account and multi-brand
// context flags actually change the instructions, and (d) the word cap is honored.
// Pure module — no DB, no AI, no network.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  ECHO_PERSONA,
  SPOKEN_RULES,
  goalFor,
  buildBriefingSystem,
} = require("../prompts/echoPersona");

test("persona + rules are plain non-empty strings (joined, not arrays)", () => {
  assert.equal(typeof ECHO_PERSONA, "string");
  assert.equal(typeof SPOKEN_RULES, "string");
  assert.ok(ECHO_PERSONA.length > 0);
  assert.ok(SPOKEN_RULES.length > 0);
  // A stray array interpolation would leave comma-joined sentences ("...it.,Your").
  assert.ok(!ECHO_PERSONA.includes(".,"));
  assert.ok(!SPOKEN_RULES.includes(".,"));
});

test("the 'only real facts' invariant is present in the spoken rules", () => {
  assert.match(SPOKEN_RULES, /never invent/i);
  assert.match(SPOKEN_RULES, /ONLY the facts/i);
});

test("goalFor returns a distinct clause per briefing kind", () => {
  const morning = goalFor("morning");
  const weekly = goalFor("weekly");
  const closing = goalFor("closing");
  const status = goalFor("status");
  const all = [morning, weekly, closing, status];
  for (const g of all) {
    assert.equal(typeof g, "string");
    assert.ok(g.length > 0);
  }
  // All four are different from one another.
  assert.equal(new Set(all).size, 4);
  assert.match(weekly, /weekly/i);
  assert.match(closing, /end-of-day|closing/i);
  assert.match(status, /right now|status/i);
});

test("morning goal adapts to an empty account (welcome, no zero-counts)", () => {
  const empty = goalFor("morning", { empty: true });
  const normal = goalFor("morning", { empty: false });
  assert.notEqual(empty, normal);
  assert.match(empty, /welcome|ready|standing by/i);
  // Must not tell an empty account about "no" data / zero counts.
  assert.match(empty, /Do NOT mention zero counts/i);
});

test("multiBrand flag adds unified-portfolio, attribute-by-name instructions", () => {
  const single = goalFor("weekly", { multiBrand: false });
  const multi = goalFor("weekly", { multiBrand: true });
  assert.notEqual(single, multi);
  assert.ok(multi.length > single.length);
  assert.match(multi, /ONE unified briefing/i);
  assert.match(multi, /by name/i);

  const singleM = goalFor("morning", { multiBrand: false });
  const multiM = goalFor("morning", { multiBrand: true });
  assert.notEqual(singleM, multiM);
  assert.match(multiM, /ONE unified briefing/i);
});

test("buildBriefingSystem composes persona + rules + goal + word cap", () => {
  const sys = buildBriefingSystem("weekly", { multiBrand: true }, 220);
  assert.ok(sys.includes(ECHO_PERSONA));
  assert.ok(sys.includes(SPOKEN_RULES));
  assert.ok(sys.includes(goalFor("weekly", { multiBrand: true })));
  assert.match(sys, /under 220 words/i);
  // The invariant must survive into the final composed prompt.
  assert.match(sys, /never invent/i);
});

test("buildBriefingSystem defaults the word cap to 130", () => {
  const sys = buildBriefingSystem("morning");
  assert.match(sys, /under 130 words/i);
});
