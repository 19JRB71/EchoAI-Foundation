const db = require("../config/db");
const { toJsonbParam } = require("../utils/jsonb");
const { isValidBrandType } = require("../config/goals");
const { normalizeWebsiteUrl, normalizeFacebookPageUrl } = require("../utils/onlinePresence");

/**
 * POST /api/brands
 * Creates a new brand linked to the authenticated user.
 */
async function createBrand(req, res) {
  const userId = req.user.userId;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  try {
    const result = await db.query(
      `INSERT INTO brands (user_id, brand_name)
       VALUES ($1, $2)
       RETURNING brand_id, user_id, brand_name, created_at`,
      [userId, name]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create brand error:", err.message);
    return res.status(500).json({ error: "Failed to create brand" });
  }
}

/**
 * GET /api/brands
 * Returns all brands belonging to the authenticated user.
 */
async function getBrands(req, res) {
  const userId = req.user.userId;

  try {
    const result = await db.query(
      `SELECT brand_id, brand_name, brand_personality, voice_description,
              visual_style_preferences, target_audience, brand_type, is_demo,
              demo_tier, website_url, facebook_page_url, created_at, updated_at
       FROM brands
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    return res.json({ count: result.rows.length, brands: result.rows });
  } catch (err) {
    console.error("Get brands error:", err.message);
    return res.status(500).json({ error: "Failed to fetch brands" });
  }
}

/**
 * GET /api/brands/:brandId
 * Returns the complete brand profile, including all discovery data.
 */
async function getBrandProfile(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const result = await db.query(
      `SELECT brand_id, user_id, brand_name, brand_personality, voice_description,
              visual_style_preferences, target_audience, brand_type,
              website_url, facebook_page_url, created_at, updated_at
       FROM brands
       WHERE brand_id = $1 AND user_id = $2`,
      [brandId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Brand not found" });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Get brand profile error:", err.message);
    return res.status(500).json({ error: "Failed to fetch brand profile" });
  }
}

/**
 * PUT /api/brands/:brandId
 * Updates brand name, personality, voice, visual style, and/or target audience.
 */
async function updateBrand(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  const { name, personality, voiceDescription, visualStylePreferences, targetAudience } = req.body;
  // Accept both camelCase and snake_case for brand type: clients (goal editor +
  // setup wizard) post `brand_type`, but keep `brandType` for compatibility.
  const brandType = req.body.brandType !== undefined ? req.body.brandType : req.body.brand_type;

  const fields = [];
  const values = [];
  let idx = 1;

  if (name !== undefined) {
    fields.push(`brand_name = $${idx++}`);
    values.push(name);
  }
  if (brandType !== undefined) {
    if (!isValidBrandType(brandType)) {
      return res.status(400).json({ error: "Invalid brandType" });
    }
    fields.push(`brand_type = $${idx++}`);
    values.push(brandType);
  }
  if (personality !== undefined) {
    fields.push(`brand_personality = $${idx++}`);
    values.push(personality);
  }
  if (voiceDescription !== undefined) {
    fields.push(`voice_description = $${idx++}`);
    values.push(voiceDescription);
  }
  if (visualStylePreferences !== undefined) {
    fields.push(`visual_style_preferences = $${idx++}::jsonb`);
    values.push(toJsonbParam(visualStylePreferences));
  }
  if (targetAudience !== undefined) {
    fields.push(`target_audience = $${idx++}::jsonb`);
    values.push(toJsonbParam(targetAudience));
  }
  // Online presence: manual owner edit is authoritative — a blank value clears
  // the field on purpose; a malformed value is a 400, never silently dropped.
  const websiteUrl = req.body.websiteUrl !== undefined ? req.body.websiteUrl : req.body.website_url;
  if (websiteUrl !== undefined) {
    const norm = normalizeWebsiteUrl(websiteUrl);
    if (!norm.ok) {
      return res.status(400).json({ error: "websiteUrl must be a valid web address (e.g. https://yourbusiness.com)" });
    }
    fields.push(`website_url = $${idx++}`);
    values.push(norm.value);
  }
  const facebookPageUrl =
    req.body.facebookPageUrl !== undefined ? req.body.facebookPageUrl : req.body.facebook_page_url;
  if (facebookPageUrl !== undefined) {
    const norm = normalizeFacebookPageUrl(facebookPageUrl);
    if (!norm.ok) {
      return res.status(400).json({ error: "facebookPageUrl must be a Facebook page link or page name" });
    }
    fields.push(`facebook_page_url = $${idx++}`);
    values.push(norm.value);
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: "No fields provided to update" });
  }

  values.push(brandId, userId);

  try {
    const result = await db.query(
      `UPDATE brands
         SET ${fields.join(", ")}
       WHERE brand_id = $${idx++} AND user_id = $${idx}
       RETURNING brand_id, brand_name, brand_personality, voice_description,
                 visual_style_preferences, target_audience, brand_type,
                 website_url, facebook_page_url, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Brand not found" });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update brand error:", err.message);
    return res.status(500).json({ error: "Failed to update brand" });
  }
}

/**
 * DELETE /api/brands/:brandId
 * Removes a brand and all associated data (leads, campaigns, analytics cascade
 * via foreign keys).
 */
async function deleteBrand(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const result = await db.query(
      "DELETE FROM brands WHERE brand_id = $1 AND user_id = $2 RETURNING brand_id",
      [brandId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Brand not found" });
    }

    return res.json({ message: "Brand deleted", brandId: result.rows[0].brand_id });
  } catch (err) {
    console.error("Delete brand error:", err.message);
    return res.status(500).json({ error: "Failed to delete brand" });
  }
}

/**
 * GET /api/brands/active/selection
 * The brand the owner was last working on (restored at login). Returns
 * { brandId: null } when never set or when the stored brand no longer exists /
 * no longer belongs to this user — the client falls back to its default.
 */
async function getActiveBrand(req, res) {
  try {
    const result = await db.query(
      `SELECT u.last_active_brand_id AS brand_id
         FROM users u
         JOIN brands b ON b.brand_id = u.last_active_brand_id AND b.user_id = u.user_id
        WHERE u.user_id = $1`,
      [req.user.userId]
    );
    return res.json({ brandId: result.rows.length ? result.rows[0].brand_id : null });
  } catch (err) {
    console.error("Get active brand error:", err.message);
    return res.status(500).json({ error: "Failed to fetch active brand" });
  }
}

/**
 * PUT /api/brands/active/selection
 * Persist the currently selected brand. Ownership is enforced with a join to
 * brands on user_id — a foreign brand id 404s and writes nothing. `brandId:
 * null` clears the selection.
 */
async function setActiveBrand(req, res) {
  const { brandId } = req.body || {};
  try {
    if (brandId === null || brandId === undefined || brandId === "") {
      await db.query(`UPDATE users SET last_active_brand_id = NULL WHERE user_id = $1`, [
        req.user.userId,
      ]);
      return res.json({ brandId: null });
    }
    const result = await db.query(
      `UPDATE users u
          SET last_active_brand_id = b.brand_id
         FROM brands b
        WHERE u.user_id = $1 AND b.brand_id = $2 AND b.user_id = $1
        RETURNING b.brand_id`,
      [req.user.userId, String(brandId)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Brand not found" });
    }
    return res.json({ brandId: result.rows[0].brand_id });
  } catch (err) {
    // A malformed uuid throws 22P02 — treat it as "not found", not a crash.
    if (err.code === "22P02") {
      return res.status(404).json({ error: "Brand not found" });
    }
    console.error("Set active brand error:", err.message);
    return res.status(500).json({ error: "Failed to save active brand" });
  }
}

module.exports = {
  createBrand,
  getBrands,
  getBrandProfile,
  updateBrand,
  deleteBrand,
  getActiveBrand,
  setActiveBrand,
};
