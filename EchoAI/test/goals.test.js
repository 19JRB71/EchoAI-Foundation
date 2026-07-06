const { test } = require("node:test");
const assert = require("node:assert");

const goals = require("../config/goals");
const db = require("../config/db");
const goalMetrics = require("../utils/goalMetrics");
const goalAlerts = require("../utils/goalAlerts");

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

// --- utils/goalAlerts.js alert derivation ----------------------------------

test("deriveAlertKinds: hit and exceeding map to status alerts", () => {
  assert.deepStrictEqual(
    goalAlerts.deriveAlertKinds({ status: "hit", percentToGoal: 100 }, null),
    [{ kind: "hit" }],
  );
  assert.deepStrictEqual(
    goalAlerts.deriveAlertKinds({ status: "exceeding", percentToGoal: 130 }, null),
    [{ kind: "exceeding" }],
  );
});

test("deriveAlertKinds: at_risk splits into early vs urgent by projection", () => {
  // Mildly behind but projected to nearly recover -> early heads-up.
  assert.deepStrictEqual(
    goalAlerts.deriveAlertKinds(
      { status: "at_risk", percentToGoal: 55, projectedPercent: 80 },
      null,
    ),
    [{ kind: "at_risk_early" }],
  );
  // Projected to fall well short -> urgent.
  assert.deepStrictEqual(
    goalAlerts.deriveAlertKinds(
      { status: "at_risk", percentToGoal: 30, projectedPercent: 45 },
      null,
    ),
    [{ kind: "at_risk_urgent" }],
  );
});

test("deriveAlertKinds: on_track/no_data raise no status alert", () => {
  assert.deepStrictEqual(
    goalAlerts.deriveAlertKinds({ status: "on_track", percentToGoal: 70 }, null),
    [],
  );
  assert.deepStrictEqual(
    goalAlerts.deriveAlertKinds({ status: "no_data", percentToGoal: null }, null),
    [],
  );
});

test("deriveAlertKinds: large single-day swing adds a momentum alert", () => {
  // +25pp in a day -> swing_up alongside the status bucket.
  const up = goalAlerts.deriveAlertKinds(
    { status: "on_track", percentToGoal: 75 },
    50,
  );
  assert.deepStrictEqual(up, [{ kind: "swing_up", delta: 25 }]);

  // -30pp in a day while behind -> both urgent status AND swing_down.
  const down = goalAlerts.deriveAlertKinds(
    { status: "at_risk", percentToGoal: 20, projectedPercent: 40 },
    50,
  );
  assert.deepStrictEqual(down, [
    { kind: "at_risk_urgent" },
    { kind: "swing_down", delta: -30 },
  ]);

  // A small day-over-day move stays quiet.
  assert.deepStrictEqual(
    goalAlerts.deriveAlertKinds({ status: "on_track", percentToGoal: 60 }, 50),
    [],
  );
});

test("buildAlertCopy: each kind produces a distinct spoken line + title", () => {
  const base = {
    metricKey: "new_leads",
    label: "New Leads",
    targetValue: 100,
    currentValue: 40,
    percentToGoal: 40,
  };
  const early = goalAlerts.buildAlertCopy(base, "Acme", "at_risk_early");
  const urgent = goalAlerts.buildAlertCopy(base, "Acme", "at_risk_urgent");
  assert.notStrictEqual(early.title, urgent.title);
  assert.ok(/Acme/.test(early.speak("Sam")));

  const up = goalAlerts.buildAlertCopy(base, "Acme", "swing_up", { delta: 25 });
  const down = goalAlerts.buildAlertCopy(base, "Acme", "swing_down", { delta: -30 });
  assert.ok(/25 points/.test(up.speak("Sam")));
  assert.ok(/30 points/.test(down.speak("Sam")));
  assert.notStrictEqual(up.title, down.title);
});

// --- utils/echoBriefing.js goal narration ----------------------------------

const echoBriefing = require("../utils/echoBriefing");

/** A quiet briefing payload (no leads/appts/etc.) with just goals attached. */
function quietBriefing(goals, brands) {
  return {
    brands: brands || [{ brand_id: "b1", brand_name: "Acme" }],
    newLeads: [],
    hotLeads: 0,
    todaysAppointments: [],
    followUpsCompleted: 0,
    campaigns: [],
    sentinelFixes: [],
    pendingApprovals: 0,
    competitorNote: null,
    facebookConnected: true,
    goals,
  };
}

test("hasActivity: goal state alone counts as briefing-worthy activity", () => {
  const noGoals = quietBriefing(null);
  assert.strictEqual(echoBriefing.hasActivity(noGoals), false);

  const withGoals = quietBriefing({
    score: 40,
    perBusiness: [{ brandId: "b1", brandName: "Acme", score: 40, atRisk: ["New Leads"], achieved: [], farAhead: [] }],
  });
  assert.strictEqual(echoBriefing.hasActivity(withGoals), true);
});

test("templateMorning: goals-only day narrates goals, not the empty welcome", () => {
  const data = quietBriefing({
    score: 40,
    perBusiness: [{ brandId: "b1", brandName: "Acme", score: 40, atRisk: ["New Leads"], achieved: [], farAhead: [] }],
  });
  const text = echoBriefing.templateMorning("Sam", data);
  assert.ok(/behind pace/.test(text), text);
  assert.ok(!/standing by/.test(text), "should not fall into the empty-account branch");
});

test("templateMorning: a brand with both far-ahead and at-risk reports both", () => {
  const data = quietBriefing({
    score: 70,
    perBusiness: [
      {
        brandId: "b1",
        brandName: "Acme",
        score: 70,
        atRisk: ["Cost Per Lead"],
        achieved: [],
        farAhead: ["New Leads"],
      },
    ],
  });
  const text = echoBriefing.templateMorning("Sam", data);
  // Both the win and the risk must appear — far-ahead must not silence at-risk.
  assert.ok(/far ahead on New Leads/.test(text), text);
  assert.ok(/Cost Per Lead .*behind pace/.test(text), text);
});

// --- Department category scoping (Prompt 67 spec) ----------------------------

test("DEPARTMENT_CATEGORIES: Atlas = campaign only, ROI = revenue only", () => {
  assert.deepStrictEqual(goals.DEPARTMENT_CATEGORIES.atlas, ["campaign"]);
  assert.deepStrictEqual(goals.DEPARTMENT_CATEGORIES.roi, ["revenue"]);
  assert.deepStrictEqual(goals.DEPARTMENT_CATEGORIES.nova, ["content"]);
  assert.deepStrictEqual(goals.DEPARTMENT_CATEGORIES.pulse, ["lead", "appointment"]);
});

// --- Goal setup AI parse helpers (conversational wizard) ---------------------

const goalSetupPrompt = require("../prompts/goalSetupPrompt");

const parseCatalog = [
  { metricKey: "new_leads", label: "New Leads" },
  { metricKey: "cost_per_lead", label: "Cost Per Lead" },
];

test("buildGoalSetupPrompt lists only the catalog metricKeys", () => {
  const p = goalSetupPrompt.buildGoalSetupPrompt("standard", parseCatalog);
  assert.ok(p.includes("new_leads"));
  assert.ok(p.includes("cost_per_lead"));
  assert.ok(!p.includes("referrals"));
});

test("parseGoalSuggestions parses a clean JSON object", () => {
  const raw = '{"goals":[{"metricKey":"new_leads","targetValue":40}]}';
  assert.deepStrictEqual(goalSetupPrompt.parseGoalSuggestions(raw, parseCatalog), [
    { metricKey: "new_leads", targetValue: 40 },
  ]);
});

test("parseGoalSuggestions strips code fences and extracts embedded JSON", () => {
  const raw = 'Sure!\n```json\n{"goals":[{"metricKey":"cost_per_lead","targetValue":15}]}\n```';
  assert.deepStrictEqual(goalSetupPrompt.parseGoalSuggestions(raw, parseCatalog), [
    { metricKey: "cost_per_lead", targetValue: 15 },
  ]);
});

test("parseGoalSuggestions drops metrics not in the catalog and bad targets", () => {
  const raw = JSON.stringify({
    goals: [
      { metricKey: "new_leads", targetValue: 40 },
      { metricKey: "not_a_metric", targetValue: 10 },
      { metricKey: "cost_per_lead", targetValue: -5 },
      { metricKey: "cost_per_lead", targetValue: "abc" },
    ],
  });
  assert.deepStrictEqual(goalSetupPrompt.parseGoalSuggestions(raw, parseCatalog), [
    { metricKey: "new_leads", targetValue: 40 },
  ]);
});

test("parseGoalSuggestions dedups repeated metrics and handles junk safely", () => {
  const dup = JSON.stringify({
    goals: [
      { metricKey: "new_leads", targetValue: 40 },
      { metricKey: "new_leads", targetValue: 99 },
    ],
  });
  assert.deepStrictEqual(goalSetupPrompt.parseGoalSuggestions(dup, parseCatalog), [
    { metricKey: "new_leads", targetValue: 40 },
  ]);
  assert.deepStrictEqual(goalSetupPrompt.parseGoalSuggestions("not json at all", parseCatalog), []);
  assert.deepStrictEqual(goalSetupPrompt.parseGoalSuggestions("", parseCatalog), []);
});

// --- parseGoals controller: AI-failure contract ------------------------------

const goalController = require("../controllers/goalController");
const anthropicModule = require("../config/anthropic");

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

test("parseGoals maps an upstream AI failure to 502 (not 500)", async () => {
  const origQuery = db.query;
  const origCreate = anthropicModule.anthropic.messages.create;
  db.query = async () => ({
    rows: [{ brand_id: "b1", brand_name: "Acme", brand_type: "standard" }],
  });
  anthropicModule.anthropic.messages.create = async () => {
    throw new Error("anthropic unreachable");
  };
  try {
    const req = {
      user: { userId: "u1" },
      params: { brandId: "b1" },
      body: { message: "about 40 leads a month" },
    };
    const res = fakeRes();
    await goalController.parseGoals(req, res);
    assert.strictEqual(res.statusCode, 502);
  } finally {
    db.query = origQuery;
    anthropicModule.anthropic.messages.create = origCreate;
  }
});

test("parseGoals returns 400 when the message is missing", async () => {
  const origQuery = db.query;
  db.query = async () => ({
    rows: [{ brand_id: "b1", brand_name: "Acme", brand_type: "standard" }],
  });
  try {
    const req = { user: { userId: "u1" }, params: { brandId: "b1" }, body: {} };
    const res = fakeRes();
    await goalController.parseGoals(req, res);
    assert.strictEqual(res.statusCode, 400);
  } finally {
    db.query = origQuery;
  }
});

test("parseGoals returns validated suggestions on a good AI reply", async () => {
  const origQuery = db.query;
  const origCreate = anthropicModule.anthropic.messages.create;
  db.query = async () => ({
    rows: [{ brand_id: "b1", brand_name: "Acme", brand_type: "standard" }],
  });
  anthropicModule.anthropic.messages.create = async () => ({
    content: [
      {
        type: "text",
        text: '{"goals":[{"metricKey":"new_leads","targetValue":40},{"metricKey":"bogus","targetValue":9}]}',
      },
    ],
  });
  try {
    const req = {
      user: { userId: "u1" },
      params: { brandId: "b1" },
      body: { message: "40 leads a month" },
    };
    const res = fakeRes();
    await goalController.parseGoals(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.suggestions));
    // Out-of-catalog "bogus" is dropped; new_leads kept.
    assert.ok(res.body.suggestions.every((s) => s.metricKey !== "bogus"));
    assert.ok(res.body.suggestions.some((s) => s.metricKey === "new_leads"));
  } finally {
    db.query = origQuery;
    anthropicModule.anthropic.messages.create = origCreate;
  }
});
