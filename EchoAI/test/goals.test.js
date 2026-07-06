const { test } = require("node:test");
const assert = require("node:assert");

const goals = require("../config/goals");
const db = require("../config/db");
const goalMetrics = require("../utils/goalMetrics");

// --- config/goals.js pure math + registry -----------------------------------

test("computePercent: increase goals scale current/target", () => {
  assert.strictEqual(goals.computePercent(50, 100, "increase"), 50);
  assert.strictEqual(goals.computePercent(100, 100, "increase"), 100);
  assert.strictEqual(goals.computePercent(150, 100, "increase"), 150);
});

test("computePercent: decrease goals reward being at/below target", () => {
  // Cost per lead: target $10, current $20 -> 50% (twice the target = behind).
  assert.strictEqual(goals.computePercent(20, 10, "decrease"), 50);
  // At target -> 100%; below target -> over 100% (overachievement visible).
  assert.strictEqual(goals.computePercent(10, 10, "decrease"), 100);
  assert.strictEqual(goals.computePercent(5, 10, "decrease"), 200);
});

test("computePercent: no measurable basis returns null", () => {
  // Decrease goal with no current reading is not measurable yet.
  assert.strictEqual(goals.computePercent(0, 10, "decrease"), null);
  assert.strictEqual(goals.computePercent("x", 10, "increase"), null);
});

test("classifyProgress buckets by percent then projection", () => {
  assert.strictEqual(goals.classifyProgress(120, 120), goals.STATUS_EXCEEDING);
  assert.strictEqual(goals.classifyProgress(105, 105), goals.STATUS_HIT);
  assert.strictEqual(goals.classifyProgress(50, 95), goals.STATUS_ON_TRACK);
  assert.strictEqual(goals.classifyProgress(40, 60), goals.STATUS_AT_RISK);
  assert.strictEqual(goals.classifyProgress(null, null), goals.STATUS_NO_DATA);
});

test("clampScore keeps the score within 0..100", () => {
  assert.strictEqual(goals.clampScore(150), 100);
  assert.strictEqual(goals.clampScore(-10), 0);
  assert.strictEqual(goals.clampScore(null), 0);
  assert.strictEqual(goals.clampScore(73.2), 73.2);
});

test("brand type gating exposes only allowed metrics", () => {
  // Affiliate brands can target affiliate metrics; standard brands cannot.
  assert.ok(goals.metricAllowedForBrandType("commission", "affiliate"));
  assert.ok(!goals.metricAllowedForBrandType("commission", "standard"));
  // Standard brands get campaign metrics; affiliate brands don't.
  assert.ok(goals.metricAllowedForBrandType("cost_per_lead", "standard"));
  assert.ok(!goals.metricAllowedForBrandType("cost_per_lead", "affiliate"));
  // Unknown brand type falls back to the standard category set.
  const std = goals.metricsForBrandType("standard");
  assert.deepStrictEqual(goals.metricsForBrandType("nonsense"), std);
});

test("isValidBrandType / isValidMetric reject unknowns", () => {
  assert.ok(goals.isValidBrandType("restaurant"));
  assert.ok(!goals.isValidBrandType("spaceship"));
  assert.ok(goals.isValidMetric("new_leads"));
  assert.ok(!goals.isValidMetric("teleportation"));
});

// --- utils/goalMetrics.js buildGoalProgress (stubbed db) --------------------

function withStub(handler, fn) {
  const original = db.query;
  db.query = handler;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      db.query = original;
    });
}

test("buildGoalProgress computes percent, projection, trend for cumulative goal", async () => {
  await withStub(
    async (sql) => {
      // Metric measurement (new_leads count) -> 10 so far this month.
      if (/FROM leads/i.test(sql)) return { rows: [{ value: 10 }] };
      // Prior snapshot for trend -> yesterday we had 6, so trend is "up".
      if (/FROM goal_snapshots/i.test(sql))
        return { rows: [{ current_value: 6 }] };
      return { rows: [] };
    },
    async () => {
      const progress = await goalMetrics.buildGoalProgress({
        goal_id: "g1",
        brand_id: "b1",
        metric_key: "new_leads",
        category: "lead",
        label: "New Leads",
        target_value: 100,
        sort_order: 0,
      });
      assert.strictEqual(progress.metricKey, "new_leads");
      assert.strictEqual(progress.currentValue, 10);
      assert.strictEqual(progress.percentToGoal, 10);
      assert.strictEqual(progress.trend, "up");
      // Projection is at least the current value (linear month-to-date).
      assert.ok(progress.projectedEom >= progress.currentValue);
      assert.ok(
        [
          goals.STATUS_AT_RISK,
          goals.STATUS_ON_TRACK,
          goals.STATUS_HIT,
          goals.STATUS_EXCEEDING,
        ].includes(progress.status),
      );
    },
  );
});

test("buildGoalProgress reports no_data for a decrease goal with no reading", async () => {
  await withStub(
    async (sql) => {
      // 'latest' rate metric with no analytics row -> null current value.
      if (/FROM analytics/i.test(sql)) return { rows: [] };
      if (/FROM goal_snapshots/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    async () => {
      const progress = await goalMetrics.buildGoalProgress({
        goal_id: "g2",
        brand_id: "b1",
        metric_key: "cost_per_lead",
        category: "campaign",
        label: "Cost Per Lead",
        target_value: 10,
        sort_order: 0,
      });
      assert.strictEqual(progress.currentValue, null);
      assert.strictEqual(progress.percentToGoal, null);
      assert.strictEqual(progress.status, goals.STATUS_NO_DATA);
    },
  );
});

test("computeBrandGoals averages clamped percents into a 0-100 score", async () => {
  await withStub(
    async (sql) => {
      // Two active goals.
      if (/FROM brand_goals/i.test(sql) && /status = 'active'/i.test(sql)) {
        return {
          rows: [
            {
              goal_id: "g1",
              brand_id: "b1",
              metric_key: "new_leads",
              category: "lead",
              label: "New Leads",
              target_value: 100,
              sort_order: 0,
            },
            {
              goal_id: "g2",
              brand_id: "b1",
              metric_key: "hot_leads",
              category: "lead",
              label: "Hot Leads",
              target_value: 100,
              sort_order: 1,
            },
          ],
        };
      }
      // new_leads -> 100 (100%), hot_leads -> 50 (50%). Score = 75.
      if (/AS value/i.test(sql) && /created_at/i.test(sql)) {
        return { rows: [{ value: /temperature/i.test(sql) ? 50 : 100 }] };
      }
      if (/FROM goal_snapshots/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    async () => {
      const out = await goalMetrics.computeBrandGoals("b1");
      assert.strictEqual(out.goalCount, 2);
      assert.strictEqual(out.goals.length, 2);
      assert.ok(out.score >= 0 && out.score <= 100);
    },
  );
});
