"use strict";

// Onboarding personalization ("How involved would you like me to be?") —
// pure-function coverage: normalizing the involvement answer, extracting the
// working style from interview answers, and rendering it into prompt guidance.

const test = require("node:test");
const assert = require("node:assert");

const { normalizeInvolvement, workingStyleLines } = require("../utils/echoContext");
const { extractWorkingStyle } = require("../controllers/setupAgentController");

test("normalizeInvolvement maps common phrasings to the three modes", () => {
  assert.strictEqual(normalizeInvolvement("Hands-off, please"), "hands_off");
  assert.strictEqual(normalizeInvolvement("hands off"), "hands_off");
  assert.strictEqual(normalizeInvolvement("you handle it, don't bother me"), "hands_off");
  assert.strictEqual(normalizeInvolvement("Executive mode"), "executive");
  assert.strictEqual(normalizeInvolvement("I want to stay closely involved"), "executive");
  assert.strictEqual(normalizeInvolvement("Guided sounds good"), "guided");
  assert.strictEqual(normalizeInvolvement("check in with me before big things"), "guided");
});

test("normalizeInvolvement never guesses on unrecognized input", () => {
  assert.strictEqual(normalizeInvolvement(""), "");
  assert.strictEqual(normalizeInvolvement(null), "");
  assert.strictEqual(normalizeInvolvement("banana"), "");
});

test("extractWorkingStyle pulls all four preferences from keyed answers", () => {
  const style = extractWorkingStyle({
    business_name: "Acme",
    echo_daily_briefing: "Yes please",
    echo_instant_alerts: "Alert me right away",
    echo_detail_level: "Short and to the point",
    echo_involvement: "Hands-off",
  });
  assert.deepStrictEqual(style, {
    involvement: "hands_off",
    daily_briefing: true,
    instant_alerts: true,
    detail_level: "concise",
  });
});

test("extractWorkingStyle handles the opposite choices", () => {
  const style = extractWorkingStyle({
    echo_daily_briefing: "No thanks",
    echo_instant_alerts: "save it for the briefing",
    echo_detail_level: "full detail please",
    echo_involvement: "Executive — I make the calls",
  });
  assert.deepStrictEqual(style, {
    involvement: "executive",
    daily_briefing: false,
    instant_alerts: false,
    detail_level: "detailed",
  });
});

test("extractWorkingStyle omits keys it can't confidently read", () => {
  assert.deepStrictEqual(extractWorkingStyle({}), {});
  assert.deepStrictEqual(extractWorkingStyle({ echo_involvement: "hmm not sure" }), {});
});

test("workingStyleLines renders stored style into guidance lines", () => {
  const lines = workingStyleLines({
    data: {
      working_style: {
        involvement: "guided",
        daily_briefing: true,
        instant_alerts: false,
        detail_level: "concise",
      },
    },
  });
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0], /GUIDED mode/);
  assert.match(lines[1], /daily morning briefing/);
  assert.match(lines[1], /short and to the point/);
});

test("workingStyleLines is empty when no style is stored", () => {
  assert.deepStrictEqual(workingStyleLines({}), []);
  assert.deepStrictEqual(workingStyleLines({ data: {} }), []);
  assert.deepStrictEqual(workingStyleLines(null), []);
});
