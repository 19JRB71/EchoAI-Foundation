/**
 * Sage V2 Phase 6 — channel scorecards, honest forecasts, Top-3-bets
 * strategy + Executive Debate, and the self-evaluation scorecard.
 *
 * All endpoints flag-gated (default OFF → { enabled:false }, byte-identical
 * dark responses) and owner-only (requireOwner in sageRoutes). Ownership via
 * getOwnedBrand (404 on foreign brands). Demo brands are excluded at the
 * data-gathering layer per the standing rule — endpoints answer honestly
 * with a demoExcluded marker instead of computing on demo data.
 *
 * AI failures map to 502 (aiInvalid / upstream), never mocked. Refusals
 * (debate cap, live strategy exists, unchanged inputs) carry err.status and
 * a plain-English message.
 */

const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");
const { getScorecards } = require("../utils/channelScorecards");
const { getForecasts } = require("../utils/sageForecasts");
const { getSelfEval } = require("../utils/sageSelfEval");
const {
  getStrategyState,
  generateStrategy,
  approveStrategy,
  declineStrategy,
  reviseStrategy,
} = require("../utils/sageStrategy");

async function getOwnedBrand(userId, brandId) {
  const { rows } = await db.query("SELECT * FROM brands WHERE brand_id = $1 AND user_id = $2", [
    brandId,
    userId,
  ]);
  return rows[0] || null;
}

async function requireEnabledBrand(req, res, flag) {
  if (!(await getSwitch(flag))) {
    res.json({ enabled: false });
    return null;
  }
  const brandId = req.query.brandId || req.body.brandId;
  if (!brandId) {
    res.status(400).json({ error: "brandId is required." });
    return null;
  }
  const brand = await getOwnedBrand(req.user.userId, brandId);
  if (!brand) {
    res.status(404).json({ error: "Brand not found." });
    return null;
  }
  if (brand.is_demo) {
    res.json({ enabled: true, demoExcluded: true });
    return null;
  }
  return brand;
}

function sendKnownError(res, err) {
  if (err.aiInvalid) {
    res.status(502).json({ error: `Sage's draft failed validation and was rejected: ${err.message}` });
    return true;
  }
  if (err.status && err.status < 500) {
    res.status(err.status).json({ error: err.message, code: err.code || undefined });
    return true;
  }
  return false;
}

// --- Scorecards (§4, deterministic) --------------------------------------------

exports.getScorecardsHandler = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_SCORECARDS");
    if (!brand) return;
    res.json(await getScorecards(brand.brand_id));
  } catch (err) {
    next(err);
  }
};

// --- Forecasts (§5, deterministic, ≥8 weeks) ------------------------------------

exports.getForecastsHandler = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_FORECASTS");
    if (!brand) return;
    res.json(await getForecasts(brand.brand_id));
  } catch (err) {
    next(err);
  }
};

// --- Strategy + Executive Debate (§6–§9) ----------------------------------------

exports.getStrategyHandler = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_STRATEGY");
    if (!brand) return;
    const state = await getStrategyState(brand.brand_id);
    res.json({ enabled: true, ...state });
  } catch (err) {
    next(err);
  }
};

exports.generateStrategyHandler = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_STRATEGY");
    if (!brand) return;
    const strategy = await generateStrategy(brand, {
      triggerEvent: req.body.triggerEvent === "quarterly_review" ? "quarterly_review" : "new_strategy",
    });
    res.status(201).json({ enabled: true, strategy });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
};

exports.decideStrategyHandler = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_STRATEGY");
    if (!brand) return;
    const { action, ownerNote, bets, budgetLine } = req.body;
    let strategy;
    if (action === "approve") {
      strategy = await approveStrategy(brand, req.params.id, ownerNote);
    } else if (action === "decline") {
      strategy = await declineStrategy(brand, req.params.id, ownerNote);
    } else if (action === "revise") {
      strategy = await reviseStrategy(brand, req.params.id, { bets, budgetLine, ownerNote });
    } else {
      return res.status(400).json({ error: "action must be approve, decline, or revise." });
    }
    res.json({ enabled: true, strategy });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
};

// --- Self-evaluation (§11–12, deterministic) ------------------------------------

exports.getSelfEvalHandler = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_SELF_EVAL");
    if (!brand) return;
    const period = req.query.period === "all" ? "all" : "90d";
    res.json(await getSelfEval(brand.brand_id, period));
  } catch (err) {
    next(err);
  }
};
