const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const db = require("../config/db");
const { sageContextForBrand } = require("../utils/sageContext");
const { openai } = require("../config/openai");
const {
  PURPOSES,
  isPurpose,
  purposeMeta,
  sizeFor,
  buildImagePrompt,
  VARIANT_STYLES,
} = require("../prompts/imagePromptBuilder");
const {
  generateImagePrompts: engineerImagePrompts,
  buildBrandStyleSummary,
} = require("../prompts/imagePromptEngineerPrompt");

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "dall-e-3";

// Saved images are persisted to disk because DALL-E hosted URLs expire after a
// couple of hours. Files are written here and served statically at /uploads.
const UPLOADS_DIR = path.join(__dirname, "..", "uploads", "images");
const PUBLIC_PREFIX = "/uploads/images";

// Download guardrails. The image URL comes from the client (the temp DALL-E
// URL), so persistImage must never be a generic fetch of arbitrary URLs — that
// would be an SSRF sink. Only HTTPS URLs on the OpenAI/Azure-blob hosts that
// DALL-E serves from are accepted, and downloads are bounded by size + time.
const ALLOWED_IMAGE_HOST_SUFFIXES = [
  ".blob.core.windows.net",
  ".openai.com",
  ".oaiusercontent.com",
];
const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB
const DOWNLOAD_TIMEOUT_MS = 20000;

function isAllowedImageUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_IMAGE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Loads a brand only if it belongs to the authenticated user.
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
 * Maps an OpenAI SDK error to an HTTP status. Upstream provider failures
 * (billing, rate limits, content policy) become 502 with a clear message;
 * everything else becomes a generic 500.
 */
function sendOpenAiError(res, err, fallbackMsg) {
  const status = err && typeof err.status === "number" ? err.status : null;
  if (status && status >= 400) {
    return res.status(502).json({
      error:
        "The image provider could not generate the image right now. Please try again shortly.",
    });
  }
  return res.status(500).json({ error: fallbackMsg });
}

/**
 * Maps an AI-text failure to an HTTP status. Upstream provider failures
 * (Anthropic billing/rate/etc.) AND invalid/malformed AI output (tagged
 * `err.aiInvalid`) both become 502 with a clear message — never a generic 500,
 * and never silently mocked.
 */
function sendAiError(res, err, fallbackMsg) {
  const status = err && typeof err.status === "number" ? err.status : null;
  if (err?.aiInvalid || (status && status >= 400)) {
    return res.status(502).json({
      error:
        "The AI could not produce on-brand image prompts right now. Please try again shortly.",
    });
  }
  return res.status(500).json({ error: fallbackMsg });
}

/**
 * Generates a single image with DALL-E and returns its (temporary) URL plus the
 * prompt used.
 */
async function generateOne(brand, purpose, description, variantIndex) {
  const prompt = buildImagePrompt(brand, purpose, description, { variantIndex });
  const response = await openai.images.generate({
    model: IMAGE_MODEL,
    prompt,
    n: 1,
    size: sizeFor(purpose),
    response_format: "url",
  });
  return { imageUrl: response.data[0].url, prompt };
}

/**
 * POST /api/images/generate
 * Generates one or more image variations for a brand + purpose + description.
 * The client requests 3 variations to show side by side; a single image is
 * produced when variations === 1.
 */
async function generateImage(req, res) {
  const userId = req.user.userId;
  const { brandId, purpose, description } = req.body;
  const variations = Math.min(Math.max(Number(req.body.variations) || 1, 1), 3);

  if (!brandId || !description || !description.trim()) {
    return res
      .status(400)
      .json({ error: "brandId and description are required" });
  }
  if (purpose && !isPurpose(purpose)) {
    return res.status(400).json({ error: "Unknown image purpose" });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    brand._sageContext = await sageContextForBrand(brand.brand_id);
    const meta = purposeMeta(purpose);
    const results = await Promise.all(
      Array.from({ length: variations }, (_, i) =>
        generateOne(brand, purpose, description.trim(), i)
      )
    );

    return res.json({
      brandId,
      purpose: purpose || "instagram_post",
      platform: meta.platform,
      size: meta.size,
      images: results,
    });
  } catch (err) {
    console.error("Generate image error:", err.message);
    return sendOpenAiError(res, err, "Failed to generate image");
  }
}

/**
 * POST /api/images/ad-set
 * Generates a 3-image A/B ad creative set for a brand + campaign goal. The
 * variations share branding but use three different visual directions.
 */
async function generateAdCreativeSet(req, res) {
  const userId = req.user.userId;
  const { brandId, campaignGoal } = req.body;
  const purpose = isPurpose(req.body.purpose) ? req.body.purpose : "facebook_ad";

  if (!brandId || !campaignGoal || !campaignGoal.trim()) {
    return res
      .status(400)
      .json({ error: "brandId and campaignGoal are required" });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const meta = purposeMeta(purpose);
    const results = await Promise.all(
      VARIANT_STYLES.map((_, i) =>
        generateOne(brand, purpose, campaignGoal.trim(), i)
      )
    );

    return res.json({
      brandId,
      purpose,
      platform: meta.platform,
      size: meta.size,
      campaignGoal: campaignGoal.trim(),
      images: results,
    });
  } catch (err) {
    console.error("Generate ad creative set error:", err.message);
    return sendOpenAiError(res, err, "Failed to generate ad creative set");
  }
}

/**
 * POST /api/images/prompts
 * AI Image Prompt Engineer: returns 5 detailed, on-brand image-generation
 * prompts for a brand + purpose + content description. No image is generated
 * here — the client picks a prompt and calls /from-prompt to render it.
 */
async function generateImagePrompts(req, res) {
  const userId = req.user.userId;
  const { brandId, purpose, description } = req.body;

  if (!brandId || !description || !description.trim()) {
    return res
      .status(400)
      .json({ error: "brandId and description are required" });
  }
  if (purpose && !isPurpose(purpose)) {
    return res.status(400).json({ error: "Unknown image purpose" });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const resolvedPurpose = isPurpose(purpose) ? purpose : "instagram_post";
    const meta = purposeMeta(resolvedPurpose);
    const prompts = await engineerImagePrompts(
      brand,
      resolvedPurpose,
      description.trim()
    );

    return res.json({
      brandId,
      purpose: resolvedPurpose,
      platform: meta.platform,
      size: meta.size,
      description: description.trim(),
      prompts,
    });
  } catch (err) {
    console.error("Generate image prompts error:", err.message);
    return sendAiError(res, err, "Failed to generate image prompts");
  }
}

/**
 * Renders a single DALL-E image from an explicit (prompt-engineer authored)
 * prompt. Returns the temporary URL — the caller saves it to persist.
 */
async function renderFromPrompt(prompt, purpose) {
  const response = await openai.images.generate({
    model: IMAGE_MODEL,
    prompt,
    n: 1,
    size: sizeFor(purpose),
    response_format: "url",
  });
  const url = response?.data?.[0]?.url;
  if (!url || typeof url !== "string") {
    const err = new Error("Image generator returned no image");
    err.aiInvalid = true;
    throw err;
  }
  return url;
}

/**
 * POST /api/images/from-prompt
 * Generates one image from a specific engineer-authored prompt + purpose.
 */
async function generateImageFromPrompt(req, res) {
  const userId = req.user.userId;
  const { brandId, purpose, prompt } = req.body;

  if (!brandId || !prompt || !prompt.trim()) {
    return res.status(400).json({ error: "brandId and prompt are required" });
  }
  if (purpose && !isPurpose(purpose)) {
    return res.status(400).json({ error: "Unknown image purpose" });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const resolvedPurpose = isPurpose(purpose) ? purpose : "instagram_post";
    const meta = purposeMeta(resolvedPurpose);
    const imageUrl = await renderFromPrompt(prompt.trim(), resolvedPurpose);

    return res.json({
      brandId,
      purpose: resolvedPurpose,
      platform: meta.platform,
      size: meta.size,
      image: { imageUrl, prompt: prompt.trim() },
    });
  } catch (err) {
    console.error("Generate image from prompt error:", err.message);
    return sendOpenAiError(res, err, "Failed to generate image");
  }
}

/**
 * POST /api/images/variations
 * Generates 3 variations of an existing prompt, each nudged with a different
 * creative direction so the owner has options to choose from.
 */
async function generateImageVariations(req, res) {
  const userId = req.user.userId;
  const { brandId, purpose, prompt } = req.body;

  if (!brandId || !prompt || !prompt.trim()) {
    return res.status(400).json({ error: "brandId and prompt are required" });
  }
  if (purpose && !isPurpose(purpose)) {
    return res.status(400).json({ error: "Unknown image purpose" });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const resolvedPurpose = isPurpose(purpose) ? purpose : "instagram_post";
    const meta = purposeMeta(resolvedPurpose);
    const base = prompt.trim();

    const images = await Promise.all(
      VARIANT_STYLES.map(async (direction) => {
        const variantPrompt = `${base} Creative direction: ${direction}`;
        const imageUrl = await renderFromPrompt(variantPrompt, resolvedPurpose);
        return { imageUrl, prompt: variantPrompt };
      })
    );

    return res.json({
      brandId,
      purpose: resolvedPurpose,
      platform: meta.platform,
      size: meta.size,
      images,
    });
  } catch (err) {
    console.error("Generate image variations error:", err.message);
    return sendOpenAiError(res, err, "Failed to generate image variations");
  }
}

/**
 * GET /api/images/style-guide/:brandId
 * Returns the brand's visual profile (palette, visual style, mood, personality,
 * audience) for the Brand Style Guide tab.
 */
async function getBrandStyleGuide(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    return res.json({
      brandId,
      brandName: brand.brand_name,
      styleGuide: buildBrandStyleSummary(brand),
    });
  } catch (err) {
    console.error("Get brand style guide error:", err.message);
    return res.status(500).json({ error: "Failed to load brand style guide" });
  }
}

/**
 * Downloads an image from a (temporary) URL and writes it to the uploads dir.
 * Returns the public-serving path. Throws if the download fails.
 */
async function persistImage(sourceUrl) {
  if (!isAllowedImageUrl(sourceUrl)) {
    throw new Error("Image URL is not from an allowed host");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(sourceUrl, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`Image download failed with status ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Unexpected content-type: ${contentType || "unknown"}`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    throw new Error("Image exceeds the maximum allowed size");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("Image exceeds the maximum allowed size");
  }

  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const filename = `${crypto.randomUUID()}.png`;
  await fs.writeFile(path.join(UPLOADS_DIR, filename), buffer);
  return `${PUBLIC_PREFIX}/${filename}`;
}

/**
 * POST /api/images
 * Saves a generated image: downloads the bytes (the DALL-E URL is temporary),
 * persists them, and records the permanent URL + metadata.
 */
async function saveImage(req, res) {
  const userId = req.user.userId;
  const { brandId, purpose, prompt, imageUrl, platform, contentDescription, styleNotes } =
    req.body;

  if (!brandId || !imageUrl || !prompt) {
    return res
      .status(400)
      .json({ error: "brandId, imageUrl, and prompt are required" });
  }
  if (purpose && !isPurpose(purpose)) {
    return res.status(400).json({ error: "Unknown image purpose" });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    let storedUrl;
    try {
      storedUrl = await persistImage(imageUrl);
    } catch (err) {
      console.error("Persist image error:", err.message);
      return res.status(502).json({
        error:
          "Could not download the generated image (the link may have expired). Please regenerate and try again.",
      });
    }

    const meta = purposeMeta(purpose);
    const result = await db.query(
      `INSERT INTO images
         (brand_id, purpose, prompt_used, image_url, platform, status,
          content_description, style_notes)
       VALUES ($1, $2, $3, $4, $5, 'saved', $6, $7)
       RETURNING image_id, brand_id, purpose, prompt_used, image_url, platform,
                 status, content_description, style_notes, created_at`,
      [
        brandId,
        purpose || "instagram_post",
        prompt,
        storedUrl,
        platform || meta.platform,
        contentDescription || null,
        styleNotes || null,
      ]
    );
    return res.status(201).json({ image: result.rows[0] });
  } catch (err) {
    console.error("Save image error:", err.message);
    return res.status(500).json({ error: "Failed to save image" });
  }
}

/**
 * GET /api/images/:brandId
 * Returns all saved images for a brand, grouped by purpose.
 */
async function getImages(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `SELECT image_id, brand_id, purpose, prompt_used, image_url, platform,
              status, content_description, style_notes, created_at
       FROM images
       WHERE brand_id = $1
       ORDER BY created_at DESC`,
      [brandId]
    );

    const byPurpose = {};
    for (const row of result.rows) {
      const key = row.purpose || "other";
      if (!byPurpose[key]) {
        byPurpose[key] = {
          purpose: key,
          label: PURPOSES[key] ? PURPOSES[key].label : key,
          images: [],
        };
      }
      byPurpose[key].images.push(row);
    }

    return res.json({
      brandId,
      total: result.rows.length,
      images: result.rows,
      groups: Object.values(byPurpose),
    });
  } catch (err) {
    console.error("Get images error:", err.message);
    return res.status(500).json({ error: "Failed to fetch images" });
  }
}

/**
 * DELETE /api/images/:imageId
 * Deletes a saved image (ownership enforced via brand). Also removes the file
 * from disk on a best-effort basis.
 */
async function deleteImage(req, res) {
  const userId = req.user.userId;
  const { imageId } = req.params;

  try {
    const result = await db.query(
      `DELETE FROM images
       USING brands
       WHERE images.image_id = $1
         AND images.brand_id = brands.brand_id
         AND brands.user_id = $2
       RETURNING images.image_url`,
      [imageId, userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Image not found" });
    }

    const url = result.rows[0].image_url;
    if (url && url.startsWith(`${PUBLIC_PREFIX}/`)) {
      const filename = path.basename(url);
      fs.unlink(path.join(UPLOADS_DIR, filename)).catch(() => {});
    }

    return res.json({ success: true, imageId });
  } catch (err) {
    console.error("Delete image error:", err.message);
    return res.status(500).json({ error: "Failed to delete image" });
  }
}

module.exports = {
  UPLOADS_DIR,
  generateImage,
  generateAdCreativeSet,
  generateImagePrompts,
  generateImageFromPrompt,
  generateImageVariations,
  getBrandStyleGuide,
  saveImage,
  getImages,
  deleteImage,
};
