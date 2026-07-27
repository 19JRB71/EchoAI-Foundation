const test = require("node:test");
const assert = require("node:assert");

const {
  OBJECTIVES,
  TONES,
  VISUAL_STYLES,
  CAMERAS,
  COPY_STYLES,
  TIME_SLOT_THEMES,
  engagementScore,
  pickValue,
  composeBrief,
  briefPromptLines,
  visualDirective,
  currentSlotLabel,
} = require("../utils/forgeDirector");

// --- engagementScore: honest, real-numbers-only scoring -----------------------

test("engagementScore: null/empty metrics score null (never fabricated zeroes)", () => {
  assert.strictEqual(engagementScore(null), null);
  assert.strictEqual(engagementScore({}), null);
  assert.strictEqual(engagementScore({ likes: 0, comments: 0 }), null);
});

test("engagementScore: weights comments and shares above likes", () => {
  const s = engagementScore({ likes: 10, comments: 5, shares: 2 });
  assert.strictEqual(s, 10 + 5 * 2 + 2 * 3);
});

test("engagementScore: tolerates alternate metric keys and junk values", () => {
  assert.strictEqual(engagementScore({ reactions: 3, retweets: 1 }), 3 + 3);
  assert.strictEqual(engagementScore({ likes: "not-a-number" }), null);
});

// --- pickValue: creative memory (recency block) --------------------------------

test("pickValue: never picks a recently-used value when alternatives exist", () => {
  const pool = ["A", "B", "C", "D", "E", "F"];
  const history = [
    { tone: "A" },
    { tone: "B" },
    { tone: "C" },
    { tone: "D" },
  ];
  for (let i = 0; i < 50; i += 1) {
    const v = pickValue(pool, "tone", history);
    assert.ok(["E", "F"].includes(v), `picked recently-used value ${v}`);
  }
});

test("pickValue: falls back to the full pool when recency would block everything", () => {
  const pool = ["A", "B"];
  const history = [{ camera: "A" }, { camera: "B" }];
  const v = pickValue(pool, "camera", history);
  assert.ok(pool.includes(v));
});

test("pickValue: performance weighting favors proven winners (exploit path)", () => {
  const pool = ["winner", "loser"];
  // rand sequence: first call (explore roll) high -> exploit; second call picks.
  const history = Array.from({ length: 10 }, () => ({
    visual_style: "winner",
    score: 100,
  }));
  // No recency block interference: block size = min(5, pool-1) = 1, so only
  // the single most recent ("winner") is blocked... use fresh history where the
  // most recent entry is "loser" so "winner" stays allowed.
  history.unshift({ visual_style: "loser", score: null });
  let calls = 0;
  const rand = () => {
    calls += 1;
    if (calls % 2 === 1) return 0.99; // skip exploration
    return 0.5; // pick roll
  };
  let winnerCount = 0;
  for (let i = 0; i < 40; i += 1) {
    if (pickValue(pool, "visual_style", history, rand) === "winner") winnerCount += 1;
  }
  assert.ok(winnerCount === 40, `expected weighted picks to favor winner, got ${winnerCount}/40`);
});

// --- composeBrief --------------------------------------------------------------

test("composeBrief: fills every field from the spec pools + valid time slot", () => {
  const b = composeBrief([], "morning");
  assert.ok(OBJECTIVES.includes(b.objective));
  assert.ok(TONES.includes(b.tone));
  assert.ok(VISUAL_STYLES.includes(b.visual_style));
  assert.ok(CAMERAS.includes(b.camera));
  assert.ok(COPY_STYLES.includes(b.copy_style));
  assert.strictEqual(b.time_slot, "morning");
});

test("composeBrief: unknown slot label stores null time slot", () => {
  assert.strictEqual(composeBrief([], "midnight").time_slot, null);
});

// --- prompt directives -----------------------------------------------------------

test("briefPromptLines: empty input adds nothing (fail-open prompt)", () => {
  assert.deepStrictEqual(briefPromptLines([]), []);
  assert.deepStrictEqual(briefPromptLines(null), []);
});

test("briefPromptLines: one numbered directive per brief incl. time-of-day theme", () => {
  const briefs = [
    composeBrief([], "morning"),
    composeBrief([], "evening"),
  ];
  const lines = briefPromptLines(briefs).join("\n");
  assert.match(lines, /Brief 1:/);
  assert.match(lines, /Brief 2:/);
  assert.match(lines, /stop scrolling/i);
  assert.ok(lines.includes(TIME_SLOT_THEMES.morning));
  assert.ok(lines.includes(TIME_SLOT_THEMES.evening));
  assert.ok(lines.includes(briefs[0].visual_style));
  assert.ok(lines.includes(briefs[1].camera));
});

test("visualDirective: carries visual style + camera + tone; empty without a brief", () => {
  const b = composeBrief([], "afternoon");
  const d = visualDirective(b);
  assert.ok(d.includes(b.visual_style));
  assert.ok(d.includes(b.camera));
  assert.match(d, /never like generic AI imagery/i);
  assert.strictEqual(visualDirective(null), "");
});

test("currentSlotLabel: bad timezone fails open to afternoon", () => {
  assert.strictEqual(currentSlotLabel("Not/AZone"), "afternoon");
  assert.ok(["morning", "afternoon", "evening"].includes(currentSlotLabel("America/New_York")));
});

// --- DB integration: orphan briefs never pollute creative memory ---------------

const db = require("../config/db");
const { planBriefs, creativeHistory, linkBriefToItem } = require("../utils/forgeDirector");
require("./dbGuard");

async function createUserBrandBatch() {
  const email = `forge-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const u = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING user_id",
    [email, "test-not-a-real-hash"]
  );
  const userId = u.rows[0].user_id;
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, $2) RETURNING brand_id",
    [userId, "Forge Test Brand"]
  );
  const brandId = b.rows[0].brand_id;
  const batch = await db.query(
    `INSERT INTO autopilot_batches (brand_id, user_id, week_start, status)
     VALUES ($1, $2, CURRENT_DATE, 'ready') RETURNING batch_id`,
    [brandId, userId]
  );
  return { userId, brandId, batchId: batch.rows[0].batch_id };
}

test("creative memory: planned-but-unused briefs are excluded; linked briefs count", async () => {
  const { userId, brandId, batchId } = await createUserBrandBatch();
  try {
    const briefs = await planBriefs(brandId, ["morning", "evening"]);
    assert.strictEqual(briefs.length, 2);
    assert.ok(briefs[0].brief_id);

    // No brief is linked to an item yet -> memory must be empty (a failed
    // batch or short AI output must never pollute recency/learning).
    assert.deepStrictEqual(await creativeHistory(brandId), []);

    const item = await db.query(
      `INSERT INTO autopilot_batch_items (batch_id, position, item_type, platform, post_content)
       VALUES ($1, 1, 'post', 'facebook', 'test post') RETURNING item_id`,
      [batchId]
    );
    await linkBriefToItem(briefs[0].brief_id, item.rows[0].item_id);

    const history = await creativeHistory(brandId);
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].objective, briefs[0].objective);
    assert.strictEqual(history[0].score, null); // no published engagement yet
  } finally {
    await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
  }
});
