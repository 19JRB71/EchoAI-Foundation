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
