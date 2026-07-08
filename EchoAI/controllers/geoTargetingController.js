/**
 * Geographic targeting + exclusion zones (all tiers).
 *
 * GET  /api/geo/:brandId  — current config + plain-language summary
 * PUT  /api/geo/:brandId  — replace config (areas + exclusions)
 *
 * Sage-added exclusions are preserved across owner saves unless the owner
 * explicitly removes them (the client sends back the full exclusion list, so
 * a save without a sage entry means the owner deleted it — their call).
 */

const db = require("../config/db");
const { toJsonbParam } = require("../utils/jsonb");
const {
  normalizeGeo,
  parseGeo,
  geoSummaryText,
} = require("../utils/geoTargeting");

async function getOwnedBrand(brandId, userId) {
  const result = await db.query(
    "SELECT brand_id, brand_name, industry, geo_targeting FROM brands WHERE brand_id = $1 AND user_id = $2",
    [brandId, userId]
  );
  return result.rows[0] || null;
}

function serialize(brand) {
  const geo = parseGeo(brand.geo_targeting) || { areas: [], exclusions: [] };
  return {
    brandId: brand.brand_id,
    areas: geo.areas,
    exclusions: geo.exclusions,
    summary: geoSummaryText(geo) || null,
    configured: Boolean(geo.areas.length || geo.exclusions.length),
  };
}

async function getGeoTargeting(req, res) {
  try {
    const brand = await getOwnedBrand(req.params.brandId, req.user.userId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    return res.json(serialize(brand));
  } catch (err) {
    console.error("getGeoTargeting error:", err.message);
    return res.status(500).json({ error: "Failed to load geographic targeting" });
  }
}

async function updateGeoTargeting(req, res) {
  try {
    const brand = await getOwnedBrand(req.params.brandId, req.user.userId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    let geo;
    try {
      geo = normalizeGeo(req.body || {});
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const stored = geo.areas.length || geo.exclusions.length ? geo : null;
    const updated = await db.query(
      `UPDATE brands SET geo_targeting = $1::jsonb, updated_at = NOW()
        WHERE brand_id = $2
        RETURNING brand_id, brand_name, industry, geo_targeting`,
      [toJsonbParam(stored), brand.brand_id]
    );
    return res.json(serialize(updated.rows[0]));
  } catch (err) {
    console.error("updateGeoTargeting error:", err.message);
    return res.status(500).json({ error: "Failed to save geographic targeting" });
  }
}

module.exports = { getGeoTargeting, updateGeoTargeting };
