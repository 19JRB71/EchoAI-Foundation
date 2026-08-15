/**
 * Prompt 035 Stage 2 — Section C: deterministic business-hours parser.
 *
 * The parser must be VERBATIM/DETERMINISTIC-ONLY: a stated schedule either
 * parses mechanically (single day-range + single time-range) or returns null
 * — never a guess, never a silent 9–5 default. (The 9–5 default only applies
 * to UNANSWERED hours, and that decision lives in the controller, not here.)
 *
 * Run with:  node --test test/p035.hoursParser.test.js
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { parseBusinessHours } = require("../utils/hoursParser");

const WEEKDAYS_8_5 = [1, 2, 3, 4, 5].map((day) => ({ day, start: "08:00", end: "17:00" }));

test("handoff.verbatimOnly.statedPath — 'Monday through Friday, 8 to 5' parses deterministically", () => {
  const parsed = parseBusinessHours("Monday through Friday, 8 to 5");
  assert.deepEqual(parsed.weeklyHours, WEEKDAYS_8_5);
});

test("compact 'M-F 8-5' parses with pm inference on the end time", () => {
  assert.deepEqual(parseBusinessHours("M-F 8-5").weeklyHours, WEEKDAYS_8_5);
});

test("explicit am/pm is honored (9am to 6pm weekdays)", () => {
  const parsed = parseBusinessHours("weekdays 9am to 6pm");
  assert.deepEqual(
    parsed.weeklyHours,
    [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "18:00" })),
  );
});

test("bare time range defaults the DAYS to weekdays but never the times", () => {
  const parsed = parseBusinessHours("8 to 5");
  assert.deepEqual(parsed.weeklyHours, WEEKDAYS_8_5);
});

test("multi-segment schedules return null (deterministic-only, no partial guessing)", () => {
  assert.equal(parseBusinessHours("Mon 8-5, Sat 9-12"), null);
});

test("vague statements return null — never coerced into a default", () => {
  assert.equal(parseBusinessHours("whenever people need me"), null);
  assert.equal(parseBusinessHours("around the clock mostly"), null);
  assert.equal(parseBusinessHours(""), null);
  assert.equal(parseBusinessHours(null), null);
});

test("weekend-inclusive ranges keep the stated span (Mon-Sun)", () => {
  const parsed = parseBusinessHours("Monday to Sunday 10 to 4");
  assert.ok(parsed);
  assert.equal(parsed.weeklyHours.length, 7);
  for (const h of parsed.weeklyHours) {
    assert.equal(h.start, "10:00");
    assert.equal(h.end, "16:00");
  }
});

test("nonsense time ranges (end before start with explicit meridiem) return null", () => {
  assert.equal(parseBusinessHours("Mon-Fri 5pm to 8am"), null);
});
