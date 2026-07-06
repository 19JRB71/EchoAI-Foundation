// Shared Sage intelligence accessor.
//
// Sage (EchoAI's Industry Intelligence agent) researches each brand's industry
// with live web search and stores the result. This module is the single place
// other agents read that intelligence so their generative prompts stay grounded
// in real, current market conditions instead of the model's stale priors.
//
// `sageContextForBrand` returns a compact plain-text block (or null when Sage
// has nothing yet). Controllers attach it to the brand object as
// `brand._sageContext`; each agent's prompt builder appends `sageBlock(...)` so
// the intelligence flows through unchanged. Never throws — a missing profile or
// a DB hiccup simply means "no extra context", never a broken agent.

const db = require("../config/db");

async function sageContextForBrand(brandId) {
  if (!brandId) return null;
  try {
    const [profile, feed] = await Promise.all([
      db.query(
        `SELECT industry, summary, marketing_insights
           FROM sage_intelligence_profiles WHERE brand_id = $1`,
        [brandId],
      ),
      db.query(
        `SELECT summary, why_it_matters, urgent
           FROM sage_intelligence_feed
          WHERE brand_id = $1 AND created_at > NOW() - INTERVAL '30 days'
          ORDER BY urgent DESC, created_at DESC LIMIT 6`,
        [brandId],
      ),
    ]);
    const p = profile.rows[0];
    const findings = feed.rows;
    if (!p && findings.length === 0) return null;

    const lines = [];
    if (p && p.industry) lines.push(`Industry: ${p.industry}`);
    if (p && p.summary) lines.push(`Current state of the industry: ${p.summary}`);

    const insights = Array.isArray(p && p.marketing_insights) ? p.marketing_insights : [];
    const topInsights = insights
      .slice(0, 3)
      .map((i) => i && (i.insight || i.recommendation || i.headline || i.tip))
      .filter(Boolean);
    if (topInsights.length) {
      lines.push("What is working in this industry right now:");
      topInsights.forEach((t) => lines.push(`- ${t}`));
    }

    if (findings.length) {
      lines.push("Recent developments Sage has surfaced:");
      findings.forEach((f) =>
        lines.push(
          `- ${f.urgent ? "[URGENT] " : ""}${f.summary}${
            f.why_it_matters ? ` (why it matters: ${f.why_it_matters})` : ""
          }`,
        ),
      );
    }

    if (lines.length === 0) return null;
    return lines.join("\n");
  } catch (_e) {
    return null;
  }
}

function sageBlock(sageContext) {
  if (!sageContext) return "";
  return [
    "",
    "LIVE INDUSTRY INTELLIGENCE (from Sage, EchoAI's dedicated industry-research agent — this reflects real, current market conditions gathered from live web research; ground your recommendations in it):",
    sageContext,
  ].join("\n");
}

module.exports = { sageContextForBrand, sageBlock };
