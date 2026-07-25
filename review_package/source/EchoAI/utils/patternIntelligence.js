/**
 * Sage — Pattern Intelligence Engine (PIE).
 *
 * Continuously studies PUBLICLY AVAILABLE marketing in each brand's industry
 * and distills WHY campaigns work into (a) an industry-wide intelligence
 * report and (b) a Creative Brief that steers Forge toward higher-performing
 * ORIGINAL work. Never a competitor-copying tool.
 *
 * Real-data rules (replit.md honesty invariants):
 *  - Campaign gathering uses the SAME real Meta Ad Library plumbing the
 *    Competitor Ad Spy uses. No Facebook token → no campaigns are gathered
 *    (nothing is fabricated); the report then rests solely on cited live web
 *    research, and with neither the run fails honestly.
 *  - Commercial Ad Library rows expose NO engagement metrics and NO media, so
 *    aggregates measure PREVALENCE among currently-active ads (a revealed
 *    preference), never engagement.
 *  - AI failures throw (mapped to 502 upstream) — no silent fallbacks.
 */

const db = require("../config/db");
const { toJsonbParam } = require("./jsonb");
const { accessToken } = require("../config/facebook");
const { graphGet } = require("./facebookApi");
const { reachedCountries } = require("./competitorAdLibrary");
const {
  analyzeCampaigns,
  buildPatternReport,
} = require("../prompts/patternIntelligencePrompt");
const forgeDirector = require("./forgeDirector");

const AD_LIBRARY_PATH = "ads_archive";
const AD_FIELDS = [
  "id",
  "page_name",
  "ad_creative_bodies",
  "ad_creative_link_titles",
  "ad_creative_link_captions",
  "ad_delivery_start_time",
  "publisher_platforms",
  "ad_snapshot_url",
].join(",");

// How many public ads one gather pulls, and how many new campaigns one run
// will send to the analyst (keeps each cycle's AI cost bounded — the corpus
// still grows week over week).
const MAX_ADS_PER_GATHER = 50;
const MAX_ANALYZE_PER_RUN = 30;
const ANALYZE_BATCH_SIZE = 10;

/** True when the Ad Library source can actually be used. */
function isConfigured() {
  return !!accessToken;
}

function firstString(arr) {
  if (!Array.isArray(arr)) return null;
  const v = arr.find((x) => typeof x === "string" && x.trim());
  return v ? v.trim() : null;
}

/**
 * Gather currently-active public ads across the WHOLE industry (search_terms =
 * the industry itself — deliberately not a competitor name: PIE studies the
 * market, not a company). Best-effort: [] on any failure or no token.
 */
async function fetchIndustryAds(brand) {
  const industry = String(brand.industry || "").trim();
  if (!accessToken || !industry) return [];
  try {
    const data = await graphGet(
      AD_LIBRARY_PATH,
      {
        ad_reached_countries: reachedCountries(brand),
        ad_type: "ALL",
        ad_active_status: "ACTIVE",
        search_terms: industry,
        fields: AD_FIELDS,
        limit: MAX_ADS_PER_GATHER,
      },
      accessToken
    );
    const rows = (data && Array.isArray(data.data) && data.data) || [];
    const seen = new Set();
    const ads = [];
    for (const raw of rows) {
      if (!raw || !raw.id || seen.has(String(raw.id))) continue;
      const body = firstString(raw.ad_creative_bodies);
      const headline = firstString(raw.ad_creative_link_titles);
      if (!body && !headline) continue; // empty shell teaches nothing real
      seen.add(String(raw.id));
      ads.push({
        adArchiveId: String(raw.id),
        pageName: raw.page_name || null,
        headline: headline || null,
        body: body || null,
        cta: firstString(raw.ad_creative_link_captions),
        snapshotUrl: raw.ad_snapshot_url || null,
        platforms: Array.isArray(raw.publisher_platforms)
          ? raw.publisher_platforms.filter((p) => typeof p === "string")
          : [],
        deliveryStart:
          typeof raw.ad_delivery_start_time === "string" && raw.ad_delivery_start_time
            ? raw.ad_delivery_start_time.slice(0, 10)
            : null,
      });
    }
    return ads;
  } catch (_err) {
    // Optional source: token without ads_read, network error, etc.
    return [];
  }
}

/** Store newly seen campaigns (dedup on (brand, ad_archive_id)). */
async function upsertCampaigns(brandId, ads) {
  let added = 0;
  for (const ad of ads) {
    const r = await db.query(
      `INSERT INTO sage_pattern_campaigns
         (brand_id, ad_archive_id, page_name, headline, body, cta, snapshot_url,
          platforms, delivery_start)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       ON CONFLICT (brand_id, ad_archive_id) DO NOTHING
       RETURNING campaign_id`,
      [
        brandId,
        ad.adArchiveId,
        ad.pageName,
        ad.headline,
        ad.body,
        ad.cta,
        ad.snapshotUrl,
        toJsonbParam(ad.platforms || []),
        ad.deliveryStart,
      ]
    );
    if (r.rows[0]) added += 1;
  }
  return added;
}

/** Analyze up to MAX_ANALYZE_PER_RUN stored-but-unanalyzed campaigns. */
async function analyzePendingCampaigns(brand) {
  const pending = await db.query(
    `SELECT campaign_id, headline, body, cta
       FROM sage_pattern_campaigns
      WHERE brand_id = $1 AND analysis IS NULL
      ORDER BY created_at ASC
      LIMIT ${MAX_ANALYZE_PER_RUN}`,
    [brand.brand_id]
  );
  let analyzed = 0;
  for (let i = 0; i < pending.rows.length; i += ANALYZE_BATCH_SIZE) {
    const batch = pending.rows.slice(i, i + ANALYZE_BATCH_SIZE);
    const byIndex = await analyzeCampaigns(brand, batch);
    for (const [idx, analysis] of byIndex.entries()) {
      await db.query(
        `UPDATE sage_pattern_campaigns
            SET analysis = $2::jsonb, analyzed_at = NOW()
          WHERE campaign_id = $1`,
        [batch[idx].campaign_id, toJsonbParam(analysis)]
      );
      analyzed += 1;
    }
  }
  return analyzed;
}

/** Sorted "value: count" entries (deterministic, most common first). */
function topCounts(counter, limit = 8) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

/**
 * REAL aggregate statistics across analyzed campaign rows — pure code, no AI.
 * These are prevalence counts among currently/recently active public ads.
 */
function aggregateAnalyses(rows) {
  const hooks = {};
  const emotions = {};
  const ctas = {};
  const readingLevels = {};
  const copyTraits = {
    storytelling: 0,
    educational: 0,
    humor: 0,
    scarcity: 0,
    trust_signals: 0,
    customer_focused: 0,
  };
  let immediateValue = 0;
  let n = 0;
  for (const row of rows) {
    const a = row && (row.analysis || row);
    if (!a || typeof a !== "object" || !a.hook_type) continue;
    n += 1;
    hooks[a.hook_type] = (hooks[a.hook_type] || 0) + 1;
    for (const e of Array.isArray(a.emotions) ? a.emotions : []) {
      emotions[e] = (emotions[e] || 0) + 1;
    }
    if (a.cta_style) ctas[a.cta_style] = (ctas[a.cta_style] || 0) + 1;
    if (a.value_speed === "immediate") immediateValue += 1;
    const c = a.copy || {};
    for (const k of Object.keys(copyTraits)) if (c[k]) copyTraits[k] += 1;
    if (c.reading_level) {
      readingLevels[c.reading_level] = (readingLevels[c.reading_level] || 0) + 1;
    }
  }
  return {
    sampleSize: n,
    basis:
      "Prevalence among publicly available active ads (Meta Ad Library). No engagement metrics are available for commercial ads — these are revealed preferences, not engagement scores.",
    topHooks: topCounts(hooks),
    topEmotions: topCounts(emotions),
    topCtaStyles: topCounts(ctas, 6),
    copyTraits,
    readingLevels,
    immediateValueShare: n > 0 ? Math.round((immediateValue / n) * 100) / 100 : null,
  };
}

/** All analyzed campaign analyses for a brand (fuel for aggregation). */
async function loadAnalyses(brandId) {
  const r = await db.query(
    `SELECT analysis FROM sage_pattern_campaigns
      WHERE brand_id = $1 AND analysis IS NOT NULL
      ORDER BY analyzed_at DESC
      LIMIT 2000`,
    [brandId]
  );
  return r.rows;
}

async function saveInsights(brandId, industry, aggregates, report) {
  await db.query(
    `INSERT INTO sage_pattern_insights
       (brand_id, industry, sample_size, report, forge_brief, sources, last_run_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, NOW(), NOW())
     ON CONFLICT (brand_id) DO UPDATE SET
       industry = EXCLUDED.industry,
       sample_size = EXCLUDED.sample_size,
       report = EXCLUDED.report,
       forge_brief = EXCLUDED.forge_brief,
       sources = EXCLUDED.sources,
       last_run_at = NOW(),
       updated_at = NOW()`,
    [
      brandId,
      industry || null,
      aggregates.sampleSize,
      toJsonbParam(report.insights),
      report.forge_brief ? toJsonbParam(report.forge_brief) : null,
      toJsonbParam(report.sources || []),
    ]
  );
}

/**
 * One full PIE cycle for a brand: gather → analyze → aggregate → report.
 * Throws on AI failure (aiInvalid → 502 upstream); returns a real summary.
 */
async function runPatternCycleForBrand(brand) {
  const ads = await fetchIndustryAds(brand);
  const added = await upsertCampaigns(brand.brand_id, ads);
  const analyzed = await analyzePendingCampaigns(brand);
  const aggregates = aggregateAnalyses(await loadAnalyses(brand.brand_id));
  const report = await buildPatternReport(brand, aggregates, {
    objectives: forgeDirector.OBJECTIVES,
    tones: forgeDirector.TONES,
    visualStyles: forgeDirector.VISUAL_STYLES,
    cameras: forgeDirector.CAMERAS,
    copyStyles: forgeDirector.COPY_STYLES,
  });
  await saveInsights(brand.brand_id, brand.industry, aggregates, report);
  return {
    gathered: ads.length,
    newCampaigns: added,
    analyzed,
    sampleSize: aggregates.sampleSize,
    insights: report.insights.length,
    hasForgeBrief: Boolean(report.forge_brief),
    sources: (report.sources || []).length,
  };
}

/** Latest insights row for a brand, or null. */
async function getInsightsForBrand(brandId) {
  const r = await db.query(
    `SELECT industry, sample_size, report, forge_brief, sources, last_run_at
       FROM sage_pattern_insights WHERE brand_id = $1`,
    [brandId]
  );
  return r.rows[0] || null;
}

module.exports = {
  isConfigured,
  fetchIndustryAds,
  upsertCampaigns,
  analyzePendingCampaigns,
  aggregateAnalyses,
  runPatternCycleForBrand,
  getInsightsForBrand,
  MAX_ANALYZE_PER_RUN,
};
