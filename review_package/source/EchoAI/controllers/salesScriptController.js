const db = require("../config/db");
const {
  SALE_TYPES,
  normalizeObjections,
  generateSalesScript,
} = require("../prompts/salesScriptPrompt");

function isSupportedSaleType(saleType) {
  return SALE_TYPES.includes(String(saleType || "").toLowerCase());
}

/**
 * Loads a brand only if it belongs to the authenticated user. Returns null when
 * the brand does not exist or is not owned by the user.
 */
async function getOwnedBrand(userId, brandId) {
  const result = await db.query(
    `SELECT brand_id, brand_name, brand_personality, voice_description,
            target_audience
     FROM brands
     WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId],
  );
  return result.rows[0] || null;
}

/**
 * POST /api/sales-scripts/generate
 * Generates a complete AI sales script for a brand + sale context.
 */
async function generateScript(req, res) {
  const userId = req.user.userId;
  const { brandId, saleType, targetPersona, commonObjections, desiredOutcome } =
    req.body;
  const normalizedSaleType = String(saleType || "").toLowerCase();
  const trimmedPersona = String(targetPersona || "").trim();
  const trimmedOutcome = String(desiredOutcome || "").trim();

  if (!brandId || !trimmedPersona || !trimmedOutcome) {
    return res.status(400).json({
      error:
        "brandId, targetPersona, and desiredOutcome are required",
    });
  }
  if (!isSupportedSaleType(normalizedSaleType)) {
    return res.status(400).json({
      error: `Unsupported saleType. Supported: ${SALE_TYPES.join(", ")}`,
    });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const objections = normalizeObjections(commonObjections);
    const script = await generateSalesScript(brand, {
      saleType: normalizedSaleType,
      targetPersona: trimmedPersona,
      objections,
      desiredOutcome: trimmedOutcome,
    });

    return res.json({
      saleType: normalizedSaleType,
      targetPersona: trimmedPersona,
      desiredOutcome: trimmedOutcome,
      objections,
      script,
    });
  } catch (err) {
    console.error("Generate sales script error:", err.message);
    // Surface upstream AI provider failures (billing, rate limits, outages) as a
    // 502 with a clearer message instead of a generic 500, so the cause is
    // distinguishable from an Zorecho code fault.
    if (typeof err.status === "number" && err.status >= 400) {
      return res.status(502).json({
        error:
          "The AI provider could not generate the sales script right now. Please try again shortly.",
      });
    }
    return res.status(500).json({ error: "Failed to generate sales script" });
  }
}

/**
 * POST /api/sales-scripts
 * Saves a generated sales script to the sales_scripts table.
 */
async function saveScript(req, res) {
  const userId = req.user.userId;
  const { brandId, saleType, targetPersona, scriptContent, status } = req.body;
  const normalizedSaleType = String(saleType || "").toLowerCase();
  const normalizedStatus = status === "active" ? "active" : "draft";
  const trimmedPersona = String(targetPersona || "").trim();

  if (!brandId || !saleType || !trimmedPersona || !scriptContent) {
    return res.status(400).json({
      error: "brandId, saleType, targetPersona, and scriptContent are required",
    });
  }
  if (!isSupportedSaleType(normalizedSaleType)) {
    return res.status(400).json({
      error: `Unsupported saleType. Supported: ${SALE_TYPES.join(", ")}`,
    });
  }
  if (typeof scriptContent !== "object" || Array.isArray(scriptContent)) {
    return res
      .status(400)
      .json({ error: "scriptContent must be the generated sales-script object" });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `INSERT INTO sales_scripts
         (brand_id, sale_type, target_persona, script_content, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING script_id, brand_id, sale_type, target_persona,
                 script_content, status, created_at, updated_at`,
      [
        brandId,
        normalizedSaleType,
        trimmedPersona,
        JSON.stringify(scriptContent),
        normalizedStatus,
      ],
    );
    return res.status(201).json({ script: result.rows[0] });
  } catch (err) {
    console.error("Save sales script error:", err.message);
    return res.status(500).json({ error: "Failed to save sales script" });
  }
}

/**
 * GET /api/sales-scripts/:brandId
 * Returns all saved sales scripts for a brand (newest first).
 */
async function getScripts(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `SELECT script_id, brand_id, sale_type, target_persona,
              script_content, status, created_at, updated_at
       FROM sales_scripts
       WHERE brand_id = $1
       ORDER BY created_at DESC`,
      [brandId],
    );
    return res.json({
      brandId,
      count: result.rows.length,
      scripts: result.rows,
    });
  } catch (err) {
    console.error("Get sales scripts error:", err.message);
    return res.status(500).json({ error: "Failed to fetch sales scripts" });
  }
}

/**
 * PUT /api/sales-scripts/:scriptId
 * Edits a saved sales script (content, persona, sale type, and/or status). Only
 * succeeds if the script belongs to one of the authenticated user's brands.
 */
async function updateScript(req, res) {
  const userId = req.user.userId;
  const { scriptId } = req.params;
  const { saleType, targetPersona, scriptContent, status } = req.body;

  if (
    saleType === undefined &&
    targetPersona === undefined &&
    scriptContent === undefined &&
    status === undefined
  ) {
    return res.status(400).json({
      error:
        "Provide at least one of saleType, targetPersona, scriptContent, or status to update",
    });
  }

  let normalizedSaleType;
  if (saleType !== undefined) {
    normalizedSaleType = String(saleType).toLowerCase();
    if (!isSupportedSaleType(normalizedSaleType)) {
      return res.status(400).json({
        error: `Unsupported saleType. Supported: ${SALE_TYPES.join(", ")}`,
      });
    }
  }
  let normalizedPersona;
  if (targetPersona !== undefined) {
    if (typeof targetPersona !== "string" || !targetPersona.trim()) {
      return res
        .status(400)
        .json({ error: "targetPersona must be a non-empty string" });
    }
    normalizedPersona = targetPersona.trim();
  }
  if (
    scriptContent !== undefined &&
    (!scriptContent ||
      typeof scriptContent !== "object" ||
      Array.isArray(scriptContent))
  ) {
    return res
      .status(400)
      .json({ error: "scriptContent must be the sales-script object" });
  }
  let normalizedStatus;
  if (status !== undefined) {
    if (status !== "draft" && status !== "active") {
      return res
        .status(400)
        .json({ error: "status must be 'draft' or 'active'" });
    }
    normalizedStatus = status;
  }

  try {
    // Ownership-guarded update via COALESCE so only provided fields change. The
    // join to brands enforces that the script belongs to the user.
    const result = await db.query(
      `UPDATE sales_scripts ss
       SET sale_type      = COALESCE($1, ss.sale_type),
           target_persona = COALESCE($2, ss.target_persona),
           script_content = COALESCE($3::jsonb, ss.script_content),
           status         = COALESCE($4, ss.status)
       FROM brands b
       WHERE ss.script_id = $5
         AND ss.brand_id = b.brand_id
         AND b.user_id = $6
       RETURNING ss.script_id, ss.brand_id, ss.sale_type, ss.target_persona,
                 ss.script_content, ss.status, ss.created_at, ss.updated_at`,
      [
        normalizedSaleType ?? null,
        normalizedPersona ?? null,
        scriptContent !== undefined ? JSON.stringify(scriptContent) : null,
        normalizedStatus ?? null,
        scriptId,
        userId,
      ],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Sales script not found" });
    }
    return res.json({ script: result.rows[0] });
  } catch (err) {
    console.error("Update sales script error:", err.message);
    return res.status(500).json({ error: "Failed to update sales script" });
  }
}

/**
 * DELETE /api/sales-scripts/:scriptId
 * Removes a saved sales script (only if it belongs to one of the user's brands).
 */
async function deleteScript(req, res) {
  const userId = req.user.userId;
  const { scriptId } = req.params;

  try {
    const result = await db.query(
      `DELETE FROM sales_scripts ss
       USING brands b
       WHERE ss.script_id = $1
         AND ss.brand_id = b.brand_id
         AND b.user_id = $2
       RETURNING ss.script_id`,
      [scriptId, userId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Sales script not found" });
    }
    return res.json({ deleted: true, scriptId });
  } catch (err) {
    console.error("Delete sales script error:", err.message);
    return res.status(500).json({ error: "Failed to delete sales script" });
  }
}

module.exports = {
  generateScript,
  saveScript,
  getScripts,
  updateScript,
  deleteScript,
};
