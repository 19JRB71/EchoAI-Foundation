/**
 * Forge — Zorecho's Creative Director engine.
 *
 * Forge is not an image generator and not a copywriter: every piece of
 * content STARTS from a strategy brief, exactly like a world-class agency's
 * creative director would run the room. A brief fixes, before anything is
 * generated:
 *
 *   - objective       (why this post exists: sell / educate / build trust...)
 *   - emotional tone  (how it should feel)
 *   - visual style    (how the image is art-directed)
 *   - camera          (composition / perspective)
 *   - copy style      (how the words hook the reader)
 *   - time-of-day theme (morning motivation vs. evening reflection)
 *
 * Creative memory: the last 30 briefs per brand are loaded before picking, and
 * recently-used values in each category are excluded so no two weeks look or
 * read the same.
 *
 * Performance learning: briefs linked to published posts join to the post's
 * real engagement metrics. Higher-performing values are favored (weighted
 * pick) ~70% of the time; ~30% stays pure exploration so the feed never
 * collapses into one look.
 *
 * Everything here is FAIL-OPEN: any DB or data problem returns empty briefs /
 * null so content generation is never blocked by the director layer.
 */

const db = require("../config/db");

const OBJECTIVES = [
  "Sell",
  "Educate",
  "Inspire",
  "Entertain",
  "Build Trust",
  "Build Authority",
  "Generate Leads",
  "Customer Story",
  "Brand Awareness",
  "Showcase Quality",
  "Seasonal",
  "Community",
  "FAQ",
  "Myth vs Fact",
  "Behind the Scenes",
  "Problem to Solution",
  "Testimonial-style (only real, owner-provided testimonials — never invented)",
  "Success Story (only real, owner-provided outcomes — never invented)",
  "Limited Time Offer (only offers the owner actually configured — never invented)",
  "Industry Insight",
  "Local Community Tie-in",
];

const TONES = [
  "Inspirational",
  "Friendly",
  "Humorous",
  "Professional",
  "Luxury",
  "Bold",
  "Emotional",
  "Curious",
  "Educational",
  "Patriotic",
  "Hard Working",
  "Family",
  "Exciting",
  "Calm",
  "Premium",
  "Trustworthy",
  "Motivational",
  "Appreciative",
];

const VISUAL_STYLES = [
  "Cinematic",
  "Lifestyle",
  "Documentary",
  "Editorial",
  "Luxury",
  "Magazine Cover",
  "Storybook",
  "Drone Photography",
  "Ground Perspective",
  "Hero Shot",
  "Wide Landscape",
  "Golden Hour",
  "Blue Hour",
  "Sunrise",
  "Sunset",
  "Dramatic Storm Sky",
  "Rain-washed",
  "Night Lighting",
  "Seasonal",
  "Minimalist",
  "High Contrast",
  "Warm Colors",
  "Cool Colors",
];

const CAMERAS = [
  "Drone / aerial",
  "Eye level",
  "Close-up",
  "Ultra wide",
  "First person",
  "Customer perspective",
  "Builder / craftsman perspective",
  "Detail shot",
  "Over-the-shoulder",
  "Interior",
  "Exterior",
];

const COPY_STYLES = [
  "Storytelling",
  "Question",
  "Short Hook",
  "Educational Tip",
  "Statistics (only real numbers from the data provided — never invented)",
  "Conversational",
  "Humor",
  "Challenge",
  "FAQ",
  "Myth Busting",
  "List Format",
  "Emotional Story",
  "Before and After (only real, owner-provided work — never invented)",
  "Problem to Solution",
  "Direct Call To Action",
];

const TIME_SLOT_THEMES = {
  morning: "Morning energy: motivation, education, goals, planning, inspiration.",
  afternoon:
    "Afternoon momentum: active work, progress, behind the scenes, team, customer interaction.",
  evening:
    "Evening wind-down: finished results, success stories, reflection, community, lifestyle, family, soft selling.",
};

// How many most-recent picks per category are excluded from re-selection.
const RECENCY_BLOCK = { objective: 5, tone: 4, visual_style: 5, camera: 4, copy_style: 4 };
// Share of picks that ignore performance weighting entirely (pure exploration).
const EXPLORE_RATE = 0.3;
// Creative memory horizon.
const MEMORY_LIMIT = 30;

/** Honest engagement score from a social post's engagement_metrics JSONB. */
function engagementScore(metrics) {
  if (!metrics || typeof metrics !== "object") return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const likes = num(metrics.likes ?? metrics.reactions);
  const comments = num(metrics.comments);
  const shares = num(metrics.shares ?? metrics.retweets ?? metrics.reposts);
  const clicks = num(metrics.clicks ?? metrics.link_clicks);
  const total = likes + comments * 2 + shares * 3 + clicks;
  return total > 0 ? total : null;
}

/**
 * Loads the brand's creative memory: the last 30 USED briefs, newest first,
 * each with the real engagement score of its published post when one exists.
 *
 * Only briefs linked to a real batch item count (item_id set at insert time).
 * Planned-but-never-used briefs — a failed batch, or the AI returning fewer
 * posts than planned — stay orphaned and are deliberately excluded so they
 * can never pollute recency blocking or performance weighting with content
 * that was never actually created.
 */
async function creativeHistory(brandId) {
  const r = await db.query(
    `SELECT f.objective, f.tone, f.visual_style, f.camera, f.copy_style,
            sp.engagement_metrics
       FROM forge_creative_briefs f
       JOIN autopilot_batch_items abi ON abi.item_id = f.item_id
       LEFT JOIN social_posts sp ON sp.post_id = abi.posted_post_id
      WHERE f.brand_id = $1 AND f.item_id IS NOT NULL
      ORDER BY f.created_at DESC
      LIMIT ${MEMORY_LIMIT}`,
    [brandId]
  );
  return r.rows.map((row) => ({
    objective: row.objective,
    tone: row.tone,
    visual_style: row.visual_style,
    camera: row.camera,
    copy_style: row.copy_style,
    score: engagementScore(row.engagement_metrics),
  }));
}

/**
 * Picks one value from a pool: recently-used values are excluded, then the
 * pick is either pure-random (exploration) or weighted by the average real
 * engagement each value has earned (+1 smoothing so unproven values still
 * get chosen).
 */
function pickValue(pool, key, history, rand = Math.random) {
  const blockCount = Math.min(RECENCY_BLOCK[key] || 3, pool.length - 1);
  const blocked = new Set(
    history
      .map((h) => h[key])
      .filter(Boolean)
      .slice(0, blockCount)
  );
  const allowed = pool.filter((v) => !blocked.has(v));
  const candidates = allowed.length ? allowed : pool;

  if (rand() < EXPLORE_RATE) {
    return candidates[Math.floor(rand() * candidates.length)];
  }

  // Performance weighting from REAL engagement only.
  const stats = new Map();
  for (const h of history) {
    if (h.score == null || !h[key]) continue;
    const s = stats.get(h[key]) || { total: 0, n: 0 };
    s.total += h.score;
    s.n += 1;
    stats.set(h[key], s);
  }
  const weights = candidates.map((v) => {
    const s = stats.get(v);
    return 1 + (s ? s.total / s.n : 0);
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  let roll = rand() * sum;
  for (let i = 0; i < candidates.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** Builds one brief in memory (no DB write). */
function composeBrief(history, timeSlot, rand = Math.random) {
  return {
    objective: pickValue(OBJECTIVES, "objective", history, rand),
    tone: pickValue(TONES, "tone", history, rand),
    visual_style: pickValue(VISUAL_STYLES, "visual_style", history, rand),
    camera: pickValue(CAMERAS, "camera", history, rand),
    copy_style: pickValue(COPY_STYLES, "copy_style", history, rand),
    time_slot: TIME_SLOT_THEMES[timeSlot] ? timeSlot : null,
  };
}

/**
 * Plans and RECORDS one brief per requested slot label. Later briefs in the
 * same plan see the earlier ones as "recent", so a single batch is internally
 * varied too. Fail-open: returns [] on any failure.
 *
 * @param {string} brandId
 * @param {string[]} slotLabels - e.g. ["morning","afternoon","evening",...]
 * @returns {Promise<Array<{brief_id, objective, tone, visual_style, camera, copy_style, time_slot}>>}
 */
async function planBriefs(brandId, slotLabels, seedBriefs = []) {
  try {
    // seedBriefs: briefs already planned in this same run (e.g. earlier weeks
    // of a multi-week batch) that aren't linked to items yet — they must still
    // count as "recent" so consecutive weeks stay visually different.
    const history = [
      ...seedBriefs.map((b) => ({ ...b, score: null })).reverse(),
      ...(await creativeHistory(brandId)),
    ];
    const briefs = [];
    for (const label of slotLabels) {
      const brief = composeBrief(history, label);
      const ins = await db.query(
        `INSERT INTO forge_creative_briefs
           (brand_id, objective, tone, visual_style, camera, copy_style, time_slot)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING brief_id`,
        [
          brandId,
          brief.objective,
          brief.tone,
          brief.visual_style,
          brief.camera,
          brief.copy_style,
          brief.time_slot,
        ]
      );
      brief.brief_id = ins.rows[0].brief_id;
      briefs.push(brief);
      history.unshift({ ...brief, score: null });
    }
    return briefs;
  } catch (err) {
    console.error("Forge brief planning failed (continuing without briefs):", err.message);
    return [];
  }
}

/** Links a recorded brief to its autopilot item (best-effort). */
async function linkBriefToItem(briefId, itemId) {
  if (!briefId || !itemId) return;
  try {
    await db.query(
      "UPDATE forge_creative_briefs SET item_id = $2 WHERE brief_id = $1",
      [briefId, itemId]
    );
  } catch (err) {
    console.error("Forge brief link failed:", err.message);
  }
}

/** The brief attached to an item, or null (fail-open). */
async function getBriefForItem(itemId) {
  try {
    const r = await db.query(
      `SELECT brief_id, objective, tone, visual_style, camera, copy_style, time_slot
         FROM forge_creative_briefs WHERE item_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [itemId]
    );
    return r.rows[0] || null;
  } catch (err) {
    console.error("Forge brief lookup failed:", err.message);
    return null;
  }
}

/** One human-readable line per brief, for the batch-drafting prompt. */
function briefPromptLines(briefs) {
  if (!Array.isArray(briefs) || !briefs.length) return [];
  return [
    "",
    "FORGE'S CREATIVE DIRECTION PLAN — Forge, the Creative Director, has already",
    "assigned each post a strategy brief. Post N MUST follow brief N exactly:",
    ...briefs.map((b, i) =>
      [
        `Brief ${i + 1}: objective = ${b.objective}; emotional tone = ${b.tone};`,
        `copywriting style = ${b.copy_style};`,
        b.time_slot && TIME_SLOT_THEMES[b.time_slot]
          ? `time-of-day theme = ${TIME_SLOT_THEMES[b.time_slot]}`
          : "",
        `Its visualIdea must describe ONE concrete scene art-directed in a "${b.visual_style}" style from a "${b.camera}" viewpoint.`,
      ]
        .filter(Boolean)
        .join(" ")
    ),
    "Do NOT reuse the same opening hook, subject focus, or call-to-action phrasing across posts.",
    "Ask of every post: would this make someone stop scrolling, look, and remember this business? If not, sharpen the concept before writing it.",
  ];
}

/** Art-direction text appended to an item's image prompt. */
function visualDirective(brief) {
  if (!brief) return "";
  return (
    `Art direction (from Forge, the Creative Director): render this in a "${brief.visual_style}" visual style, ` +
    `composed from a "${brief.camera}" viewpoint, with a ${String(brief.tone).toLowerCase()} emotional feel. ` +
    "The result must look professionally art-directed, never like generic AI imagery."
  );
}

/** Brand-local time-of-day slot label for right now (fail-open "afternoon"). */
function currentSlotLabel(timezone) {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone || "America/New_York",
        hour: "numeric",
        hour12: false,
      }).format(new Date())
    );
    if (hour < 11) return "morning";
    if (hour < 16) return "afternoon";
    return "evening";
  } catch {
    return "afternoon";
  }
}

module.exports = {
  OBJECTIVES,
  TONES,
  VISUAL_STYLES,
  CAMERAS,
  COPY_STYLES,
  TIME_SLOT_THEMES,
  engagementScore,
  creativeHistory,
  pickValue,
  composeBrief,
  planBriefs,
  linkBriefToItem,
  getBriefForItem,
  briefPromptLines,
  visualDirective,
  currentSlotLabel,
};
