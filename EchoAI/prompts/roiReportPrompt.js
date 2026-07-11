/**
 * AI monthly ROI report generator.
 *
 * generateRoiReport(brand, roi, history) calls Anthropic to write a friendly,
 * specific, results-focused monthly summary that reads like a note from a trusted
 * marketing partner — celebrating wins, acknowledging what's still improving, and
 * building confidence that Zorecho is worth every dollar. It is grounded in the
 * REAL computed ROI breakdown so every claim references an actual number.
 */

const { anthropic, MODEL } = require("../config/anthropic");

function money(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function buildRoiReportPrompt(brand, roi, history) {
  const name = brand.brand_name || "your business";
  const h = roi.headline || {};
  const leads = roi.leads || {};
  const campaigns = roi.campaigns || {};
  const social = roi.social || {};
  const email = roi.email || {};
  const sub = roi.subscription || {};

  const trend =
    Array.isArray(history) && history.length
      ? history
          .map(
            (w) =>
              `  - Week of ${w.weekDate}: ${w.totalLeads} leads (${w.hotLeads} hot), ${money(w.totalRoiEstimate)} value`,
          )
          .join("\n")
      : "  - Not enough weekly history yet.";

  return [
    "You are Zorecho's customer success partner writing a customer's monthly ROI report.",
    "Tone: warm, human, specific, and confident — like a trusted marketing partner who genuinely cares, NOT a software changelog. Use 'we' (Zorecho) and 'you/your' (the customer).",
    "",
    `Customer / brand: ${name}`,
    "",
    "REAL results this period (use these exact numbers — never invent figures):",
    `- Total estimated value generated: ${money(h.totalValueGenerated)}`,
    `- Hours saved: ${Math.round(h.hoursSaved || 0)}`,
    `- Money saved vs. hiring an agency / in-house: ${money(h.moneySaved)}`,
    `- Return on investment: ${Math.round(h.roiPercent || 0)}%`,
    `- Their Zorecho plan: ${sub.tier || "starter"} at ${money(sub.monthlyPrice)}/mo`,
    "",
    "Where the value came from:",
    `- Leads: ${leads.total || 0} total, ${leads.hot || 0} hot/sales-ready, worth about ${money(leads.estimatedValue)}`,
    `- Ad campaigns: ${campaigns.count || 0} run, ${money(campaigns.adSpendManaged)} in ad spend managed${
      campaigns.costPerLeadImprovementPct != null
        ? `, cost-per-lead improved ${Math.round(campaigns.costPerLeadImprovementPct)}%`
        : ""
    }`,
    `- Social posts: ${social.postsPublished || 0} published, ~${social.estimatedReach || 0} estimated reach`,
    `- Emails: ${email.sent || 0} sent${
      email.openRate != null ? `, ${Math.round(email.openRate)}% open rate` : ""
    }`,
    "",
    "12-week trend:",
    trend,
    "",
    "Write the report with:",
    "1. A warm opening that names a headline win.",
    "2. A short paragraph celebrating the biggest results, citing specific numbers above.",
    "3. An honest 'what we're still improving' paragraph (e.g. a metric that's lower, or an area to grow next month) — be real, not falsely glowing.",
    "4. A confident 'what we're working on next month' paragraph.",
    "5. A closing line that reinforces the value for the money.",
    "",
    "Keep it to roughly 250-400 words. Plain language. No markdown headers, no bullet lists — flowing paragraphs like a real email. Do not fabricate numbers beyond those provided.",
  ].join("\n");
}

async function generateRoiReport(brand, roi, history) {
  const systemPrompt = buildRoiReportPrompt(brand, roi, history);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Write the monthly ROI report for ${brand.brand_name || "the customer"} now.`,
      },
    ],
  });

  const text = response.content?.[0]?.text || "";
  if (!text.trim()) {
    throw new Error("The AI response did not contain a report");
  }
  return text.trim();
}

module.exports = { buildRoiReportPrompt, generateRoiReport };
