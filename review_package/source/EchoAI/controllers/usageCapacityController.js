const db = require("../config/db");

// ---------------------------------------------------------------------------
// Customer-facing "AI Workforce Capacity" — percentage ONLY, never dollars.
//
// Each tier includes a monthly AI-work capacity. Internally that capacity is a
// dollar budget (env-overridable), but customers only ever see a percentage of
// capacity used, per the CEO decision: costs stay internal, customers see how
// hard their AI team is working. Notify-only: nothing is enforced or billed.
// ---------------------------------------------------------------------------

function envNum(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Internal monthly AI-cost allowances per tier (USD). NEVER returned to the
// client — used only to convert month-to-date cost into a percentage.
function capacityBudgetFor(tier) {
  switch (tier) {
    case "enterprise":
      return envNum("CAPACITY_BUDGET_ENTERPRISE", 200);
    case "pro":
      return envNum("CAPACITY_BUDGET_PRO", 100);
    default:
      return envNum("CAPACITY_BUDGET_STARTER", 40);
  }
}

// Customer-friendly usage categories. Feature keys are free-form internally,
// so we bucket by pattern; order matters (first match wins). Anything that
// doesn't match falls into "Other tasks".
const USAGE_CATEGORIES = [
  { key: "voice_calls", label: "Voice Calls", re: /voice|phone|call|tts|sound|elevenlabs|receptionist/i },
  { key: "content_creation", label: "Content Creation", re: /content|image|ad_studio|ad[-_ ]creative|social|video|email_marketing|email_send|calendar|seo|script|creative|post/i },
  { key: "research", label: "Research", re: /research|intelligence|scout|competitor|discovery|market|self[-_ ]review/i },
  { key: "lead_automation", label: "Lead Automation", re: /lead|autonomous|crm|sms|capture|appointment|sales|chatbot|drip|feedback|webhook/i },
  { key: "echo_conversations", label: "Echo Conversations", re: /echo|conversational|chat|briefing|orchestrator|memory|assistant|hermes|intent|reply/i },
];

function categorizeFeature(feature) {
  const f = String(feature || "");
  for (const c of USAGE_CATEGORIES) {
    if (c.re.test(f)) return c.key;
  }
  return "other";
}

function capacityStatus(pct) {
  if (pct >= 100) return "at_capacity";
  if (pct >= 85) return "high";
  if (pct >= 60) return "moderate";
  return "healthy";
}

/**
 * GET /api/usage/capacity — the logged-in owner's AI Workforce Capacity.
 * Percent only; the underlying dollar figures are intentionally omitted.
 */
async function getCapacity(req, res) {
  try {
    const userId = req.user.userId;
    const [subRow, usage, byFeature] = await Promise.all([
      db.query(
        "SELECT subscription_tier FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
        [userId],
      ),
      db.query(
        `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS cost,
                COUNT(*) AS operations,
                COUNT(*) FILTER (WHERE triggered_by = 'background') AS background_operations
           FROM ai_usage_log
          WHERE user_id::text = $1::text
            AND at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
        [String(userId)],
      ),
      db.query(
        `SELECT feature, COUNT(*) AS operations
           FROM ai_usage_log
          WHERE user_id::text = $1::text
            AND at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          GROUP BY feature`,
        [String(userId)],
      ),
    ]);

    const tier =
      (subRow.rows[0] && String(subRow.rows[0].subscription_tier)) || "starter";
    const budget = capacityBudgetFor(tier);
    const cost = Number(usage.rows[0].cost) || 0;
    const rawPct = budget > 0 ? (cost / budget) * 100 : 0;
    // Display caps at 100 — capacity is a meter, not a bill.
    const percentUsed = Math.min(100, Math.round(rawPct * 10) / 10);

    const now = new Date();
    const daysInMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    ).getUTCDate();

    // "What's using my AI Workforce?" — task counts per customer-friendly
    // category. Counts only, never dollars.
    const catCounts = {};
    for (const row of byFeature.rows) {
      const key = categorizeFeature(row.feature);
      catCounts[key] = (catCounts[key] || 0) + (Number(row.operations) || 0);
    }
    const usageBreakdown = [
      ...USAGE_CATEGORIES.map((c) => ({
        key: c.key,
        label: c.label,
        tasks: catCounts[c.key] || 0,
      })),
      ...(catCounts.other ? [{ key: "other", label: "Other tasks", tasks: catCounts.other }] : []),
    ].sort((a, b) => b.tasks - a.tasks);

    res.json({
      tier,
      percentUsed,
      usageBreakdown,
      status: capacityStatus(rawPct),
      operationsThisMonth: Number(usage.rows[0].operations) || 0,
      backgroundOperationsThisMonth:
        Number(usage.rows[0].background_operations) || 0,
      daysLeftInCycle: Math.max(0, daysInMonth - now.getUTCDate()),
      note:
        rawPct >= 100
          ? "Your AI team has reached its included monthly capacity. Nothing stops — we'll reach out about the right plan for your workload."
          : rawPct >= 85
            ? "Your AI team is working near full capacity this month."
            : "Your AI team has plenty of capacity left this month.",
    });
  } catch (err) {
    console.error("Capacity meter failed:", err.message);
    res.status(500).json({ error: "Failed to load AI workforce capacity." });
  }
}

module.exports = { getCapacity, capacityBudgetFor, categorizeFeature };
