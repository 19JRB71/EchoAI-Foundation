const db = require("../config/db");

function toJsonbParam(value) {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

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
              visual_style_preferences, target_audience, created_at, updated_at
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
              visual_style_preferences, target_audience, created_at, updated_at
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

  const fields = [];
  const values = [];
  let idx = 1;

  if (name !== undefined) {
    fields.push(`brand_name = $${idx++}`);
    values.push(name);
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
                 visual_style_preferences, target_audience, updated_at`,
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

module.exports = {
  createBrand,
  getBrands,
  getBrandProfile,
  updateBrand,
  deleteBrand,
};
