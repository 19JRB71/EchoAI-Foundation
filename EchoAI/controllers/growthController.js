// Autonomous Growth Mode — guardrail settings and the log of actions Echo
// proposes or auto-executes on the owner's behalf.
//
// The guardrails (budget cap, approval threshold, brand-voice rules, geo) bound
// what Echo may do autonomously. Low-risk optimizations can run automatically;
// anything above the approval threshold (or flagged high-risk) is recorded as a
// "proposed" action that surfaces in the Echo companion for one-click approval.

const db = require("../config/db");

async function getSettingsRow(userId) {
  const { rows } = await db.query(
    `INSERT INTO growth_settings (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [userId],
  );
  return rows[0];
}

function serialize(r) {
  return {
    enabled: !!r.enabled,
    monthlyBudgetCap: r.monthly_budget_cap != null ? Number(r.monthly_budget_cap) : null,
    approvalThreshold: r.approval_threshold != null ? Number(r.approval_threshold) : null,
    brandVoiceRules: r.brand_voice_rules || "",
    geoTargeting: r.geo_targeting || "",
    updatedAt: r.updated_at,
  };
}

async function getSettings(req, res) {
  try {
    const row = await getSettingsRow(req.user.userId);
    return res.json({ settings: serialize(row) });
  } catch (err) {
    console.error("growth getSettings error:", err.message);
    return res.status(500).json({ error: "Failed to load Autonomous Growth settings." });
  }
}

async function updateSettings(req, res) {
  try {
    const userId = req.user.userId;
    const b = req.body || {};

    // Coerce + validate the guardrails.
    const enabled = b.enabled === undefined ? undefined : !!b.enabled;
    const numOrNull = (v) => {
      if (v === undefined) return undefined;
      if (v === null || v === "") return null;
      const num = Number(v);
      return Number.isFinite(num) && num >= 0 ? num : null;
    };
    const budgetCap = numOrNull(b.monthlyBudgetCap);
    const threshold = numOrNull(b.approvalThreshold);
    const voice = b.brandVoiceRules === undefined ? undefined : String(b.brandVoiceRules).slice(0, 4000);
    const geo = b.geoTargeting === undefined ? undefined : String(b.geoTargeting).slice(0, 2000);

    await getSettingsRow(userId); // ensure a row exists
    await db.query(
      `UPDATE growth_settings SET
         enabled            = COALESCE($2, enabled),
         monthly_budget_cap = CASE WHEN $3::boolean THEN $4 ELSE monthly_budget_cap END,
         approval_threshold = CASE WHEN $5::boolean THEN $6 ELSE approval_threshold END,
         brand_voice_rules  = COALESCE($7, brand_voice_rules),
         geo_targeting      = COALESCE($8, geo_targeting),
         updated_at         = NOW()
       WHERE user_id = $1`,
      [
        userId,
        enabled === undefined ? null : enabled,
        budgetCap !== undefined, budgetCap === undefined ? null : budgetCap,
        threshold !== undefined, threshold === undefined ? null : threshold,
        voice === undefined ? null : voice,
        geo === undefined ? null : geo,
      ],
    );
    const row = await getSettingsRow(userId);
    return res.json({ settings: serialize(row) });
  } catch (err) {
    console.error("growth updateSettings error:", err.message);
    return res.status(500).json({ error: "Failed to save Autonomous Growth settings." });
  }
}

async function listActions(req, res) {
  try {
    const userId = req.user.userId;
    const { rows } = await db.query(
      `SELECT action_id, agent, kind, risk, title, detail, status, created_at
       FROM growth_actions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId],
    );
    return res.json({
      actions: rows.map((r) => ({
        id: r.action_id,
        agent: r.agent,
        kind: r.kind,
        risk: r.risk,
        title: r.title,
        detail: r.detail,
        status: r.status,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error("growth listActions error:", err.message);
    return res.status(500).json({ error: "Failed to load growth activity." });
  }
}

// Reusable: record an autonomous/proposed action (best-effort; never throws).
async function logAction(userId, brandId, { agent = "echo", kind, risk = "low", title, detail = "", status = "proposed" }) {
  try {
    await db.query(
      `INSERT INTO growth_actions (user_id, brand_id, agent, kind, risk, title, detail, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [userId, brandId || null, agent, kind, risk, title, detail, status],
    );
  } catch (e) {
    console.error("growth logAction failed:", e.message);
  }
}

module.exports = { getSettings, updateSettings, listActions, logAction };
