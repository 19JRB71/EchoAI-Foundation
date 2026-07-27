/**
 * Competitor Ad Spy — Facebook Ad Library fetch layer.
 *
 * Pulls the ACTIVE ads a specific competitor is running right now from the public
 * Ad Library (`ads_archive`), normalized into the shape the Competitor Ad Spy
 * subsystem persists. Reuses the same real plumbing Sage uses
 * (utils/sageFacebook.js → utils/facebookApi.graphGet).
 *
 * Honesty rules (see replit.md — no fabricated data):
 *  - Requires FACEBOOK_ACCESS_TOKEN (identity-confirmed, ads_read). With no token
 *    every call returns [] and isConfigured() is false — the feature simply shows
 *    "connect Facebook" rather than inventing ads.
 *  - "Estimated audience size" / reach is NOT exposed for commercial ads (Meta
 *    only returns it for political/issue ads), so we never store or claim it.
 *  - `ad_snapshot_url` is a LINK to the ad's Facebook snapshot, not raw media, so
 *    it is stored/surfaced as a link.
 *  - CTA is best-effort: commercial `ads_archive` has no CTA-button field, so we
 *    fall back to the ad's link caption and leave it null when absent.
 *
 * Best-effort in EVERY failure mode (no token, refused scope, network, empty):
 * it NEVER throws — it returns [] so a limited token can't break a scan.
 */

const { accessToken } = require("../config/facebook");
const { graphGet } = require("./facebookApi");
const { pageRefFromUrl } = require("./sageFacebook");

const AD_LIBRARY_PATH = "ads_archive";
// Fields we can honestly populate for commercial ads.
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

const MAX_ADS_PER_COMPETITOR = 25;

/** True when a Facebook token is present (the feature can actually pull ads). */
function isConfigured() {
  return !!accessToken;
}

/** Best-effort ISO country code(s) for Ad Library scoping (it requires one). */
function reachedCountries(brand) {
  const raw =
    (brand && (brand.country || brand.country_code || brand.market)) || "";
  const code = String(raw).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? [code] : ["US"];
}

function firstString(arr) {
  if (!Array.isArray(arr)) return null;
  const v = arr.find((x) => typeof x === "string" && x.trim());
  return v ? v.trim() : null;
}

/** Strip company noise (LLC/Inc/…), apostrophes, punctuation, and case. */
function normalizeCompanyName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/['’`]/g, "") // Bob's → bobs (so it matches a "Bobs" page)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company|group|the|official)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when an Ad Library page plausibly IS this competitor. Used only for the
 * name-search fallback (search_terms returns ads from ANY advertiser matching the
 * term), so we never misattribute an unrelated brand's ad to a competitor.
 * A precise numeric page-id search does not need this.
 *
 * Token-subset match (every word of the competitor name is a whole word of the
 * page name) — so "Acme Plumbing" matches "Acme Plumbing LLC" but "Rival" never
 * matches "Rivalry" (substring coincidences are rejected).
 */
function pageNameMatchesCompetitor(competitorName, pageName) {
  const c = normalizeCompanyName(competitorName);
  const p = normalizeCompanyName(pageName);
  if (!c || !p) return false;
  if (c === p) return true;
  const cTokens = c.split(" ").filter(Boolean);
  const pTokens = new Set(p.split(" ").filter(Boolean));
  if (cTokens.length === 0) return false;
  return cTokens.every((t) => pTokens.has(t));
}

/** Normalize one raw Ad Library row into our stored ad shape (or null). */
function normalizeAd(raw, competitor) {
  if (!raw || !raw.id) return null;
  const body = firstString(raw.ad_creative_bodies);
  const headline = firstString(raw.ad_creative_link_titles);
  const cta = firstString(raw.ad_creative_link_captions);
  const platforms = Array.isArray(raw.publisher_platforms)
    ? raw.publisher_platforms.filter((p) => typeof p === "string")
    : [];
  const deliveryStart =
    typeof raw.ad_delivery_start_time === "string" && raw.ad_delivery_start_time
      ? raw.ad_delivery_start_time.slice(0, 10)
      : null;
  // Skip empty shells: an ad with no copy AND no headline tells us nothing real.
  if (!body && !headline) return null;
  return {
    adArchiveId: String(raw.id),
    competitorId: (competitor && competitor.competitor_id) || null,
    competitorName: (competitor && competitor.name) || raw.page_name || "Competitor",
    pageName: raw.page_name || null,
    headline: headline || null,
    body: body || null,
    cta: cta || null,
    snapshotUrl: raw.ad_snapshot_url || null,
    platforms,
    deliveryStart,
  };
}

/**
 * Fetch the active ads for ONE competitor. Prefers a numeric Page id
 * (search_page_ids, precise) when the competitor's Facebook page URL resolves to
 * one; otherwise falls back to the competitor's name (search_terms). Returns a
 * de-duplicated array of normalized ads, or [] on any failure / no token.
 *
 * @param {object} brand
 * @param {object} competitor  a sage_competitors row (name, facebook_page, ...)
 * @returns {Promise<Array>}
 */
async function fetchCompetitorAds(brand, competitor) {
  if (!accessToken || !competitor) return [];
  const name = competitor.name && String(competitor.name).trim();
  const pageRef = pageRefFromUrl(competitor.facebook_page);
  const params = {
    ad_reached_countries: reachedCountries(brand),
    ad_type: "ALL",
    ad_active_status: "ACTIVE",
    fields: AD_FIELDS,
    limit: MAX_ADS_PER_COMPETITOR,
  };
  // A numeric page id is a precise advertiser filter; a slug is not addressable
  // by search_page_ids, so for slugs we search by the competitor's name instead.
  let byName = false;
  if (pageRef && /^\d+$/.test(pageRef)) {
    params.search_page_ids = [pageRef];
  } else if (name) {
    params.search_terms = name;
    byName = true;
  } else {
    return [];
  }

  try {
    const data = await graphGet(AD_LIBRARY_PATH, params, accessToken);
    const rows = (data && Array.isArray(data.data) && data.data) || [];
    const seen = new Set();
    const ads = [];
    for (const raw of rows) {
      const ad = normalizeAd(raw, competitor);
      if (!ad || seen.has(ad.adArchiveId)) continue;
      // Name-search returns ads from ANY advertiser matching the term, so keep
      // only the ones whose page actually IS this competitor (no misattribution).
      if (byName && !pageNameMatchesCompetitor(name, ad.pageName)) continue;
      seen.add(ad.adArchiveId);
      ads.push(ad);
    }
    return ads;
  } catch (_err) {
    // Token lacks ads_read, not identity-confirmed, network error, etc. —
    // Ad Library access is optional, so we skip rather than fail the scan.
    return [];
  }
}

module.exports = {
  isConfigured,
  fetchCompetitorAds,
  normalizeAd,
  reachedCountries,
  pageNameMatchesCompetitor,
};
