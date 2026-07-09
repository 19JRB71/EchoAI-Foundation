/**
 * Regression tests for the Content Calendar guided-interview prompt block.
 * The interview answers (happenings, promotions, tone, avoid) are optional
 * free text collected by the client wizard; only answered questions may appear
 * in the AI prompt, and an empty/absent interview must add nothing.
 */
const test = require("node:test");
const assert = require("node:assert");

const { interviewBlock } = require("../prompts/contentCalendarPrompt");

test("returns empty array for missing or non-object interview", () => {
  assert.deepStrictEqual(interviewBlock(undefined), []);
  assert.deepStrictEqual(interviewBlock(null), []);
  assert.deepStrictEqual(interviewBlock("hello"), []);
  assert.deepStrictEqual(interviewBlock(42), []);
});

test("returns empty array when all answers are blank", () => {
  assert.deepStrictEqual(
    interviewBlock({ happenings: "  ", promotions: "", tone: "", avoid: "\n" }),
    []
  );
});

test("includes only the answered questions", () => {
  const lines = interviewBlock({
    happenings: "Open house on the 15th",
    promotions: "",
    tone: "",
    avoid: "old office location",
  });
  const text = lines.join("\n");
  assert.ok(text.includes("Open house on the 15th"));
  assert.ok(text.includes("old office location"));
  assert.ok(!text.includes("Offers/promotions"));
  assert.ok(!text.includes("Tone the owner asked for"));
});

test("renders all four answers with a header line", () => {
  const lines = interviewBlock({
    happenings: "Summer season",
    promotions: "Free market analysis",
    tone: "fun, playful, and upbeat",
    avoid: "pricing",
  });
  assert.strictEqual(lines[0], "");
  assert.ok(lines[1].includes("planning interview"));
  const text = lines.join("\n");
  assert.ok(text.includes("Summer season"));
  assert.ok(text.includes("Free market analysis"));
  assert.ok(text.includes("fun, playful, and upbeat"));
  assert.ok(text.includes("AVOID"));
  assert.ok(text.includes("pricing"));
});

test("coerces non-string answer values safely", () => {
  const lines = interviewBlock({ happenings: 123, tone: null });
  const text = lines.join("\n");
  assert.ok(text.includes("123"));
  assert.ok(!text.includes("null"));
});
