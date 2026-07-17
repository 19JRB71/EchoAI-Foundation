/**
 * Company Truth — data gathering + report validation (Phase 1 of the
 * chain-of-command spec).
 *
 * gatherCompanyData(brand) pulls every REAL source we hold about a brand.
 * Each source is probed independently and fail-honest: a probe error records
 * the source as unavailable (with the reason) — it is NEVER silently skipped
 * or fabricated, so Sage's report can say exactly what it did and did not see.
 *
 * validateCompanyReport(parsed) enforces the report contract before anything
 * is persisted (malformed AI output throws err.aiInvalid -> controller 502).
 */

const db = require("../config/db");

// The spec's report sections, in presentation order. Every report must carry
// every key — "we don't know" belongs in missingInformation, not in a hole.
const REPORT_SECTIONS = [
  ["identity", "Company identity & contact"],
  ["onlinePresence", "Website & connected accounts"],
  ["classification", "Industry & exact business classification"],
  ["productsServices", "Products & services"],
  ["serviceArea", "Service area"],
  ["targetCustomers", "Target customers"],
  ["businessModel", "Business model"],
  ["pricing", "Pricing / offer structure"],
  ["valuesPromises", "Company values & promises"],
  ["strengths", "Strengths & differentiators"],
  ["competitors", "Approved competitors"],
  ["terminology", "Industry terminology"],
  ["excludedCategories", "Excluded / commonly confused categories"],
  ["reputation", "Public reputation & review themes"],
  ["assets", "Uploaded & authorized assets"],
  ["currentMarketing", "Current marketing activity"],
  ["opportunitiesThreats", "Opportunities & threats"],
  ["missingInformation", "Missing information"],
];
const SECTION_KEYS = REPORT_SECTIONS.map(([k]) => k);

/** Probe one source; on failure record it honestly instead of guessing. */
async function probe(name, fn) {
  try {
    const data = await fn();
    return { name, available: true, data };
  } catch (err) {
    return { name, available: false, error: err.message };
  }
}

/**
 * Gathers every real data source for the brand. Returns
 * { sources: [{name, available, data|error}], summary: {...per-source data} }.
 */
async function gatherCompanyData(brand) {
  const sources = await Promise.all([
    probe("owner_profile", async () => {
      const { rows } = await db.query(
        `SELECT email, business_name, industry, phone, first_name
           FROM users WHERE user_id = $1`,
        [brand.user_id],
      );
      return rows[0] || null;
    }),
    probe("brand_profile", async () => ({
      brandName: brand.brand_name,
      brandType: brand.brand_type || null,
      websiteUrl: brand.website_url || null,
      facebookPageUrl: brand.facebook_page_url || null,
      personality: brand.brand_personality || null,
      voice: brand.voice_description || null,
      targetAudience: brand.target_audience || null,
      geoTargeting: brand.geo_targeting || null,
    })),
    probe("brand_discovery", async () => {
      const { rows } = await db.query(
        `SELECT draft_profile, updated_at
           FROM brand_discovery_sessions
          WHERE brand_id = $1 AND status = 'completed'
          ORDER BY updated_at DESC LIMIT 1`,
        [brand.brand_id],
      );
      return rows[0] || null;
    }),
    probe("sage_industry_profile", async () => {
      const { rows } = await db.query(
        `SELECT industry, summary, last_refreshed_at
           FROM sage_intelligence_profiles WHERE brand_id = $1`,
        [brand.brand_id],
      );
      return rows[0] || null;
    }),
    probe("confirmed_competitors", async () => {
      const { rows } = await db.query(
        `SELECT name, website, strategy_summary
           FROM sage_competitors
          WHERE brand_id = $1 AND status = 'confirmed'
          ORDER BY created_at ASC LIMIT 15`,
        [brand.brand_id],
      );
      return rows;
    }),
    probe("reviews", async () => {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS review_count,
                ROUND(AVG(star_rating)::numeric, 2)::text AS avg_rating
           FROM reviews WHERE brand_id = $1`,
        [brand.brand_id],
      );
      const recent = await db.query(
        `SELECT platform, star_rating, LEFT(COALESCE(review_text, ''), 400) AS review_text
           FROM reviews WHERE brand_id = $1
          ORDER BY posted_at DESC NULLS LAST LIMIT 5`,
        [brand.brand_id],
      );
      return { ...rows[0], recent: recent.rows };
    }),
    probe("reference_photos", async () => {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS photo_count FROM vision_reference_images WHERE brand_id = $1`,
        [brand.brand_id],
      );
      const captions = await db.query(
        `SELECT COALESCE(caption, original_name) AS label
           FROM vision_reference_images WHERE brand_id = $1
          ORDER BY created_at DESC LIMIT 10`,
        [brand.brand_id],
      );
      return { count: rows[0].photo_count, labels: captions.rows.map((r) => r.label) };
    }),
    probe("connected_accounts", async () => {
      const { rows } = await db.query(
        `SELECT platform::text, connection_status
           FROM api_integrations WHERE user_id = $1`,
        [brand.user_id],
      );
      return rows;
    }),
    probe("marketing_activity", async () => {
      const [posts, campaigns] = await Promise.all([
        db.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS last_30d
             FROM social_posts WHERE brand_id = $1`,
          [brand.brand_id],
        ),
        db.query(
          `SELECT COUNT(*)::int AS total FROM campaigns WHERE brand_id = $1`,
          [brand.brand_id],
        ),
      ]);
      return { socialPosts: posts.rows[0], adCampaigns: campaigns.rows[0].total };
    }),
  ]);

  const summary = {};
  for (const s of sources) {
    summary[s.name] = s.available ? s.data : { unavailable: true, error: s.error };
  }
  return { sources, summary };
}

/** Throws err.aiInvalid unless the parsed AI output honors the contract. */
function validateCompanyReport(parsed) {
  const fail = (msg) => {
    const err = new Error(msg);
    err.aiInvalid = true;
    throw err;
  };
  if (!parsed || typeof parsed !== "object") fail("report is not an object");
  if (typeof parsed.plainSummary !== "string" || !parsed.plainSummary.trim()) {
    fail("plainSummary missing");
  }
  if (!parsed.sections || typeof parsed.sections !== "object") fail("sections missing");
  const clean = {};
  for (const key of SECTION_KEYS) {
    let v = parsed.sections[key];
    if (Array.isArray(v)) {
      v = v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
    } else if (typeof v === "string") {
      v = v.trim();
    } else {
      v = null;
    }
    // missingInformation may legitimately be empty; every other section must
    // carry SOMETHING (even if it is "Unknown — needs owner input").
    const empty = v == null || v.length === 0;
    if (empty && key !== "missingInformation") fail(`section "${key}" is empty`);
    clean[key] = empty ? [] : v;
  }
  // The exact business classification is the whole point (pole barns are not
  // storage buildings) — it must be a concrete non-empty statement.
  const cls = Array.isArray(clean.classification)
    ? clean.classification.join(" ")
    : clean.classification;
  if (!cls || cls.length < 3) fail("classification section is not concrete");
  return { plainSummary: parsed.plainSummary.trim(), sections: clean };
}

module.exports = {
  REPORT_SECTIONS,
  SECTION_KEYS,
  gatherCompanyData,
  validateCompanyReport,
};
