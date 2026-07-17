/**
 * Canonical intelligence store (Sage V2 Phase 2, W2: one write path).
 *
 * Behind SAGE_V2_INTEL_STORE (default OFF):
 *   OFF — nothing here runs; the legacy sage_intelligence_feed paths behave
 *         exactly as before.
 *   ON  — saveIntelItem() is the ONLY writer of new intelligence (into
 *         sage_intel_items), and every reader targets sage_intel_items via
 *         feedTarget(). A per-process idempotent catch-up backfill copies any
 *         feed rows written while the flag was off (keys preserved, so
 *         dedup/soft-dismiss history survives byte-for-byte).
 *
 * sage_intel_items deliberately mirrors the feed's column names, so readers
 * only switch the relation (+ `item_id AS feed_id`). Dedup contract is the
 * proven dual-key pattern: signal_key upsert + visible-content partial unique.
 *
 * Redaction (W8) happens HERE, inside the single chokepoint, so no collector
 * can bypass it. Items flagged sensitive are owner-only by policy and must be
 * excluded from any cross-brand aggregation unconditionally.
 */

const crypto = require("crypto");
const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");
const { redactItemFields } = require("./intelRedaction");

const LEGACY = { table: "sage_intelligence_feed", idCol: "feed_id" };
const CANONICAL = { table: "sage_intel_items", idCol: "item_id" };

async function enabled() {
  return getSwitch("SAGE_V2_INTEL_STORE");
}

/** Content-level dedup key — MUST stay in sync with sageController.contentKeyOf
 *  and the SQL backfill in models/101_sage_feed_dismiss.sql. */
function contentKeyOf(summary) {
  const normalized = String(summary || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return crypto.createHash("md5").update(normalized).digest("hex");
}

// --- cutover catch-up backfill ----------------------------------------------
// Idempotent (ON CONFLICT DO NOTHING on the preserved primary key). Runs at
// most once per process lifetime AFTER the flag is seen ON; migration 117
// already did the initial copy, this catches rows the legacy path wrote since.
let backfillPromise = null;
function backfillFromFeed() {
  if (!backfillPromise) {
    backfillPromise = db
      .query(
        `INSERT INTO sage_intel_items
           (item_id, brand_id, source_type, summary, why_it_matters, url,
            source_title, urgent, signal_key, content_key, dismissed_at, created_at)
         SELECT feed_id, brand_id, source_type, summary, why_it_matters, url,
                source_title, urgent, signal_key, content_key, dismissed_at, created_at
           FROM sage_intelligence_feed
         ON CONFLICT (item_id) DO NOTHING`,
      )
      .catch((err) => {
        backfillPromise = null; // allow retry on the next call
        throw err;
      });
  }
  return backfillPromise;
}

function _resetBackfillForTests() {
  backfillPromise = null;
}

/**
 * Which relation should intelligence READERS target right now?
 * Returns { table, idCol } — select `${idCol} AS feed_id` where the legacy
 * shape is needed. Triggers the catch-up backfill on first canonical use.
 */
async function feedTarget() {
  if (!(await enabled())) return LEGACY;
  await backfillFromFeed();
  return CANONICAL;
}

// --- the single canonical writer ---------------------------------------------
/**
 * Upsert one finding into the canonical store. Same dedup + dismissed-stays-
 * dismissed semantics as the legacy saveFeedItem, plus V2 columns and
 * mandatory redaction. Callers must have routed through the flag check
 * (sageController.saveFeedItem does this).
 */
async function saveIntelItem(brandId, rawItem) {
  const { item } = redactItemFields(rawItem);
  const contentKey = contentKeyOf(item.summary);
  const confidence = ["verified", "reported", "inferred"].includes(item.confidence)
    ? item.confidence
    : "reported";
  const sensitive = Boolean(item.sensitive);
  const source = item.source || "sage_research";

  const existing = await db.query(
    `SELECT item_id, dismissed_at
       FROM sage_intel_items
      WHERE brand_id = $1 AND (signal_key = $2 OR content_key = $3)
      ORDER BY (dismissed_at IS NULL) DESC, created_at DESC
      LIMIT 1`,
    [brandId, item.signal_key, contentKey],
  );
  const row = existing.rows[0];
  if (row && row.dismissed_at) return; // owner deleted it — stay deleted
  if (row) {
    await db.query(
      `UPDATE sage_intel_items SET
         source_type = $2, summary = $3, why_it_matters = $4, url = $5,
         source_title = $6, urgent = $7, content_key = $8, confidence = $9,
         sensitive = $10, source = $11, source_ref = $12, expires_at = $13,
         created_at = NOW()
       WHERE item_id = $1 AND dismissed_at IS NULL`,
      [
        row.item_id,
        item.source_type,
        item.summary,
        item.why_it_matters,
        item.url || null,
        item.source_title || null,
        Boolean(item.urgent),
        contentKey,
        confidence,
        sensitive,
        source,
        item.source_ref || null,
        item.expires_at || null,
      ],
    );
    return;
  }
  try {
    await db.query(
      `INSERT INTO sage_intel_items
         (brand_id, source_type, summary, why_it_matters, url, source_title,
          urgent, signal_key, content_key, confidence, sensitive, source,
          source_ref, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (brand_id, signal_key) DO UPDATE SET
         source_type = EXCLUDED.source_type,
         summary = EXCLUDED.summary,
         why_it_matters = EXCLUDED.why_it_matters,
         url = EXCLUDED.url,
         source_title = EXCLUDED.source_title,
         urgent = EXCLUDED.urgent,
         content_key = EXCLUDED.content_key,
         confidence = EXCLUDED.confidence,
         sensitive = EXCLUDED.sensitive,
         source = EXCLUDED.source,
         source_ref = EXCLUDED.source_ref,
         expires_at = EXCLUDED.expires_at,
         created_at = NOW()
       WHERE sage_intel_items.dismissed_at IS NULL`,
      [
        brandId,
        item.source_type,
        item.summary,
        item.why_it_matters,
        item.url || null,
        item.source_title || null,
        Boolean(item.urgent),
        item.signal_key,
        contentKey,
        confidence,
        sensitive,
        source,
        item.source_ref || null,
        item.expires_at || null,
      ],
    );
  } catch (err) {
    // uq_sage_intel_content_visible: a concurrent writer already saved this
    // finding under a different signal_key — dedup did its job, no-op.
    if (err && err.code === "23505") return;
    throw err;
  }
}

/**
 * Soft-dismiss an item by id. Also mirrors the dismissal onto the frozen
 * legacy row with the same id (owner intent, idempotent, best-effort) so a
 * flag rollback can never resurrect an item the owner deleted while V2 was on.
 */
async function dismissItem(brandId, itemId) {
  const r = await db.query(
    `UPDATE sage_intel_items SET dismissed_at = NOW()
      WHERE item_id = $1 AND brand_id = $2 AND dismissed_at IS NULL
      RETURNING item_id`,
    [itemId, brandId],
  );
  try {
    await db.query(
      `UPDATE sage_intelligence_feed SET dismissed_at = NOW()
        WHERE feed_id = $1 AND brand_id = $2 AND dismissed_at IS NULL`,
      [itemId, brandId],
    );
  } catch (_e) {
    /* legacy mirror is best-effort */
  }
  return r.rowCount > 0;
}

module.exports = {
  enabled,
  feedTarget,
  saveIntelItem,
  dismissItem,
  backfillFromFeed,
  contentKeyOf,
  _resetBackfillForTests,
  LEGACY,
  CANONICAL,
};
