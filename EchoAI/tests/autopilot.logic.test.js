const test = require("node:test");
const assert = require("node:assert");

const { evaluateAdSpend, suggestDailyBudget } = require("../utils/spendLimits");
const { weekStartOf } = require("../controllers/autopilotController");
const { buildWeeklyBatchPrompt } = require("../prompts/autopilotPrompt");

// --- evaluateAdSpend: hard limits are hard -----------------------------------

test("evaluateAdSpend: no caps set allows the spend", () => {
  const v = evaluateAdSpend({ caps: {}, committedDailySpend: 100, proposedDailyBudget: 50 });
  assert.strictEqual(v.allowed, true);
});

test("evaluateAdSpend: daily cap blocks when committed + proposed exceeds it", () => {
  const v = evaluateAdSpend({
    caps: { daily: 50 },
    committedDailySpend: 45,
    proposedDailyBudget: 10,
  });
  assert.strictEqual(v.allowed, false);
  assert.match(v.reason, /daily limit/i);
});

test("evaluateAdSpend: daily cap allows when it fits exactly", () => {
  const v = evaluateAdSpend({
    caps: { daily: 50 },
    committedDailySpend: 40,
    proposedDailyBudget: 10,
  });
  assert.strictEqual(v.allowed, true);
});

test("evaluateAdSpend: weekly cap projects 7 days of daily spend", () => {
  const v = evaluateAdSpend({
    caps: { weekly: 100 },
    committedDailySpend: 10, // 70/week committed
    proposedDailyBudget: 5, // +35/week -> 105 > 100
  });
  assert.strictEqual(v.allowed, false);
  assert.match(v.reason, /week/i);
});

test("evaluateAdSpend: monthly cap uses month-to-date + remaining days", () => {
  const v = evaluateAdSpend({
    caps: { monthly: 300 },
    committedDailySpend: 0,
    monthToDateSpend: 295,
    proposedDailyBudget: 10,
    daysRemaining: 10, // +100 projected -> way past 300
  });
  assert.strictEqual(v.allowed, false);
  assert.match(v.reason, /month/i);
});

test("evaluateAdSpend: zero/missing budget is honestly rejected", () => {
  const v = evaluateAdSpend({ caps: {}, proposedDailyBudget: 0 });
  assert.strictEqual(v.allowed, false);
});

// --- suggestDailyBudget: room-based, conservative ------------------------------

test("suggestDailyBudget: no caps returns the conservative fallback", () => {
  assert.strictEqual(suggestDailyBudget({ caps: {}, committedDailySpend: 500 }), 10);
});

test("suggestDailyBudget: daily cap room limits the suggestion", () => {
  assert.strictEqual(
    suggestDailyBudget({ caps: { daily: 20 }, committedDailySpend: 15 }),
    5
  );
});

test("suggestDailyBudget: no room means zero, never a fabricated budget", () => {
  assert.strictEqual(
    suggestDailyBudget({ caps: { daily: 20 }, committedDailySpend: 25 }),
    0
  );
});

test("suggestDailyBudget: weekly cap divides across 7 days", () => {
  // 35/week -> 5/day of room with nothing committed.
  assert.strictEqual(
    suggestDailyBudget({ caps: { weekly: 35 }, committedDailySpend: 0 }),
    5
  );
});

test("suggestDailyBudget: monthly cap spreads remaining room over remaining days", () => {
  assert.strictEqual(
    suggestDailyBudget({
      caps: { monthly: 100 },
      monthToDateSpend: 60,
      daysRemaining: 10,
    }),
    4
  );
});

test("suggestDailyBudget: tightest cap wins", () => {
  assert.strictEqual(
    suggestDailyBudget({
      caps: { daily: 8, weekly: 700, monthly: 10000 },
      committedDailySpend: 5,
      monthToDateSpend: 0,
      daysRemaining: 15,
    }),
    3
  );
});

// --- weekStartOf: Monday of the containing week (UTC) ---------------------------

test("weekStartOf: a Wednesday maps to that week's Monday", () => {
  assert.strictEqual(weekStartOf(new Date(Date.UTC(2026, 6, 8))), "2026-07-06");
});

test("weekStartOf: a Monday maps to itself", () => {
  assert.strictEqual(weekStartOf(new Date(Date.UTC(2026, 6, 6))), "2026-07-06");
});

test("weekStartOf: a Sunday maps back to the PREVIOUS Monday", () => {
  assert.strictEqual(weekStartOf(new Date(Date.UTC(2026, 6, 12))), "2026-07-06");
});

// --- weekly batch prompt: grounded, hands-off, platform-locked ------------------

test("buildWeeklyBatchPrompt: includes cadence, platforms, and no-fabrication rules", () => {
  const brand = {
    brand_name: "Test Brand",
    brand_personality: "bold",
    voice_description: "direct",
    target_audience: "local homeowners",
  };
  const intel = {
    businessType: "landscaping company",
    connectedPlatforms: ["facebook", "linkedin"],
    recentPosts: [],
    competitorAds: [],
    competitorReport: null,
  };
  const prompt = buildWeeklyBatchPrompt(brand, intel, { postsPerWeek: 4, adsPerWeek: 2 });
  assert.match(prompt, /exactly 4 social post/);
  assert.match(prompt, /2 Facebook test ad/);
  assert.match(prompt, /facebook, linkedin/);
  assert.match(prompt, /Never invent statistics/);
  assert.match(prompt, /No clarifying questions/);
  assert.match(prompt, /Do NOT set ad budgets/);
});

test("buildWeeklyBatchPrompt: zero ads omits the ad instructions", () => {
  const prompt = buildWeeklyBatchPrompt(
    { brand_name: "B" },
    { businessType: "shop", connectedPlatforms: ["facebook"], recentPosts: [], competitorAds: [], competitorReport: null },
    { postsPerWeek: 3, adsPerWeek: 0 }
  );
  assert.match(prompt, /no ads this week/);
  assert.ok(!prompt.includes("Do NOT set ad budgets"));
});

const { autopilotSlotTimes } = require("../controllers/autopilotController");

test("autopilotSlotTimes: fixed 6am/12pm/6pm slots, never an hour apart", () => {
  const now = new Date("2026-07-15T12:00:00Z"); // 8:00 AM Eastern (EDT)
  const t = autopilotSlotTimes(15, "America/New_York", now);
  assert.strictEqual(t.length, 15);
  // First same-day slots: 12pm and 6pm Eastern (6am already past)
  assert.strictEqual(t[0].toISOString(), "2026-07-15T16:00:00.000Z");
  assert.strictEqual(t[1].toISOString(), "2026-07-15T22:00:00.000Z");
  // Next day starts at 6am Eastern
  assert.strictEqual(t[2].toISOString(), "2026-07-16T10:00:00.000Z");
  for (let i = 1; i < t.length; i += 1) {
    const gap = t[i].getTime() - t[i - 1].getTime();
    assert.ok(gap >= 6 * 60 * 60 * 1000, `slots ${i - 1}/${i} only ${gap / 3600000}h apart`);
  }
});

test("autopilotSlotTimes: <=7 posts land one per day at 6am local", () => {
  const now = new Date("2026-07-15T12:00:00Z");
  const t = autopilotSlotTimes(5, "America/New_York", now);
  assert.strictEqual(t.length, 5);
  for (const d of t) {
    assert.strictEqual(d.toISOString().slice(11), "10:00:00.000Z"); // 6am EDT
  }
});

test("autopilotSlotTimes: slots less than 30 minutes out are skipped", () => {
  const now = new Date("2026-07-15T09:45:00Z"); // 5:45 AM Eastern
  // One-per-day cadence: today's 6:00 AM slot is only 15 min away, so the
  // first post rolls to TOMORROW 6:00 AM (never fires before review).
  const t = autopilotSlotTimes(3, "America/New_York", now);
  assert.strictEqual(t[0].toISOString(), "2026-07-16T10:00:00.000Z");
  // Three-per-day cadence: same moment, the noon slot today is still usable.
  const t2 = autopilotSlotTimes(15, "America/New_York", now);
  assert.strictEqual(t2[0].toISOString(), "2026-07-15T16:00:00.000Z");
});

test("autopilotSlotTimes: zero or invalid count returns no slots", () => {
  assert.deepStrictEqual(autopilotSlotTimes(0, "America/New_York"), []);
  assert.deepStrictEqual(autopilotSlotTimes(-2, "America/New_York"), []);
});

test("autopilotSlotTimes: western timezone near UTC midnight keeps today's local slots", () => {
  // 00:30 UTC = 5:30 PM previous local day in Los Angeles — the 6 PM local
  // slot (01:00 UTC, 30 min away) must still be offered, not skipped to
  // the next local day.
  const now = new Date("2026-07-15T00:30:00Z");
  const t = autopilotSlotTimes(15, "America/Los_Angeles", now);
  assert.strictEqual(t[0].toISOString(), "2026-07-15T01:00:00.000Z");
});

test("autopilotSlotTimes: DST fall-back week stays on 6am/12pm/6pm wall clock", () => {
  // US DST ends Sun Nov 1 2026. Slots before the change are EDT (UTC-4),
  // after are EST (UTC-5) — wall-clock time stays fixed.
  const now = new Date("2026-10-30T00:00:00Z");
  const t = autopilotSlotTimes(15, "America/New_York", now);
  const wallTimes = new Set(
    t.map((d) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d)
    )
  );
  assert.deepStrictEqual([...wallTimes].sort(), ["06:00", "12:00", "18:00"]);
});
