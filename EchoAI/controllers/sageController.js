/**
 * Sage — Industry Intelligence Agent controller.
 *
 * Sage studies each brand's industry around the clock with REAL live web search
 * and keeps a rolling brief + findings feed + competitor watch list so every
 * other agent (and the owner's morning briefing) always has the smartest, fully
 * cited strategy. Nothing here is faked: research goes through prompts/sagePrompt
 * (Anthropic web_search / web_fetch), AI/provider failures map to 502, and AI
 * output is validated before it is persisted.
 *
 * Exports split into two groups:
 *   - Engine functions (runDeepCycleForBrand / runUrgentScanForBrand /
 *     sageSnapshotForBrand / activeBrandsForSage) used by the scheduler and by
 *     other subsystems (briefing, agent feed).
 *   - Express handlers for /api/sage/*.
 */

const db = require("../config/db");
const { toJsonbParam } = require("../utils/jsonb");
const { US_STATES } = require("../utils/geoTargeting");
const {
  deepResearch,
  urgentScan,
  suggestCompetitors,
  refreshCompetitor,
  analyzeSubmission,
} = require("../prompts/sagePrompt");
const { enqueueOwnerVoiceEvent } = require("../utils/echoVoiceNotifications");
const pushController = require("./pushController");
const mobilePushController = require("./mobilePushController");

// --- ownership + error helpers ---------------------------------------------

/** Loads a brand (with its owner + industry) only if it belongs to the user. */
async function getOwnedBrand(userId, brandId) {
  const result = await db.query(
    `SELECT b.brand_id, b.brand_name, b.brand_personality, b.voice_description,
            b.target_audience, b.user_id, b.geo_targeting, u.industry, u.role
       FROM brands b
       JOIN users u ON u.user_id = b.user_id
      WHERE b.brand_id = $1 AND b.user_id = $2`,
    [brandId, userId],
  );
  return result.rows[0] || null;
}

/** Maps any thrown error to the right HTTP status (AI/provider failures → 502). */
function sendError(res, err, fallbackMsg) {
  if (err && (err.aiInvalid || (typeof err.status === "number" && err.status >= 400))) {
    return res.status(502).json({
      error:
        "Sage could not complete live research right now. Please try again shortly.",
    });
  }
  return res.status(500).json({ error: fallbackMsg });
}

// --- persistence helpers ----------------------------------------------------

/** Upsert the rolling per-brand industry profile. */
async function saveProfile(brandId, brief) {
  await db.query(
    `INSERT INTO sage_intelligence_profiles
       (brand_id, industry, summary, sections, marketing_insights, sources,
        last_refreshed_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, NOW(), NOW())
     ON CONFLICT (brand_id) DO UPDATE SET
       industry = EXCLUDED.industry,
       summary = EXCLUDED.summary,
       sections = EXCLUDED.sections,
       marketing_insights = EXCLUDED.marketing_insights,
       sources = EXCLUDED.sources,
       last_refreshed_at = NOW(),
       updated_at = NOW()`,
    [
      brandId,
      brief.industry || null,
      brief.summary || "",
      toJsonbParam(brief.sections || []),
      toJsonbParam(brief.marketing_insights || []),
      toJsonbParam(brief.sources || []),
    ],
  );
}

/** Upsert one finding into the rolling feed (dedup on signal_key). */
async function saveFeedItem(brandId, item) {
  await db.query(
    `INSERT INTO sage_intelligence_feed
       (brand_id, source_type, summary, why_it_matters, url, source_title,
        urgent, signal_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (brand_id, signal_key) DO UPDATE SET
       source_type = EXCLUDED.source_type,
       summary = EXCLUDED.summary,
       why_it_matters = EXCLUDED.why_it_matters,
       url = EXCLUDED.url,
       source_title = EXCLUDED.source_title,
       urgent = EXCLUDED.urgent,
       created_at = NOW()`,
    [
      brandId,
      item.source_type,
      item.summary,
      item.why_it_matters,
      item.url || null,
      item.source_title || null,
      Boolean(item.urgent),
      item.signal_key,
    ],
  );
}

/**
 * Atomically claim a research run for a brand+cycle. Returns true only for the
 * tick that inserted the row, so overlapping scheduler ticks can never double-run
 * the same brand. run_key buckets by cycle granularity (deep = hour, urgent = 30m).
 */
async function claimRun(brandId, cycleType, runKey) {
  const r = await db.query(
    `INSERT INTO sage_research_runs (brand_id, cycle_type, run_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (brand_id, cycle_type, run_key) DO NOTHING
     RETURNING run_id`,
    [brandId, cycleType, runKey],
  );
  return Boolean(r.rows[0]);
}

async function finishRun(brandId, cycleType, runKey, status) {
  try {
    await db.query(
      `UPDATE sage_research_runs SET status = $4
         WHERE brand_id = $1 AND cycle_type = $2 AND run_key = $3`,
      [brandId, cycleType, runKey, status],
    );
  } catch (_e) {
    /* best-effort */
  }
}

/**
 * Fan out a single urgent alert to the owner exactly once per (brand, signal,
 * day) via the dedup ledger. Voice + web/mobile push are best-effort.
 */
async function dispatchUrgentAlert(brand, item) {
  let claimed;
  try {
    const r = await db.query(
      `INSERT INTO sage_alert_log (brand_id, signal_key, alert_date)
       VALUES ($1, $2, CURRENT_DATE)
       ON CONFLICT (brand_id, signal_key, alert_date) DO NOTHING
       RETURNING alert_id`,
      [brand.brand_id, item.signal_key],
    );
    claimed = Boolean(r.rows[0]);
  } catch (_e) {
    claimed = false;
  }
  if (!claimed) return false;

  const title = "Sage: urgent industry signal";
  const body = item.summary;
  try {
    await enqueueOwnerVoiceEvent(
      brand.user_id,
      "sage_urgent",
      (firstName) =>
        `Heads up ${firstName}. Sage found something time-sensitive in your industry: ${item.summary}. ${item.why_it_matters}`,
      {
        brandId: brand.brand_id,
        title,
        dedupKey: `sage_urgent:${brand.brand_id}:${item.signal_key}:${new Date()
          .toISOString()
          .slice(0, 10)}`,
        payload: { type: "sage_urgent", brandId: brand.brand_id, url: item.url || null },
      },
    );
    const pushPayload = {
      title,
      body,
      data: { type: "sage_urgent", brandId: brand.brand_id },
    };
    pushController.sendPushToUser(brand.user_id, pushPayload).catch(() => {});
    mobilePushController.sendToUser(brand.user_id, pushPayload).catch(() => {});
  } catch (err) {
    console.error(`Sage urgent alert dispatch failed for brand ${brand.brand_id}:`, err.message);
  }
  return true;
}

// --- engine (used by scheduler + on-demand refresh) -------------------------

/** All real (non-demo) brands Sage should research, with owner + industry. */
async function activeBrandsForSage() {
  const r = await db.query(
    `SELECT b.brand_id, b.brand_name, b.brand_personality, b.voice_description,
            b.target_audience, b.user_id, b.geo_targeting, u.industry, u.role
       FROM brands b
       JOIN users u ON u.user_id = b.user_id
      WHERE b.is_demo = false
      ORDER BY b.created_at ASC`,
  );
  return r.rows;
}

/** Confirmed + suggested competitors Sage should include as research context. */
async function competitorsForContext(brandId) {
  const r = await db.query(
    `SELECT name, website, facebook_page
       FROM sage_competitors
      WHERE brand_id = $1 AND status <> 'dismissed'
      ORDER BY updated_at DESC LIMIT 12`,
    [brandId],
  );
  return r.rows;
}

/**
 * Run one full deep-research cycle for a brand: refresh the brief, persist the
 * feed findings, and page the owner on any urgent signals. Returns the saved
 * brief. Throws (aiInvalid → 502) if live research produced nothing usable.
 */
async function runDeepCycleForBrand(brand) {
  const competitors = await competitorsForContext(brand.brand_id);
  const brief = await deepResearch(brand, competitors, {
    platformOwner: brand.role === "admin",
  });
  await saveProfile(brand.brand_id, brief);
  for (const item of brief.feed || []) {
    await saveFeedItem(brand.brand_id, item);
    if (item.urgent) await dispatchUrgentAlert(brand, item);
  }
  // Compliance: if the research found real legal marketing restrictions in
  // specific states, add them as exclusion zones (best-effort — a failure here
  // never fails the research cycle).
  try {
    await applySageGeoExclusions(brand, brief.restricted_areas || []);
  } catch (err) {
    console.error(
      `Sage geo exclusion apply failed for brand ${brand.brand_id}:`,
      err.message,
    );
  }
  return brief;
}

/**
 * Add Sage-found legal restrictions as state exclusion zones on the brand's
 * geographic targeting, atomically and idempotently. Never touches (or
 * removes) any existing entry — owner-added exclusions and areas are
 * preserved as-is. Notifies the owner (voice + push) for each NEW exclusion.
 */
async function applySageGeoExclusions(brand, restrictedAreas) {
  if (!Array.isArray(restrictedAreas) || restrictedAreas.length === 0) return;

  const added = [];
  for (const r of restrictedAreas) {
    const code = String(r.state || "").toUpperCase();
    if (!US_STATES[code]) continue;
    // Atomic add: append only if no exclusion for this state exists yet
    // (whoever added it). Row count tells us whether we actually added it.
    const entry = {
      type: "state",
      value: code,
      reason: String(r.reason || "").slice(0, 300),
      addedBy: "sage",
      addedAt: new Date().toISOString(),
    };
    const upd = await db.query(
      `UPDATE brands
          SET geo_targeting = jsonb_set(
                COALESCE(geo_targeting, '{"areas":[],"exclusions":[]}'::jsonb),
                '{exclusions}',
                COALESCE(geo_targeting->'exclusions', '[]'::jsonb) || $2::jsonb
              )
        WHERE brand_id = $1
          AND NOT EXISTS (
                SELECT 1
                  FROM jsonb_array_elements(COALESCE(geo_targeting->'exclusions', '[]'::jsonb)) e
                 WHERE e->>'type' = 'state' AND UPPER(e->>'value') = $3
              )
        RETURNING brand_id`,
      [brand.brand_id, toJsonbParam(entry), code],
    );
    if (upd.rows.length > 0) added.push({ code, reason: entry.reason });
  }
  if (added.length === 0) return;

  const names = added.map((a) => US_STATES[a.code]).join(", ");
  const title = "Sage: compliance exclusion added";
  const body = `Sage found legal marketing restrictions and excluded ${names} from all marketing for ${brand.brand_name}. You can review this under Settings → Where You Do Business.`;
  try {
    await enqueueOwnerVoiceEvent(
      brand.user_id,
      "sage_geo_exclusion",
      (firstName) =>
        `${firstName}, a compliance update. My research found legal marketing restrictions, so I've excluded ${names} from all marketing for ${brand.brand_name}. ${added[0].reason} You can review or change this in your settings.`,
      {
        brandId: brand.brand_id,
        title,
        dedupKey: `sage_geo:${brand.brand_id}:${added.map((a) => a.code).join(",")}:${new Date().toISOString().slice(0, 10)}`,
        payload: { type: "sage_geo_exclusion", brandId: brand.brand_id },
      },
    );
    const pushPayload = {
      title,
      body,
      data: { type: "sage_geo_exclusion", brandId: brand.brand_id },
    };
    pushController.sendPushToUser(brand.user_id, pushPayload).catch(() => {});
    mobilePushController.sendToUser(brand.user_id, pushPayload).catch(() => {});
  } catch (err) {
    console.error(
      `Sage geo exclusion notify failed for brand ${brand.brand_id}:`,
      err.message,
    );
  }
}

/**
 * Run one fast urgent scan for a brand: persist any urgent findings and page the
 * owner (deduped). Returns the urgent items found (possibly empty — not an error).
 */
async function runUrgentScanForBrand(brand) {
  const competitors = await competitorsForContext(brand.brand_id);
  const { feed } = await urgentScan(brand, competitors);
  for (const item of feed) {
    await saveFeedItem(brand.brand_id, item);
    await dispatchUrgentAlert(brand, item);
  }
  return feed;
}

/**
 * Read-only snapshot of Sage's current intelligence for a brand, for other
 * subsystems (morning briefing, agent roster). Never throws.
 */
async function sageSnapshotForBrand(brandId) {
  try {
    const [profile, feed] = await Promise.all([
      db.query(
        `SELECT industry, summary, marketing_insights, last_refreshed_at
           FROM sage_intelligence_profiles WHERE brand_id = $1`,
        [brandId],
      ),
      db.query(
        `SELECT summary, why_it_matters, urgent, created_at
           FROM sage_intelligence_feed
          WHERE brand_id = $1 AND created_at > NOW() - INTERVAL '7 days'
          ORDER BY created_at DESC LIMIT 5`,
        [brandId],
      ),
    ]);
    const p = profile.rows[0];
    if (!p && feed.rows.length === 0) return null;
    const insights = Array.isArray(p && p.marketing_insights) ? p.marketing_insights : [];
    return {
      industry: p ? p.industry : null,
      summary: p ? p.summary : null,
      lastRefreshedAt: p ? p.last_refreshed_at : null,
      topInsight: insights[0] ? insights[0].insight : null,
      recentFindings: feed.rows.map((f) => ({
        summary: f.summary,
        urgent: f.urgent,
      })),
      urgentCount: feed.rows.filter((f) => f.urgent).length,
    };
  } catch (_e) {
    return null;
  }
}

// --- HTTP handlers ----------------------------------------------------------

function brandIdOf(req) {
  return req.query.brandId || req.body.brandId || null;
}

/** GET /api/sage/brief?brandId= — the current industry brief. */
async function getBrief(req, res) {
  try {
    const brandId = brandIdOf(req);
    const brand = await getOwnedBrand(req.user.userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const r = await db.query(
      `SELECT industry, summary, sections, marketing_insights, sources,
              last_refreshed_at
         FROM sage_intelligence_profiles WHERE brand_id = $1`,
      [brandId],
    );
    return res.json({ brief: r.rows[0] || null });
  } catch (err) {
    return sendError(res, err, "Failed to load the industry brief");
  }
}

/** POST /api/sage/brief/refresh {brandId} — run deep research now. */
async function refreshBrief(req, res) {
  const brandId = brandIdOf(req);
  // Manual owner-triggered refresh: use a manual-scoped run key (millisecond
  // granularity) so it always runs on demand and never collides with the
  // scheduler's hourly "deep:" bucket, while still recording a claimed run row
  // for consistent observability.
  const runKey = `manual:${new Date().toISOString()}`;
  try {
    const brand = await getOwnedBrand(req.user.userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    await claimRun(brandId, "deep", runKey);
    const brief = await runDeepCycleForBrand(brand);
    await finishRun(brandId, "deep", runKey, "done");
    return res.json({ brief });
  } catch (err) {
    return sendError(res, err, "Failed to refresh the industry brief");
  }
}

/** GET /api/sage/feed?brandId= — the rolling findings feed (last 30 days). */
async function getFeed(req, res) {
  try {
    const brandId = brandIdOf(req);
    const brand = await getOwnedBrand(req.user.userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const r = await db.query(
      `SELECT feed_id, source_type, summary, why_it_matters, url, source_title,
              urgent, created_at
         FROM sage_intelligence_feed
        WHERE brand_id = $1 AND created_at > NOW() - INTERVAL '30 days'
        ORDER BY urgent DESC, created_at DESC
        LIMIT 100`,
      [brandId],
    );
    return res.json({ feed: r.rows });
  } catch (err) {
    return sendError(res, err, "Failed to load the intelligence feed");
  }
}

/** GET /api/sage/insights?brandId= — actionable marketing insights. */
async function getInsights(req, res) {
  try {
    const brandId = brandIdOf(req);
    const brand = await getOwnedBrand(req.user.userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const r = await db.query(
      `SELECT marketing_insights, last_refreshed_at
         FROM sage_intelligence_profiles WHERE brand_id = $1`,
      [brandId],
    );
    const row = r.rows[0];
    return res.json({
      insights: row && Array.isArray(row.marketing_insights) ? row.marketing_insights : [],
      lastRefreshedAt: row ? row.last_refreshed_at : null,
    });
  } catch (err) {
    return sendError(res, err, "Failed to load marketing insights");
  }
}

/** GET /api/sage/competitors?brandId= — the competitor watch list. */
async function listCompetitors(req, res) {
  try {
    const brandId = brandIdOf(req);
    const brand = await getOwnedBrand(req.user.userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const r = await db.query(
      `SELECT competitor_id, name, website, facebook_page, follower_count,
              last_post, ad_activity, strategy_summary, status, last_checked_at
         FROM sage_competitors
        WHERE brand_id = $1 AND status <> 'dismissed'
        ORDER BY status DESC, updated_at DESC`,
      [brandId],
    );
    return res.json({ competitors: r.rows });
  } catch (err) {
    return sendError(res, err, "Failed to load competitors");
  }
}

/** POST /api/sage/competitors {brandId, name, website, facebook_page} — add. */
async function addCompetitor(req, res) {
  try {
    const brandId = brandIdOf(req);
    const brand = await getOwnedBrand(req.user.userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ error: "Competitor name is required" });
    const r = await db.query(
      `INSERT INTO sage_competitors (brand_id, name, website, facebook_page, status)
       VALUES ($1, $2, $3, $4, 'confirmed')
       ON CONFLICT (brand_id, lower(name)) DO UPDATE SET
         website = COALESCE(EXCLUDED.website, sage_competitors.website),
         facebook_page = COALESCE(EXCLUDED.facebook_page, sage_competitors.facebook_page),
         status = 'confirmed',
         updated_at = NOW()
       RETURNING competitor_id, name, website, facebook_page, follower_count,
                 last_post, ad_activity, strategy_summary, status, last_checked_at`,
      [
        brandId,
        name,
        (req.body.website || "").trim() || null,
        (req.body.facebook_page || "").trim() || null,
      ],
    );
    return res.json({ competitor: r.rows[0] });
  } catch (err) {
    return sendError(res, err, "Failed to add competitor");
  }
}

/** POST /api/sage/competitors/suggest {brandId} — AI-suggest real competitors. */
async function suggestCompetitorsHandler(req, res) {
  try {
    const brandId = brandIdOf(req);
    const brand = await getOwnedBrand(req.user.userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const suggestions = await suggestCompetitors(brand);
    for (const c of suggestions) {
      await db.query(
        `INSERT INTO sage_competitors
           (brand_id, name, website, facebook_page, strategy_summary, status)
         VALUES ($1, $2, $3, $4, $5, 'suggested')
         ON CONFLICT (brand_id, lower(name)) DO UPDATE SET
           website = COALESCE(EXCLUDED.website, sage_competitors.website),
           facebook_page = COALESCE(EXCLUDED.facebook_page, sage_competitors.facebook_page),
           strategy_summary = COALESCE(EXCLUDED.strategy_summary, sage_competitors.strategy_summary),
           updated_at = NOW()`,
        [brandId, c.name, c.website, c.facebook_page, c.strategy_summary],
      );
    }
    const r = await db.query(
      `SELECT competitor_id, name, website, facebook_page, follower_count,
              last_post, ad_activity, strategy_summary, status, last_checked_at
         FROM sage_competitors
        WHERE brand_id = $1 AND status <> 'dismissed'
        ORDER BY status DESC, updated_at DESC`,
      [brandId],
    );
    return res.json({ competitors: r.rows });
  } catch (err) {
    return sendError(res, err, "Failed to suggest competitors");
  }
}

/** POST /api/sage/competitors/:id/refresh {brandId} — refresh one competitor. */
async function refreshCompetitorHandler(req, res) {
  try {
    const brandId = brandIdOf(req);
    const brand = await getOwnedBrand(req.user.userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const cr = await db.query(
      `SELECT competitor_id, name, website, facebook_page
         FROM sage_competitors WHERE competitor_id = $1 AND brand_id = $2`,
      [req.params.id, brandId],
    );
    const competitor = cr.rows[0];
    if (!competitor) return res.status(404).json({ error: "Competitor not found" });
    const stats = await refreshCompetitor(brand, competitor);
    const r = await db.query(
      `UPDATE sage_competitors SET
         follower_count = $3, last_post = $4, ad_activity = $5,
         strategy_summary = COALESCE($6, strategy_summary),
         last_checked_at = NOW(), updated_at = NOW()
       WHERE competitor_id = $1 AND brand_id = $2
       RETURNING competitor_id, name, website, facebook_page, follower_count,
                 last_post, ad_activity, strategy_summary, status, last_checked_at`,
      [
        competitor.competitor_id,
        brandId,
        stats.follower_count,
        stats.last_post,
        stats.ad_activity,
        stats.strategy_summary,
      ],
    );
    return res.json({ competitor: r.rows[0] });
  } catch (err) {
    return sendError(res, err, "Failed to refresh competitor");
  }
}

/** PATCH /api/sage/competitors/:id {brandId, status} — confirm/dismiss. */
async function updateCompetitor(req, res) {
  try {
    const brandId = brandIdOf(req);
    const brand = await getOwnedBrand(req.user.userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const status = req.body.status;
    if (!["confirmed", "suggested", "dismissed"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const r = await db.query(
      `UPDATE sage_competitors SET status = $3, updated_at = NOW()
       WHERE competitor_id = $1 AND brand_id = $2
       RETURNING competitor_id, name, website, facebook_page, follower_count,
                 last_post, ad_activity, strategy_summary, status, last_checked_at`,
      [req.params.id, brandId, status],
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Competitor not found" });
    return res.json({ competitor: r.rows[0] });
  } catch (err) {
    return sendError(res, err, "Failed to update competitor");
  }
}

/** DELETE /api/sage/competitors/:id?brandId= — remove from the watch list. */
async function deleteCompetitor(req, res) {
  try {
    const brandId = brandIdOf(req);
    const brand = await getOwnedBrand(req.user.userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const r = await db.query(
      `DELETE FROM sage_competitors WHERE competitor_id = $1 AND brand_id = $2
       RETURNING competitor_id`,
      [req.params.id, brandId],
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Competitor not found" });
    return res.json({ ok: true });
  } catch (err) {
    return sendError(res, err, "Failed to remove competitor");
  }
}

/**
 * POST /api/sage/input — submit intelligence for Sage to analyze.
 * Accepts JSON {brandId, type:"link"|"facebook", url} OR multipart with a single
 * file field "file" (type:"image"|"pdf" inferred from mimetype) + brandId.
 */
async function submitIntelligence(req, res) {
  try {
    const brandId = brandIdOf(req);
    const brand = await getOwnedBrand(req.user.userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    let submission;
    let inputRef;
    if (req.file) {
      const mime = req.file.mimetype || "";
      const isPdf = mime === "application/pdf";
      const isImage = mime.startsWith("image/");
      if (!isPdf && !isImage) {
        return res.status(400).json({ error: "Only image or PDF files are supported" });
      }
      submission = {
        type: isPdf ? "pdf" : "image",
        dataBase64: req.file.buffer.toString("base64"),
        mediaType: mime,
        filename: req.file.originalname || null,
      };
      inputRef = req.file.originalname || null;
    } else {
      const type = req.body.type === "facebook" ? "facebook" : "link";
      const url = typeof req.body.url === "string" ? req.body.url.trim() : "";
      if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ error: "A valid http(s) URL is required" });
      }
      submission = { type, url };
      inputRef = url;
    }

    const analysis = await analyzeSubmission(brand, submission);
    const r = await db.query(
      `INSERT INTO sage_submissions
         (brand_id, user_id, input_type, input_ref, title, summary, insights)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING submission_id, input_type, input_ref, title, summary, insights,
                 created_at`,
      [
        brandId,
        req.user.userId,
        submission.type,
        inputRef,
        analysis.title,
        analysis.summary,
        toJsonbParam(analysis.insights || []),
      ],
    );
    return res.json({ submission: r.rows[0] });
  } catch (err) {
    return sendError(res, err, "Failed to analyze the submission");
  }
}

/** GET /api/sage/submissions?brandId= — Intelligence Input history. */
async function listSubmissions(req, res) {
  try {
    const brandId = brandIdOf(req);
    const brand = await getOwnedBrand(req.user.userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const r = await db.query(
      `SELECT submission_id, input_type, input_ref, title, summary, insights,
              created_at
         FROM sage_submissions
        WHERE brand_id = $1
        ORDER BY created_at DESC LIMIT 50`,
      [brandId],
    );
    return res.json({ submissions: r.rows });
  } catch (err) {
    return sendError(res, err, "Failed to load submission history");
  }
}

module.exports = {
  // engine
  activeBrandsForSage,
  runDeepCycleForBrand,
  runUrgentScanForBrand,
  sageSnapshotForBrand,
  claimRun,
  finishRun,
  getOwnedBrand,
  // handlers
  getBrief,
  refreshBrief,
  getFeed,
  getInsights,
  listCompetitors,
  addCompetitor,
  suggestCompetitorsHandler,
  refreshCompetitorHandler,
  updateCompetitor,
  deleteCompetitor,
  submitIntelligence,
  listSubmissions,
};
