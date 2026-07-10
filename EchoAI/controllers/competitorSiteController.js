/**
 * Competitor Website Analysis controller (Scout, Enterprise).
 *
 * Owners manually add competitor WEBSITE URLs per brand. Scout reads each site
 * (Anthropic web_fetch) and stores a structured analysis; a daily sweep re-reads
 * each URL and records only MEANINGFUL changes, alerting the owner once per change
 * (voice + push), deep-linked to the Scout "Competitor Sites" section.
 *
 * Invariants (matching Competitor Ad Spy):
 *   - Ownership via getOwnedBrand(userId, brandId) — 404 on a foreign brand.
 *   - AI/upstream failures map to HTTP 502 (never mocked). Unreadable/blocked
 *     sites are an explicit 'error' status with an honest last_error, not a crash
 *     or a fabricated success.
 *   - Background paths (scheduler) enforce the Enterprise tier themselves because
 *     route featureGate never runs there; admin bypasses. Demo brands never alert.
 *   - Change alerts fire at-most-once via the change row's unique key + owner CAS.
 */

const db = require("../config/db");
const { meetsTier } = require("../config/tiers");
const { getUserTier } = require("../middleware/featureGate");
const { toJsonbParam } = require("../utils/jsonb");
const { normalizeCompetitorUrl } = require("../utils/competitorSiteUrl");
const { analyzeWebsite, detectChanges } = require("../prompts/competitorSitePrompt");
const { enqueueOwnerVoiceEvent } = require("../utils/echoVoiceNotifications");
const pushController = require("./pushController");
const mobilePushController = require("./mobilePushController");

const SITE_TIER = "enterprise";
// A tracked URL is re-checked at most once per this window (daily cadence with a
// safety margin so overlapping scheduler ticks can't double-run one site).
const RECHECK_INTERVAL = "20 hours";
const MAX_SITES_PER_BRAND = 25;

/** Loads a brand only if it belongs to the authenticated user. */
async function getOwnedBrand(userId, brandId) {
  const result = await db.query(
    `SELECT brand_id, user_id, brand_name, is_demo
       FROM brands
      WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId],
  );
  return result.rows[0] || null;
}

/** Maps a thrown error to the right HTTP status (AI/provider failures → 502). */
function sendError(res, err, fallbackMsg) {
  if (err.aiInvalid || (typeof err.status === "number" && err.status >= 400)) {
    return res.status(502).json({
      error:
        "Scout could not complete this website analysis right now. Please try again shortly.",
    });
  }
  console.error("competitorSite error:", err.message);
  return res.status(500).json({ error: fallbackMsg });
}

function signalKey(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function mapChangeRow(r) {
  return {
    changeId: r.change_id,
    changeType: r.change_type,
    summary: r.summary,
    detail: (r.details && r.details.detail) || null,
    detectedAt: r.detected_at,
  };
}

function mapSiteRow(r, changes = []) {
  return {
    siteId: r.site_id,
    url: r.url,
    label: r.label,
    status: r.status,
    lastError: r.last_error,
    analysis: {
      pricing: r.pricing,
      offers: r.offers,
      messaging: r.messaging,
      products: r.products,
      ctas: r.ctas,
      positioning: r.positioning,
      summary: r.summary,
    },
    lastCheckedAt: r.last_checked_at,
    lastAnalyzedAt: r.last_analyzed_at,
    lastChangedAt: r.last_changed_at,
    createdAt: r.created_at,
    changes: changes.map(mapChangeRow),
  };
}

/* --------------------------- persistence helpers -------------------------- */

/** Store a fresh analysis snapshot on a site (also flips status → analyzed). */
async function storeAnalysis(siteId, analysis) {
  await db.query(
    `UPDATE competitor_websites
        SET pricing = $2, offers = $3, messaging = $4, products = $5,
            ctas = $6, positioning = $7, summary = $8,
            analysis = $9::jsonb, status = 'analyzed', last_error = NULL,
            last_analyzed_at = NOW(), last_checked_at = NOW(), updated_at = NOW()
      WHERE site_id = $1`,
    [
      siteId,
      analysis.pricing,
      analysis.offers,
      analysis.messaging,
      analysis.products,
      analysis.ctas,
      analysis.positioning,
      analysis.summary,
      toJsonbParam(analysis),
    ],
  );
}

/** Mark a site as unreadable with an honest reason (never fabricate analysis). */
async function markUnreadable(siteId, reason) {
  await db.query(
    `UPDATE competitor_websites
        SET status = 'error', last_error = $2,
            last_checked_at = NOW(), updated_at = NOW()
      WHERE site_id = $1`,
    [siteId, (reason || "This site could not be read automatically.").slice(0, 600)],
  );
}

/**
 * Record ONE meaningful change and alert the owner exactly once. Two guards work
 * together: the unique (site_id, change_key) index dedups the change row across
 * overlapping sweeps, and a CAS on owner_alerted_at makes the alert at-most-once
 * AND recoverable — if a prior run inserted the row but crashed before alerting,
 * the row already exists (INSERT no-ops) yet owner_alerted_at is still NULL, so we
 * re-fetch its id and the CAS below wins and finally alerts. Alerts are best-effort
 * and never throw into the sweep.
 */
async function recordAndAlertChange(brand, site, change) {
  const changeKey = `${change.type}:${signalKey(change.summary)}`;
  const brandId = site.brand_id || brand.brand_id;
  const { rows } = await db.query(
    `INSERT INTO competitor_website_changes
       (site_id, brand_id, change_type, summary, details, change_key)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (site_id, change_key) DO NOTHING
     RETURNING change_id`,
    [
      site.site_id,
      brandId,
      change.type,
      change.summary,
      toJsonbParam({ detail: change.detail || null }),
      changeKey,
    ],
  );

  // Resolve the change_id whether we just inserted it or a prior (possibly
  // crashed-before-alert) run did — so an un-alerted row can still be recovered.
  let changeId = rows.length ? rows[0].change_id : null;
  if (!changeId) {
    const existing = await db.query(
      `SELECT change_id FROM competitor_website_changes
        WHERE site_id = $1 AND change_key = $2`,
      [site.site_id, changeKey],
    );
    changeId = existing.rows[0] && existing.rows[0].change_id;
  }
  if (!changeId) return;

  if (brand.is_demo) return; // demo brands never page the owner

  // CAS: claim the alert atomically so exactly one sweep alerts, even on overlap.
  const claim = await db.query(
    `UPDATE competitor_website_changes
        SET owner_alerted_at = NOW()
      WHERE change_id = $1 AND owner_alerted_at IS NULL`,
    [changeId],
  );
  if (claim.rowCount === 0) return; // already alerted

  await alertOwnerOfChange(brand, site, changeId, change);
}

/** Voice + web/mobile push, deep-linked to the Scout Competitor Sites section. */
async function alertOwnerOfChange(brand, site, changeId, change) {
  const label = site.label || site.url;
  const buildText = (firstName) =>
    `${firstName}, Scout noticed a meaningful change on a competitor's website, ${label}. ${change.summary} Open Competitor Sites in Scout to see the details.`;

  try {
    await enqueueOwnerVoiceEvent(brand.user_id, "competitor_site_change", buildText, {
      brandId: brand.brand_id,
      title: "Competitor website changed",
      payload: {
        type: "competitor_site_change",
        siteId: site.site_id,
        changeId,
        section: "competitorsites",
      },
      dedupKey: `competitor-site-change-${changeId}`,
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });
  } catch (err) {
    console.error("Competitor site change voice alert failed:", err.message);
  }

  const pushPayload = {
    title: "Competitor website changed",
    body: `${label}: ${change.summary}`,
    data: { type: "competitor_site_change", brandId: brand.brand_id, section: "competitorsites" },
  };
  pushController.sendPushToUser(brand.user_id, pushPayload).catch(() => {});
  mobilePushController.sendToUser(brand.user_id, pushPayload).catch(() => {});
}

/* --------------------------------- engine --------------------------------- */

/**
 * Read a site, store the fresh analysis, and — when a prior snapshot exists —
 * detect + record + alert on meaningful changes. Unreadable sites are marked
 * 'error' (honest). AI/upstream errors bubble up (caller maps to 502 / logs).
 * `site` carries the PRIOR snapshot (site.analysis) captured before this check.
 */
async function checkSite(brand, site) {
  let analysis;
  try {
    analysis = await analyzeWebsite(brand, site);
  } catch (err) {
    if (err.siteUnreadable) {
      await markUnreadable(site.site_id, err.message);
      return { ok: false, unreadable: true, reason: err.message };
    }
    throw err;
  }

  const previous =
    site.analysis && typeof site.analysis === "object" ? site.analysis : null;

  await storeAnalysis(site.site_id, analysis);

  let changed = 0;
  if (previous) {
    const changes = await detectChanges(brand, previous, analysis);
    for (const change of changes) {
      await recordAndAlertChange(brand, site, change);
    }
    changed = changes.length;
    if (changed > 0) {
      await db.query(
        `UPDATE competitor_websites SET last_changed_at = NOW() WHERE site_id = $1`,
        [site.site_id],
      );
    }
  }
  return { ok: true, changes: changed };
}

/** Full brand row (owner + is_demo) when the scheduler passes a partial one. */
async function loadBrandRow(brand) {
  if (brand && brand.brand_name && brand.user_id) return brand;
  const { rows } = await db.query(
    `SELECT brand_id, user_id, brand_name, is_demo FROM brands WHERE brand_id = $1`,
    [brand.brand_id],
  );
  return rows[0] || null;
}

/** Sites due for a re-check (never checked, or older than the cadence window). */
async function dueSites(brandId) {
  const { rows } = await db.query(
    `SELECT * FROM competitor_websites
      WHERE brand_id = $1
        AND (last_checked_at IS NULL OR last_checked_at < NOW() - INTERVAL '${RECHECK_INTERVAL}')
      ORDER BY last_checked_at ASC NULLS FIRST`,
    [brandId],
  );
  return rows;
}

/**
 * Atomically claim one site for checking: only the tick that advances
 * last_checked_at within the cadence window wins, so overlapping sweeps can't
 * double-run (and double-spend AI on) the same URL.
 */
async function claimSiteCheck(siteId) {
  const { rowCount } = await db.query(
    `UPDATE competitor_websites SET last_checked_at = NOW(), updated_at = NOW()
      WHERE site_id = $1
        AND (last_checked_at IS NULL OR last_checked_at < NOW() - INTERVAL '${RECHECK_INTERVAL}')`,
    [siteId],
  );
  return rowCount > 0;
}

/**
 * Scheduler entry point for one brand. Enterprise-gated at the source (route
 * featureGate never runs here); admin bypasses. Best-effort per site — one URL
 * failure never aborts the brand's sweep.
 */
async function runSiteMonitorForBrand(brand) {
  const { tier, role } = await getUserTier(brand.user_id);
  if (role !== "admin" && !meetsTier(tier, SITE_TIER)) return { checked: 0 };
  const brandRow = await loadBrandRow(brand);
  if (!brandRow) return { checked: 0 };

  const sites = await dueSites(brandRow.brand_id);
  let checked = 0;
  for (const site of sites) {
    const claimed = await claimSiteCheck(site.site_id);
    if (!claimed) continue;
    try {
      await checkSite(brandRow, site);
      checked += 1;
    } catch (err) {
      console.error(
        `Competitor site check failed for site ${site.site_id}:`,
        err.message,
      );
    }
  }
  return { checked };
}

/* -------------------------------- routes ---------------------------------- */

// GET /api/competitor-sites/:brandId/sites — list tracked sites + recent changes.
async function listSites(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const { rows: sites } = await db.query(
      `SELECT * FROM competitor_websites WHERE brand_id = $1 ORDER BY created_at ASC`,
      [brand.brand_id],
    );
    const { rows: changeRows } = await db.query(
      `SELECT * FROM competitor_website_changes
        WHERE brand_id = $1 ORDER BY detected_at DESC LIMIT 100`,
      [brand.brand_id],
    );
    const changesBySite = new Map();
    for (const c of changeRows) {
      if (!changesBySite.has(c.site_id)) changesBySite.set(c.site_id, []);
      changesBySite.get(c.site_id).push(c);
    }

    return res.json({
      sites: sites.map((s) => mapSiteRow(s, changesBySite.get(s.site_id) || [])),
    });
  } catch (err) {
    return sendError(res, err, "Failed to load competitor sites.");
  }
}

// POST /api/competitor-sites/:brandId/sites — add a URL + kick off initial analysis.
async function addSite(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    let url;
    try {
      url = normalizeCompetitorUrl(req.body && req.body.url);
    } catch (err) {
      if (err.badUrl) return res.status(400).json({ error: err.message });
      throw err;
    }
    const label = ((req.body && req.body.label) || "").toString().trim().slice(0, 120) || null;

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM competitor_websites WHERE brand_id = $1`,
      [brand.brand_id],
    );
    if (countRows[0].n >= MAX_SITES_PER_BRAND) {
      return res.status(400).json({
        error: `You can track up to ${MAX_SITES_PER_BRAND} competitor sites per brand.`,
      });
    }

    const { rows } = await db.query(
      `INSERT INTO competitor_websites (brand_id, url, label, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (brand_id, url) DO NOTHING
       RETURNING *`,
      [brand.brand_id, url, label],
    );
    if (rows.length === 0) {
      return res.status(409).json({ error: "You're already tracking that site." });
    }
    const site = rows[0];

    // Kick off the initial analysis without blocking the response (web_fetch can
    // take a while); the client polls the list to see it complete. The scheduled
    // sweep also picks up any still-pending site as a backstop.
    checkSite(brand, site).catch((err) => {
      console.error(`Initial competitor site analysis failed for ${site.site_id}:`, err.message);
    });

    return res.status(201).json({ site: mapSiteRow(site) });
  } catch (err) {
    return sendError(res, err, "Failed to add the competitor site.");
  }
}

// DELETE /api/competitor-sites/:brandId/sites/:siteId — stop monitoring (cascades).
async function removeSite(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { rowCount } = await db.query(
      `DELETE FROM competitor_websites WHERE site_id = $1 AND brand_id = $2`,
      [req.params.siteId, brand.brand_id],
    );
    if (rowCount === 0) return res.status(404).json({ error: "Site not found" });
    return res.json({ removed: true });
  } catch (err) {
    return sendError(res, err, "Failed to remove the competitor site.");
  }
}

// POST /api/competitor-sites/:brandId/sites/:siteId/recheck — manual re-analysis.
async function recheckSite(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { rows } = await db.query(
      `SELECT * FROM competitor_websites WHERE site_id = $1 AND brand_id = $2`,
      [req.params.siteId, brand.brand_id],
    );
    if (rows.length === 0) return res.status(404).json({ error: "Site not found" });

    // Non-blocking (web_fetch is slow); the client polls the list for the result.
    checkSite(brand, rows[0]).catch((err) => {
      console.error(`Manual competitor site recheck failed for ${rows[0].site_id}:`, err.message);
    });
    return res.json({ checking: true });
  } catch (err) {
    return sendError(res, err, "Failed to re-check the competitor site.");
  }
}

module.exports = {
  // routes
  listSites,
  addSite,
  removeSite,
  recheckSite,
  // engine (scheduler + tests)
  checkSite,
  runSiteMonitorForBrand,
  recordAndAlertChange,
  dueSites,
  claimSiteCheck,
  getOwnedBrand,
};
