/**
 * Competitor Ad Spy controller (Enterprise feature) — Scout's competitive ad
 * intelligence engine.
 *
 * What it does:
 *   1. Scan — scanCompetitorAdsForBrand(brand) reads the brand's CONFIRMED
 *      competitor watch list (sage_competitors.status='confirmed'), pulls each
 *      competitor's ACTIVE ads from the Facebook Ad Library (real data only),
 *      and upserts them into competitor_ads (dedup on brand_id+ad_archive_id).
 *      Brand-new ads are classified by Hermes (threat read); a genuinely
 *      aggressive new ad alerts the owner ONCE (voice + SMS) via a CAS marker.
 *   2. Report — generateReportForBrand(brand) has Claude write the weekly ad
 *      intelligence report (top ads, gaps, 3 recommendations) into
 *      competitor_ad_reports (one per brand per week).
 *   3. Counter — draftCounter(...) has Claude draft an on-brand counter ad.
 *
 * Background paths (scheduler) enforce the Enterprise tier themselves because
 * route featureGate never runs there. All AI failures map to HTTP 502 (never
 * mocked). Ownership is enforced via getOwnedBrand (brand.user_id). Honesty:
 * with no Facebook token the scan is a no-op and the feed reports available=false
 * rather than inventing ads.
 */

const db = require("../config/db");
const { meetsTier } = require("../config/tiers");
const { getUserTier } = require("../middleware/featureGate");
const { isConfigured, fetchCompetitorAds } = require("../utils/competitorAdLibrary");
const { classifyNewAds } = require("../utils/competitorAdBrain");
const { generateAdReport, draftCounterCampaign } = require("../prompts/competitorAdReportPrompt");
const { enqueueOwnerVoiceEvent } = require("../utils/echoVoiceNotifications");
const { buildClient } = require("../config/twilio");
const { decrypt } = require("../utils/encryption");
const { normalizeE164 } = require("../utils/phone");

const SPY_TIER = "enterprise";

// Scans run every 6h. An ad NOT re-seen in the Ad Library within this window is
// no longer running, so we stop surfacing it as "live" (the Ad Library never
// tells us an ad stopped — it just disappears from ACTIVE results). This keeps
// the feed/report honest without falsely wiping ads on a transient empty scan.
const LIVE_WINDOW = "3 days";

/** Loads a brand only if it belongs to the authenticated user. */
async function getOwnedBrand(userId, brandId) {
  const result = await db.query(
    `SELECT brand_id, user_id, brand_name, brand_personality, voice_description,
            target_audience, tagline, is_demo
     FROM brands
     WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId],
  );
  return result.rows[0] || null;
}

/** Maps any thrown error to the right HTTP status (AI/provider failures → 502). */
function sendError(res, err, fallbackMsg) {
  if (err.aiInvalid || (typeof err.status === "number" && err.status >= 400)) {
    return res.status(502).json({
      error:
        "Scout could not complete this AI analysis right now. Please try again shortly.",
    });
  }
  console.error("competitorAdSpy error:", err.message);
  return res.status(500).json({ error: fallbackMsg });
}

/** Monday (UTC) of the given date's week, as YYYY-MM-DD. */
function weekDateFor(date = new Date()) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/** Confirmed competitors on a brand's Sage watch list. */
async function confirmedCompetitors(brandId) {
  const { rows } = await db.query(
    `SELECT competitor_id, name, website, facebook_page
     FROM sage_competitors
     WHERE brand_id = $1 AND status = 'confirmed'
     ORDER BY updated_at DESC`,
    [brandId],
  );
  return rows;
}

/* -------------------------------- scanning -------------------------------- */

/**
 * Upsert one competitor's ads. Dedup on (brand_id, ad_archive_id): a re-seen ad
 * refreshes its content + last_seen_at + status; a brand-new ad is inserted.
 * Returns the rows that were newly INSERTED this run (xmax = 0), so only genuinely
 * new ads get classified/alerted — a re-scan of the same ad never re-alerts.
 */
async function upsertAds(brand, ads) {
  const inserted = [];
  for (const ad of ads) {
    const { rows } = await db.query(
      `INSERT INTO competitor_ads
         (brand_id, competitor_id, competitor_name, ad_archive_id, page_name,
          headline, body_text, cta_text, snapshot_url, platforms, delivery_start,
          status, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',NOW())
       ON CONFLICT (brand_id, ad_archive_id)
       DO UPDATE SET competitor_id = COALESCE(EXCLUDED.competitor_id, competitor_ads.competitor_id),
                     competitor_name = EXCLUDED.competitor_name,
                     page_name = EXCLUDED.page_name,
                     headline = EXCLUDED.headline,
                     body_text = EXCLUDED.body_text,
                     cta_text = EXCLUDED.cta_text,
                     snapshot_url = EXCLUDED.snapshot_url,
                     platforms = EXCLUDED.platforms,
                     delivery_start = COALESCE(EXCLUDED.delivery_start, competitor_ads.delivery_start),
                     status = 'active',
                     last_seen_at = NOW(),
                     updated_at = NOW()
       RETURNING ad_id, ad_archive_id, competitor_name, headline, body_text,
                 cta_text, platforms, delivery_start, (xmax = 0) AS inserted`,
      [
        brand.brand_id,
        ad.competitorId,
        ad.competitorName,
        ad.adArchiveId,
        ad.pageName,
        ad.headline,
        ad.body,
        ad.cta,
        ad.snapshotUrl,
        ad.platforms || [],
        ad.deliveryStart,
      ],
    );
    const row = rows[0];
    if (row && row.inserted) {
      inserted.push({
        ad_id: row.ad_id,
        adArchiveId: row.ad_archive_id,
        competitorName: row.competitor_name,
        headline: row.headline,
        body: row.body_text,
        cta: row.cta_text,
        platforms: row.platforms,
        deliveryStart: row.delivery_start,
      });
    }
  }
  return inserted;
}

/**
 * Alert the owner about ONE genuinely aggressive brand-new competitor ad — once.
 * A CAS UPDATE on owner_alerted_at guarantees at-most-once per ad even if two
 * scans overlap. Voice + SMS are both best-effort and never throw into the scan.
 */
async function escalateAggressiveAd(brand, adRow, classification) {
  const { rowCount } = await db.query(
    `UPDATE competitor_ads SET owner_alerted_at = NOW(), updated_at = NOW()
     WHERE ad_id = $1 AND owner_alerted_at IS NULL`,
    [adRow.ad_id],
  );
  if (rowCount === 0) return; // already alerted (or gone)

  const competitor = adRow.competitorName || "a competitor";
  const reason = (classification && classification.reason) || "";
  const buildText = (firstName) => {
    const lead = `${firstName}, Scout just spotted a new competitor ad from ${competitor} that looks aggressive.`;
    const why = reason ? ` ${reason}` : "";
    return `${lead}${why} Open Competitor Ads in Scout to see it and draft a counter campaign.`;
  };

  // 1) Voice — surfaced through the owner's Echo voice queue.
  try {
    await enqueueOwnerVoiceEvent(brand.user_id, "competitor_ad_threat", buildText, {
      brandId: brand.brand_id,
      title: "New aggressive competitor ad",
      payload: {
        type: "competitor_ad_threat",
        adId: adRow.ad_id,
        competitor,
        section: "competitorads",
      },
      dedupKey: `competitor-ad-threat-${adRow.ad_id}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  } catch (err) {
    console.error("Competitor ad threat voice alert failed:", err.message);
  }

  // 2) SMS — from the brand's own Twilio number to the owner's phone.
  try {
    const { rows } = await db.query(
      `SELECT u.phone AS owner_phone, u.first_name,
              tc.account_sid, tc.auth_token_encrypted, tc.phone_number
       FROM users u
       LEFT JOIN twilio_config tc ON tc.brand_id = $2
       WHERE u.user_id = $1`,
      [brand.user_id, brand.brand_id],
    );
    const row = rows[0];
    const ownerPhone = row && normalizeE164(row.owner_phone);
    if (ownerPhone && row.account_sid && row.auth_token_encrypted && row.phone_number) {
      const client = buildClient(row.account_sid, decrypt(row.auth_token_encrypted));
      const firstName = row.first_name && row.first_name.trim() ? row.first_name.trim() : "there";
      const body = `${firstName}, Scout spotted a new aggressive ad from ${competitor}.${
        reason ? ` ${reason}` : ""
      } Check Competitor Ads in EchoAI.`;
      await client.messages.create({ to: ownerPhone, from: row.phone_number, body });
    }
  } catch (err) {
    console.error("Competitor ad threat SMS alert failed:", err.message);
  }
}

/**
 * Scan a brand's confirmed competitors' live ads. Upserts every active ad,
 * classifies the brand-new ones with Hermes, persists the threat read, and
 * alerts the owner on any aggressive new ad. Returns a summary. Best-effort per
 * competitor (Ad Library is never-throw); the whole call does not require AI.
 */
async function scanCompetitorAdsForBrand(brand) {
  if (!isConfigured()) {
    return { available: false, scanned: 0, newAds: 0, competitors: 0 };
  }
  const competitors = await confirmedCompetitors(brand.brand_id);
  if (competitors.length === 0) {
    return { available: true, scanned: 0, newAds: 0, competitors: 0 };
  }

  let scanned = 0;
  let allNew = [];
  for (const competitor of competitors) {
    const ads = await fetchCompetitorAds(brand, competitor);
    scanned += ads.length;
    if (ads.length === 0) continue;
    const inserted = await upsertAds(brand, ads);
    allNew = allNew.concat(inserted);
  }

  if (allNew.length > 0) {
    const classification = await classifyNewAds(brand, allNew);
    for (const adRow of allNew) {
      const c = classification && classification[adRow.adArchiveId];
      const level = c ? c.threatLevel : null;
      // Persist the threat read (unclassified stays NULL — never a false alert).
      await db.query(
        `UPDATE competitor_ads SET threat_level = $2, threat_reason = $3, updated_at = NOW()
         WHERE ad_id = $1`,
        [adRow.ad_id, level, (c && c.reason) || null],
      );
      if (level === "aggressive" && !brand.is_demo) {
        await escalateAggressiveAd(brand, adRow, c);
      }
    }
  }

  return {
    available: true,
    scanned,
    newAds: allNew.length,
    competitors: competitors.length,
  };
}

/* --------------------------------- report --------------------------------- */

/** The active competitor ads a report should analyze (longest-running first). */
async function activeAdsForReport(brandId, limit = 40) {
  const { rows } = await db.query(
    `SELECT ad_id, competitor_name, page_name, headline, body_text, cta_text,
            snapshot_url, platforms, delivery_start, threat_level, last_seen_at
     FROM competitor_ads
     WHERE brand_id = $1 AND status = 'active'
       AND last_seen_at > NOW() - INTERVAL '${LIVE_WINDOW}'
     ORDER BY delivery_start ASC NULLS LAST, last_seen_at DESC
     LIMIT $2`,
    [brandId, limit],
  );
  return rows;
}

/**
 * Generate + persist this week's competitor ad report. Throws err.aiInvalid when
 * there are no ads to analyze or the AI output is bad (caller maps to 502).
 */
async function generateReportForBrand(brand) {
  const ads = await activeAdsForReport(brand.brand_id);
  const report = await generateAdReport(brand, ads); // throws aiInvalid if empty/bad
  const weekDate = weekDateFor();

  const { rows } = await db.query(
    `INSERT INTO competitor_ad_reports
       (brand_id, week_date, summary, top_ads, gaps, recommendations)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (brand_id, week_date)
     DO UPDATE SET summary = EXCLUDED.summary,
                   top_ads = EXCLUDED.top_ads,
                   gaps = EXCLUDED.gaps,
                   recommendations = EXCLUDED.recommendations,
                   created_at = NOW()
     RETURNING report_id, week_date, created_at`,
    [
      brand.brand_id,
      weekDate,
      report.summary,
      JSON.stringify(report.topAds),
      JSON.stringify(report.gaps),
      JSON.stringify(report.recommendations),
    ],
  );
  const row = rows[0];
  return {
    reportId: row.report_id,
    weekDate: row.week_date,
    createdAt: row.created_at,
    ...report,
  };
}

function mapReportRow(r) {
  return {
    reportId: r.report_id,
    weekDate: r.week_date,
    createdAt: r.created_at,
    summary: r.summary,
    topAds: r.top_ads || [],
    gaps: r.gaps || [],
    recommendations: r.recommendations || [],
  };
}

function mapAdRow(r) {
  let daysRunning = null;
  if (r.delivery_start) {
    const start = new Date(r.delivery_start);
    if (!Number.isNaN(start.getTime())) {
      daysRunning = Math.max(0, Math.round((Date.now() - start.getTime()) / 86400000));
    }
  }
  return {
    adId: r.ad_id,
    competitorName: r.competitor_name,
    pageName: r.page_name,
    headline: r.headline,
    body: r.body_text,
    cta: r.cta_text,
    snapshotUrl: r.snapshot_url,
    platforms: r.platforms || [],
    deliveryStart: r.delivery_start,
    daysRunning,
    threatLevel: r.threat_level,
    threatReason: r.threat_reason,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  };
}

/* -------------------------- scheduler entry points ------------------------- */

/** Load a full brand row when only a partial one is available. */
async function loadBrandRow(brand) {
  if (brand && brand.brand_name && brand.user_id) return brand;
  const { rows } = await db.query(
    `SELECT brand_id, user_id, brand_name, brand_personality, voice_description,
            target_audience, tagline, is_demo
     FROM brands WHERE brand_id = $1`,
    [brand.brand_id],
  );
  return rows[0] || null;
}

/**
 * 6-hourly scan for one brand. Enterprise-gated at the source (background path).
 * Best-effort: never throws into the scheduler loop.
 */
async function runCompetitorAdScanForBrand(brand) {
  const { tier, role } = await getUserTier(brand.user_id);
  if (role !== "admin" && !meetsTier(tier, SPY_TIER)) return;
  const brandRow = await loadBrandRow(brand);
  if (!brandRow) return;
  try {
    await scanCompetitorAdsForBrand(brandRow);
  } catch (err) {
    console.error(`Competitor ad scan failed for brand ${brandRow.brand_id}:`, err.message);
  }
}

/**
 * Weekly (Monday) report for one brand. Enterprise-gated at the source. Only
 * generates when there are ads to analyze (no ads = nothing to report, and the
 * AI would correctly refuse). Best-effort.
 */
async function runWeeklyCompetitorAdReportForBrand(brand) {
  const { tier, role } = await getUserTier(brand.user_id);
  if (role !== "admin" && !meetsTier(tier, SPY_TIER)) return;
  const brandRow = await loadBrandRow(brand);
  if (!brandRow) return;

  // Refresh ads first so the report reflects what is running right now.
  try {
    await scanCompetitorAdsForBrand(brandRow);
  } catch (err) {
    console.error(`Weekly competitor ad scan failed for brand ${brandRow.brand_id}:`, err.message);
  }

  const ads = await activeAdsForReport(brandRow.brand_id, 1);
  if (ads.length === 0) return; // nothing to report on yet

  try {
    await generateReportForBrand(brandRow);
  } catch (err) {
    console.error(`Weekly competitor ad report failed for brand ${brandRow.brand_id}:`, err.message);
  }
}

/* -------------------------------- routes ---------------------------------- */

// GET /api/competitor-ads/:brandId/feed — live feed grouped by competitor.
async function getFeed(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const [competitors, adRows, reportRow] = await Promise.all([
      confirmedCompetitors(brand.brand_id),
      db.query(
        `SELECT ad_id, competitor_name, page_name, headline, body_text, cta_text,
                snapshot_url, platforms, delivery_start, threat_level, threat_reason,
                first_seen_at, last_seen_at
         FROM competitor_ads
         WHERE brand_id = $1 AND status = 'active'
           AND last_seen_at > NOW() - INTERVAL '${LIVE_WINDOW}'
         ORDER BY delivery_start ASC NULLS LAST, last_seen_at DESC`,
        [brand.brand_id],
      ),
      db.query(
        `SELECT * FROM competitor_ad_reports
         WHERE brand_id = $1 ORDER BY week_date DESC LIMIT 1`,
        [brand.brand_id],
      ),
    ]);

    const groupsByName = new Map();
    for (const r of adRows.rows) {
      const ad = mapAdRow(r);
      const key = ad.competitorName || "Unknown";
      if (!groupsByName.has(key)) groupsByName.set(key, []);
      groupsByName.get(key).push(ad);
    }
    const groups = Array.from(groupsByName.entries()).map(([name, ads]) => ({
      competitor: name,
      ads,
    }));

    return res.json({
      connected: isConfigured(),
      confirmedCompetitors: competitors.length,
      totalAds: adRows.rows.length,
      competitors: groups,
      report: reportRow.rows[0] ? mapReportRow(reportRow.rows[0]) : null,
    });
  } catch (err) {
    return sendError(res, err, "Failed to load competitor ads.");
  }
}

// POST /api/competitor-ads/:brandId/scan — manual scan.
async function scan(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const result = await scanCompetitorAdsForBrand(brand);
    return res.json(result);
  } catch (err) {
    return sendError(res, err, "Failed to scan competitor ads.");
  }
}

// GET /api/competitor-ads/:brandId/report — latest weekly report.
async function getReport(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { rows } = await db.query(
      `SELECT * FROM competitor_ad_reports
       WHERE brand_id = $1 ORDER BY week_date DESC LIMIT 1`,
      [brand.brand_id],
    );
    return res.json({ ready: rows.length > 0, report: rows[0] ? mapReportRow(rows[0]) : null });
  } catch (err) {
    return sendError(res, err, "Failed to load the competitor ad report.");
  }
}

// POST /api/competitor-ads/:brandId/report/generate — regenerate on demand.
async function generateReport(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const report = await generateReportForBrand(brand);
    return res.json({ ready: true, report });
  } catch (err) {
    return sendError(res, err, "Failed to generate the competitor ad report.");
  }
}

// POST /api/competitor-ads/:brandId/ads/:adId/counter — draft a counter ad.
async function draftCounter(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { rows } = await db.query(
      `SELECT * FROM competitor_ads WHERE ad_id = $1 AND brand_id = $2`,
      [req.params.adId, brand.brand_id],
    );
    if (rows.length === 0) return res.status(404).json({ error: "Ad not found" });
    const counter = await draftCounterCampaign(brand, rows[0]);
    return res.json({ counter });
  } catch (err) {
    return sendError(res, err, "Failed to draft the counter campaign.");
  }
}

module.exports = {
  // routes
  getFeed,
  scan,
  getReport,
  generateReport,
  draftCounter,
  // engine (scheduler + tests)
  scanCompetitorAdsForBrand,
  generateReportForBrand,
  runCompetitorAdScanForBrand,
  runWeeklyCompetitorAdReportForBrand,
  escalateAggressiveAd,
  confirmedCompetitors,
  upsertAds,
  weekDateFor,
};
