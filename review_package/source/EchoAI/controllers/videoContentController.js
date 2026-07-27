const db = require("../config/db");
const {
  generateVideoScript,
  SUPPORTED_VIDEO_PLATFORMS,
  VIDEO_LENGTHS,
} = require("../prompts/videoContentPrompt");

function isSupportedPlatform(platform) {
  return SUPPORTED_VIDEO_PLATFORMS.includes(String(platform || "").toLowerCase());
}

function isSupportedLength(length) {
  return VIDEO_LENGTHS.includes(String(length || "").toLowerCase());
}

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
    [brandId, userId]
  );
  return result.rows[0] || null;
}

/**
 * POST /api/video/generate
 * Generates a complete AI video package for a brand + topic + platform + length.
 */
async function generateScript(req, res) {
  const userId = req.user.userId;
  const { brandId, topic, platform, length } = req.body;
  const normalizedPlatform = String(platform || "").toLowerCase();
  const normalizedLength = String(length || "").toLowerCase();

  if (!brandId || !topic || !platform || !length) {
    return res.status(400).json({
      error: "brandId, topic, platform, and length are required",
    });
  }
  if (!isSupportedPlatform(normalizedPlatform)) {
    return res.status(400).json({
      error: `Unsupported platform. Supported: ${SUPPORTED_VIDEO_PLATFORMS.join(", ")}`,
    });
  }
  if (!isSupportedLength(normalizedLength)) {
    return res.status(400).json({
      error: `Unsupported length. Supported: ${VIDEO_LENGTHS.join(", ")}`,
    });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const videoPackage = await generateVideoScript(
      brand,
      topic,
      normalizedPlatform,
      normalizedLength
    );
    return res.json({
      platform: normalizedPlatform,
      length: normalizedLength,
      topic,
      videoPackage,
    });
  } catch (err) {
    console.error("Generate video script error:", err.message);
    // Surface upstream AI provider failures (billing, rate limits, outages) as a
    // 502 with a clearer message instead of a generic 500, so the cause is
    // distinguishable from an Zorecho code fault.
    if (typeof err.status === "number" && err.status >= 400) {
      return res.status(502).json({
        error:
          "The AI provider could not generate the video script right now. Please try again shortly.",
      });
    }
    return res.status(500).json({ error: "Failed to generate video script" });
  }
}

/**
 * POST /api/video/scripts
 * Saves a generated video package to the video_scripts table so users can come
 * back to it later.
 */
async function saveScript(req, res) {
  const userId = req.user.userId;
  const { brandId, topic, platform, length, scriptContent, status } = req.body;
  const normalizedPlatform = String(platform || "").toLowerCase();
  const normalizedLength = String(length || "").toLowerCase();
  const normalizedStatus = status === "published" ? "published" : "draft";

  if (!brandId || !topic || !platform || !length || !scriptContent) {
    return res.status(400).json({
      error: "brandId, topic, platform, length, and scriptContent are required",
    });
  }
  if (!isSupportedPlatform(normalizedPlatform)) {
    return res.status(400).json({
      error: `Unsupported platform. Supported: ${SUPPORTED_VIDEO_PLATFORMS.join(", ")}`,
    });
  }
  if (!isSupportedLength(normalizedLength)) {
    return res.status(400).json({
      error: `Unsupported length. Supported: ${VIDEO_LENGTHS.join(", ")}`,
    });
  }
  if (typeof scriptContent !== "object" || Array.isArray(scriptContent)) {
    return res
      .status(400)
      .json({ error: "scriptContent must be the generated video package object" });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `INSERT INTO video_scripts
         (brand_id, platform, topic, video_length, script_content, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING script_id, brand_id, platform, topic, video_length,
                 script_content, status, created_at, updated_at`,
      [
        brandId,
        normalizedPlatform,
        topic,
        normalizedLength,
        JSON.stringify(scriptContent),
        normalizedStatus,
      ]
    );
    return res.status(201).json({ script: result.rows[0] });
  } catch (err) {
    console.error("Save video script error:", err.message);
    return res.status(500).json({ error: "Failed to save video script" });
  }
}

/**
 * GET /api/video/scripts/:brandId
 * Returns all saved video scripts for a brand (newest first).
 */
async function getScripts(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `SELECT script_id, brand_id, platform, topic, video_length,
              script_content, status, created_at, updated_at
       FROM video_scripts
       WHERE brand_id = $1
       ORDER BY created_at DESC`,
      [brandId]
    );
    return res.json({
      brandId,
      count: result.rows.length,
      scripts: result.rows,
    });
  } catch (err) {
    console.error("Get video scripts error:", err.message);
    return res.status(500).json({ error: "Failed to fetch video scripts" });
  }
}

/**
 * DELETE /api/video/scripts/:scriptId
 * Removes a saved video script (only if it belongs to one of the user's brands).
 */
async function deleteScript(req, res) {
  const userId = req.user.userId;
  const { scriptId } = req.params;

  try {
    const result = await db.query(
      `DELETE FROM video_scripts vs
       USING brands b
       WHERE vs.script_id = $1
         AND vs.brand_id = b.brand_id
         AND b.user_id = $2
       RETURNING vs.script_id`,
      [scriptId, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Video script not found" });
    }
    return res.json({ deleted: true, scriptId });
  } catch (err) {
    console.error("Delete video script error:", err.message);
    return res.status(500).json({ error: "Failed to delete video script" });
  }
}

module.exports = {
  generateScript,
  saveScript,
  getScripts,
  deleteScript,
};
