/**
 * Learning Engine — Echo learns the owner's taste from every review decision.
 *
 * Three moving parts:
 *
 * 1. recordSignal(...) — fire-and-forget raw log of every approve / decline /
 *    revise from the autopilot batch review and the voice content flow. Never
 *    throws; a logging hiccup must never break the decision endpoint.
 *
 * 2. runWeeklyLearningStudy() — Sage's weekly study (Monday 05:00, before the
 *    autopilot batch drafts at 06:30). Per brand with enough fresh signals it
 *    asks Claude to distill the raw decisions into short preference learnings,
 *    and — when a pattern is genuinely ambiguous — into an OPEN QUESTION for
 *    the owner instead of a guess. AI failure = skip the brand honestly
 *    (signals stay undistilled for next week); nothing is ever fabricated.
 *
 * 3. learningContextForBrand(brandId) — compact plain-text block of active
 *    learnings, injected into the drafting prompts (autopilot batch + voice
 *    content) so every new draft respects what Echo has learned. Never throws;
 *    null means "nothing learned yet".
 */

const db = require("../config/db");
const { MODEL, createMessage } = require("../config/anthropic");

// Don't bother the model (or the owner) until there's a real pattern to study.
const MIN_SIGNALS_TO_STUDY = 4;
// Cap what one study reads so a busy brand can't blow the prompt budget.
const MAX_SIGNALS_PER_STUDY = 120;
const MAX_LEARNINGS_PER_BRAND = 12;
const MAX_OPEN_QUESTIONS = 2;

/**
 * Log one review decision. Fire-and-forget: always resolves, never throws.
 * { brandId, userId, source: 'autopilot'|'voice_content', itemType: 'post'|'ad',
 *   platform, action: 'approve'|'decline'|'revise', instruction?, content? }
 */
async function recordSignal({ brandId, userId, source, itemType, platform, action, instruction, content }) {
  try {
    await db.query(
      `INSERT INTO echo_learning_signals
         (brand_id, user_id, source, item_type, platform, action, instruction, content_excerpt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        brandId,
        userId,
        source,
        itemType,
        platform || null,
        action,
        instruction ? String(instruction).slice(0, 500) : null,
        content ? String(content).replace(/\s+/g, " ").slice(0, 300) : null,
      ]
    );
  } catch (err) {
    console.error("Learning signal log failed (non-fatal):", err.message);
  }
}

/** Compact prompt block of active learnings; null when nothing learned yet. */
async function learningContextForBrand(brandId) {
  if (!brandId) return null;
  try {
    const { rows } = await db.query(
      `SELECT insight, evidence_count FROM echo_learnings
        WHERE brand_id = $1 AND active = TRUE
        ORDER BY evidence_count DESC, updated_at DESC
        LIMIT $2`,
      [brandId, MAX_LEARNINGS_PER_BRAND]
    );
    if (rows.length === 0) return null;
    return [
      "What Echo has LEARNED about this owner's taste (from their real approve/decline/revise decisions — follow these):",
      ...rows.map((r) => `- ${r.insight}`),
    ].join("\n");
  } catch (err) {
    console.error("Learning context read failed (non-fatal):", err.message);
    return null;
  }
}

function summarizeSignals(rows) {
  return rows.map((s) => {
    const bits = [
      `[${s.source}] ${s.action.toUpperCase()} ${s.item_type}${s.platform ? ` on ${s.platform}` : ""}`,
    ];
    if (s.instruction) bits.push(`owner said: "${s.instruction}"`);
    if (s.content_excerpt) bits.push(`content: "${s.content_excerpt}"`);
    return `- ${bits.join(" — ")}`;
  });
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("The study response contained no JSON object");
  }
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Study one brand's fresh signals. Exported for tests and guarded per-brand
 * by the weekly sweep. Marks signals distilled ONLY after learnings persist.
 */
async function studyBrand(brand) {
  const { rows: signals } = await db.query(
    `SELECT signal_id, source, item_type, platform, action, instruction, content_excerpt
       FROM echo_learning_signals
      WHERE brand_id = $1 AND distilled_at IS NULL
        AND created_at > NOW() - INTERVAL '90 days'
      ORDER BY created_at ASC
      LIMIT $2`,
    [brand.brand_id, MAX_SIGNALS_PER_STUDY]
  );
  if (signals.length < MIN_SIGNALS_TO_STUDY) return { studied: false };

  const { rows: existing } = await db.query(
    `SELECT insight FROM echo_learnings
      WHERE brand_id = $1 AND active = TRUE
      ORDER BY evidence_count DESC LIMIT $2`,
    [brand.brand_id, MAX_LEARNINGS_PER_BRAND]
  );

  // Sage's live industry intelligence grounds the study when available.
  let sageBlock = null;
  try {
    const { sageContextForBrand } = require("./sageContext");
    sageBlock = await sageContextForBrand(brand.brand_id);
  } catch (_) {
    sageBlock = null;
  }

  const system = [
    "You are Sage, EchoAI's learning analyst. Below are a business owner's REAL",
    "recent content-review decisions (approve / decline / revise, with their",
    "spoken change requests). Distill them into durable preference learnings.",
    "",
    `Brand: ${brand.brand_name || "the brand"}`,
    ...(existing.length
      ? ["", "Already-known learnings (refine or confirm, do not repeat verbatim):", ...existing.map((e) => `- ${e.insight}`)]
      : []),
    ...(sageBlock ? ["", sageBlock] : []),
    "",
    "The owner's decisions:",
    ...summarizeSignals(signals),
    "",
    "Rules:",
    "- Every learning must be a short, imperative, actionable statement about",
    '  this owner\'s content taste (e.g. "Keep posts under 3 sentences", "Never',
    '  use emojis in LinkedIn posts", "Lead ads with the price").',
    "- Only state what the decisions actually support. NEVER invent a",
    "  preference the evidence doesn't show.",
    `- If a pattern is genuinely ambiguous, put a plain-English question in`,
    `  "openQuestions" (max ${MAX_OPEN_QUESTIONS}) instead of guessing — each with a short`,
    '  "context" explaining what you noticed.',
    "- If the decisions show no clear pattern at all, return empty arrays.",
    "",
    'Respond with ONLY a JSON object: {"learnings":[{"insight":"...","category":',
    '"content_preference|ad_preference|platform_insight"}],"openQuestions":',
    '[{"question":"...","context":"..."}]}',
  ].join("\n");

  const response = await createMessage(
    {
      model: MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: "Distill the learnings now. JSON only." }],
    },
    { label: "weekly learning study" }
  );
  const parsed = extractJson(response.content?.[0]?.text || "");

  const learnings = (Array.isArray(parsed.learnings) ? parsed.learnings : [])
    .map((l) => ({
      insight: String((l && l.insight) || "").trim().slice(0, 300),
      category: ["content_preference", "ad_preference", "platform_insight"].includes(l && l.category)
        ? l.category
        : "content_preference",
    }))
    .filter((l) => l.insight)
    .slice(0, MAX_LEARNINGS_PER_BRAND);
  const questions = (Array.isArray(parsed.openQuestions) ? parsed.openQuestions : [])
    .map((q) => ({
      question: String((q && q.question) || "").trim().slice(0, 300),
      context: String((q && q.context) || "").trim().slice(0, 500) || null,
    }))
    .filter((q) => q.question)
    .slice(0, MAX_OPEN_QUESTIONS);

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    for (const l of learnings) {
      await client.query(
        `INSERT INTO echo_learnings (brand_id, user_id, insight, category)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ON CONSTRAINT uq_echo_learnings_brand_insight
         DO UPDATE SET evidence_count = echo_learnings.evidence_count + 1,
                       active = TRUE, updated_at = NOW()`,
        [brand.brand_id, brand.user_id, l.insight, l.category]
      );
    }
    for (const q of questions) {
      await client.query(
        `INSERT INTO echo_open_questions (brand_id, user_id, question, context)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ON CONSTRAINT uq_echo_open_questions_brand_question DO NOTHING`,
        [brand.brand_id, brand.user_id, q.question, q.context]
      );
    }
    // Consume the signals ONLY now that the distilled output is persisted.
    await client.query(
      `UPDATE echo_learning_signals SET distilled_at = NOW()
        WHERE signal_id = ANY($1::uuid[])`,
      [signals.map((s) => s.signal_id)]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { studied: true, learnings: learnings.length, questions: questions.length };
}

/** Weekly sweep: study every brand with fresh signals. Each brand guarded. */
async function runWeeklyLearningStudy() {
  let brands;
  try {
    const { rows } = await db.query(
      `SELECT b.brand_id, b.user_id, b.brand_name
         FROM brands b
        WHERE COALESCE(b.is_demo, FALSE) = FALSE
          AND EXISTS (SELECT 1 FROM echo_learning_signals s
                       WHERE s.brand_id = b.brand_id AND s.distilled_at IS NULL)`
    );
    brands = rows;
  } catch (err) {
    console.error("Learning study brand scan failed:", err.message);
    return;
  }
  for (const brand of brands) {
    try {
      const result = await module.exports.studyBrand(brand);
      if (result.studied) {
        console.log(
          `Learning study for ${brand.brand_name}: ${result.learnings} learning(s), ${result.questions} question(s)`
        );
      }
    } catch (err) {
      console.error(`Learning study failed for brand ${brand.brand_id}:`, err.message);
    }
  }
}

module.exports = {
  recordSignal,
  learningContextForBrand,
  studyBrand,
  runWeeklyLearningStudy,
};
