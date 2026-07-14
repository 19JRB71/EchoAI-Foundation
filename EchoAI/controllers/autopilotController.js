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
const { generateWeeklyBatch, reviseAdDraft } = require("../prompts/autopilotPrompt");
const { reviseVoiceDraft } = require("../prompts/voiceContentPrompt");
const { composePostContent } = require("../prompts/contentCalendarPrompt");
const { buildImagePrompt } = require("../prompts/imagePromptBuilder");
const { renderFromPrompt, persistImage } = require("./imageController");
const {
  PLATFORM_IMAGE_PURPOSE,
  proposeScheduledTime,
  getUsablePlatforms,
  gatherIntelligence,
  getBrandTimezone,
} = require("./voiceContentController");
const { launchFacebookCampaign } = require("./campaignController");
const { evaluateAdSpend, suggestDailyBudget, getBrandSpend } = require("../utils/spendLimits");
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
      adsPerWeek: 1,
      dailySpendCap: null,
      weeklySpendCap: null,
      monthlySpendCap: null,
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
  };
}

async function batchState(batch) {
  const items = await db.query(
    "SELECT * FROM autopilot_batch_items WHERE batch_id = $1 ORDER BY position",
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
    const adsPerWeek =
      req.body.adsPerWeek != null ? Number(req.body.adsPerWeek) : current.adsPerWeek;

    if (!Number.isInteger(postsPerWeek) || postsPerWeek < 0 || postsPerWeek > 21) {
      return res.status(400).json({ error: "postsPerWeek must be a whole number from 0 to 21" });
    }
    if (!Number.isInteger(adsPerWeek) || adsPerWeek < 0 || adsPerWeek > 7) {
      return res.status(400).json({ error: "adsPerWeek must be a whole number from 0 to 7" });
    }
    if (enabled && postsPerWeek === 0 && adsPerWeek === 0) {
      return res.status(400).json({ error: "Autopilot needs at least one post or ad per week" });
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
          daily_spend_cap, weekly_spend_cap, monthly_spend_cap)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (brand_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         posts_per_week = EXCLUDED.posts_per_week,
         ads_per_week = EXCLUDED.ads_per_week,
         daily_spend_cap = EXCLUDED.daily_spend_cap,
         weekly_spend_cap = EXCLUDED.weekly_spend_cap,
         monthly_spend_cap = EXCLUDED.monthly_spend_cap`,
      [brandId, enabled, postsPerWeek, adsPerWeek, dailySpendCap, weeklySpendCap, monthlySpendCap]
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

/** Best-effort on-brand image for one batch item; failures leave it null. */
async function renderItemImage(brand, item) {
  const purpose = PLATFORM_IMAGE_PURPOSE[item.platform] || "facebook_ad";
  const description =
    (item.visual_idea && item.visual_idea.trim()) ||
    `An eye-catching marketing visual for: ${String(item.post_content).slice(0, 200)}`;
  const prompt = buildImagePrompt(brand, purpose, description);
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

    // Ads need a connected Facebook ad account; without one this week's batch
    // honestly contains no ads rather than drafts doomed to fail at launch.
    let adsPerWeek = settings.adsPerWeek;
    if (adsPerWeek > 0) {
      const fb = await db.query(
        `SELECT 1 FROM api_integrations
          WHERE user_id = $1 AND platform = 'facebook' AND connection_status = 'connected'`,
        [userId]
      );
      if (fb.rows.length === 0) adsPerWeek = 0;
    }

    if (settings.postsPerWeek === 0 && adsPerWeek === 0) {
      throw new Error(
        "Nothing can be drafted this week: no posts are configured and no Facebook ad account is connected."
      );
    }

    const intel = await gatherIntelligence(brand, platforms);
    brand._learningContext = await learningContextForBrand(brandId);
    const result = await generateWeeklyBatch(brand, intel, {
      postsPerWeek: settings.postsPerWeek,
      adsPerWeek,
    });

    // Suggested ad budget from CURRENT spend + the owner's hard limits.
    const spend = await getBrandSpend(brandId);
    const adBudget = suggestDailyBudget({ caps: capsOf(settings), ...spend });

    const timezone = await getBrandTimezone(brandId);
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      let position = 0;
      for (let i = 0; i < result.posts.length; i += 1) {
        const p = result.posts[i];
        position += 1;
        await client.query(
          `INSERT INTO autopilot_batch_items
             (batch_id, position, item_type, platform, post_content, visual_idea,
              scheduled_time, rationale)
           VALUES ($1, $2, 'post', $3, $4, $5, $6, $7)`,
          [
            batchId,
            position,
            p.platform,
            composePostContent(p),
            p.visualIdea,
            proposeScheduledTime(i, p.bestPostingTime, p.platform, timezone),
            p.rationale || null,
          ]
        );
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
          body: `Echo drafted ${result.posts.length} post(s)${result.ads.length ? ` and ${result.ads.length} test ad(s)` : ""} for ${brand.brand_name}. Review and approve when you're ready.`,
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
              s.daily_spend_cap, s.weekly_spend_cap, s.monthly_spend_cap
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

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const settings = await loadSettings(brandId);
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

/** POST /api/autopilot/items/:itemId/decline */
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
    return res.json(itemView(updated.rows[0]));
  } catch (err) {
    console.error("Autopilot decline error:", err.message);
    return res.status(500).json({ error: "Failed to decline this item" });
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
  declineItem,
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
};
