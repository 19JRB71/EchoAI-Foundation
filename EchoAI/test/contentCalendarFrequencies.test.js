const { test } = require("node:test");
const assert = require("node:assert");

const {
  computeSlots,
  sanitizeFrequencies,
  defaultPostingFrequencies,
} = require("../controllers/contentCalendarController");

// ---------------------------------------------------------------------------
// Per-platform frequency (cadence + weekly count) overrides for "optimal".
// ---------------------------------------------------------------------------

test("defaultPostingFrequencies exposes the coded per-platform cadences", () => {
  const defs = defaultPostingFrequencies();
  assert.equal(defs.facebook.cadence, "daily");
  assert.ok(!("perWeek" in defs.facebook), "daily platforms carry no perWeek");
  assert.equal(defs.youtube.cadence, "weekly");
  assert.equal(defs.youtube.perWeek, 3);
});

test("sanitizeFrequencies validates cadence, clamps perWeek, drops junk", () => {
  const clean = sanitizeFrequencies({
    linkedin: { cadence: "weekly", perWeek: 4 }, // valid weekly
    facebook: { cadence: "daily", perWeek: 5 }, // daily drops perWeek
    youtube: { cadence: "weekly", perWeek: 99 }, // clamp to 7
    tiktok: { cadence: "weekly", perWeek: 0 }, // clamp to 1
    instagram: { cadence: "monthly" }, // invalid cadence -> dropped
    bogus: { cadence: "daily" }, // unknown platform -> dropped
  });
  assert.deepEqual(clean.linkedin, { cadence: "weekly", perWeek: 4 });
  assert.deepEqual(clean.facebook, { cadence: "daily" });
  assert.deepEqual(clean.youtube, { cadence: "weekly", perWeek: 7 });
  assert.deepEqual(clean.tiktok, { cadence: "weekly", perWeek: 1 });
  assert.ok(!("instagram" in clean), "invalid cadence -> omitted");
  assert.ok(!("bogus" in clean), "unknown platform -> omitted");
});

test("sanitizeFrequencies defaults weekly perWeek to 3 when missing/invalid", () => {
  const clean = sanitizeFrequencies({
    linkedin: { cadence: "weekly" },
    tiktok: { cadence: "weekly", perWeek: "nope" },
  });
  assert.equal(clean.linkedin.perWeek, 3);
  assert.equal(clean.tiktok.perWeek, 3);
});

test("sanitizeFrequencies tolerates junk input", () => {
  assert.deepEqual(sanitizeFrequencies(null), {});
  assert.deepEqual(sanitizeFrequencies("nope"), {});
  assert.deepEqual(sanitizeFrequencies(["array"]), {});
  assert.deepEqual(sanitizeFrequencies({ facebook: "daily" }), {}); // value must be object
});

test("a weekly frequency override reduces a daily platform's post count", () => {
  // Facebook defaults to daily (90 posts across 30 days at 3×/day). Forcing it
  // to 2×/week means only 2 posting days per rolling week, still 3 windows each.
  const slots = computeSlots(
    "optimal",
    ["facebook"],
    {},
    { facebook: { cadence: "weekly", perWeek: 2 } }
  ).filter((s) => s.platform === "facebook");
  const postingDays = new Set(slots.map((s) => s.day));
  // ~2 posting days per rolling 7-day window across 30 days.
  assert.ok(postingDays.size >= 8 && postingDays.size <= 10, `days ${postingDays.size}`);
  // Each posting day still fires the 3 default windows.
  const day = [...postingDays][0];
  const perDay = slots.filter((s) => s.day === day).length;
  assert.equal(perDay, 3, "still 3 windows per posting day");
});

test("a daily frequency override makes a weekly platform post every day", () => {
  const slots = computeSlots(
    "optimal",
    ["youtube"],
    {},
    { youtube: { cadence: "daily" } }
  ).filter((s) => s.platform === "youtube");
  const days = new Set(slots.map((s) => s.day));
  assert.equal(days.size, 30, "youtube now posts every day");
});

test("frequency and window overrides combine", () => {
  const slots = computeSlots(
    "optimal",
    ["linkedin"],
    { linkedin: ["09:00", "17:00"] },
    { linkedin: { cadence: "weekly", perWeek: 3 } }
  ).filter((s) => s.platform === "linkedin");
  const days = new Set(slots.map((s) => s.day));
  assert.ok(days.size >= 12 && days.size <= 14, `~3/week days ${days.size}`);
  const day = [...days][0];
  const times = slots.filter((s) => s.day === day).map((s) => s.time).sort();
  assert.deepEqual(times, ["09:00", "17:00"], "custom windows applied on posting days");
});

test("frequency overrides are ignored for legacy (non-optimal) frequencies", () => {
  const withOverride = computeSlots(
    "daily",
    ["facebook"],
    {},
    { facebook: { cadence: "weekly", perWeek: 1 } }
  );
  const without = computeSlots("daily", ["facebook"]);
  assert.equal(withOverride.length, without.length, "override doesn't change legacy cadence");
});

test("no two consecutive posts share a content type with frequency overrides", () => {
  const slots = computeSlots(
    "optimal",
    ["facebook", "linkedin", "youtube"],
    {},
    {
      linkedin: { cadence: "weekly", perWeek: 2 },
      youtube: { cadence: "daily" },
    }
  );
  for (let i = 1; i < slots.length; i += 1) {
    assert.notEqual(slots[i].contentType, slots[i - 1].contentType);
  }
});
