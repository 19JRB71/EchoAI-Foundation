/**
 * Sage — Facebook signal gathering (Ad Library + public page reads).
 *
 * Sage's industry research is grounded in live web search, but the task also
 * requires it to read Facebook's public surfaces — the Ad Library (what ads
 * competitors and the wider industry are running) and public page facts — via
 * the shared `FACEBOOK_ACCESS_TOKEN`. This module returns a compact, source-
 * cited summary that the prompt builder folds into the deep-research context.
 *
 * It degrades gracefully in EVERY failure mode (no token, refused scope,
 * network error, empty results): it NEVER throws — it returns
 * `{ available: false }` so a missing/limited Facebook token can't break a
 * research cycle. Real Facebook URLs it surfaces are returned as `sources` so
 * findings stay grounded in real links.
 */

const { accessToken } = require("../config/facebook");
const { graphGet } = require("./facebookApi");

const AD_LIBRARY_PATH = "ads_archive";
const AD_FIELDS =
  "page_name,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,publisher_platforms,ad_snapshot_url";

/** Best-effort country code for Ad Library scoping (Ad Library requires one). */
function reachedCountries(brand) {
  const raw =
    (brand && (brand.country || brand.country_code || brand.market)) || "";
  const code = String(raw).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? [code] : ["US"];
}

/** Trim/normalize an ad's creative body text for compact prompt inclusion. */
function adLine(ad) {
  const page = (ad && ad.page_name) || "Unknown advertiser";
  const body =
    (ad && Array.isArray(ad.ad_creative_bodies) && ad.ad_creative_bodies[0]) ||
    (ad && Array.isArray(ad.ad_creative_link_titles) && ad.ad_creative_link_titles[0]) ||
    "";
  const platforms =
    ad && Array.isArray(ad.publisher_platforms)
      ? ad.publisher_platforms.join("/")
      : "";
  const started = (ad && ad.ad_delivery_start_time) || "";
  const parts = [`${page}:`];
  if (body) parts.push(`"${String(body).replace(/\s+/g, " ").slice(0, 200)}"`);
  if (platforms) parts.push(`[${platforms}]`);
  if (started) parts.push(`(since ${String(started).slice(0, 10)})`);
  return `- ${parts.join(" ")}`;
}

/**
 * Query the Ad Library for one search term. Returns { lines, sources } or an
 * empty result on any failure (never throws).
 */
async function queryAdLibrary(term, countries) {
  try {
    const data = await graphGet(
      AD_LIBRARY_PATH,
      {
        search_terms: term,
        ad_reached_countries: countries,
        ad_type: "ALL",
        ad_active_status: "ACTIVE",
        fields: AD_FIELDS,
        limit: 5,
      },
      accessToken,
    );
    const ads = (data && Array.isArray(data.data) && data.data) || [];
    const lines = ads.map(adLine);
    const sources = ads
      .filter((a) => a && a.ad_snapshot_url)
      .map((a) => ({
        url: a.ad_snapshot_url,
        title: `Facebook Ad Library — ${a.page_name || "advertiser"}`,
      }));
    return { term, lines, sources };
  } catch (_err) {
    // Token lacks ads_read, not identity-confirmed, network error, etc. —
    // Facebook data is supplementary, so we silently skip it.
    return { term, lines: [], sources: [] };
  }
}

/**
 * Gather Facebook signals for a brand's deep-research cycle.
 *
 * @returns {Promise<{available: boolean, summary: string, sources: Array<{url,title}>}>}
 *   `available:false` when the token is unset or nothing usable came back.
 */
async function gatherFacebookSignals(brand, competitors = []) {
  if (!accessToken) return { available: false, summary: "", sources: [] };

  const countries = reachedCountries(brand);
  // A small, targeted set of search terms: the industry plus up to 3 tracked
  // competitor names (competitor ad strategy is the highest-signal read).
  const terms = [];
  if (brand && brand.industry) terms.push(String(brand.industry).slice(0, 80));
  for (const c of Array.isArray(competitors) ? competitors : []) {
    if (c && c.name && terms.length < 4) terms.push(String(c.name).slice(0, 80));
  }
  if (terms.length === 0) return { available: false, summary: "", sources: [] };

  const results = await Promise.all(
    terms.map((t) => queryAdLibrary(t, countries)),
  );

  const blocks = [];
  const sources = [];
  const seenUrls = new Set();
  for (const r of results) {
    if (r.lines.length === 0) continue;
    blocks.push(`Ads currently running for "${r.term}":\n${r.lines.join("\n")}`);
    for (const s of r.sources) {
      if (s.url && !seenUrls.has(s.url)) {
        seenUrls.add(s.url);
        sources.push(s);
      }
    }
  }

  if (blocks.length === 0) return { available: false, summary: "", sources: [] };

  const summary = `Live Facebook Ad Library data (${countries.join(
    ", ",
  )}) — real ads competitors and this industry are running right now:\n${blocks.join(
    "\n\n",
  )}`;
  return { available: true, summary, sources: sources.slice(0, 8) };
}

module.exports = { gatherFacebookSignals };
