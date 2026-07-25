const test = require("node:test");
const assert = require("node:assert");
const {
  formatMoney,
  daysRemainingInMonth,
  evaluateBudgetChange,
  geoAllowed,
  followupTimingFactor,
  describeTimingChange,
} = require("../utils/growthGuardrails");

test("formatMoney rounds to whole dollars with a $ and commas", () => {
  assert.strictEqual(formatMoney(1500), "$1,500");
  assert.strictEqual(formatMoney(99.6), "$100");
  assert.strictEqual(formatMoney(0), "$0");
});

test("daysRemainingInMonth is inclusive of today and >= 1", () => {
  assert.strictEqual(daysRemainingInMonth(new Date("2026-01-31T12:00:00Z")), 1);
  assert.strictEqual(daysRemainingInMonth(new Date("2026-01-01T12:00:00Z")), 31);
  assert.ok(daysRemainingInMonth(new Date("2026-02-15T12:00:00Z")) >= 1);
});

test("cutting spend is always auto-approved and needs no guardrail room", () => {
  const r = evaluateBudgetChange({
    settings: { monthlyBudgetCap: 100, approvalThreshold: 1 },
    currentDailyBudget: 50,
    proposedDailyBudget: 30,
    monthToDateSpend: 99,
    daysRemaining: 10,
    campaignName: "Spring Sale",
  });
  assert.strictEqual(r.decision, "auto");
  assert.strictEqual(r.appliedDailyBudget, 30);
  assert.strictEqual(r.incrementalMonthlySpend, 0);
});

test("a small increase within cap and under threshold runs automatically", () => {
  const r = evaluateBudgetChange({
    settings: { monthlyBudgetCap: 5000, approvalThreshold: 500 },
    currentDailyBudget: 20,
    proposedDailyBudget: 30,
    monthToDateSpend: 100,
    daysRemaining: 10, // +$10/day * 10 = +$100 incremental
  });
  assert.strictEqual(r.decision, "auto");
  assert.strictEqual(r.appliedDailyBudget, 30);
  assert.strictEqual(r.incrementalMonthlySpend, 100);
});

test("an increase whose extra monthly spend exceeds the approval threshold needs approval", () => {
  const r = evaluateBudgetChange({
    settings: { monthlyBudgetCap: 5000, approvalThreshold: 100 },
    currentDailyBudget: 20,
    proposedDailyBudget: 40,
    monthToDateSpend: 100,
    daysRemaining: 10, // +$20/day * 10 = +$200 > 100
  });
  assert.strictEqual(r.decision, "approval");
});

test("an increase that would breach the monthly cap (with room left) is presented for approval", () => {
  const r = evaluateBudgetChange({
    settings: { monthlyBudgetCap: 1000, approvalThreshold: 100000 },
    currentDailyBudget: 20,
    proposedDailyBudget: 60,
    monthToDateSpend: 900,
    daysRemaining: 10, // +$40/day * 10 = +$400 -> 1300 > 1000 cap
  });
  assert.strictEqual(r.decision, "approval");
});

test("an increase is blocked outright when the monthly cap is already reached", () => {
  const r = evaluateBudgetChange({
    settings: { monthlyBudgetCap: 1000, approvalThreshold: 100000 },
    currentDailyBudget: 20,
    proposedDailyBudget: 60,
    monthToDateSpend: 1000,
    daysRemaining: 10,
  });
  assert.strictEqual(r.decision, "blocked");
  assert.strictEqual(r.appliedDailyBudget, 20); // unchanged
});

test("no cap and no threshold means increases run automatically", () => {
  const r = evaluateBudgetChange({
    settings: { monthlyBudgetCap: null, approvalThreshold: null },
    currentDailyBudget: 20,
    proposedDailyBudget: 200,
    monthToDateSpend: 10000,
    daysRemaining: 20,
  });
  assert.strictEqual(r.decision, "auto");
});

test("geoAllowed: no configured geo means no restriction", () => {
  assert.strictEqual(geoAllowed({ geoTargeting: "" }, "Miami, FL").allowed, true);
});

test("geoAllowed: a matching/contained geo is allowed, a foreign geo needs approval", () => {
  assert.strictEqual(geoAllowed({ geoTargeting: "Austin, TX + 25mi" }, "Austin").allowed, true);
  const foreign = geoAllowed({ geoTargeting: "Austin, TX + 25mi" }, "Miami, FL");
  assert.strictEqual(foreign.allowed, false);
  assert.ok(foreign.reason.includes("approval"));
});

test("followupTimingFactor spaces out high responders and tightens low ones, clamped", () => {
  assert.strictEqual(followupTimingFactor(0.5), 1.25);
  assert.strictEqual(followupTimingFactor(0.3), 1.1);
  assert.strictEqual(followupTimingFactor(0.15), 0.85);
  assert.strictEqual(followupTimingFactor(0.05), 0.7);
  assert.strictEqual(followupTimingFactor(0.22), 1.0);
  assert.strictEqual(followupTimingFactor("bad"), 1.0);
});

test("describeTimingChange explains the direction in plain English", () => {
  assert.ok(describeTimingChange(1.0, 1.25, 0.5).toLowerCase().includes("spread"));
  assert.ok(describeTimingChange(1.0, 0.7, 0.05).toLowerCase().includes("sooner"));
  assert.ok(describeTimingChange(1.0, 1.0, 0.2).toLowerCase().includes("left it"));
});
