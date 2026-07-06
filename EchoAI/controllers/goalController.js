/**
 * Target Goals controller — per-brand goal CRUD, live progress, department
 * dashboards, and the cross-brand Goals Overview (Mission Control). All routes
 * are ownership-scoped; goals are available on every tier (no feature gate).
 */

const db = require("../config/db");
const {
  GOAL_METRICS,
  CATEGORIES,
  BRAND_TYPES,
  DEFAULT_BRAND_TYPE,
  DEPARTMENT_CATEGORIES,
  isValidMetric,
  metricAllowedForBrandType,
  metricsForBrandType,
  getMetric,
} = require("../config/goals");
const {
  computeBrandGoals,
  buildGoalProgress,
  monthWindow,
} = require("../utils/goalMetrics");
const { createMessage, MODEL } = require("../config/anthropic");
const {
  buildGoalSetupPrompt,
  parseGoalSuggestions,
} = require("../prompts/goalSetupPrompt");

/** Loads an owned brand (with its type) or null. */
async function getOwnedBrand(userId, brandId) {
  const { rows } = await db.query(
    "SELECT brand_id, brand_name, brand_type FROM brands WHERE brand_id = $1 AND user_id = $2",
    [brandId, userId]
  );
  return rows[0] || null;
}

/** The metric catalog (metrics + labels) offered for a brand type. */
function catalogForBrandType(brandType) {
  return metricsForBrandType(brandType).map((key) => ({
    metricKey: key,
    ...GOAL_METRICS[key],
  }));
}

/**
 * GET /api/goals/catalog/:brandId
 * Returns the brand's type + the goal metrics/categories available to set.
 */
async function getCatalog(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const brandType = brand.brand_type || DEFAULT_BRAND_TYPE;
    return res.json({
      brandType,
      brandTypes: BRAND_TYPES,
      categories: CATEGORIES,
      catalog: catalogForBrandType(brandType),
    });
  } catch (err) {
    console.error("Get goal catalog error:", err.message);
    return res.status(500).json({ error: "Failed to load goal catalog" });
  }
}

/**
 * POST /api/goals/:brandId/parse
 * Conversational goal setup (runs after the Setup Agent). The owner describes
 * their goals in plain English; Echo (Anthropic) parses that into measurable
 * targets drawn ONLY from the brand's catalog. Nothing is saved here — the
 * wizard shows the suggestions for the owner to confirm/adjust before creating
 * goals. Upstream AI failure -> 502 so onboarding can continue without blocking.
 * Body: { message: string }.
 */
async function parseGoals(req, res) {
  const { message } = req.body || {};
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "A message describing your goals is required" });
    }

    const brandType = brand.brand_type || DEFAULT_BRAND_TYPE;
    const catalog = catalogForBrandType(brandType);

    let response;
    try {
      response = await createMessage(
        {
          model: MODEL,
          max_tokens: 1024,
          system: buildGoalSetupPrompt(brandType, catalog),
          messages: [{ role: "user", content: message.slice(0, 2000) }],
        },
        { label: "Goal setup parse" }
      );
    } catch (err) {
      console.error("Goal parse AI error:", err && err.message);
      return res
        .status(502)
        .json({ error: "Echo couldn't reach the AI to read your goals. You can pick them manually." });
    }

    const text = (response && response.content && response.content[0] && response.content[0].text) || "";
    const suggestions = parseGoalSuggestions(text, catalog);
    return res.json({ brandType, suggestions });
  } catch (err) {
    console.error("Parse goals error:", err.message);
    return res.status(500).json({ error: "Failed to parse goals" });
  }
}

/**
 * GET /api/goals/:brandId
 * Live progress for every active goal + the 0–100 achievement score + catalog.
 */
async function listGoals(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const brandType = brand.brand_type || DEFAULT_BRAND_TYPE;
    const { goals, score, goalCount } = await computeBrandGoals(brand.brand_id);
    return res.json({
      brandId: brand.brand_id,
      brandType,
      score,
      goalCount,
      goals,
      catalog: catalogForBrandType(brandType),
    });
  } catch (err) {
    console.error("List goals error:", err.message);
    return res.status(500).json({ error: "Failed to load goals" });
  }
}

/**
 * GET /api/goals/:brandId/department/:department
 * Goals whose category belongs to a department dashboard (atlas/nova/pulse/roi).
 */
async function getDepartmentGoals(req, res) {
  const department = String(req.params.department || "").toLowerCase();
  const cats = DEPARTMENT_CATEGORIES[department];
  if (!cats) return res.status(400).json({ error: "Unknown department" });
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { goals, score } = await computeBrandGoals(brand.brand_id);
    const filtered = goals.filter((g) => cats.includes(g.category));
    return res.json({
      brandId: brand.brand_id,
      department,
      score,
      goals: filtered,
    });
  } catch (err) {
    console.error("Get department goals error:", err.message);
    return res.status(500).json({ error: "Failed to load department goals" });
  }
}

/**
 * POST /api/goals/:brandId
 * Body: { metricKey, targetValue, label? }. 409 if an active goal already
 * exists for that metric (the partial unique index enforces one per metric).
 */
async function createGoal(req, res) {
  const { metricKey, targetValue, label } = req.body || {};
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const brandType = brand.brand_type || DEFAULT_BRAND_TYPE;

    if (!metricKey || !isValidMetric(metricKey)) {
      return res.status(400).json({ error: "A valid metricKey is required" });
    }
    if (!metricAllowedForBrandType(metricKey, brandType)) {
      return res
        .status(400)
        .json({ error: "That metric is not available for this brand type" });
    }
    const target = Number(targetValue);
    if (!Number.isFinite(target) || target < 0) {
      return res
        .status(400)
        .json({ error: "targetValue must be a number >= 0" });
    }

    const meta = getMetric(metricKey);
    const { rows } = await db.query(
      `INSERT INTO brand_goals
         (brand_id, category, metric_key, label, target_value, sort_order)
       VALUES ($1, $2, $3, $4, $5,
               COALESCE((SELECT MAX(sort_order) + 1 FROM brand_goals
                         WHERE brand_id = $1 AND status = 'active'), 0))
       RETURNING goal_id, brand_id, category, metric_key, label, target_value,
                 period, sort_order, status`,
      [
        brand.brand_id,
        meta.category,
        metricKey,
        label ? String(label).slice(0, 160) : null,
        target,
      ]
    );

    const progress = await buildGoalProgress(rows[0]);
    return res.status(201).json({ goal: progress });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ error: "An active goal already exists for that metric" });
    }
    console.error("Create goal error:", err.message);
    return res.status(500).json({ error: "Failed to create goal" });
  }
}

/**
 * PUT /api/goals/:brandId/:goalId
 * Body: { targetValue?, label?, status?, sortOrder? }.
 */
async function updateGoal(req, res) {
  const { targetValue, label, status, sortOrder } = req.body || {};
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const fields = [];
    const values = [];
    let idx = 1;

    if (targetValue !== undefined) {
      const t = Number(targetValue);
      if (!Number.isFinite(t) || t < 0) {
        return res.status(400).json({ error: "targetValue must be a number >= 0" });
      }
      fields.push(`target_value = $${idx++}`);
      values.push(t);
    }
    if (label !== undefined) {
      fields.push(`label = $${idx++}`);
      values.push(label ? String(label).slice(0, 160) : null);
    }
    if (status !== undefined) {
      if (status !== "active" && status !== "archived") {
        return res.status(400).json({ error: "status must be 'active' or 'archived'" });
      }
      fields.push(`status = $${idx++}`);
      values.push(status);
    }
    if (sortOrder !== undefined) {
      const s = Number(sortOrder);
      if (!Number.isInteger(s)) {
        return res.status(400).json({ error: "sortOrder must be an integer" });
      }
      fields.push(`sort_order = $${idx++}`);
      values.push(s);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "No fields provided to update" });
    }
    fields.push("updated_at = NOW()");
    values.push(req.params.goalId, brand.brand_id);

    const { rows } = await db.query(
      `UPDATE brand_goals SET ${fields.join(", ")}
        WHERE goal_id = $${idx++} AND brand_id = $${idx}
        RETURNING goal_id, brand_id, category, metric_key, label, target_value,
                  period, sort_order, status`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: "Goal not found" });

    const progress = await buildGoalProgress(rows[0]);
    return res.json({ goal: progress });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ error: "An active goal already exists for that metric" });
    }
    console.error("Update goal error:", err.message);
    return res.status(500).json({ error: "Failed to update goal" });
  }
}

/**
 * DELETE /api/goals/:brandId/:goalId — permanently removes a goal (and its
 * snapshots cascade).
 */
async function deleteGoal(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { rows } = await db.query(
      "DELETE FROM brand_goals WHERE goal_id = $1 AND brand_id = $2 RETURNING goal_id",
      [req.params.goalId, brand.brand_id]
    );
    if (!rows.length) return res.status(404).json({ error: "Goal not found" });
    return res.json({ deleted: true, goalId: rows[0].goal_id });
  } catch (err) {
    console.error("Delete goal error:", err.message);
    return res.status(500).json({ error: "Failed to delete goal" });
  }
}

/**
 * GET /api/goals/overview
 * Cross-brand Goals Overview for Mission Control: per-brand achievement score,
 * total goals, at-risk count, plus the flattened list of at-risk / hit goals.
 */
async function getOverview(req, res) {
  try {
    const { rows: brands } = await db.query(
      `SELECT brand_id, brand_name, brand_type FROM brands
        WHERE user_id = $1 AND is_demo = false
        ORDER BY created_at ASC`,
      [req.user.userId]
    );

    const win = monthWindow();
    const perBrand = [];
    const attention = [];
    let scoredBrands = 0;
    let scoreSum = 0;

    for (const b of brands) {
      const { goals, score } = await computeBrandGoals(b.brand_id, win);
      if (goals.length === 0) continue;
      if (score != null) {
        scoredBrands += 1;
        scoreSum += score;
      }
      const atRisk = goals.filter((g) => g.status === "at_risk").length;
      perBrand.push({
        brandId: b.brand_id,
        brandName: b.brand_name,
        brandType: b.brand_type || DEFAULT_BRAND_TYPE,
        score,
        goalCount: goals.length,
        atRisk,
        goals,
      });
      for (const g of goals) {
        if (g.status === "at_risk" || g.status === "exceeding" || g.status === "hit") {
          attention.push({
            brandId: b.brand_id,
            brandName: b.brand_name,
            ...g,
          });
        }
      }
    }

    const overallScore = scoredBrands ? Math.round(scoreSum / scoredBrands) : null;
    return res.json({
      overallScore,
      brandsWithGoals: perBrand.length,
      perBrand,
      attention,
    });
  } catch (err) {
    console.error("Goals overview error:", err.message);
    return res.status(500).json({ error: "Failed to load goals overview" });
  }
}

module.exports = {
  getCatalog,
  parseGoals,
  listGoals,
  getDepartmentGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  getOverview,
};
