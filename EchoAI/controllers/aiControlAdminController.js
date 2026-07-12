const db = require("../config/db");
const { ENVIRONMENT, ENVIRONMENT_BASIS, DEPLOY_VERSION } = require("../config/environment");
const {
  describeControls,
  setControl,
  clearControl,
  SWITCH_DEFAULTS,
  NUMBER_DEFAULTS,
} = require("../config/aiControls");
const { summarizeUsage } = require("../utils/aiUsage");
const { listScheduledJobs } = require("../utils/scheduler");

// ---------------------------------------------------------------------------
// Admin-only AI cost-control endpoints (mounted under /api/admin/ai — the
// router already enforces auth + admin). These are the operator's levers for
// the launch sprint: see spend, flip switches, and hit the emergency stop
// without a redeploy.
// ---------------------------------------------------------------------------

/** GET /api/admin/ai/status — the whole cost picture in one call. */
async function getAiStatus(req, res) {
  try {
    const [controls, usage, alerts] = await Promise.all([
      describeControls(),
      summarizeUsage().catch((err) => ({ unavailable: true, error: err.message })),
      db
        .query(
          `SELECT scope, period_key, level, spent_usd, limit_usd, created_at
             FROM ai_budget_alerts ORDER BY created_at DESC LIMIT 20`,
        )
        .then((r) => r.rows)
        .catch(() => []),
    ]);
    res.json({
      environment: ENVIRONMENT,
      environmentDetectedVia: ENVIRONMENT_BASIS,
      deployVersion: DEPLOY_VERSION,
      controls,
      usage,
      budgetAlerts: alerts,
      scheduledJobs: listScheduledJobs(),
    });
  } catch (err) {
    console.error("AI status failed:", err.message);
    res.status(500).json({ error: "Failed to load AI status." });
  }
}

/** PUT /api/admin/ai/settings — set one control: { key, value }. */
async function updateAiSetting(req, res) {
  const { key, value } = req.body || {};
  if (!key || value === undefined) {
    return res.status(400).json({ error: "Both key and value are required." });
  }
  try {
    const saved = await setControl(String(key), value, req.user && req.user.userId);
    console.log(`AI control changed by admin ${req.user && req.user.userId}: ${key} = ${saved.value}`);
    res.json({ message: `${key} is now ${saved.value}.`, ...saved });
  } catch (err) {
    const known = key in SWITCH_DEFAULTS || key in NUMBER_DEFAULTS;
    res.status(known ? 400 : 404).json({ error: err.message });
  }
}

/** DELETE /api/admin/ai/settings/:key — remove an override (env/default applies). */
async function resetAiSetting(req, res) {
  const { key } = req.params;
  if (!(key in SWITCH_DEFAULTS) && !(key in NUMBER_DEFAULTS)) {
    return res.status(404).json({ error: `Unknown AI control: ${key}` });
  }
  try {
    await clearControl(key);
    res.json({ message: `${key} override removed; environment variable or default applies again.` });
  } catch (err) {
    console.error("AI setting reset failed:", err.message);
    res.status(500).json({ error: "Failed to reset the setting." });
  }
}

/** POST /api/admin/ai/emergency-stop — one switch kills ALL paid AI calls. */
async function emergencyStop(req, res) {
  try {
    await setControl("AI_ENABLED", false, req.user && req.user.userId);
    console.error(`EMERGENCY AI STOP activated by admin ${req.user && req.user.userId}.`);
    res.json({
      message:
        "Emergency stop is ON. All paid AI calls (user and background) are blocked until you resume.",
    });
  } catch (err) {
    console.error("Emergency stop failed:", err.message);
    res.status(500).json({ error: "Failed to activate the emergency stop." });
  }
}

/** POST /api/admin/ai/resume — lift the emergency stop. */
async function resumeAi(req, res) {
  try {
    await setControl("AI_ENABLED", true, req.user && req.user.userId);
    console.log(`Emergency AI stop lifted by admin ${req.user && req.user.userId}.`);
    res.json({ message: "AI is back on. Individual switches and budgets still apply." });
  } catch (err) {
    console.error("AI resume failed:", err.message);
    res.status(500).json({ error: "Failed to resume AI." });
  }
}

module.exports = { getAiStatus, updateAiSetting, resetAiSetting, emergencyStop, resumeAi };
