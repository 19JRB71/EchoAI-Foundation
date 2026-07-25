const { test } = require("node:test");
const assert = require("node:assert");

const ctrl = require("../controllers/contentCalendarController");
const { CONTENT_TYPES } = require("../prompts/contentCalendarPrompt");
const { computeSlots, scheduledTimeFor } = ctrl;

// ---------------------------------------------------------------------------
// The DEFAULT "optimal" per-platform schedule.
// ---------------------------------------------------------------------------

test("optimal: FB/IG/TikTok post 3×/day, LinkedIn 1×/day, YouTube 3×/week", () => {
  const slots = computeSlots("optimal", [
    "facebook",
    "instagram",
    "tiktok",
    "linkedin",
    "youtube",
  ]);

  const count = (p) => slots.filter((s) => s.platform === p).length;
  assert.equal(count("facebook"), 90, "facebook 3×/day for 30 days");
  assert.equal(count("instagram"), 90);
  assert.equal(count("tiktok"), 90);
  assert.equal(count("linkedin"), 30, "linkedin 1×/day for 30 days");
  // 3 posting days per rolling 7-day window across 30 days.
  const yt = count("youtube");
  assert.ok(yt >= 12 && yt <= 14, `youtube ~3/week, got ${yt}`);
});

test("optimal: daily platforms hit the 8am/12pm/6pm windows", () => {
  const slots = computeSlots("optimal", ["facebook"]);
  const day1 = slots.filter((s) => s.day === 1).map((s) => s.time).sort();
  assert.deepEqual(day1, ["08:00", "12:00", "18:00"]);
});

test("optimal: LinkedIn posts only in the morning window", () => {
  const slots = computeSlots("optimal", ["linkedin"]);
  assert.ok(slots.every((s) => s.time === "08:00"));
});

// ---------------------------------------------------------------------------
// Content-type rotation invariant (never the same type twice in a row).
// ---------------------------------------------------------------------------

test("no two consecutive posts share a content type (optimal, multi-platform)", () => {
  const slots = computeSlots("optimal", [
    "facebook",
    "instagram",
    "tiktok",
    "linkedin",
    "youtube",
  ]);
  for (let i = 1; i < slots.length; i += 1) {
    assert.notEqual(
      slots[i].contentType,
      slots[i - 1].contentType,
      `slots ${i - 1} and ${i} repeat ${slots[i].contentType}`
    );
    assert.ok(CONTENT_TYPES.includes(slots[i].contentType));
  }
});

test("no two consecutive posts share a content type (legacy cadence too)", () => {
  const slots = computeSlots("three_per_week", ["instagram", "facebook"]);
  assert.ok(slots.length > 0);
  for (let i = 1; i < slots.length; i += 1) {
    assert.notEqual(slots[i].contentType, slots[i - 1].contentType);
  }
});

test("slots are ordered chronologically by day then time", () => {
  const slots = computeSlots("optimal", ["facebook", "linkedin"]);
  for (let i = 1; i < slots.length; i += 1) {
    const prev = slots[i - 1];
    const cur = slots[i];
    const prevKey = prev.day * 10000 + Number(prev.time.replace(":", ""));
    const curKey = cur.day * 10000 + Number(cur.time.replace(":", ""));
    assert.ok(curKey >= prevKey, "slots must be non-decreasing in time");
  }
  // index is 1-based and contiguous.
  slots.forEach((s, i) => assert.equal(s.index, i + 1));
});

// ---------------------------------------------------------------------------
// Timezone-aware scheduling.
// ---------------------------------------------------------------------------

test("scheduledTimeFor converts the wall-clock window from the brand timezone to UTC", () => {
  // Day 1 anchors to "today" (local date) at 08:00 in the given zone. Pin the
  // UTC hour that 08:00 Eastern maps to (12:00Z in EDT, 13:00Z in EST) rather
  // than the calendar date, which depends on when the test runs.
  const utc = scheduledTimeFor(1, "08:00", "America/New_York");
  const hour = utc.getUTCHours();
  assert.ok(hour === 12 || hour === 13, `expected 12/13Z, got ${hour}`);
});

test("scheduledTimeFor falls back safely on an invalid timezone", () => {
  const utc = scheduledTimeFor(1, "08:00", "Not/AZone");
  assert.ok(!Number.isNaN(utc.getTime()));
  // With no valid zone it treats the wall time as UTC.
  assert.equal(utc.getUTCHours(), 8);
});
