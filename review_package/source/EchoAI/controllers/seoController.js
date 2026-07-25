const db = require("../config/db");
const {
  CONTENT_TYPES,
  generateSeoContent,
  generateKeywordSuggestions,
} = require("../prompts/seoContentPrompt");

/**
 * Loads a brand only if it belongs to the authenticated user. Returns null when
 * the brand does not exist or is not owned by the user.
 */
async function getOwnedBrand(userId, brandId) {
  const result = await db.query(
    `SELECT brand_id, brand_name, brand_personality, voice_description,
            visual_style_preferences, target_audience
     FROM brands
     WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId],
  );
  return result.rows[0] || null;
}

function clampScore(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

/**
 * POST /api/seo/generate  { brandId, keyword, contentType }
 * Generates a complete SEO content package for a brand + keyword + content type.
 */
async function generateContent(req, res) {
  const userId = req.user.userId;
  const { brandId, keyword, contentType } = req.body;

  if (!brandId || !keyword || !keyword.trim()) {
    return res.status(400).json({ error: "brandId and keyword are required" });
  }
  if (!CONTENT_TYPES[contentType]) {
    return res.status(400).json({
      error: `contentType must be one of: ${Object.keys(CONTENT_TYPES).join(", ")}`,
    });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const content = await generateSeoContent(brand, keyword.trim(), contentType);
    return res.json({
      brandId,
      keyword: keyword.trim(),
      contentType,
      content,
    });
  } catch (err) {
    console.error("Generate SEO content error:", err.message);
    if (typeof err.status === "number" && err.status >= 400) {
      return res.status(502).json({
        error:
          "The AI provider could not generate SEO content right now. Please try again shortly.",
      });
    }
    return res.status(500).json({ error: "Failed to generate SEO content" });
  }
}

/**
 * POST /api/seo/keywords  { topic }
 * Returns ten related keyword suggestions with search-volume categories.
 */
async function getKeywordSuggestions(req, res) {
  const { topic } = req.body;
  if (!topic || !topic.trim()) {
    return res.status(400).json({ error: "topic is required" });
  }

  try {
    const keywords = await generateKeywordSuggestions(topic.trim());
    return res.json({ topic: topic.trim(), count: keywords.length, keywords });
  } catch (err) {
    console.error("Get keyword suggestions error:", err.message);
    if (typeof err.status === "number" && err.status >= 400) {
      return res.status(502).json({
        error:
          "The AI provider could not generate keyword ideas right now. Please try again shortly.",
      });
    }
    return res.status(500).json({ error: "Failed to generate keyword suggestions" });
  }
}

/**
 * POST /api/seo  { brandId, keyword, contentType, content, seoScore? }
 * Saves a generated SEO content package to the seo_content table.
 */
async function saveContent(req, res) {
  const userId = req.user.userId;
  const { brandId, keyword, contentType, content } = req.body;

  if (!brandId || !keyword || !contentType || !content) {
    return res.status(400).json({
      error: "brandId, keyword, contentType, and content are required",
    });
  }
  if (!CONTENT_TYPES[contentType]) {
    return res.status(400).json({
      error: `contentType must be one of: ${Object.keys(CONTENT_TYPES).join(", ")}`,
    });
  }

  // The SEO score lives inside the content package; allow an explicit override.
  const seoScore =
    clampScore(req.body.seoScore) ?? clampScore(content.seoScore);

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `INSERT INTO seo_content
         (brand_id, keyword, content_type, generated_content, seo_score)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING content_id, brand_id, keyword, content_type, generated_content,
                 seo_score, created_at, updated_at`,
      [brandId, keyword, contentType, JSON.stringify(content), seoScore],
    );
    return res.status(201).json({ content: result.rows[0] });
  } catch (err) {
    console.error("Save SEO content error:", err.message);
    return res.status(500).json({ error: "Failed to save SEO content" });
  }
}

/**
 * GET /api/seo/:brandId
 * Returns all saved SEO content for a brand (newest first).
 */
async function getContent(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `SELECT content_id, brand_id, keyword, content_type, generated_content,
              seo_score, created_at, updated_at
       FROM seo_content
       WHERE brand_id = $1
       ORDER BY created_at DESC`,
      [brandId],
    );

    const content = result.rows.map((row) => ({
      contentId: row.content_id,
      brandId: row.brand_id,
      keyword: row.keyword,
      contentType: row.content_type,
      content: row.generated_content,
      seoScore: row.seo_score,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return res.json({ brandId, count: content.length, content });
  } catch (err) {
    console.error("Get SEO content error:", err.message);
    return res.status(500).json({ error: "Failed to fetch SEO content" });
  }
}

/**
 * DELETE /api/seo/:contentId
 * Deletes a saved SEO content item, enforcing ownership via the brand join.
 */
async function deleteContent(req, res) {
  const userId = req.user.userId;
  const { contentId } = req.params;

  try {
    const result = await db.query(
      `DELETE FROM seo_content sc
       USING brands b
       WHERE sc.content_id = $1
         AND sc.brand_id = b.brand_id
         AND b.user_id = $2
       RETURNING sc.content_id`,
      [contentId, userId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "SEO content not found" });
    }
    return res.json({ deleted: true, contentId });
  } catch (err) {
    console.error("Delete SEO content error:", err.message);
    return res.status(500).json({ error: "Failed to delete SEO content" });
  }
}

module.exports = {
  generateContent,
  getKeywordSuggestions,
  saveContent,
  getContent,
  deleteContent,
};
