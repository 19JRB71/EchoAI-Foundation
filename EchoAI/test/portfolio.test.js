const { test } = require("node:test");
const assert = require("node:assert");

const {
  weekDateFor,
  statusForScore,
  computeHealthForBrand,
} = require("../utils/portfolio");
const {
  validateCrossBusiness,
  normalizeCategory,
} = require("../prompts/crossBusinessPrompt");

/* ------------------------------- week date -------------------------------- */

test("weekDateFor returns the Monday (UTC) on or before the date", () => {
  // 2026-07-05 is a Sunday -> Monday of that week is 2026-06-29.
  assert.strictEqual(weekDateFor(new Date("2026-07-05T12:00:00Z")), "2026-06-29");
  // A Monday maps to itself.
  assert.strictEqual(weekDateFor(new Date("2026-06-29T00:00:00Z")), "2026-06-29");
  // Mid-week (Thursday) still resolves back to that week's Monday.
  assert.strictEqual(weekDateFor(new Date("2026-07-02T09:00:00Z")), "2026-06-29");
});

/* --------------------------- health score status -------------------------- */

test("statusForScore maps the 1-10 score to the traffic-light bands", () => {
  assert.strictEqual(statusForScore(10), "green");
  assert.strictEqual(statusForScore(7), "green");
  assert.strictEqual(statusForScore(6.9), "yellow");
  assert.strictEqual(statusForScore(4), "yellow");
  assert.strictEqual(statusForScore(3.9), "red");
  assert.strictEqual(statusForScore(1), "red");
});

/* -------------------------- cross-business category ----------------------- */

test("normalizeCategory maps free text onto the fixed category set", () => {
  assert.strictEqual(normalizeCategory("shared_audience"), "shared_audience");
  assert.strictEqual(normalizeCategory("Cross Referral"), "cross_referral");
  assert.strictEqual(normalizeCategory("send referrals"), "cross_referral");
  assert.strictEqual(normalizeCategory("reallocate budget"), "resource_allocation");
  assert.strictEqual(normalizeCategory("skill transfer"), "skill_transfer");
  assert.strictEqual(normalizeCategory("where to focus time"), "attention_allocation");
  assert.strictEqual(normalizeCategory("promote to their audience"), "shared_audience");
  // Unknown -> safe default.
  assert.strictEqual(normalizeCategory("gibberish"), "shared_audience");
});

/* --------------------- cross-business output validation ------------------- */

test("validateCrossBusiness normalizes, clamps impact, and sorts by impact desc", () => {
  const out = validateCrossBusiness({
    summary: "Portfolio momentum is strongest in the auto vertical.",
    insights: [
      {
        category: "referrals",
        title: "Low impact idea",
        businesses: ["A", "B"],
        insight: "some overlap",
        recommendedAction: "do a thing",
        impactScore: 3,
      },
      {
        category: "budget shift",
        title: "High impact idea",
        businesses: ["A", "C"],
        insight: "big overlap",
        recommendedAction: "do the big thing",
        impactScore: 42, // clamped to 10
      },
    ],
  });
  assert.strictEqual(out.insights.length, 2);
  assert.strictEqual(out.insights[0].title, "High impact idea");
  assert.strictEqual(out.insights[0].impactScore, 10);
  assert.strictEqual(out.insights[0].category, "resource_allocation");
  assert.strictEqual(out.insights[1].category, "cross_referral");
});

test("validateCrossBusiness drops insights missing required text", () => {
  const out = validateCrossBusiness({
    summary: "ok",
    insights: [
      { title: "", insight: "x", recommendedAction: "y" }, // dropped: no title
      { title: "keep", insight: "real", recommendedAction: "act", impactScore: 5 },
    ],
  });
  assert.strictEqual(out.insights.length, 1);
  assert.strictEqual(out.insights[0].title, "keep");
});

test("validateCrossBusiness throws aiInvalid on empty summary or no insights", () => {
  assert.throws(
    () =>
      validateCrossBusiness({
        summary: "",
        insights: [{ title: "x", insight: "y", recommendedAction: "z" }],
      }),
    (err) => err.aiInvalid === true,
  );
  assert.throws(
    () => validateCrossBusiness({ summary: "ok", insights: [] }),
    (err) => err.aiInvalid === true,
  );
  assert.throws(
    () =>
      validateCrossBusiness({
        summary: "ok",
        insights: [{ title: "", insight: "", recommendedAction: "" }],
      }),
    (err) => err.aiInvalid === true,
  );
});

/* --------------------------- deterministic health ------------------------- */

test("computeHealthForBrand is deterministic and never AI-backed (no 502 path)", async () => {
  // A brand with no activity should still yield a real, clamped 1-10 score built
  // purely from SQL aggregates — proving the daily snapshot job can't 502.
  const calls = [];
  const db = require("../config/db");
  const original = db.query;
  db.query = async (sql) => {
    calls.push(sql);
    if (/FROM leads/.test(sql)) {
      return {
        rows: [
          {
            total: 0,
            last_7d: 0,
            prev_7d: 0,
            hot: 0,
            open: 0,
            converted: 0,
          },
        ],
      };
    }
    if (/FROM campaigns/.test(sql)) return { rows: [{ active: 0 }] };
    if (/FROM analytics/.test(sql)) return { rows: [{ avg_roas: 0, weeks: 0 }] };
    return { rows: [{}] };
  };
  try {
    const a = await computeHealthForBrand(101);
    const b = await computeHealthForBrand(101);
    assert.deepStrictEqual(a, b); // deterministic
    assert.ok(a.score >= 1 && a.score <= 10);
    assert.ok(["green", "yellow", "red"].includes(a.status));
    assert.ok(a.factors && a.factors.signals);
  } finally {
    db.query = original;
  }
});
