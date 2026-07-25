/**
 * Sage — Facebook signal gathering (Ad Library + public Page posts).
 *
 * Sage's industry research is grounded in live web search, but the task also
 * requires it to read Facebook's public surfaces and feed those signals into the
 * deep-research context. Two real public sources are collected here:
 *
 *   1. Ad Library (`ads_archive`) — the ads competitors and the wider industry
 *      are actually running right now (competitor ad strategy / creative angles).
 *   2. Public Page posts — recent public posts + follower counts for the
 *      competitor Facebook Pages the owner is tracking (consumer-facing messaging
 *      and posting cadence).
 *
 * Facebook Groups are intentionally not queried: the Graph API does not expose
 * arbitrary public group content to a non-member app (group feed reads require
 * the group to install the app), so attempting it would only ever fail — we do
 * not fake a source Sage cannot actually read (honesty rule).
 *
 * Everything here is best-effort and degrades gracefully in EVERY failure mode
 * (no token, refused scope, network error, empty results): it NEVER throws — it
 * returns `{ available: false }` so a missing/limited Facebook token can't break
 * a research cycle. Real Facebook URLs it surfaces are returned as `sources` so
 * findings stay grounded in real links.
 */

const { accessToken } = require("../config/facebook");
const { graphGet } = require("./facebookApi");

const AD_LIBRARY_PATH = "ads_archive";
const AD_FIELDS =
  "page_name,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,publisher_platforms,ad_snapshot_url";
const PAGE_FIELDS =
  "name,fan_count,followers_count,posts.limit(3){message,created_time,permalink_url}";

/** Best-effort country code for Ad Library scoping (Ad Library requires one). */
function reachedCountries(brand) {
  const raw =
    (brand && (brand.country || brand.country_code || brand.market)) || "";
  const code = String(raw).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? [code] : ["US"];
}

/**
 * Extract a Graph-addressable Page reference (slug or numeric id) from a
 * Facebook page URL. Returns null when the URL isn't a recognizable page link.
 */
function pageRefFromUrl(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
  // profile.php?id=1234567890
  const idParam = u.searchParams.get("id");
  if (idParam && /^\d+$/.test(idParam)) return idParam;
  // facebook.com/<slug> (ignore known non-page prefixes)
  const seg = u.pathname.split("/").filter(Boolean)[0];
  if (!seg) return null;
  if (["profile.php", "pages", "people", "groups", "watch"].includes(seg))
    return null;
  return seg;
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
 * Read a competitor's public Page (follower count + recent public posts).
 * Returns { block, sources } or an empty result on any failure (never throws).
 */
async function queryPagePosts(competitor) {
  const ref = pageRefFromUrl(competitor && competitor.facebook_page);
  if (!ref) return { block: "", sources: [] };
  try {
    const data = await graphGet(ref, { fields: PAGE_FIELDS }, accessToken);
    if (!data || data.error) return { block: "", sources: [] };
    const name = data.name || competitor.name || ref;
    const followers = data.followers_count || data.fan_count;
    const posts = (data.posts && Array.isArray(data.posts.data) && data.posts.data) || [];
    const postLines = posts
      .filter((p) => p && (p.message || p.permalink_url))
      .map((p) => {
        const when = p.created_time ? String(p.created_time).slice(0, 10) : "";
        const msg = p.message
          ? `"${String(p.message).replace(/\s+/g, " ").slice(0, 180)}"`
          : "(no text)";
        return `  - ${when ? `${when}: ` : ""}${msg}`;
      });
    if (!followers && postLines.length === 0) return { block: "", sources: [] };
    const header = `${name}${
      followers ? ` (${followers} followers)` : ""
    } — recent public posts:`;
    const block =
      postLines.length > 0 ? `${header}\n${postLines.join("\n")}` : header;
    const sources = posts
      .filter((p) => p && p.permalink_url)
      .map((p) => ({ url: p.permalink_url, title: `Facebook — ${name}` }));
    return { block, sources };
  } catch (_err) {
    // Page Public Content Access not granted, page not found, etc. — skip.
    return { block: "", sources: [] };
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

  const comps = Array.isArray(competitors) ? competitors : [];
  const countries = reachedCountries(brand);

  // Ad Library search terms: the industry plus up to 3 tracked competitor names.
  const terms = [];
  if (brand && brand.industry) terms.push(String(brand.industry).slice(0, 80));
  for (const c of comps) {
    if (c && c.name && terms.length < 4) terms.push(String(c.name).slice(0, 80));
  }

  const [adResults, pageResults] = await Promise.all([
    Promise.all(terms.map((t) => queryAdLibrary(t, countries))),
    Promise.all(comps.map((c) => queryPagePosts(c))),
  ]);

  const sections = [];
  const sources = [];
  const seenUrls = new Set();
  const addSources = (list) => {
    for (const s of list) {
      if (s && s.url && !seenUrls.has(s.url)) {
        seenUrls.add(s.url);
        sources.push(s);
      }
    }
  };

  const adBlocks = [];
  for (const r of adResults) {
    if (r.lines.length === 0) continue;
    adBlocks.push(`Ads currently running for "${r.term}":\n${r.lines.join("\n")}`);
    addSources(r.sources);
  }
  if (adBlocks.length > 0) {
    sections.push(
      `Live Facebook Ad Library data (${countries.join(
        ", ",
      )}) — real ads competitors and this industry are running right now:\n${adBlocks.join(
        "\n\n",
      )}`,
    );
  }

  const postBlocks = [];
  for (const r of pageResults) {
    if (!r.block) continue;
    postBlocks.push(r.block);
    addSources(r.sources);
  }
  if (postBlocks.length > 0) {
    sections.push(
      `Competitor public Facebook Page activity (real recent posts + follower counts):\n${postBlocks.join(
        "\n\n",
      )}`,
    );
  }

  if (sections.length === 0)
    return { available: false, summary: "", sources: [] };

  return {
    available: true,
    summary: sections.join("\n\n"),
    sources: sources.slice(0, 10),
  };
}

module.exports = { gatherFacebookSignals, pageRefFromUrl };
