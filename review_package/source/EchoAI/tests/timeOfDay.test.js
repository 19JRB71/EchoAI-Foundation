// Echo must greet the owner by THEIR local clock (owner requirement): morning
// 5:00–11:59, afternoon 12:00–16:59, evening 17:00–20:59, late 21:00–04:59 —
// never "Good morning" outside the morning window. These are the pure helpers
// (no DB, no AI) that every greeting path (login standby, briefings, Mission
// Control) builds on, so the boundaries must be pinned exactly.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  hourInTimezone,
  partOfDay,
  greetingFor,
  greetingBare,
  DEFAULT_TIMEZONE,
} = require("../utils/timeOfDay");

// ---- partOfDay boundaries ---------------------------------------------------

test("partOfDay maps every hour to the owner's required windows", () => {
  const expected = {
    0: "late", 1: "late", 2: "late", 3: "late", 4: "late",
    5: "morning", 6: "morning", 11: "morning",
    12: "afternoon", 13: "afternoon", 16: "afternoon",
    17: "evening", 18: "evening", 20: "evening",
    21: "late", 22: "late", 23: "late",
  };
  for (const [hour, part] of Object.entries(expected)) {
    assert.equal(partOfDay(Number(hour)), part, `hour ${hour}`);
  }
});

// ---- greetings --------------------------------------------------------------

test("greetingFor never says Good morning outside the morning window", () => {
  assert.equal(greetingFor("morning", "Sir"), "Good morning Sir.");
  assert.equal(greetingFor("afternoon", "Sir"), "Good afternoon Sir.");
  assert.equal(greetingFor("evening", "Sir"), "Good evening Sir.");
  assert.match(greetingFor("late", "Sir"), /^Working late Sir/);
  for (const part of ["afternoon", "evening", "late"]) {
    assert.ok(!/good morning/i.test(greetingFor(part, "Sir")), part);
  }
});

test("greetingFor defaults the name to Sir; greetingBare carries no name", () => {
  assert.equal(greetingFor("morning", null), "Good morning Sir.");
  assert.equal(greetingBare("afternoon"), "Good afternoon.");
  assert.equal(greetingBare("late"), "Working late?");
  // Unknown part falls back to morning (never throws, never blank).
  assert.equal(greetingBare("nonsense"), "Good morning.");
});

// ---- hourInTimezone ---------------------------------------------------------

test("hourInTimezone reads the wall clock in the given IANA zone", () => {
  // 2026-07-08 18:30 UTC = 14:30 in New York (EDT, UTC-4) = 03:30 next day in Tokyo (+9).
  const instant = new Date(Date.UTC(2026, 6, 8, 18, 30, 0));
  assert.equal(hourInTimezone("America/New_York", instant), 14);
  assert.equal(hourInTimezone("Asia/Tokyo", instant), 3);
  assert.equal(hourInTimezone("UTC", instant), 18);
});

test("hourInTimezone falls back to Eastern on an invalid timezone", () => {
  const instant = new Date(Date.UTC(2026, 6, 8, 18, 30, 0));
  assert.equal(hourInTimezone("Not/AZone", instant), hourInTimezone(DEFAULT_TIMEZONE, instant));
  assert.equal(hourInTimezone(null, instant), 14);
});

test("midnight in-zone is hour 0 → late", () => {
  // 04:00 UTC on 2026-07-09 = midnight in New York (EDT).
  const instant = new Date(Date.UTC(2026, 6, 9, 4, 0, 0));
  assert.equal(hourInTimezone("America/New_York", instant), 0);
  assert.equal(partOfDay(0), "late");
});
