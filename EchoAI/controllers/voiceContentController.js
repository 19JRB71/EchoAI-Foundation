/**
 * Voice-driven content creation ("Hey Echo, let's create some content").
 *
 * Flow: the owner asks by voice → `start` gathers the brand's REAL intelligence
 * (profile, connected accounts, recent post performance, competitor ads + the
 * latest competitor report) and Claude either drafts 3-5 posts or returns
 * clarifying questions (Echo asks them out loud → `answer`). Each draft gets a
 * DALL-E visual on demand (`generateDraftImage`), the owner reviews each post by
 * voice (revise / skip / approve), and NOTHING is scheduled until "approve" —
 * approval atomically copies the draft into social_posts as a normal 'scheduled'
 * row (image included) that the existing publisher picks up.
 *
 * Invariants (match the rest of the codebase):
 * - Ownership: every session/draft access joins through brands.user_id.
 * - AI failures → 502, never mocked; AI output validated before persistence.
 * - Drafts only target platforms that are BOTH connected AND publishable by
 *   socialApi (facebook/twitter/linkedin) — no post that is doomed to fail.
 * - Approve is an atomic status-guarded UPDATE (row-count branch) so a double
 *   "approve" can never schedule the same draft twice.
 */

const db = require("../config/db");
const { generateVoiceDrafts, reviseVoiceDraft } = require("../prompts/voiceContentPrompt");
const { composePostContent, DEFAULT_POSTING_TIMES } = require("../prompts/contentCalendarPrompt");
const { buildImagePrompt } = require("../prompts/imagePromptBuilder");
const { renderFromPrompt, persistImage } = require("./imageController");
const { zonedWallTimeToUtc, isValidTimezone } = require("../utils/timezone");
const { recordSignal, learningContextForBrand } = require("../utils/learningEngine");

const DEFAULT_TIMEZONE = "America/New_York";

// Platforms socialApi.publishPost can actually publish to. Instagram, TikTok
// and YouTube require media-upload flows we don't support yet — drafting for
// them would create posts guaranteed to fail, so they are excluded honestly.
const PUBLISHABLE_PLATFORMS = ["facebook", "twitter", "linkedin"];

// Platform → Image Studio purpose (drives DALL-E size/aspect).
const PLATFORM_IMAGE_PURPOSE = {
  facebook: "facebook_ad",
  twitter: "twitter_post",
  linkedin: "linkedin_post",
};

/** Maps an Anthropic/OpenAI upstream failure to a 502 (vs. a generic 500). */
function isUpstreamAiError(err) {
  return (
    err?.aiInvalid === true ||
    (typeof err?.status === "number" && err.status >= 400)
  );
}

function sendAiError(res, err, fallback) {
  if (isUpstreamAiError(err)) {
    return res.status(502).json({
      error: "The AI service could not complete this request. Please try again.",
    });
  }
  return res.status(500).json({ error: fallback });
}

/** Loads a brand only if it belongs to the authenticated user. */
async function getOwnedBrand(userId, brandId) {
  const result = await db.query(
    `SELECT b.brand_id, b.brand_name, b.brand_personality, b.voice_description,
            b.visual_style_preferences, b.target_audience, u.industry
     FROM brands b
     JOIN users u ON u.user_id = b.user_id
     WHERE b.brand_id = $1 AND b.user_id = $2`,
    [brandId, userId]
  );
  return result.rows[0] || null;
}

/** Loads a session (with brand ownership enforced). */
async function getOwnedSession(userId, sessionId) {
  const result = await db.query(
    `SELECT s.*, b.brand_name
     FROM voice_content_sessions s
     JOIN brands b ON b.brand_id = s.brand_id
     WHERE s.session_id = $1 AND b.user_id = $2`,
    [sessionId, userId]
  );
  return result.rows[0] || null;
}

/** Brand timezone lives on availability_schedules; Eastern fallback. */
async function getBrandTimezone(brandId) {
  try {
    const r = await db.query(
      "SELECT timezone FROM availability_schedules WHERE brand_id = $1 LIMIT 1",
      [brandId]
    );
    const tz = r.rows[0]?.timezone && String(r.rows[0].timezone).trim();
    return tz && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Validates an "HH:MM" 24h string, falling back to the platform default. */
function normalizeTime(value, platform) {
  const fallback = DEFAULT_POSTING_TIMES[platform] || "10:00";
  if (typeof value !== "string") return fallback;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return fallback;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/**
 * Proposes a UTC scheduled time for draft #position: the AI's suggested
 * wall-clock time in the brand's timezone, on the earliest day that still
 * lands at least 30 minutes in the future.
 *
 * Options (both optional, callers scheduling a whole batch should pass them):
 * - notBefore: Date of the PREVIOUS scheduled post. The returned time is
 *   always at least MIN_POST_GAP (4h) after it — never two posts 30 minutes
 *   apart, even when a past suggested time pushes two drafts onto the same
 *   day. If honoring the gap would shove the post more than 8h past its
 *   suggested wall-clock time, it slides to the next day instead.
 * - perDay: how many posts share a day (default 1). Lets >7 posts/week fit
 *   inside the week instead of spilling into the next one.
 */
const MIN_POST_GAP = 4 * 60 * 60 * 1000;

function proposeScheduledTime(position, bestPostingTime, platform, timezone, now = new Date(), opts = {}) {
  const time = normalizeTime(bestPostingTime, platform);
  const [hh, mm] = time.split(":").map(Number);
  const minLead = 30 * 60 * 1000;
  const perDay = Math.max(1, Math.floor(opts.perDay || 1));
  const floor = opts.notBefore ? new Date(opts.notBefore).getTime() + MIN_POST_GAP : 0;
  const startDay = Math.floor(position / perDay);
  for (let dayOffset = startDay; dayOffset < startDay + 8; dayOffset += 1) {
    const day = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const utc = zonedWallTimeToUtc(
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      hh,
      mm,
      timezone
    );
    // Push later the same day if needed to keep the 4h spacing…
    const candidate = Math.max(utc.getTime(), floor);
    // …but never more than 8h past the suggested time (no 2am posts) — try
    // the next day instead.
    if (candidate - utc.getTime() > 8 * 60 * 60 * 1000) continue;
    if (candidate - now.getTime() >= minLead) return new Date(candidate);
  }
  // Unreachable in practice; backstop keeps the invariants "always future"
  // and "always ≥4h after the previous post".
  return new Date(Math.max(now.getTime() + 24 * 60 * 60 * 1000, floor));
}

/** Connected + publishable platforms for a brand (real connections only). */
async function getUsablePlatforms(brandId) {
  const r = await db.query(
    `SELECT platform FROM social_accounts
     WHERE brand_id = $1 AND connection_status = 'connected'`,
    [brandId]
  );
  return r.rows
    .map((row) => row.platform)
    .filter((p) => PUBLISHABLE_PLATFORMS.includes(p));
}

/** Gathers the REAL intelligence Claude drafts from. Nothing fabricated. */
async function gatherIntelligence(brand, connectedPlatforms) {
  const brandId = brand.brand_id;

  const [postsRes, adsRes, reportRes] = await Promise.all([
    db.query(
      `SELECT platform, post_content, engagement_metrics, published_time
       FROM social_posts
       WHERE brand_id = $1 AND status = 'published'
       ORDER BY published_time DESC NULLS LAST
       LIMIT 12`,
      [brandId]
    ),
    db.query(
      `SELECT competitor_name, headline, body_text, threat_level
       FROM competitor_ads
       WHERE brand_id = $1 AND status = 'active'
       ORDER BY last_seen_at DESC
       LIMIT 8`,
      [brandId]
    ),
    db.query(
      `SELECT summary, gaps, recommendations
       FROM competitor_ad_reports
       WHERE brand_id = $1
       ORDER BY week_date DESC
       LIMIT 1`,
      [brandId]
    ),
  ]);

  return {
    businessType: brand.industry || null,
    connectedPlatforms,
    recentPosts: postsRes.rows.map((p) => ({
      platform: p.platform,
      content: p.post_content,
      metrics: p.engagement_metrics || null,
      publishedTime: p.published_time,
    })),
    competitorAds: adsRes.rows.map((a) => ({
      competitorName: a.competitor_name,
      headline: a.headline,
      bodyText: a.body_text,
      threatLevel: a.threat_level,
    })),
    competitorReport: reportRes.rows[0] || null,
  };
}

/** Serializes a draft row for the client/voice layer. */
function draftView(d) {
  return {
    draftId: d.draft_id,
    position: d.position,
    platform: d.platform,
    postContent: d.post_content,
    visualIdea: d.visual_idea,
    imageUrl: d.image_url,
    scheduledTime: d.scheduled_time,
    rationale: d.rationale,
    status: d.status,
  };
}

async function sessionState(session) {
  const drafts = await db.query(
    "SELECT * FROM voice_content_drafts WHERE session_id = $1 ORDER BY position",
    [session.session_id]
  );
  return {
    sessionId: session.session_id,
    brandId: session.brand_id,
    status: session.status,
    questions: session.questions || [],
    answers: session.answers || [],
    drafts: drafts.rows.map(draftView),
  };
}

/** Persists drafted posts for a session inside one transaction. */
async function storeDrafts(sessionId, brandId, posts) {
  const timezone = await getBrandTimezone(brandId);
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const perDay = Math.max(1, Math.ceil(posts.length / 7));
    let lastPostTime = null;
    for (let i = 0; i < posts.length; i += 1) {
      const p = posts[i];
      const scheduledTime = proposeScheduledTime(
        i,
        p.bestPostingTime,
        p.platform,
        timezone,
        new Date(),
        { notBefore: lastPostTime, perDay }
      );
      lastPostTime = scheduledTime;
      await client.query(
        `INSERT INTO voice_content_drafts
           (session_id, position, platform, post_content, visual_idea, rationale, scheduled_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          sessionId,
          i + 1,
          p.platform,
          composePostContent(p),
          p.visualIdea,
          p.rationale || null,
          scheduledTime,
        ]
      );
    }
    await client.query(
      `UPDATE voice_content_sessions SET status = 'reviewing' WHERE session_id = $1`,
      [sessionId]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * POST /api/voice-content/start
 * Body: { brandId, request? }
 * Gathers intelligence and drafts posts — or returns clarifying questions.
 */
async function startSession(req, res) {
  const userId = req.user.userId;
  const { brandId, request } = req.body;
  if (!brandId) return res.status(400).json({ error: "brandId is required" });

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const connectedPlatforms = await getUsablePlatforms(brandId);
    if (connectedPlatforms.length === 0) {
      // Honesty over convenience: without a connected, publishable account
      // every "approved" post would be doomed. 409 lets Echo explain why.
      return res.status(409).json({
        error: "no_connected_platforms",
        message:
          "No connected social account can be posted to yet. Connect Facebook, X, or LinkedIn in Social Media first.",
      });
    }

    const requestText = typeof request === "string" ? request.trim().slice(0, 500) : "";
    const intel = await gatherIntelligence(brand, connectedPlatforms);
    brand._learningContext = await learningContextForBrand(brandId);
    const result = await generateVoiceDrafts(brand, intel, { requestText });

    if (result.questions) {
      const insert = await db.query(
        `INSERT INTO voice_content_sessions (brand_id, user_id, status, request_text, questions)
         VALUES ($1, $2, 'awaiting_answers', $3, $4::jsonb)
         RETURNING *`,
        [brandId, userId, requestText || null, JSON.stringify(result.questions)]
      );
      return res.status(201).json(await sessionState(insert.rows[0]));
    }

    const insert = await db.query(
      `INSERT INTO voice_content_sessions (brand_id, user_id, status, request_text)
       VALUES ($1, $2, 'drafting', $3)
       RETURNING *`,
      [brandId, userId, requestText || null]
    );
    const session = insert.rows[0];
    await storeDrafts(session.session_id, brandId, result.posts);
    const fresh = await getOwnedSession(userId, session.session_id);
    return res.status(201).json(await sessionState(fresh));
  } catch (err) {
    console.error("Voice content start error:", err.message);
    return sendAiError(res, err, "Failed to start the content session");
  }
}

/**
 * POST /api/voice-content/:sessionId/answers
 * Body: { answers: ["...", ...] } — one spoken answer per pending question.
 */
async function submitAnswers(req, res) {
  const userId = req.user.userId;
  const { sessionId } = req.params;
  const { answers } = req.body;

  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: "answers must be a non-empty array" });
  }

  try {
    const session = await getOwnedSession(userId, sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status !== "awaiting_answers") {
      return res.status(409).json({ error: "This session is not waiting for answers" });
    }

    const questions = Array.isArray(session.questions) ? session.questions : [];
    const paired = questions.map((q, i) => ({
      question: q,
      answer: String(answers[i] || "").trim().slice(0, 500) || "(no answer)",
    }));

    const brand = await getOwnedBrand(userId, session.brand_id);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const connectedPlatforms = await getUsablePlatforms(session.brand_id);
    if (connectedPlatforms.length === 0) {
      return res.status(409).json({
        error: "no_connected_platforms",
        message:
          "No connected social account can be posted to yet. Connect Facebook, X, or LinkedIn in Social Media first.",
      });
    }

    const intel = await gatherIntelligence(brand, connectedPlatforms);
    brand._learningContext = await learningContextForBrand(brand.brand_id);
    const result = await generateVoiceDrafts(brand, intel, {
      requestText: session.request_text || "",
      answers: paired,
    });

    if (result.questions) {
      // The AI is still unsure — surface the follow-up questions rather than
      // guessing. (Rare: the prompt tells it to ask everything in one round.)
      const updated = await db.query(
        `UPDATE voice_content_sessions
         SET questions = $1::jsonb, answers = $2::jsonb
         WHERE session_id = $3
         RETURNING *`,
        [JSON.stringify(result.questions), JSON.stringify(paired), sessionId]
      );
      return res.json(await sessionState(updated.rows[0]));
    }

    await db.query(
      `UPDATE voice_content_sessions SET answers = $1::jsonb WHERE session_id = $2`,
      [JSON.stringify(paired), sessionId]
    );
    await storeDrafts(sessionId, session.brand_id, result.posts);
    const fresh = await getOwnedSession(userId, sessionId);
    return res.json(await sessionState(fresh));
  } catch (err) {
    console.error("Voice content answers error:", err.message);
    return sendAiError(res, err, "Failed to draft the content");
  }
}

/** GET /api/voice-content/:sessionId — current session state. */
async function getSession(req, res) {
  const userId = req.user.userId;
  try {
    const session = await getOwnedSession(userId, req.params.sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    return res.json(await sessionState(session));
  } catch (err) {
    console.error("Voice content get error:", err.message);
    return res.status(500).json({ error: "Failed to load the session" });
  }
}

/** Loads a draft with ownership enforced (via its session's brand). */
async function getOwnedDraft(userId, sessionId, draftId) {
  const r = await db.query(
    `SELECT d.*, s.brand_id
     FROM voice_content_drafts d
     JOIN voice_content_sessions s ON s.session_id = d.session_id
     JOIN brands b ON b.brand_id = s.brand_id
     WHERE d.draft_id = $1 AND d.session_id = $2 AND b.user_id = $3`,
    [draftId, sessionId, userId]
  );
  return r.rows[0] || null;
}

/**
 * POST /api/voice-content/:sessionId/drafts/:draftId/image
 * Generates (or regenerates) the draft's visual: brand-grounded DALL-E prompt →
 * render → download to permanent storage. DALL-E URLs expire, so the image is
 * persisted immediately and only the permanent relative URL is stored.
 */
async function generateDraftImage(req, res) {
  const userId = req.user.userId;
  const { sessionId, draftId } = req.params;

  try {
    const draft = await getOwnedDraft(userId, sessionId, draftId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });
    if (draft.status !== "pending") {
      return res.status(409).json({ error: "This draft is no longer editable" });
    }

    const brand = await getOwnedBrand(userId, draft.brand_id);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const purpose = PLATFORM_IMAGE_PURPOSE[draft.platform] || "facebook_ad";
    const description =
      (draft.visual_idea && draft.visual_idea.trim()) ||
      `An eye-catching social media visual for this post: ${String(draft.post_content).slice(0, 200)}`;
    const prompt = buildImagePrompt(brand, purpose, description);

    const temporaryUrl = await renderFromPrompt(prompt, purpose);
    const permanentUrl = await persistImage(temporaryUrl);

    const updated = await db.query(
      `UPDATE voice_content_drafts
       SET image_prompt = $1, image_url = $2
       WHERE draft_id = $3 AND status = 'pending'
       RETURNING *`,
      [prompt, permanentUrl, draftId]
    );
    if (updated.rows.length === 0) {
      return res.status(409).json({ error: "This draft is no longer editable" });
    }
    return res.json(draftView(updated.rows[0]));
  } catch (err) {
    console.error("Voice content image error:", err.message);
    return sendAiError(res, err, "Failed to create the visual");
  }
}

/**
 * POST /api/voice-content/:sessionId/drafts/:draftId/revise
 * Body: { instruction } — the owner's spoken change request.
 */
async function reviseDraft(req, res) {
  const userId = req.user.userId;
  const { sessionId, draftId } = req.params;
  const instruction = String(req.body.instruction || "").trim();
  if (!instruction) {
    return res.status(400).json({ error: "instruction is required" });
  }

  try {
    const draft = await getOwnedDraft(userId, sessionId, draftId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });
    if (draft.status !== "pending") {
      return res.status(409).json({ error: "This draft is no longer editable" });
    }

    const brand = await getOwnedBrand(userId, draft.brand_id);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const revised = await reviseVoiceDraft(brand, draft, instruction.slice(0, 500));
    const updated = await db.query(
      `UPDATE voice_content_drafts
       SET post_content = $1
       WHERE draft_id = $2 AND status = 'pending'
       RETURNING *`,
      [composePostContent(revised), draftId]
    );
    if (updated.rows.length === 0) {
      return res.status(409).json({ error: "This draft is no longer editable" });
    }
    recordSignal({
      brandId: draft.brand_id,
      userId,
      source: "voice_content",
      itemType: "post",
      platform: draft.platform,
      action: "revise",
      instruction,
      content: draft.post_content,
    });
    return res.json(draftView(updated.rows[0]));
  } catch (err) {
    console.error("Voice content revise error:", err.message);
    return sendAiError(res, err, "Failed to revise the post");
  }
}

/**
 * POST /api/voice-content/:sessionId/drafts/:draftId/approve
 * The ONLY path that schedules anything. Atomic: the pending→approved flip's
 * row count decides whether this call inserts the social_posts row, so a
 * double "approve" (echoed command, retry) can never double-schedule.
 */
async function approveDraft(req, res) {
  const userId = req.user.userId;
  const { sessionId, draftId } = req.params;

  const client = await db.pool.connect();
  try {
    const draft = await getOwnedDraft(userId, sessionId, draftId);
    if (!draft) {
      client.release();
      return res.status(404).json({ error: "Draft not found" });
    }

    await client.query("BEGIN");
    const claimed = await client.query(
      `UPDATE voice_content_drafts
       SET status = 'approved'
       WHERE draft_id = $1 AND status = 'pending'
       RETURNING *`,
      [draftId]
    );
    if (claimed.rows.length === 0) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(409).json({ error: "This draft was already handled" });
    }
    const row = claimed.rows[0];

    // Never schedule into the past (long review sessions): backstop to +10 min.
    const scheduledTime =
      row.scheduled_time && new Date(row.scheduled_time).getTime() > Date.now()
        ? row.scheduled_time
        : new Date(Date.now() + 10 * 60 * 1000);

    const inserted = await client.query(
      `INSERT INTO social_posts (brand_id, platform, post_content, image_url, scheduled_time, status)
       VALUES ($1, $2, $3, $4, $5, 'scheduled')
       RETURNING post_id, scheduled_time`,
      [draft.brand_id, row.platform, row.post_content, row.image_url, scheduledTime]
    );
    await client.query(
      "UPDATE voice_content_drafts SET posted_post_id = $1 WHERE draft_id = $2",
      [inserted.rows[0].post_id, draftId]
    );
    await client.query("COMMIT");
    client.release();

    recordSignal({
      brandId: draft.brand_id,
      userId,
      source: "voice_content",
      itemType: "post",
      platform: row.platform,
      action: "approve",
      content: row.post_content,
    });
    return res.json({
      ...draftView({ ...row, status: "approved", posted_post_id: inserted.rows[0].post_id }),
      postId: inserted.rows[0].post_id,
      scheduledTime: inserted.rows[0].scheduled_time,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    client.release();
    console.error("Voice content approve error:", err.message);
    return res.status(500).json({ error: "Failed to schedule the post" });
  }
}

/** POST /api/voice-content/:sessionId/drafts/:draftId/skip */
async function skipDraft(req, res) {
  const userId = req.user.userId;
  const { sessionId, draftId } = req.params;
  try {
    const draft = await getOwnedDraft(userId, sessionId, draftId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });
    const updated = await db.query(
      `UPDATE voice_content_drafts SET status = 'skipped'
       WHERE draft_id = $1 AND status = 'pending'
       RETURNING *`,
      [draftId]
    );
    if (updated.rows.length === 0) {
      return res.status(409).json({ error: "This draft was already handled" });
    }
    recordSignal({
      brandId: draft.brand_id,
      userId,
      source: "voice_content",
      itemType: "post",
      platform: draft.platform,
      action: "decline",
      content: draft.post_content,
    });
    return res.json(draftView(updated.rows[0]));
  } catch (err) {
    console.error("Voice content skip error:", err.message);
    return res.status(500).json({ error: "Failed to skip the draft" });
  }
}

/**
 * POST /api/voice-content/:sessionId/complete
 * Marks the session finished (all drafts reviewed) or cancelled mid-way.
 * Body: { cancelled? } — pending drafts stay pending (harmless: they are
 * drafts, not scheduled posts; nothing publishes without an approve).
 */
async function completeSession(req, res) {
  const userId = req.user.userId;
  const { sessionId } = req.params;
  const cancelled = req.body.cancelled === true;
  try {
    const session = await getOwnedSession(userId, sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (["completed", "cancelled"].includes(session.status)) {
      return res.json(await sessionState(session));
    }
    const updated = await db.query(
      `UPDATE voice_content_sessions SET status = $1
       WHERE session_id = $2
       RETURNING *`,
      [cancelled ? "cancelled" : "completed", sessionId]
    );
    return res.json(await sessionState(updated.rows[0]));
  } catch (err) {
    console.error("Voice content complete error:", err.message);
    return res.status(500).json({ error: "Failed to close the session" });
  }
}

module.exports = {
  PUBLISHABLE_PLATFORMS,
  PLATFORM_IMAGE_PURPOSE,
  proposeScheduledTime,
  getUsablePlatforms,
  gatherIntelligence,
  getBrandTimezone,
  startSession,
  submitAnswers,
  getSession,
  generateDraftImage,
  reviseDraft,
  approveDraft,
  skipDraft,
  completeSession,
};
