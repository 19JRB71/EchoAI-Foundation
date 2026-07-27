/**
 * Sage Pattern Intelligence Engine (PIE) — pure-logic tests.
 *
 * Covers the honesty-critical seams that need no DB or AI:
 *  - normalizeAnalysis: only spec taxonomy values survive; junk → null
 *  - aggregateAnalyses: real prevalence counts, no fabricated fields
 *  - forgeDirector.pickValue: Sage's recommendation biases but never locks in,
 *    and recency blocking still beats the recommendation.
 */

const test = require("node:test");
const assert = require("node:assert");

const {
  HOOK_TYPES,
  EMOTIONS,
  normalizeAnalysis,
} = require("../prompts/patternIntelligencePrompt");
const { aggregateAnalyses } = require("../utils/patternIntelligence");
const forgeDirector = require("../utils/forgeDirector");

test("normalizeAnalysis keeps only spec taxonomy values", () => {
  const good = normalizeAnalysis({
    hook_type: "Curiosity",
    hook_why: "It teases a secret.",
    emotions: ["Trust", "NotAnEmotion", "Urgency"],
    value_speed: "immediate",
    copy: { storytelling: true, reading_level: "simple" },
    cta_style: "Book now",
  });
  assert.ok(good);
  assert.strictEqual(good.hook_type, "Curiosity");
  assert.deepStrictEqual(good.emotions, ["Trust", "Urgency"]);
  assert.strictEqual(good.value_speed, "immediate");
  assert.strictEqual(good.copy.storytelling, true);
  assert.strictEqual(good.copy.reading_level, "simple");
  assert.strictEqual(good.cta_style, "Book now");
});

test("normalizeAnalysis rejects unknown hooks and missing rationale", () => {
  assert.strictEqual(
    normalizeAnalysis({ hook_type: "Made Up Hook", hook_why: "x", emotions: [] }),
    null
  );
  assert.strictEqual(
    normalizeAnalysis({ hook_type: "Curiosity", hook_why: "", emotions: [] }),
    null
  );
  assert.strictEqual(normalizeAnalysis(null), null);
});

test("spec taxonomies are intact", () => {
  assert.ok(HOOK_TYPES.includes("Before & After"));
  assert.ok(HOOK_TYPES.includes("Fear of Missing Out"));
  assert.strictEqual(HOOK_TYPES.length, 15);
  assert.ok(EMOTIONS.includes("Belonging"));
});

test("aggregateAnalyses computes real prevalence counts only", () => {
  const rows = [
    {
      analysis: {
        hook_type: "Question",
        emotions: ["Trust"],
        value_speed: "immediate",
        copy: { storytelling: true, reading_level: "simple" },
        cta_style: "Call today",
      },
    },
    {
      analysis: {
        hook_type: "Question",
        emotions: ["Trust", "Urgency"],
        value_speed: "delayed",
        copy: { educational: true, reading_level: "simple" },
        cta_style: "Call today",
      },
    },
    {
      analysis: {
        hook_type: "Story",
        emotions: [],
        value_speed: "immediate",
        copy: { reading_level: "moderate" },
      },
    },
    { analysis: null }, // unanalyzed rows are ignored
  ];
  const agg = aggregateAnalyses(rows);
  assert.strictEqual(agg.sampleSize, 3);
  assert.deepStrictEqual(agg.topHooks[0], { value: "Question", count: 2 });
  assert.deepStrictEqual(agg.topEmotions[0], { value: "Trust", count: 2 });
  assert.deepStrictEqual(agg.topCtaStyles[0], { value: "Call today", count: 2 });
  assert.strictEqual(agg.copyTraits.storytelling, 1);
  assert.strictEqual(agg.copyTraits.educational, 1);
  assert.strictEqual(agg.readingLevels.simple, 2);
  assert.ok(Math.abs(agg.immediateValueShare - 0.67) < 0.01);
  assert.match(agg.basis, /revealed preferences/);
});

test("aggregateAnalyses on empty input is honest (0 sample, null share)", () => {
  const agg = aggregateAnalyses([]);
  assert.strictEqual(agg.sampleSize, 0);
  assert.strictEqual(agg.immediateValueShare, null);
  assert.deepStrictEqual(agg.topHooks, []);
});

test("pickValue biases toward Sage's recommendation without locking in", () => {
  const pool = forgeDirector.TONES;
  const recommended = pool[0];
  // Force the weighted branch (rand > exploration threshold) with a roll of 0
  // → lands on the first candidate with weight. With no history all weights
  // are 1 except the recommended value's ×3.
  let calls = 0;
  const rand = () => {
    calls += 1;
    // 1st call decides explore-vs-weighted, 2nd is the weighted roll.
    return calls % 2 === 1 ? 0.99 : 0.0;
  };
  const picked = forgeDirector.pickValue(pool, "tone", [], rand, recommended);
  assert.strictEqual(picked, recommended);

  // Statistical bias: recommended should win far more often than 1/pool.length.
  let wins = 0;
  const runs = 2000;
  for (let i = 0; i < runs; i += 1) {
    if (forgeDirector.pickValue(pool, "tone", [], Math.random, recommended) === recommended) {
      wins += 1;
    }
  }
  const share = wins / runs;
  assert.ok(share > 1.5 / pool.length, `expected bias, got share ${share}`);
  assert.ok(share < 0.9, "recommendation must never be a lock-in");
});

test("recency blocking beats the recommendation", () => {
  const pool = forgeDirector.TONES;
  const recommended = pool[0];
  // Recommended value used just now → blocked; it must not be picked.
  const history = [{ tone: recommended, score: null }];
  for (let i = 0; i < 200; i += 1) {
    const picked = forgeDirector.pickValue(pool, "tone", history, Math.random, recommended);
    assert.notStrictEqual(picked, recommended);
  }
});

test("sageGuidanceLines emits originality rule only when recs exist", () => {
  assert.deepStrictEqual(forgeDirector.sageGuidanceLines(null), []);
  assert.deepStrictEqual(forgeDirector.sageGuidanceLines({}), []);
  const lines = forgeDirector.sageGuidanceLines({
    recommended_hook: "Open with a question",
    color_palette: "warm earth tones",
  });
  assert.ok(lines.some((l) => l.includes("Open with a question")));
  assert.ok(lines.some((l) => l.includes("Never imitate")));
});

// ---------------------------------------------------------------------------
// Manual refresh claim gate: concurrent claims with the same run key must
// resolve to exactly one winner (unique index on brand/cycle_type/run_key).
// ---------------------------------------------------------------------------
test("manual pattern-study claim: N racers, exactly one wins", async () => {
  const { db, createTestUser, deleteUser } = require("./helpers");
  const { claimRun } = require("../controllers/sageController");
  const userId = await createTestUser();
  const brand = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, 'PIE Claim Test') RETURNING brand_id",
    [userId]
  );
  const brandId = brand.rows[0].brand_id;
  try {
    const runKey = `manual:${new Date().toISOString().slice(0, 16)}`;
    const results = await Promise.all(
      Array.from({ length: 6 }, () => claimRun(brandId, "patterns", runKey))
    );
    assert.strictEqual(results.filter(Boolean).length, 1);
  } finally {
    await db.query("DELETE FROM sage_research_runs WHERE brand_id = $1", [brandId]);
    await db.query("DELETE FROM brands WHERE brand_id = $1", [brandId]);
    await deleteUser(userId);
  }
});
