"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  parseCaptureJSON,
  mergeOwnerProfile,
  formatKnowledge,
  valuesGuardrail,
} = require("../utils/echoContext");

test("parseCaptureJSON returns null on empty/garbage input", () => {
  assert.strictEqual(parseCaptureJSON(""), null);
  assert.strictEqual(parseCaptureJSON(null), null);
  assert.strictEqual(parseCaptureJSON("no json here"), null);
  assert.strictEqual(parseCaptureJSON("{ not valid json"), null);
});

test("parseCaptureJSON extracts JSON from a ```json fenced block", () => {
  const text =
    "Sure!\n```json\n" +
    JSON.stringify({
      memories: [{ category: "goal", title: "Hit $50k MRR", detail: "by Q4" }],
    }) +
    "\n```\nHope that helps.";
  const out = parseCaptureJSON(text);
  assert.ok(out);
  assert.strictEqual(out.memories.length, 1);
  assert.strictEqual(out.memories[0].category, "goal");
  assert.strictEqual(out.memories[0].title, "Hit $50k MRR");
});

test("parseCaptureJSON extracts a bare JSON object embedded in prose", () => {
  const out = parseCaptureJSON(
    'Here you go: {"memories":[{"title":"Prefers email"}]} done',
  );
  assert.ok(out);
  assert.strictEqual(out.memories[0].title, "Prefers email");
  // Unknown/absent category coerces to "note".
  assert.strictEqual(out.memories[0].category, "note");
});

test("parseCaptureJSON drops memories without a title and caps arrays", () => {
  const memories = [];
  for (let i = 0; i < 20; i++) memories.push({ title: i % 2 === 0 ? "" : "k" + i });
  const out = parseCaptureJSON(JSON.stringify({ memories }));
  assert.ok(out.memories.length <= 8);
  assert.ok(out.memories.every((m) => m.title));
});

test("parseCaptureJSON coerces invalid relationship type to 'other'", () => {
  const out = parseCaptureJSON(
    JSON.stringify({ relationships: [{ name: "Sarah", type: "nonsense" }] }),
  );
  assert.strictEqual(out.relationships[0].type, "other");
  assert.strictEqual(out.relationships[0].name, "Sarah");
});

test("parseCaptureJSON keeps only known owner profile fields", () => {
  const out = parseCaptureJSON(
    JSON.stringify({
      profileUpdates: { goals: "grow", bogusField: "ignore me", values: "honesty" },
    }),
  );
  assert.strictEqual(out.profileUpdates.goals, "grow");
  assert.strictEqual(out.profileUpdates.values, "honesty");
  assert.ok(!("bogusField" in out.profileUpdates));
});

test("mergeOwnerProfile only overwrites with non-empty values and maps to columns", () => {
  const existing = { core_values: "honesty", goals: "old goal" };
  const merged = mergeOwnerProfile(existing, {
    goals: "new goal",
    values: "   ", // whitespace-only should be ignored
    riskTolerance: "cautious",
  });
  assert.strictEqual(merged.goals, "new goal");
  assert.strictEqual(merged.core_values, "honesty"); // unchanged
  assert.strictEqual(merged.risk_tolerance, "cautious");
});

test("formatKnowledge returns '' when there is nothing to say", () => {
  assert.strictEqual(formatKnowledge({}), "");
  assert.strictEqual(formatKnowledge(), "");
});

test("formatKnowledge (chat mode) builds an owner + relationships block", () => {
  const out = formatKnowledge({
    ownerProfile: { goals: "grow", core_values: "integrity" },
    profiles: [{ person_name: "Sarah", person_type: "lead", next_step: "send quote" }],
    memories: [{ title: "Wants a demo", detail: "next week" }],
  });
  assert.match(out, /WHAT YOU KNOW/);
  assert.match(out, /Goals: grow/);
  assert.match(out, /Sarah/);
  assert.match(out, /Wants a demo/);
});

test("formatKnowledge (speech mode) uses guidance-only header, not a facts header", () => {
  const out = formatKnowledge({
    ownerProfile: { goals: "grow" },
    mode: "speech",
  });
  assert.match(out, /PERSONALIZATION GUIDANCE/);
  assert.doesNotMatch(out, /WHAT YOU KNOW/);
});

test("valuesGuardrail is empty without values/preferences/risk, present with them", () => {
  assert.strictEqual(valuesGuardrail({}), "");
  assert.strictEqual(valuesGuardrail(null), "");
  const g = valuesGuardrail({ core_values: "honesty" });
  assert.match(g, /conflict/i);
});
