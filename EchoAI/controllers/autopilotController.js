/**
 * Autopilot Mode — "the captain approves, the crew executes."
 *
 * The owner sets a weekly cadence once (N posts + N Facebook test ads) plus
 * hard ad-spend limits (daily / weekly / monthly). Every Monday morning the
 * engine drafts the whole week from the brand's REAL intelligence — posts WITH
 * on-brand graphics and fully drafted test ads — then pings the owner: "your
 * week is ready to review." NOTHING publishes or spends until each item is
 * approved (by voice or click). Approving a post schedules it through the
 * normal social_posts pipeline; approving an ad launches a Facebook campaign
 * ONLY if it fits inside every spend limit (blocked = honest 409 with the
 * plain-English reason).
 *
 * Invariants (match the rest of the codebase):
 * - Ownership: every access joins through brands.user_id.
 * - AI failures → 502, never mocked; AI output validated before persistence.
 * - Weekly claim is atomic (UNIQUE(brand_id, week_start) + ON CONFLICT DO
 *   NOTHING) so overlapping cron ticks can't double-generate.
 * - Approve/decline are atomic status-guarded UPDATEs (row-count branch).
 * - Spend limits are re-checked with FRESH numbers at approve time, not the
 *   stale numbers from generation time.
 */

const db = require("../config/db");
const { generateWeeklyBatch, reviseAdDraft, draftInstantPost } = require("../prompts/autopilotPrompt");
const forgeDirector = require("../utils/forgeDirector");
const { zonedWallTimeToUtc } = require("../utils/timezone");
const { reviseVoiceDraft } = require("../prompts/voiceContentPrompt");
const { composePostContent } = require("../prompts/contentCalendarPrompt");
const { buildImagePrompt } = require("../prompts/imagePromptBuilder");
const { renderFromPrompt, persistImage } = require("./imageController");
const {
  PLATFORM_IMAGE_PURPOSE,
  getUsablePlatforms,
  gatherIntelligence,
  getBrandTimezone,
} = require("./voiceContentController");
const { launchFacebookCampaign } = require("./campaignController");
const { publishStoredPost } = require("./socialController");
const { evaluateAdSpend, suggestDailyBudget, getBrandSpend } = require("../utils/spendLimits");
const fs = require("fs");
const path = require("path");
const creativeModes = require("../utils/creativeModes");
const { toJsonbParam } = require("../utils/jsonb");
const { getGuidanceForImageRequest } = require("../utils/visionEngine");
const { recordSignal, learningContextForBrand } = require("../utils/learningEngine");
const { computeSetupStatus } = require("../utils/setupStatus");
const pushController = require("./pushController");

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
    `SELECT b.*, u.industry
     FROM brands b
     JOIN users u ON u.user_id = b.user_id
     WHERE b.brand_id = $1 AND b.user_id = $2`,
    [brandId, userId]
  );
  return result.rows[0] || null;
}

/** Monday (UTC date string YYYY-MM-DD) of the week containing `now`. */
function weekStartOf(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Fixed Autopilot posting slots (owner's rule, July 2026): 6 AM, 12 PM, and
 * 6 PM in the brand's timezone — never two posts an hour apart. Slots are
 * allocated chronologically across the week; posts per day = ceil(count / 7)
 * capped at 3 slots. Slots less than 30 minutes in the future are skipped so
 * the first post never fires before the owner can review the batch.
 */
const AUTOPILOT_SLOTS = ["06:00", "12:00", "18:00"];

/** Calendar date (Y/M/D) that `date` falls on in the given timezone. */
function localDateParts(date, timeZone) {
  // en-CA formats as YYYY-MM-DD.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .split("-")
    .map(Number);
  return { y: parts[0], m: parts[1], d: parts[2] };
}

function autopilotSlotTimes(count, timezone, now = new Date(), cadence = count) {
  const times = [];
  if (!Number.isInteger(count) || count <= 0) return times;
  // Slots per day come from the owner's REQUESTED weekly cadence (e.g. 21/wk
  // = 3 a day), not from how many posts the AI actually returned — a short
  // batch must still post 3x/day and finish early, never stretch into a
  // second week at a thinner cadence.
  const cadenceBase = Number.isInteger(cadence) && cadence > 0 ? cadence : count;
  const perDay = Math.min(AUTOPILOT_SLOTS.length, Math.max(1, Math.ceil(cadenceBase / 7)));
  const minLead = 30 * 60 * 1000;
  // Day iteration is anchored on the BRAND-LOCAL calendar date of `now` (not
  // the UTC date) so near-midnight-UTC moments in western timezones still see
  // today's remaining local slots. Calendar day arithmetic runs on the local
  // Y-M-D via Date.UTC, which is DST-safe (zonedWallTimeToUtc does the
  // offset conversion per day).
  const local = localDateParts(now, timezone);
  const baseUtcMidnight = Date.UTC(local.y, local.m - 1, local.d);
  // Backstop bound: even if every early slot is in the past we always find
  // `count` future slots within count/perDay + a few extra days.
  const maxDays = Math.ceil(count / perDay) + 8;
  for (let dayOffset = 0; dayOffset < maxDays && times.length < count; dayOffset += 1) {
    const day = new Date(baseUtcMidnight + dayOffset * 24 * 60 * 60 * 1000);
    for (let s = 0; s < perDay && times.length < count; s += 1) {
      const [hh, mm] = AUTOPILOT_SLOTS[s].split(":").map(Number);
      const utc = zonedWallTimeToUtc(
        day.getUTCFullYear(),
        day.getUTCMonth() + 1,
        day.getUTCDate(),
        hh,
        mm,
        timezone
      );
      if (utc.getTime() - now.getTime() >= minLead) times.push(utc);
    }
  }
  return times;
}

/** Serialized autopilot settings for a brand (defaults when no row yet). */
async function loadSettings(brandId) {
  const { rows } = await db.query(
    "SELECT * FROM autopilot_settings WHERE brand_id = $1",
    [brandId]
  );
  const r = rows[0];
  if (!r) {
    return {
      enabled: false,
      postsPerWeek: 5,
      adsPerWeek: 0,
      dailySpendCap: null,
      weeklySpendCap: null,
      monthlySpendCap: null,
      contentPreference: "balanced_auto",
      editingPermissions: creativeModes.normalizePermissions(null),
      exists: false,
    };
  }
  return {
    enabled: !!r.enabled,
    postsPerWeek: Number(r.posts_per_week),
    adsPerWeek: Number(r.ads_per_week),
    dailySpendCap: r.daily_spend_cap != null ? Number(r.daily_spend_cap) : null,
    weeklySpendCap: r.weekly_spend_cap != null ? Number(r.weekly_spend_cap) : null,
    monthlySpendCap: r.monthly_spend_cap != null ? Number(r.monthly_spend_cap) : null,
    contentPreference: creativeModes.isValidPreference(r.content_preference)
      ? r.content_preference
      : "balanced_auto",
    editingPermissions: creativeModes.normalizePermissions(r.editing_permissions),
    exists: true,
  };
}

function capsOf(settings) {
  return {
    daily: settings.dailySpendCap,
    weekly: settings.weeklySpendCap,
    monthly: settings.monthlySpendCap,
  };
}

/**
 * Connect-everything-first readiness. Autopilot can only be honest about
 * "your week is handled" when the pipes it publishes through actually exist:
 * - posts need at least one connected, publishable social account;
 * - ads need a connected Facebook ad account.
 * Returns { ready, missing: [{key,label,section}] } for the given cadence.
 */
async function computeReadiness(userId, brandId, { postsPerWeek, adsPerWeek }) {
  const missing = [];

  if (postsPerWeek > 0) {
    const platforms = await getUsablePlatforms(brandId);
    if (platforms.length === 0) {
      missing.push({
        key: "social",
        label: "Connect a social account Echo can post to (Facebook, X, or LinkedIn)",
        section: "social",
      });
    }
  }

  if (adsPerWeek > 0) {
    const fb = await db.query(
      `SELECT 1 FROM api_integrations
        WHERE user_id = $1 AND platform = 'facebook' AND connection_status = 'connected'`,
      [userId]
    );
    if (fb.rows.length === 0) {
      missing.push({
        key: "facebook_ads",
        label: "Connect your Facebook ad account so Echo can launch test ads",
        section: "campaigns",
      });
    }
  }

  return { ready: missing.length === 0, missing };
}

function itemView(i) {
  return {
    itemId: i.item_id,
    batchId: i.batch_id,
    position: i.position,
    itemType: i.item_type,
    platform: i.platform,
    postContent: i.post_content,
    visualIdea: i.visual_idea,
    imageUrl: i.image_url,
    videoUrl: i.video_url,
    scheduledTime: i.scheduled_time,
    rationale: i.rationale,
    adHeadline: i.ad_headline,
    adDailyBudget: i.ad_daily_budget != null ? Number(i.ad_daily_budget) : null,
    status: i.status,
    postedPostId: i.posted_post_id,
    campaignId: i.campaign_id,
    // Hybrid Creative Engine: how this item's graphic was (or will be) built —
    // 'asset' (your photo enhanced), 'assisted' (your photo + AI edits), 'ai'
    // (original AI concept). Null on legacy items.
    creativeMode: i.creative_mode || null,
    sourceImageId: i.source_image_id || null,
  };
}

async function batchState(batch) {
  // Items that already have a linked social post are hidden from the batch
  // review list (owner's rule) — the moment a post is approved it lives in
  // the Social Media calendar (scheduled, publishing, published, or failed
  // with a retry there); the batch list is only for work still needing a
  // decision (pending / declined drafts).
  const items = await db.query(
    `SELECT i.* FROM autopilot_batch_items i
      LEFT JOIN social_posts sp ON sp.post_id = i.posted_post_id
      WHERE i.batch_id = $1
        AND sp.post_id IS NULL
      ORDER BY i.position`,
    [batch.batch_id]
  );
  return {
    batchId: batch.batch_id,
    brandId: batch.brand_id,
    weekStart: batch.week_start,
    status: batch.status,
    error: batch.error || null,
    createdAt: batch.created_at,
    items: items.rows.map(itemView),
  };
}

/** Loads a batch item with ownership enforced (via its batch's brand). */
async function getOwnedItem(userId, itemId) {
  const r = await db.query(
    `SELECT i.*, ab.brand_id, ab.user_id AS owner_id, ab.status AS batch_status
     FROM autopilot_batch_items i
     JOIN autopilot_batches ab ON ab.batch_id = i.batch_id
     JOIN brands b ON b.brand_id = ab.brand_id
     WHERE i.item_id = $1 AND b.user_id = $2`,
    [itemId, userId]
  );
  return r.rows[0] || null;
}

// --- settings + readiness ----------------------------------------------------

/** GET /api/autopilot/settings?brandId= */
async function getSettings(req, res) {
  const userId = req.user.userId;
  const brandId = req.query.brandId;
  if (!brandId) return res.status(400).json({ error: "brandId is required" });
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const settings = await loadSettings(brandId);
    const readiness = await computeReadiness(userId, brandId, settings);
    return res.json({ brandId, ...settings, readiness });
  } catch (err) {
    console.error("Autopilot settings error:", err.message);
    return res.status(500).json({ error: "Failed to load autopilot settings" });
  }
}

function parseCap(value, name) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error(`${name} must be a positive dollar amount`);
    err.badInput = true;
    throw err;
  }
  return Math.round(n * 100) / 100;
}

/**
 * PUT /api/autopilot/settings
 * Body: { brandId, enabled, postsPerWeek, adsPerWeek,
 *         dailySpendCap, weeklySpendCap, monthlySpendCap }
 * Enabling requires the connect-everything-first readiness check to pass —
 * autopilot never pretends it can publish through pipes that don't exist.
 */
async function updateSettings(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.body;
  if (!brandId) return res.status(400).json({ error: "brandId is required" });

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const current = await loadSettings(brandId);
    const enabled = req.body.enabled != null ? req.body.enabled === true : current.enabled;
    const postsPerWeek =
      req.body.postsPerWeek != null ? Number(req.body.postsPerWeek) : current.postsPerWeek;
    // Autopilot is posts-only (product decision, July 2026): ads are Atlas's
    // job in Ad Campaigns. Any adsPerWeek from a client is coerced to 0 so no
    // path — UI, API, or cron reading stored settings — drafts test ads again.
    const adsPerWeek = 0;

    if (!Number.isInteger(postsPerWeek) || postsPerWeek < 0 || postsPerWeek > 21) {
      return res.status(400).json({ error: "postsPerWeek must be a whole number from 0 to 21" });
    }
    if (enabled && postsPerWeek === 0) {
      return res.status(400).json({ error: "Autopilot needs at least one post per week" });
    }

    let dailySpendCap;
    let weeklySpendCap;
    let monthlySpendCap;
    try {
      dailySpendCap =
        "dailySpendCap" in req.body ? parseCap(req.body.dailySpendCap, "Daily limit") : current.dailySpendCap;
      weeklySpendCap =
        "weeklySpendCap" in req.body ? parseCap(req.body.weeklySpendCap, "Weekly limit") : current.weeklySpendCap;
      monthlySpendCap =
        "monthlySpendCap" in req.body
          ? parseCap(req.body.monthlySpendCap, "Monthly limit")
          : current.monthlySpendCap;
    } catch (e) {
      if (e.badInput) return res.status(400).json({ error: e.message });
      throw e;
    }

    // Hybrid Creative Engine settings: how Forge mixes the owner's real
    // photos with AI creativity, and which photo edits AI is allowed to make.
    let contentPreference = current.contentPreference;
    if ("contentPreference" in req.body) {
      if (!creativeModes.isValidPreference(req.body.contentPreference)) {
        return res.status(400).json({ error: "Unknown content preference" });
      }
      contentPreference = req.body.contentPreference;
    }
    let editingPermissions = current.editingPermissions;
    if ("editingPermissions" in req.body) {
      if (
        req.body.editingPermissions == null ||
        typeof req.body.editingPermissions !== "object" ||
        Array.isArray(req.body.editingPermissions)
      ) {
        return res.status(400).json({ error: "editingPermissions must be an object" });
      }
      editingPermissions = creativeModes.normalizePermissions(req.body.editingPermissions);
    }

    const readiness = await computeReadiness(userId, brandId, { postsPerWeek, adsPerWeek });
    if (enabled && !readiness.ready) {
      return res.status(409).json({
        error: "not_ready",
        message:
          "A couple of connections are needed before autopilot can take over. " +
          readiness.missing.map((m) => m.label).join(" "),
        missing: readiness.missing,
      });
    }

    await db.query(
      `INSERT INTO autopilot_settings
         (brand_id, enabled, posts_per_week, ads_per_week,
          daily_spend_cap, weekly_spend_cap, monthly_spend_cap,
          content_preference, editing_permissions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (brand_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         posts_per_week = EXCLUDED.posts_per_week,
         ads_per_week = EXCLUDED.ads_per_week,
         daily_spend_cap = EXCLUDED.daily_spend_cap,
         weekly_spend_cap = EXCLUDED.weekly_spend_cap,
         monthly_spend_cap = EXCLUDED.monthly_spend_cap,
         content_preference = EXCLUDED.content_preference,
         editing_permissions = EXCLUDED.editing_permissions`,
      [
        brandId,
        enabled,
        postsPerWeek,
        adsPerWeek,
        dailySpendCap,
        weeklySpendCap,
        monthlySpendCap,
        contentPreference,
        toJsonbParam(editingPermissions),
      ]
    );

    const settings = await loadSettings(brandId);
    return res.json({ brandId, ...settings, readiness });
  } catch (err) {
    console.error("Autopilot update settings error:", err.message);
    return res.status(500).json({ error: "Failed to save autopilot settings" });
  }
}

/**
 * GET /api/autopilot/readiness?brandId=
 * Connect-everything-first checklist for the voice onboarding walkthrough:
 * the full guided-setup status plus the autopilot-specific must-haves.
 */
async function getReadiness(req, res) {
  const userId = req.user.userId;
  const brandId = req.query.brandId;
  if (!brandId) return res.status(400).json({ error: "brandId is required" });
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const settings = await loadSettings(brandId);
    const [readiness, setup] = await Promise.all([
      computeReadiness(userId, brandId, settings),
      computeSetupStatus(userId, brandId),
    ]);
    return res.json({ brandId, ...readiness, setup });
  } catch (err) {
    console.error("Autopilot readiness error:", err.message);
    return res.status(500).json({ error: "Failed to check autopilot readiness" });
  }
}

// --- weekly batch generation ---------------------------------------------------

/**
 * Recent image prompts for this brand across Autopilot batches, so the next
 * graphic can be steered AWAY from scenes the owner has already seen. Fail-open
 * (empty list) — variety guidance must never block image generation.
 */
async function recentImageScenes(brandId) {
  try {
    const r = await db.query(
      `SELECT image_prompt FROM autopilot_batch_items abi
        JOIN autopilot_batches ab ON ab.batch_id = abi.batch_id
       WHERE ab.brand_id = $1 AND abi.image_prompt IS NOT NULL
       ORDER BY abi.created_at DESC
       LIMIT 8`,
      [brandId]
    );
    const scenes = r.rows
      .map((row) => {
        // The subject line ("Subject: ....") is the scene; the rest is boilerplate.
        const m = String(row.image_prompt).match(/Subject:\s*([^.]+(?:\.[^.]*)?)/);
        return (m ? m[1] : String(row.image_prompt)).slice(0, 160).trim();
      })
      .filter(Boolean);
    return [...new Set(scenes)];
  } catch (err) {
    console.error("Autopilot recent-scene lookup failed:", err.message);
    return [];
  }
}

// --- Hybrid Creative Engine: real-photo sourcing --------------------------------

const VISION_UPLOAD_DIR = path.join(__dirname, "..", "uploads", "vision");

/**
 * The brand's Vision reference photos ordered least-used-first (how many
 * autopilot items have already been built from each), so real photos rotate
 * instead of the same hero shot repeating every week.
 */
async function leastUsedReferences(brandId, limit = 60) {
  const { rows } = await db.query(
    `SELECT v.image_id, v.file_path, v.mime_type, v.caption,
            COUNT(i.item_id) AS uses
       FROM vision_reference_images v
       LEFT JOIN autopilot_batch_items i ON i.source_image_id = v.image_id
      WHERE v.brand_id = $1
      GROUP BY v.image_id
      ORDER BY uses ASC, v.created_at DESC
      LIMIT $2`,
    [brandId, limit]
  );
  return rows;
}

/**
 * Loads a Vision reference photo (ownership-scoped to the brand) as the
 * {buffer, mime, filename} shape imageController's edit path expects.
 * Returns null when the row or file is gone — callers fall back to AI mode
 * honestly instead of failing the whole render.
 */
async function loadVisionReference(imageId, brandId) {
  try {
    const { rows } = await db.query(
      "SELECT file_path, mime_type FROM vision_reference_images WHERE image_id = $1 AND brand_id = $2",
      [imageId, brandId]
    );
    if (!rows.length) return null;
    const filename = path.basename(rows[0].file_path);
    const buffer = await fs.promises.readFile(path.join(VISION_UPLOAD_DIR, filename));
    return { buffer, mime: rows[0].mime_type || "image/jpeg", filename };
  } catch (e) {
    console.error(`Vision reference ${imageId} unreadable:`, e.message);
    return null;
  }
}

/**
 * Renders a photo-based item ('asset' or 'assisted' mode): the owner's real
 * photo goes to the image model's EDIT endpoint with an instruction block
 * built strictly from the owner's editing permissions. Returns true when the
 * photo path succeeded; false → caller falls back to pure AI mode.
 */
async function renderItemImageFromPhoto(brand, item, purpose, settings) {
  const mode = item.creative_mode;
  const reference = await loadVisionReference(item.source_image_id, brand.brand_id);
  if (!reference) return false;

  const description =
    (item.visual_idea && item.visual_idea.trim()) ||
    `A marketing visual for: ${String(item.post_content).slice(0, 200)}`;
  const prompt =
    `Turn this real photo into a polished social media marketing image for ${brand.brand_name}. ` +
    `Post context: ${description.slice(0, 300)}\n\n` +
    creativeModes.editDirectives(mode, settings ? settings.editingPermissions : null);

  const temporaryUrl = await renderFromPrompt(prompt, purpose, reference);
  const permanentUrl = await persistImage(temporaryUrl);
  await db.query(
    `UPDATE autopilot_batch_items SET image_prompt = $1, image_url = $2, video_url = NULL
      WHERE item_id = $3 AND status = 'pending'`,
    [prompt, permanentUrl, item.item_id]
  );
  return true;
}

/** Best-effort on-brand image for one batch item; failures leave it null. */
async function renderItemImage(brand, item) {
  const purpose = PLATFORM_IMAGE_PURPOSE[item.platform] || "facebook_ad";

  // Hybrid Creative Engine: photo-based modes work FROM the owner's real
  // photo. If the photo has vanished (deleted from the library), the item
  // honestly downgrades to an original AI concept and records that.
  if (
    (item.creative_mode === "asset" || item.creative_mode === "assisted") &&
    item.source_image_id
  ) {
    const settings = await loadSettings(brand.brand_id);
    const ok = await renderItemImageFromPhoto(brand, item, purpose, settings);
    if (ok) return;
    await db.query(
      "UPDATE autopilot_batch_items SET creative_mode = 'ai', source_image_id = NULL WHERE item_id = $1",
      [item.item_id]
    );
    item.creative_mode = "ai";
    item.source_image_id = null;
  }
  const description =
    (item.visual_idea && item.visual_idea.trim()) ||
    `An eye-catching marketing visual for: ${String(item.post_content).slice(0, 200)}`;

  // Rotate the creative direction per image (clean/bold/editorial) so a week
  // of posts doesn't render as near-identical scenes.
  let prompt = buildImagePrompt(brand, purpose, description, {
    variantIndex: Math.floor(Math.random() * 3),
  });

  // Honesty rule for pure-AI items: original brand concepts never pretend to
  // depict a specific real project/product of this business.
  if (item.creative_mode === "ai") {
    prompt += `\n\n${creativeModes.AI_ORIGINALITY_LINE}`;
  }

  // Forge's art direction: the item's creative brief fixed a visual style +
  // camera composition BEFORE generation. Fail-open: items without a brief
  // (legacy batches, planning failures) render exactly as before.
  const brief = await forgeDirector.getBriefForItem(item.item_id);
  if (brief) {
    // Sage's Pattern Intelligence can add an industry-informed color
    // direction to the art direction (fail-open null when Sage hasn't run).
    const sage = await forgeDirector.getPatternRecommendation(brand.brand_id);
    prompt += `\n\n${forgeDirector.visualDirective(brief, sage)}`;
  }

  // Consult Vision's visual knowledge base — distilled from the owner's real
  // uploaded reference photos + studied industry standards. Fail-open: image
  // generation is never blocked when Vision hasn't studied this brand yet.
  const guidance = await getGuidanceForImageRequest({
    brandId: brand.brand_id,
    requester: "nova_autopilot",
    requestSummary: `${purpose}: ${description.slice(0, 200)}`,
  });
  // Cap the guidance block so an unusually large knowledge base can't balloon
  // the image prompt past what the image model handles reliably.
  if (guidance && guidance.text) prompt += `\n\n${String(guidance.text).slice(0, 2500)}`;

  // Anti-repetition: tell the model what this brand's recent graphics already
  // showed so it composes a genuinely NEW scene (different setting, angle,
  // season, subject treatment) instead of the same hero shot every week.
  const recent = await recentImageScenes(brand.brand_id);
  if (recent.length) {
    prompt +=
      "\n\nThis brand's recent images already showed the scenes below. Compose a CLEARLY DIFFERENT scene — change the setting, camera angle, time of day, season, or featured subject. Do not repeat these:\n" +
      recent.map((s, i) => `${i + 1}. ${s}`).join("\n");
  }
  const temporaryUrl = await renderFromPrompt(prompt, purpose);
  const permanentUrl = await persistImage(temporaryUrl);
  await db.query(
    `UPDATE autopilot_batch_items SET image_prompt = $1, image_url = $2, video_url = NULL
      WHERE item_id = $3 AND status = 'pending'`,
    [prompt, permanentUrl, item.item_id]
  );
}

/**
 * Generates one brand's weekly batch. Assumes the batch row (status
 * 'generating') has already been claimed atomically by the caller. Fills the
 * items, renders graphics best-effort, flips the batch to 'ready' and alerts
 * the owner. On failure the batch is marked 'failed' with the honest reason.
 */
async function generateBatchForBrand(batch, brand, settings) {
  const { batch_id: batchId, brand_id: brandId, user_id: userId } = batch;

  try {
    const platforms = settings.postsPerWeek > 0 ? await getUsablePlatforms(brandId) : [];
    if (settings.postsPerWeek > 0 && platforms.length === 0) {
      throw new Error(
        "No connected social account can be posted to. Connect Facebook, X, or LinkedIn in Social Media."
      );
    }

    // Autopilot is posts-only (product decision, July 2026): ads are Atlas's
    // job in Ad Campaigns. Hard-zero here too — saveSettings coerces new saves
    // to 0, but legacy settings rows written before that decision can still
    // carry ads_per_week > 0, and this generation path must never honor them.
    const adsPerWeek = 0;

    if (settings.postsPerWeek === 0) {
      throw new Error("Nothing can be drafted this week: no posts are configured.");
    }

    // Date range: the owner can draft 1 week (default) or several weeks in
    // one go. Total posts scale with the range; the per-DAY cadence stays
    // the requested weekly cadence, so the slots simply extend across the
    // extra weeks (never a denser day).
    const weeks =
      Number.isInteger(settings.weeks) && settings.weeks >= 1 && settings.weeks <= 4
        ? settings.weeks
        : 1;
    const targetPosts = settings.postsPerWeek * weeks;

    // Hybrid Creative Engine: know the real-photo pool up front. When the
    // owner insists on "only my media" and the library is empty, fail the
    // batch honestly BEFORE any expensive AI drafting.
    const referencePhotos = await leastUsedReferences(brandId);
    if (settings.contentPreference === "only_my_media" && referencePhotos.length === 0) {
      creativeModes.decideModes({
        preference: "only_my_media",
        industry: brand.industry,
        assetCount: 0,
        itemCount: 1,
      }); // throws the honest no-assets error
    }

    const intel = await gatherIntelligence(brand, platforms);
    brand._learningContext = await learningContextForBrand(brandId);
    // Generate week-by-week so a multi-week range never asks the AI for one
    // giant response (output limits would silently truncate the batch).
    // Forge Creative Director: BEFORE each week is drafted, plan one strategy
    // brief per post (objective/tone/visual style/camera/copy style + the
    // time-of-day theme of its posting slot). Briefs steer the copy prompt
    // now and the image prompt at render time. Fail-open: an empty plan
    // drafts exactly as before.
    const perDay = Math.min(
      AUTOPILOT_SLOTS.length,
      Math.max(1, Math.ceil(settings.postsPerWeek / 7))
    );
    const SLOT_LABELS = ["morning", "afternoon", "evening"];
    const result = { posts: [], ads: [] };
    const plannedSoFar = [];
    for (let w = 0; w < weeks; w += 1) {
      const labels = Array.from(
        { length: settings.postsPerWeek },
        (_, i) => SLOT_LABELS[i % perDay]
      );
      // Earlier weeks' briefs are seeded in so consecutive weeks of the same
      // batch never repeat each other (they aren't linked to items yet, so
      // creative memory alone can't see them).
      const briefs = await forgeDirector.planBriefs(brandId, labels, plannedSoFar);
      plannedSoFar.push(...briefs);
      const chunk = await generateWeeklyBatch(brand, intel, {
        postsPerWeek: settings.postsPerWeek,
        adsPerWeek,
        avoidPosts: result.posts.map((p) => p.postText),
        briefs,
      });
      // Brief N belongs to post N of this week's chunk; carried through so the
      // inserted item can be linked back to its brief (creative memory +
      // performance learning + art direction at image-render time).
      chunk.posts.forEach((p, i) => {
        p._forgeBrief = briefs[i] || null;
      });
      result.posts.push(...chunk.posts);
      result.ads.push(...chunk.ads);
    }

    // Suggested ad budget from CURRENT spend + the owner's hard limits.
    const spend = await getBrandSpend(brandId);
    const adBudget = suggestDailyBudget({ caps: capsOf(settings), ...spend });

    const timezone = await getBrandTimezone(brandId);
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      let position = 0;
      // Fixed posting slots (owner's rule): 6 AM, 12 PM, 6 PM brand-local —
      // never two posts an hour apart. Slots are allocated chronologically.
      const slotTimes = autopilotSlotTimes(
        result.posts.length,
        timezone,
        new Date(),
        settings.postsPerWeek
      );
      for (let i = 0; i < result.posts.length; i += 1) {
        const p = result.posts[i];
        position += 1;
        const scheduledTime = slotTimes[i];
        const insertedItem = await client.query(
          `INSERT INTO autopilot_batch_items
             (batch_id, position, item_type, platform, post_content, visual_idea,
              scheduled_time, rationale)
           VALUES ($1, $2, 'post', $3, $4, $5, $6, $7)
           RETURNING item_id`,
          [
            batchId,
            position,
            p.platform,
            composePostContent(p),
            p.visualIdea,
            scheduledTime,
            p.rationale || null,
          ]
        );
        // Link the item to its Forge brief inside the same transaction so the
        // image renderer and performance learning can find it. Best-effort by
        // design: a missing brief never blocks the batch.
        if (p._forgeBrief && p._forgeBrief.brief_id) {
          await client.query(
            "UPDATE forge_creative_briefs SET item_id = $2 WHERE brief_id = $1",
            [p._forgeBrief.brief_id, insertedItem.rows[0].item_id]
          );
        }
      }
      for (const ad of result.ads) {
        position += 1;
        await client.query(
          `INSERT INTO autopilot_batch_items
             (batch_id, position, item_type, platform, post_content, visual_idea,
              rationale, ad_headline, ad_daily_budget)
           VALUES ($1, $2, 'ad', 'facebook', $3, $4, $5, $6, $7)`,
          [batchId, position, ad.primaryText, ad.visualIdea || null, ad.rationale || null, ad.headline, adBudget]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    // Graphics: best-effort per item so one DALL-E failure never sinks the
    // batch — items without an image can still be rendered on demand later.
    const { rows: items } = await db.query(
      "SELECT * FROM autopilot_batch_items WHERE batch_id = $1 ORDER BY position",
      [batchId]
    );

    // Hybrid Creative Engine: decide each post's creative mode (real photo
    // enhanced / real photo + AI edits / original AI concept) from the
    // owner's preference, the industry's default mix, and the actual photo
    // pool. Real photos rotate least-used-first. Ads stay pure AI concepts.
    const postItems = items.filter((i) => i.item_type === "post");
    const modes = creativeModes.decideModes({
      preference: settings.contentPreference,
      industry: brand.industry,
      assetCount: referencePhotos.length,
      itemCount: postItems.length,
      permissions: settings.editingPermissions,
    });
    let refCursor = 0;
    for (let i = 0; i < postItems.length; i += 1) {
      const mode = modes[i] || "ai";
      const ref =
        mode === "ai" ? null : referencePhotos[refCursor++ % referencePhotos.length];
      await db.query(
        "UPDATE autopilot_batch_items SET creative_mode = $1, source_image_id = $2 WHERE item_id = $3",
        [mode, ref ? ref.image_id : null, postItems[i].item_id]
      );
      postItems[i].creative_mode = mode;
      postItems[i].source_image_id = ref ? ref.image_id : null;
    }
    for (const item of items) {
      if (item.item_type !== "post" && !item.creative_mode) {
        item.creative_mode = "ai";
        await db.query(
          "UPDATE autopilot_batch_items SET creative_mode = 'ai' WHERE item_id = $1",
          [item.item_id]
        );
      }
    }

    for (const item of items) {
      try {
        await renderItemImage(brand, item);
      } catch (e) {
        console.error(`Autopilot image failed for item ${item.item_id}:`, e.message);
      }
    }

    // Status-guarded flip: if the batch was cancelled mid-generation, stay out.
    const flipped = await db.query(
      `UPDATE autopilot_batches SET status = 'ready'
        WHERE batch_id = $1 AND status = 'generating'
        RETURNING batch_id`,
      [batchId]
    );
    if (flipped.rows.length > 0) {
      pushController
        .sendPushToUser(userId, {
          title: "Your week is drafted and ready",
          body: `Echo drafted ${result.posts.length}${result.posts.length < targetPosts ? ` of the ${targetPosts}` : ""} post(s)${weeks > 1 ? ` covering the next ${weeks} weeks` : ""}${result.ads.length ? ` and ${result.ads.length} test ad(s)` : ""} for ${brand.brand_name}. Review and approve when you're ready.`,
          url: "/dashboard?section=autopilot",
          tag: `autopilot-${batchId}`,
        })
        .catch(() => {});
    }
    return true;
  } catch (err) {
    console.error(`Autopilot batch failed for brand ${brandId}:`, err.message);
    await db
      .query(
        `UPDATE autopilot_batches SET status = 'failed', error = $1
          WHERE batch_id = $2 AND status = 'generating'`,
        [String(err.message || "Generation failed").slice(0, 500), batchId]
      )
      .catch(() => {});
    return false;
  }
}

/**
 * Claims this week's batch for a brand (atomic via the UNIQUE constraint) and
 * generates it. Returns the claimed batch row, or null when the week is
 * already claimed. Exported per-row so the sweep guard is testable.
 */
async function processBrandWeeklyBatch(brandRow, settings, now = new Date(), batchDate = null) {
  // batchDate (YYYY-MM-DD) lets run-now draft an EXTRA mid-week batch dated
  // today when this week's Monday batch already exists — owners shouldn't
  // have to wait until next Monday to start posts or ads they want now.
  const weekStart = batchDate || weekStartOf(now);
  const claimed = await db.query(
    `INSERT INTO autopilot_batches (brand_id, user_id, week_start, status)
     VALUES ($1, $2, $3, 'generating')
     ON CONFLICT (brand_id, week_start) DO NOTHING
     RETURNING *`,
    [brandRow.brand_id, brandRow.user_id, weekStart]
  );
  if (claimed.rows.length === 0) return null;
  await module.exports.generateBatchForBrand(claimed.rows[0], brandRow, settings);
  return claimed.rows[0];
}

/**
 * Monday cron: draft the week for every real brand with autopilot enabled.
 * Each brand is guarded individually so one failure never stops the sweep.
 */
async function runWeeklyAutopilot() {
  let brands = [];
  try {
    const { rows } = await db.query(
      `SELECT b.*, u.industry, s.posts_per_week, s.ads_per_week,
              s.daily_spend_cap, s.weekly_spend_cap, s.monthly_spend_cap,
              s.content_preference, s.editing_permissions
         FROM autopilot_settings s
         JOIN brands b ON b.brand_id = s.brand_id AND b.is_demo = false
         JOIN users u ON u.user_id = b.user_id
        WHERE s.enabled = true`
    );
    brands = rows;
  } catch (err) {
    console.error("Autopilot weekly sweep query failed:", err.message);
    return;
  }

  for (const row of brands) {
    try {
      const settings = {
        postsPerWeek: Number(row.posts_per_week),
        adsPerWeek: Number(row.ads_per_week),
        dailySpendCap: row.daily_spend_cap != null ? Number(row.daily_spend_cap) : null,
        weeklySpendCap: row.weekly_spend_cap != null ? Number(row.weekly_spend_cap) : null,
        monthlySpendCap: row.monthly_spend_cap != null ? Number(row.monthly_spend_cap) : null,
        contentPreference: creativeModes.isValidPreference(row.content_preference)
          ? row.content_preference
          : "balanced_auto",
        editingPermissions: creativeModes.normalizePermissions(row.editing_permissions),
      };
      await module.exports.processBrandWeeklyBatch(row, settings);
    } catch (err) {
      console.error(`Autopilot sweep failed for brand ${row.brand_id}:`, err.message);
    }
  }
}

/**
 * POST /api/autopilot/run
 * Body: { brandId } — draft a batch right now, any day of the week.
 * If this week's batch already exists: retries it when failed, or drafts an
 * EXTRA batch dated today (409 only while generating, while items are still
 * awaiting review, or when today's extra batch already exists).
 */
async function runNow(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.body;
  if (!brandId) return res.status(400).json({ error: "brandId is required" });
  // Optional date range: draft 1 (default) to 4 weeks of posts in one batch.
  const weeksRaw = Number(req.body.weeks);
  const weeks = Number.isInteger(weeksRaw) && weeksRaw >= 1 && weeksRaw <= 4 ? weeksRaw : 1;

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const settings = { ...(await loadSettings(brandId)), weeks };
    if (!settings.exists || (!settings.enabled && !req.body.firstRun)) {
      return res.status(409).json({ error: "Turn autopilot on first" });
    }
    const readiness = await computeReadiness(userId, brandId, settings);
    if (!readiness.ready) {
      return res.status(409).json({
        error: "not_ready",
        message: readiness.missing.map((m) => m.label).join(" "),
        missing: readiness.missing,
      });
    }

    let batch = await processBrandWeeklyBatch({ ...brand, user_id: userId }, settings);
    if (!batch) {
      // This week's batch already exists. Decide honestly what to do:
      // generating → wait; failed → retry IT; ready + pending → finish review
      // first (a newer batch would hide those items); otherwise draft an EXTRA
      // batch dated today so mid-week posts/ads never wait until next Monday.
      const { rows: existingRows } = await db.query(
        `SELECT * FROM autopilot_batches
          WHERE brand_id = $1
          ORDER BY week_start DESC, created_at DESC
          LIMIT 1`,
        [brandId]
      );
      const existing = existingRows[0];
      if (existing && existing.status === "generating") {
        return res.status(409).json({
          error: "Echo is already drafting a batch right now — give it a minute.",
        });
      }
      if (existing && existing.status === "failed") {
        // Retry the failed batch in place (atomic re-claim; items wiped first).
        const reclaimed = await db.query(
          `UPDATE autopilot_batches SET status = 'generating', error = NULL
            WHERE batch_id = $1 AND status = 'failed'
            RETURNING *`,
          [existing.batch_id]
        );
        if (reclaimed.rows.length === 0) {
          return res.status(409).json({ error: "This batch was already retried — reload." });
        }
        await db.query("DELETE FROM autopilot_batch_items WHERE batch_id = $1", [
          existing.batch_id,
        ]);
        await module.exports.generateBatchForBrand(
          reclaimed.rows[0],
          { ...brand, user_id: userId },
          settings
        );
        batch = reclaimed.rows[0];
      } else {
        if (existing) {
          const pend = await db.query(
            `SELECT COUNT(*)::int AS n FROM autopilot_batch_items
              WHERE batch_id = $1 AND status = 'pending'`,
            [existing.batch_id]
          );
          if (pend.rows[0].n > 0) {
            return res.status(409).json({
              error:
                "You still have items awaiting your OK below. Approve or decline them first, then draft a fresh batch.",
            });
          }
        }
        const today = new Date().toISOString().slice(0, 10);
        batch = await processBrandWeeklyBatch(
          { ...brand, user_id: userId },
          settings,
          new Date(),
          today
        );
      }
    }
    if (!batch) {
      return res.status(409).json({
        error: "You've already drafted a batch today — review it below, or draft again tomorrow.",
      });
    }
    const fresh = await db.query("SELECT * FROM autopilot_batches WHERE batch_id = $1", [
      batch.batch_id,
    ]);
    return res.status(201).json(await batchState(fresh.rows[0]));
  } catch (err) {
    console.error("Autopilot run-now error:", err.message);
    return sendAiError(res, err, "Failed to draft this week's batch");
  }
}

// --- batch review ------------------------------------------------------------

/** GET /api/autopilot/batch?brandId= — the latest batch with its items. */
async function getCurrentBatch(req, res) {
  const userId = req.user.userId;
  const brandId = req.query.brandId;
  if (!brandId) return res.status(400).json({ error: "brandId is required" });
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { rows } = await db.query(
      `SELECT * FROM autopilot_batches
        WHERE brand_id = $1
        ORDER BY week_start DESC, created_at DESC
        LIMIT 1`,
      [brandId]
    );
    if (rows.length === 0) return res.json({ batch: null });
    return res.json({ batch: await batchState(rows[0]) });
  } catch (err) {
    console.error("Autopilot get batch error:", err.message);
    return res.status(500).json({ error: "Failed to load the batch" });
  }
}

/**
 * POST /api/autopilot/items/:itemId/approve
 * Posts: atomically flips pending→approved and schedules through social_posts.
 * Ads: re-checks EVERY spend limit with fresh numbers, then launches the
 * Facebook campaign — blocked limits return an honest 409, nothing launches.
 */
async function approveItem(req, res) {
  const userId = req.user.userId;
  const { itemId } = req.params;

  try {
    const item = await getOwnedItem(userId, itemId);
    if (!item) return res.status(404).json({ error: "Item not found" });

    if (item.item_type === "post") {
      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query(
          `UPDATE autopilot_batch_items SET status = 'approved'
            WHERE item_id = $1 AND status = 'pending'
            RETURNING *`,
          [itemId]
        );
        if (claimed.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "This item was already handled" });
        }
        const row = claimed.rows[0];
        const scheduledTime =
          row.scheduled_time && new Date(row.scheduled_time).getTime() > Date.now()
            ? row.scheduled_time
            : new Date(Date.now() + 10 * 60 * 1000);
        const inserted = await client.query(
          `INSERT INTO social_posts (brand_id, platform, post_content, image_url, video_url, scheduled_time, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
           RETURNING post_id, scheduled_time`,
          [item.brand_id, row.platform, row.post_content, row.image_url, row.video_url, scheduledTime]
        );
        await client.query(
          "UPDATE autopilot_batch_items SET posted_post_id = $1 WHERE item_id = $2",
          [inserted.rows[0].post_id, itemId]
        );
        await client.query("COMMIT");
        recordSignal({
          brandId: item.brand_id,
          userId,
          source: "autopilot",
          itemType: "post",
          platform: row.platform,
          action: "approve",
          content: row.post_content,
        });
        return res.json({
          ...itemView({ ...row, status: "approved", posted_post_id: inserted.rows[0].post_id }),
          scheduledTime: inserted.rows[0].scheduled_time,
        });
      } catch (e) {
        try {
          await client.query("ROLLBACK");
        } catch {}
        throw e;
      } finally {
        client.release();
      }
    }

    // --- ad approval: hard spend limits first, always, with fresh numbers ---
    // (postItemNow handles the instant-publish path for posts; ads never
    // publish instantly — they always go through the spend-limit launch below.)
    const settings = await loadSettings(item.brand_id);
    const dailyBudget =
      req.body?.dailyBudget != null ? Number(req.body.dailyBudget) : Number(item.ad_daily_budget);
    if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) {
      return res.status(400).json({
        error: "This ad has no daily budget. Set a budget (or spending limits) first.",
      });
    }
    const spend = await getBrandSpend(item.brand_id);
    const verdict = evaluateAdSpend({
      caps: capsOf(settings),
      ...spend,
      proposedDailyBudget: dailyBudget,
      label: item.ad_headline ? `"${item.ad_headline}"` : "this test ad",
    });
    if (!verdict.allowed) {
      return res.status(409).json({ error: "spend_limit", message: verdict.reason });
    }

    const brand = await getOwnedBrand(userId, item.brand_id);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        `UPDATE autopilot_batch_items SET status = 'approved'
          WHERE item_id = $1 AND status = 'pending'
          RETURNING *`,
        [itemId]
      );
      if (claimed.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "This item was already handled" });
      }

      const launched = await launchFacebookCampaign({
        userId,
        brand,
        name: `${brand.brand_name} - Autopilot test: ${item.ad_headline || "ad"}`,
        goal: "leads",
        budget: dailyBudget,
        creativeOverride: {
          headline: item.ad_headline || brand.brand_name,
          primaryText: item.post_content,
        },
      });

      await client.query(
        "UPDATE autopilot_batch_items SET campaign_id = $1, ad_daily_budget = $2 WHERE item_id = $3",
        [launched.campaignId, dailyBudget, itemId]
      );
      await client.query("COMMIT");
      recordSignal({
        brandId: item.brand_id,
        userId,
        source: "autopilot",
        itemType: "ad",
        platform: "facebook",
        action: "approve",
        content: item.post_content,
      });
      return res.json({
        ...itemView({
          ...claimed.rows[0],
          status: "approved",
          campaign_id: launched.campaignId,
          ad_daily_budget: dailyBudget,
        }),
        launch: launched,
        spendCheck: verdict.reason,
      });
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Autopilot approve error:", err.message);
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: "Failed to approve this item" });
  }
}

/**
 * POST /api/autopilot/items/:itemId/post-now
 * Approves a pending POST item and publishes it to the platform right now
 * instead of waiting for its scheduled slot. The approval claim is the same
 * atomic pending→approved flip as approveItem; the publish uses the
 * scheduler's own claim pattern (scheduled→publishing, status-guarded) so an
 * overlapping cron tick can never double-post. Ads are excluded — they always
 * go through the spend-limit launch path.
 */
async function postItemNow(req, res) {
  const userId = req.user.userId;
  const { itemId } = req.params;
  try {
    const item = await getOwnedItem(userId, itemId);
    if (!item) return res.status(404).json({ error: "Item not found" });
    if (item.item_type !== "post") {
      return res
        .status(400)
        .json({ error: "Only social posts can be posted instantly" });
    }
    const brand = await getOwnedBrand(userId, item.brand_id);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    if (brand.is_demo) {
      return res
        .status(400)
        .json({ error: "Demo businesses can't publish to real platforms" });
    }

    let row;
    let postId;
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        `UPDATE autopilot_batch_items SET status = 'approved'
          WHERE item_id = $1 AND status = 'pending'
          RETURNING *`,
        [itemId]
      );
      if (claimed.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "This item was already handled" });
      }
      row = claimed.rows[0];
      const inserted = await client.query(
        `INSERT INTO social_posts (brand_id, platform, post_content, image_url, video_url, scheduled_time, status)
         VALUES ($1, $2, $3, $4, $5, NOW(), 'scheduled')
         RETURNING post_id`,
        [item.brand_id, row.platform, row.post_content, row.image_url, row.video_url]
      );
      postId = inserted.rows[0].post_id;
      await client.query(
        "UPDATE autopilot_batch_items SET posted_post_id = $1 WHERE item_id = $2",
        [postId, itemId]
      );
      await client.query("COMMIT");
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw e;
    } finally {
      client.release();
    }

    recordSignal({
      brandId: item.brand_id,
      userId,
      source: "autopilot",
      itemType: "post",
      platform: row.platform,
      action: "approve",
      instruction: "posted instantly",
      content: row.post_content,
    });

    // Publish right now: claim the freshly created row exactly like the
    // every-minute sweep does, so whichever side wins the claim publishes and
    // the other side sees zero rows (no double-post possible).
    const claim = await db.query(
      `UPDATE social_posts SET status = 'publishing'
        WHERE post_id = $1 AND status = 'scheduled'
        RETURNING post_id, brand_id, platform, post_content, image_url, video_url, publish_attempts`,
      [postId]
    );
    if (claim.rows.length === 0) {
      // The every-minute sweep beat us to the claim. Zero rows does NOT mean
      // success — the sweep may have already published OR failed the post.
      // Re-read the row and report its real status, never a fabricated one.
      const check = await db.query(
        "SELECT status, engagement_metrics FROM social_posts WHERE post_id = $1",
        [postId]
      );
      const status = check.rows[0]?.status;
      if (status === "failed") {
        const reason =
          check.rows[0]?.engagement_metrics?.error || "The platform rejected the post.";
        return res.status(502).json({
          error: `The post was approved but publishing failed: ${reason} You can retry it from the Social Media calendar.`,
        });
      }
      return res.json({
        ...itemView({ ...row, status: "approved", posted_post_id: postId }),
        postedNow: status === "published",
        publishing: status === "publishing",
      });
    }
    try {
      await publishStoredPost(claim.rows[0]);
    } catch (err) {
      // Honest failure: mark the post failed (status-guarded) and tell the
      // owner exactly what happened. The item stays approved; the post can be
      // rescheduled from the Social Media calendar.
      await db.query(
        `UPDATE social_posts
         SET status = 'failed', engagement_metrics = $1,
             publish_attempts = publish_attempts + 1
         WHERE post_id = $2 AND status = 'publishing'`,
        [JSON.stringify({ error: err.message }), postId]
      );
      return res.status(502).json({
        error: `The post was approved but publishing failed: ${err.message} You can retry it from the Social Media calendar.`,
      });
    }
    return res.json({
      ...itemView({ ...row, status: "approved", posted_post_id: postId }),
      postedNow: true,
    });
  } catch (err) {
    console.error("Autopilot post-now error:", err.message);
    return res.status(500).json({ error: "Failed to post this item" });
  }
}

/**
 * POST /api/autopilot/instant-post
 * Body: { brandId, platform?, topic? }
 * Drafts ONE brand-new post and adds it to the latest batch as a pending item
 * scheduled for right now — an EXTRA post on top of the week's fixed slots, so
 * a spur-of-the-moment post never consumes a scheduled one. The owner still
 * reviews it (pending) and fires it with "Post instantly".
 */
async function createInstantPost(req, res) {
  const userId = req.user.userId;
  const { brandId, platform: requestedPlatform, topic } = req.body || {};
  if (!brandId) return res.status(400).json({ error: "brandId is required" });
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    if (brand.is_demo) {
      return res
        .status(400)
        .json({ error: "Demo businesses can't publish to real platforms" });
    }

    const usable = await getUsablePlatforms(brandId);
    if (usable.length === 0) {
      return res.status(409).json({
        error:
          "No connected social account to post to — connect one under Social Media first.",
      });
    }
    let platform = usable[0];
    if (requestedPlatform) {
      if (!usable.includes(requestedPlatform)) {
        return res
          .status(400)
          .json({ error: `No connected ${requestedPlatform} account for this business` });
      }
      platform = requestedPlatform;
    }

    // Latest batch = where the item lives so it shows in the review queue.
    // No batch yet (brand-new autopilot) → create today's, empty and ready.
    let batchRow;
    const latest = await db.query(
      `SELECT * FROM autopilot_batches
        WHERE brand_id = $1
        ORDER BY week_start DESC, created_at DESC
        LIMIT 1`,
      [brandId]
    );
    if (latest.rows.length > 0 && latest.rows[0].status === "ready") {
      batchRow = latest.rows[0];
    } else {
      const weekStart = weekStartOf(new Date());
      const created = await db.query(
        `INSERT INTO autopilot_batches (brand_id, user_id, week_start, status)
         VALUES ($1, $2, $3, 'ready')
         ON CONFLICT (brand_id, week_start)
         DO UPDATE SET status = autopilot_batches.status
         RETURNING *`,
        [brandId, userId, weekStart]
      );
      batchRow = created.rows[0];
      if (batchRow.status !== "ready") {
        return res.status(409).json({
          error:
            "This week's batch is still being drafted — try again in a minute.",
        });
      }
    }

    // Context so the new post doesn't repeat what's already queued this week.
    const recent = await db.query(
      `SELECT post_content FROM autopilot_batch_items
        WHERE batch_id = $1 AND item_type = 'post' AND status <> 'declined'
        ORDER BY position DESC
        LIMIT 10`,
      [batchRow.batch_id]
    );
    // Forge Creative Director: instant posts get a strategy brief too, themed
    // to the brand-local time of day right now. Fail-open ([] → null brief).
    const tzForBrief = await getBrandTimezone(brandId);
    const instantBriefs = await forgeDirector.planBriefs(brandId, [
      forgeDirector.currentSlotLabel(tzForBrief),
    ]);
    const forgeBrief = instantBriefs[0] || null;
    const draft = await draftInstantPost(
      brand,
      platform,
      recent.rows.map((r) => r.post_content),
      typeof topic === "string" ? topic.trim().slice(0, 300) : "",
      forgeBrief
    );

    // Position allocation locks the batch row (same as decline replacements)
    // so two simultaneous instant posts can't both claim MAX(position)+1.
    let inserted;
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        "SELECT status FROM autopilot_batches WHERE batch_id = $1 FOR UPDATE",
        [batchRow.batch_id]
      );
      // Re-check under the lock: a concurrent flip (regenerating, failed)
      // must not sneak a new pending item into a non-ready batch.
      if (locked.rows[0]?.status !== "ready") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error:
            "This week's batch is busy right now — try again in a minute.",
        });
      }
      inserted = await client.query(
        `INSERT INTO autopilot_batch_items
           (batch_id, position, item_type, platform, post_content,
            scheduled_time, rationale)
         SELECT $1, COALESCE(MAX(position), 0) + 1, 'post', $2, $3, NOW(), $4
           FROM autopilot_batch_items WHERE batch_id = $1
         RETURNING *`,
        [
          batchRow.batch_id,
          platform,
          composePostContent(draft),
          "Instant post you asked Echo to draft — extra, on top of this week's scheduled slots.",
        ]
      );
      await client.query("COMMIT");
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw e;
    } finally {
      client.release();
    }

    // Best-effort: tie the instant post to its Forge brief so its image (if
    // rendered later) gets the same art direction and its engagement feeds
    // performance learning.
    if (forgeBrief && forgeBrief.brief_id) {
      await forgeDirector.linkBriefToItem(forgeBrief.brief_id, inserted.rows[0].item_id);
    }

    // Hybrid Creative Engine: give the instant post a creative mode too, so
    // an on-demand render uses the owner's real photo when the settings and
    // photo library call for it. Best-effort — a failure here just leaves the
    // item as a pure AI concept.
    try {
      const cSettings = await loadSettings(brandId);
      const refs = await leastUsedReferences(brandId, 5);
      const [mode] = creativeModes.decideModes({
        preference: cSettings.contentPreference,
        industry: brand.industry,
        assetCount: refs.length,
        itemCount: 1,
        permissions: cSettings.editingPermissions,
      });
      const ref = mode === "ai" ? null : refs[0];
      const updated = await db.query(
        "UPDATE autopilot_batch_items SET creative_mode = $1, source_image_id = $2 WHERE item_id = $3 RETURNING *",
        [mode || "ai", ref ? ref.image_id : null, inserted.rows[0].item_id]
      );
      if (updated.rows.length) inserted = updated;
    } catch (e) {
      // "Only my media" with an empty photo library must not quietly fake an
      // AI image — the drafted copy stays for review, but the owner is told.
      if (e.noAssets) {
        await db.query(
          "UPDATE autopilot_batch_items SET creative_mode = 'ai' WHERE item_id = $1",
          [inserted.rows[0].item_id]
        );
        inserted.rows[0].creative_mode = "ai";
        return res.status(201).json({
          item: itemView(inserted.rows[0]),
          notice:
            "Instant post drafted — but your creative setting is \u201cOnly use my uploaded media\u201d and this brand has no photos in the Vision reference library, so any graphic would have to be AI-made. Upload real photos in Vision \u2192 Reference Library.",
        });
      }
      console.error("Instant post creative mode failed:", e.message);
      await db.query(
        "UPDATE autopilot_batch_items SET creative_mode = 'ai' WHERE item_id = $1",
        [inserted.rows[0].item_id]
      );
      inserted.rows[0].creative_mode = "ai";
    }

    return res.status(201).json({
      item: itemView(inserted.rows[0]),
      notice:
        "Instant post drafted — review it below, then hit Post instantly to publish.",
    });
  } catch (err) {
    console.error("Autopilot instant post error:", err.message);
    return sendAiError(res, err, "Failed to draft an instant post");
  }
}

/**
 * POST /api/autopilot/items/:itemId/decline
 * Declining a POST doesn't leave the time slot empty: Echo immediately drafts
 * a completely different replacement post for the same slot (pending, so the
 * owner still reviews it). Replacement is best-effort — the decline itself
 * always succeeds, and a failed redraft is reported honestly, never faked.
 */
async function declineItem(req, res) {
  const userId = req.user.userId;
  const { itemId } = req.params;
  try {
    const item = await getOwnedItem(userId, itemId);
    if (!item) return res.status(404).json({ error: "Item not found" });
    const updated = await db.query(
      `UPDATE autopilot_batch_items SET status = 'declined'
        WHERE item_id = $1 AND status = 'pending'
        RETURNING *`,
      [itemId]
    );
    if (updated.rows.length === 0) {
      return res.status(409).json({ error: "This item was already handled" });
    }
    recordSignal({
      brandId: item.brand_id,
      userId,
      source: "autopilot",
      itemType: item.item_type,
      platform: item.platform,
      action: "decline",
      content: item.post_content,
    });

    let replacement = null;
    let replacementError = null;
    if (item.item_type === "post") {
      try {
        const brand = await getOwnedBrand(userId, item.brand_id);
        if (brand) {
          const redraft = await reviseVoiceDraft(
            brand,
            item,
            "The owner DECLINED this draft entirely. Write a COMPLETELY DIFFERENT post — new angle, new topic, same brand voice — to fill the same time slot. Do not reuse the declined post's hook, wording, or theme."
          );
          // Position allocation locks the batch row so two simultaneous
          // declines can't both claim MAX(position)+1.
          const client = await db.pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("SELECT 1 FROM autopilot_batches WHERE batch_id = $1 FOR UPDATE", [
              item.batch_id,
            ]);
            const inserted = await client.query(
              `INSERT INTO autopilot_batch_items
                 (batch_id, position, item_type, platform, post_content, visual_idea,
                  scheduled_time, rationale)
               SELECT $1, COALESCE(MAX(position), 0) + 1, 'post', $2, $3, $4, $5, $6
                 FROM autopilot_batch_items WHERE batch_id = $1
               RETURNING *`,
              [
                item.batch_id,
                item.platform,
                composePostContent(redraft),
                item.visual_idea,
                item.scheduled_time,
                "Fresh replacement for the post you declined — same time slot, different angle.",
              ]
            );
            await client.query("COMMIT");
            replacement = itemView(inserted.rows[0]);
          } catch (e) {
            try {
              await client.query("ROLLBACK");
            } catch {}
            throw e;
          } finally {
            client.release();
          }
        }
      } catch (e) {
        console.error("Autopilot replacement draft failed:", e.message);
        replacementError =
          "Declined. Echo couldn't draft a replacement post right now — hit Draft now later or add one from Social Media.";
      }
    }

    return res.json({ ...itemView(updated.rows[0]), replacement, replacementError });
  } catch (err) {
    console.error("Autopilot decline error:", err.message);
    return res.status(500).json({ error: "Failed to decline this item" });
  }
}

/**
 * DELETE /api/autopilot/items/:itemId
 * Removes a draft from the batch entirely (owner's tidy-up). Only drafts that
 * never went anywhere are deletable: pending or declined. Approved items are
 * scheduled/launched work — those must be handled through their own flows.
 * Unlike decline, deleting never drafts a replacement.
 */
async function deleteItem(req, res) {
  const userId = req.user.userId;
  const { itemId } = req.params;
  try {
    const item = await getOwnedItem(userId, itemId);
    if (!item) return res.status(404).json({ error: "Item not found" });
    const deleted = await db.query(
      `DELETE FROM autopilot_batch_items
        WHERE item_id = $1 AND status IN ('pending', 'declined')
        RETURNING item_id`,
      [itemId]
    );
    if (deleted.rows.length === 0) {
      return res.status(409).json({
        error: "Only pending or declined drafts can be deleted.",
      });
    }
    return res.json({ deleted: true, itemId });
  } catch (err) {
    console.error("Autopilot delete item error:", err.message);
    return res.status(500).json({ error: "Failed to delete this item" });
  }
}

/**
 * POST /api/autopilot/items/:itemId/revise
 * Body: { instruction } — the owner's spoken change request.
 */
async function reviseItem(req, res) {
  const userId = req.user.userId;
  const { itemId } = req.params;
  const instruction = String(req.body.instruction || "").trim();
  if (!instruction) return res.status(400).json({ error: "instruction is required" });

  try {
    const item = await getOwnedItem(userId, itemId);
    if (!item) return res.status(404).json({ error: "Item not found" });
    if (item.status !== "pending") {
      return res.status(409).json({ error: "This item is no longer editable" });
    }
    const brand = await getOwnedBrand(userId, item.brand_id);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    if (item.item_type === "post") {
      const revised = await reviseVoiceDraft(brand, item, instruction.slice(0, 500));
      const updated = await db.query(
        `UPDATE autopilot_batch_items SET post_content = $1
          WHERE item_id = $2 AND status = 'pending'
          RETURNING *`,
        [composePostContent(revised), itemId]
      );
      if (updated.rows.length === 0) {
        return res.status(409).json({ error: "This item is no longer editable" });
      }
      recordSignal({
        brandId: item.brand_id,
        userId,
        source: "autopilot",
        itemType: "post",
        platform: item.platform,
        action: "revise",
        instruction,
        content: item.post_content,
      });
      return res.json(itemView(updated.rows[0]));
    }

    const revised = await reviseAdDraft(brand, item, instruction.slice(0, 500));
    const updated = await db.query(
      `UPDATE autopilot_batch_items SET post_content = $1, ad_headline = $2
        WHERE item_id = $3 AND status = 'pending'
        RETURNING *`,
      [revised.primaryText, revised.headline, itemId]
    );
    if (updated.rows.length === 0) {
      return res.status(409).json({ error: "This item is no longer editable" });
    }
    recordSignal({
      brandId: item.brand_id,
      userId,
      source: "autopilot",
      itemType: "ad",
      platform: "facebook",
      action: "revise",
      instruction,
      content: item.post_content,
    });
    return res.json(itemView(updated.rows[0]));
  } catch (err) {
    console.error("Autopilot revise error:", err.message);
    return sendAiError(res, err, "Failed to revise this item");
  }
}

/** POST /api/autopilot/items/:itemId/image — (re)render the item's graphic. */
async function generateItemImage(req, res) {
  const userId = req.user.userId;
  const { itemId } = req.params;
  try {
    const item = await getOwnedItem(userId, itemId);
    if (!item) return res.status(404).json({ error: "Item not found" });
    if (item.status !== "pending") {
      return res.status(409).json({ error: "This item is no longer editable" });
    }
    const brand = await getOwnedBrand(userId, item.brand_id);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    await renderItemImage(brand, item);
    const fresh = await db.query("SELECT * FROM autopilot_batch_items WHERE item_id = $1", [
      itemId,
    ]);
    return res.json(itemView(fresh.rows[0]));
  } catch (err) {
    console.error("Autopilot image error:", err.message);
    return sendAiError(res, err, "Failed to create the visual");
  }
}

/**
 * PUT /api/autopilot/items/:itemId/media
 * Body: { imageUrl? , videoUrl? } — attach an owner-uploaded photo/video (from
 * POST /api/social/media) to a pending batch item, or clear both (empty body).
 * A photo and a video are mutually exclusive; videos publish on Facebook only.
 */
async function setItemMedia(req, res) {
  const userId = req.user.userId;
  const { itemId } = req.params;
  const { imageUrl, videoUrl } = req.body || {};

  function validLocalMediaPath(value, prefixes) {
    return (
      typeof value === "string" &&
      !value.includes("..") &&
      prefixes.some((p) => value.startsWith(p))
    );
  }

  try {
    const item = await getOwnedItem(userId, itemId);
    if (!item) return res.status(404).json({ error: "Item not found" });
    if (item.item_type !== "post") {
      return res.status(400).json({ error: "Only posts can carry media" });
    }
    if (item.status !== "pending") {
      return res.status(409).json({ error: "This item is no longer editable" });
    }
    if (imageUrl && videoUrl) {
      return res.status(400).json({ error: "Attach a photo or a video, not both" });
    }
    let nextImage = null;
    let nextVideo = null;
    if (imageUrl != null && imageUrl !== "") {
      if (!validLocalMediaPath(imageUrl, ["/uploads/images/", "/uploads/media/"])) {
        return res.status(400).json({
          error:
            "imageUrl must be a stored image path (/uploads/images/... or /uploads/media/...)",
        });
      }
      nextImage = imageUrl;
    }
    if (videoUrl != null && videoUrl !== "") {
      if (!validLocalMediaPath(videoUrl, ["/uploads/media/"])) {
        return res.status(400).json({
          error: "videoUrl must be an uploaded video path (/uploads/media/...)",
        });
      }
      if (item.platform !== "facebook") {
        return res.status(400).json({
          error: "Video posts are currently supported on Facebook only.",
        });
      }
      nextVideo = videoUrl;
    }
    const updated = await db.query(
      `UPDATE autopilot_batch_items SET image_url = $1, video_url = $2
        WHERE item_id = $3 AND status = 'pending'
        RETURNING *`,
      [nextImage, nextVideo, itemId]
    );
    if (updated.rows.length === 0) {
      return res.status(409).json({ error: "This item is no longer editable" });
    }
    return res.json(itemView(updated.rows[0]));
  } catch (err) {
    console.error("Autopilot item media error:", err.message);
    return res.status(500).json({ error: "Failed to attach media to this item" });
  }
}

/**
 * POST /api/autopilot/batches/:batchId/complete
 * Body: { cancelled? } — close out a review session. Pending items stay
 * pending (they are drafts; nothing publishes without an approve).
 */
async function completeBatch(req, res) {
  const userId = req.user.userId;
  const { batchId } = req.params;
  const cancelled = req.body.cancelled === true;
  try {
    const r = await db.query(
      `SELECT ab.* FROM autopilot_batches ab
        JOIN brands b ON b.brand_id = ab.brand_id
       WHERE ab.batch_id = $1 AND b.user_id = $2`,
      [batchId, userId]
    );
    const batch = r.rows[0];
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    if (["completed", "cancelled"].includes(batch.status)) {
      return res.json(await batchState(batch));
    }
    const updated = await db.query(
      `UPDATE autopilot_batches SET status = $1
        WHERE batch_id = $2 AND status IN ('ready', 'generating')
        RETURNING *`,
      [cancelled ? "cancelled" : "completed", batchId]
    );
    if (updated.rows.length === 0) {
      const fresh = await db.query("SELECT * FROM autopilot_batches WHERE batch_id = $1", [batchId]);
      return res.json(await batchState(fresh.rows[0]));
    }
    return res.json(await batchState(updated.rows[0]));
  } catch (err) {
    console.error("Autopilot complete error:", err.message);
    return res.status(500).json({ error: "Failed to close the batch" });
  }
}

/**
 * GET /api/autopilot/learnings?brandId=
 * What Echo has learned about this brand's taste (active learnings, newest
 * first) — shown in the Autopilot section so the owner can audit/forget them.
 */
async function listLearnings(req, res) {
  const userId = req.user.userId;
  const brandId = req.query.brandId;
  if (!brandId) return res.status(400).json({ error: "brandId is required" });

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const rows = await db.query(
      `SELECT learning_id, insight, category, evidence_count, updated_at
         FROM echo_learnings
        WHERE brand_id = $1 AND active = TRUE
        ORDER BY updated_at DESC
        LIMIT 50`,
      [brandId]
    );
    return res.json({ learnings: rows.rows });
  } catch (err) {
    console.error("Autopilot list learnings error:", err.message);
    return res.status(500).json({ error: "Failed to load learnings" });
  }
}

/**
 * POST /api/autopilot/learnings/:learningId/forget
 * Owner tells Echo a learning is wrong — deactivate it (ownership enforced
 * via the brands join; 404 on a foreign row).
 */
async function forgetLearning(req, res) {
  const userId = req.user.userId;
  const { learningId } = req.params;

  try {
    const updated = await db.query(
      `UPDATE echo_learnings l SET active = FALSE, updated_at = NOW()
         FROM brands b
        WHERE l.learning_id = $1 AND l.active = TRUE
          AND b.brand_id = l.brand_id AND b.user_id = $2
        RETURNING l.learning_id`,
      [learningId, userId]
    );
    if (updated.rows.length === 0) {
      return res.status(404).json({ error: "Learning not found" });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("Autopilot forget learning error:", err.message);
    return res.status(500).json({ error: "Failed to forget that" });
  }
}

/**
 * GET /api/autopilot/questions?brandId=
 * Echo's open questions for this brand (pending or asked), oldest first.
 */
async function listOpenQuestions(req, res) {
  const userId = req.user.userId;
  const brandId = req.query.brandId;
  if (!brandId) return res.status(400).json({ error: "brandId is required" });

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const rows = await db.query(
      `SELECT question_id, question, context, status, created_at
         FROM echo_open_questions
        WHERE brand_id = $1 AND status IN ('pending', 'asked')
        ORDER BY created_at
        LIMIT 10`,
      [brandId]
    );
    return res.json({ questions: rows.rows });
  } catch (err) {
    console.error("Autopilot list questions error:", err.message);
    return res.status(500).json({ error: "Failed to load questions" });
  }
}

/**
 * POST /api/autopilot/questions/:questionId/answer  Body: { answer }
 * The owner's answer becomes a permanent owner_answer learning (highest-trust
 * category) and the question closes. Atomic claim on the status flip so a
 * double-submit can't create two learnings.
 */
async function answerOpenQuestion(req, res) {
  const userId = req.user.userId;
  const { questionId } = req.params;
  const answer = String(req.body.answer || "").trim().slice(0, 1000);
  if (!answer) return res.status(400).json({ error: "answer is required" });

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const claimed = await client.query(
      `UPDATE echo_open_questions q
          SET status = 'answered', answer = $3, answered_at = NOW()
         FROM brands b
        WHERE q.question_id = $1 AND q.status IN ('pending', 'asked')
          AND b.brand_id = q.brand_id AND b.user_id = $2
        RETURNING q.brand_id, q.user_id, q.question`,
      [questionId, userId, answer]
    );
    if (claimed.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Question not found or already handled" });
    }
    const q = claimed.rows[0];
    const insight = `${q.question} — Owner's answer: ${answer}`.slice(0, 500);
    await client.query(
      `INSERT INTO echo_learnings (brand_id, user_id, insight, category)
       VALUES ($1, $2, $3, 'owner_answer')
       ON CONFLICT ON CONSTRAINT uq_echo_learnings_brand_insight
       DO UPDATE SET active = TRUE, evidence_count = echo_learnings.evidence_count + 1,
                     updated_at = NOW()`,
      [q.brand_id, q.user_id, insight]
    );
    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("Autopilot answer question error:", err.message);
    return res.status(500).json({ error: "Failed to save your answer" });
  } finally {
    client.release();
  }
}

/**
 * POST /api/autopilot/questions/:questionId/dismiss
 * Owner doesn't want to answer — close the question without learning anything.
 */
async function dismissOpenQuestion(req, res) {
  const userId = req.user.userId;
  const { questionId } = req.params;

  try {
    const updated = await db.query(
      `UPDATE echo_open_questions q SET status = 'dismissed'
         FROM brands b
        WHERE q.question_id = $1 AND q.status IN ('pending', 'asked')
          AND b.brand_id = q.brand_id AND b.user_id = $2
        RETURNING q.question_id`,
      [questionId, userId]
    );
    if (updated.rows.length === 0) {
      return res.status(404).json({ error: "Question not found or already handled" });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("Autopilot dismiss question error:", err.message);
    return res.status(500).json({ error: "Failed to dismiss the question" });
  }
}

module.exports = {
  weekStartOf,
  computeReadiness,
  loadSettings,
  getSettings,
  updateSettings,
  getReadiness,
  runNow,
  getCurrentBatch,
  approveItem,
  postItemNow,
  createInstantPost,
  autopilotSlotTimes,
  declineItem,
  deleteItem,
  reviseItem,
  generateItemImage,
  setItemMedia,
  completeBatch,
  listLearnings,
  forgetLearning,
  listOpenQuestions,
  answerOpenQuestion,
  dismissOpenQuestion,
  generateBatchForBrand,
  processBrandWeeklyBatch,
  runWeeklyAutopilot,
  // Hybrid Creative Engine test seams.
  _leastUsedReferencesForTests: leastUsedReferences,
  _loadVisionReferenceForTests: loadVisionReference,
};
