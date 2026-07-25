const { test } = require("node:test");
const assert = require("node:assert");

const {
  computeSlots,
  sanitizeWindows,
  defaultPostingWindows,
} = require("../controllers/contentCalendarController");

// ---------------------------------------------------------------------------
// Per-platform posting-window overrides for the "optimal" schedule.
// ---------------------------------------------------------------------------

test("defaultPostingWindows exposes the coded 08:00/12:00/18:00 defaults", () => {
  const defs = defaultPostingWindows();
  assert.deepEqual(defs.facebook.times, ["08:00", "12:00", "18:00"]);
  assert.deepEqual(defs.linkedin.times, ["08:00"]);
  assert.equal(defs.youtube.cadence, "weekly");
  assert.equal(defs.youtube.perWeek, 3);
});

test("sanitizeWindows validates, dedupes, sorts, and caps times", () => {
  const clean = sanitizeWindows({
    facebook: ["9:30", "07:00", "07:00", "23:59"], // pad, dedupe, sort
    instagram: ["25:00", "12:60", "abc", ""], // all invalid -> dropped
    linkedin: [], // empty -> dropped (use default)
    bogusplatform: ["08:00"], // unknown platform -> dropped
  });
  assert.deepEqual(clean.facebook, ["07:00", "09:30", "23:59"]);
  assert.ok(!("instagram" in clean), "no valid times -> omitted");
  assert.ok(!("linkedin" in clean), "empty -> omitted");
  assert.ok(!("bogusplatform" in clean), "unknown platform -> omitted");
});

test("sanitizeWindows caps a platform at 6 windows/day", () => {
  const clean = sanitizeWindows({
    facebook: ["00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"],
  });
  assert.equal(clean.facebook.length, 6);
});

test("sanitizeWindows tolerates junk input", () => {
  assert.deepEqual(sanitizeWindows(null), {});
  assert.deepEqual(sanitizeWindows("nope"), {});
  assert.deepEqual(sanitizeWindows(["array"]), {});
  assert.deepEqual(sanitizeWindows({ facebook: "08:00" }), {}); // value must be array
});

test("computeSlots applies a per-platform window override for the optimal schedule", () => {
  const slots = computeSlots("optimal", ["facebook"], {
    facebook: ["07:30", "13:00"],
  });
  const day1 = slots.filter((s) => s.day === 1).map((s) => s.time).sort();
  assert.deepEqual(day1, ["07:30", "13:00"], "custom windows replace the default 3");
});

test("computeSlots falls back to defaults for platforms without an override", () => {
  const slots = computeSlots("optimal", ["facebook", "linkedin"], {
    linkedin: ["09:00", "17:00"],
  });
  const fb = slots.filter((s) => s.platform === "facebook" && s.day === 1).map((s) => s.time).sort();
  const li = slots.filter((s) => s.platform === "linkedin" && s.day === 1).map((s) => s.time).sort();
  assert.deepEqual(fb, ["08:00", "12:00", "18:00"], "facebook keeps its default windows");
  assert.deepEqual(li, ["09:00", "17:00"], "linkedin uses its override");
});

test("an override changes how many posts a daily platform makes", () => {
  const twoPerDay = computeSlots("optimal", ["facebook"], {
    facebook: ["08:00", "20:00"],
  }).filter((s) => s.platform === "facebook").length;
  assert.equal(twoPerDay, 60, "2×/day over 30 days");
});

test("overrides are ignored for legacy (non-optimal) frequencies", () => {
  const withOverride = computeSlots("daily", ["facebook"], {
    facebook: ["07:30", "13:00", "19:00"],
  });
  const without = computeSlots("daily", ["facebook"]);
  assert.equal(withOverride.length, without.length, "override doesn't change legacy cadence");
});
