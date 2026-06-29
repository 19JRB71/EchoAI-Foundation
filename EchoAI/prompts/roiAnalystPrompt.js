/**
 * AI ROI Analyst Agent.
 *
 * generateRoiAnalysis(brand, dataset) calls Anthropic to read a complete,
 * multi-channel performance dataset for a time period and write a plain-language
 * executive summary a non-technical business owner can act on: which channels are
 * driving revenue, which are underperforming, the trends behind the numbers, and a
 * clear recommendation. It is grounded ONLY in the real computed numbers passed in
 * (no invented figures).
 */

const { anthropic, MODEL } = require("../config/anthropic");

function money(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function pct(n) {
  if (n == null) return "n/a";
  return `${Math.round(Number(n))}%`;
}

function buildRoiAnalysisPrompt(brand, dataset) {
  const name = brand.brand_name || "the business";
  const totals = dataset.totals || {};
  const channels = Array.isArray(dataset.channels) ? dataset.channels : [];
  const period = dataset.period || {};
  const best = dataset.best || null;
  const worst = dataset.worst || null;

  const channelLines = channels.length
    ? channels
        .map(
          (c) =>
            `  - ${c.label}: ${money(c.spend)} spent, ${c.leads} leads, ` +
            `${c.appointments} appointments, ${c.conversions} conversions, ` +
            `${money(c.revenue)} revenue, ROI ${c.roiPercent == null ? "n/a (no spend)" : pct(c.roiPercent)}`,
        )
        .join("\n")
    : "  - No channel activity in this period.";

  return [
    "You are EchoAI's ROI Analyst — a sharp, honest marketing analyst writing a short executive summary for a busy, non-technical business owner.",
    "Tone: clear, concrete, and confident. Plain English, no jargon, no markdown headers or bullet lists — flowing paragraphs like a smart advisor's note. Use 'you/your' for the customer.",
    "",
    `Business: ${name}`,
    `Reporting period: ${period.label || `${period.start} to ${period.end}`}`,
    "",
    "REAL totals this period (use these exact numbers — never invent figures):",
    `- Total ad/marketing spend: ${money(totals.spend)}`,
    `- Total revenue attributed: ${money(totals.revenue)}`,
    `- Overall ROI: ${pct(totals.roiPercent)}`,
    `- Leads: ${totals.leads || 0}`,
    `- Appointments booked: ${totals.appointments || 0}`,
    `- Conversions: ${totals.conversions || 0}`,
    "",
    "Per-channel performance:",
    channelLines,
    "",
    best ? `Highest-performing channel by ROI: ${best.label} (ROI ${pct(best.roiPercent)}).` : "",
    worst ? `Lowest-performing channel by ROI: ${worst.label} (ROI ${pct(worst.roiPercent)}).` : "",
    "",
    "Write a 150-250 word executive summary that:",
    "1. Opens with the single most important takeaway (overall ROI and whether EchoAI is paying for itself).",
    "2. Calls out the best-performing channel and why it's working, citing its real numbers.",
    "3. Names the weakest channel honestly and gives one concrete recommendation to fix or cut it.",
    "4. Notes any trend or pattern visible in the data (e.g. where revenue is concentrated).",
    "5. Closes with a clear, prioritized next action.",
    "",
    "Do not fabricate numbers beyond those provided. If spend is zero for a channel, treat its ROI as not measurable rather than infinite.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function generateRoiAnalysis(brand, dataset) {
  const systemPrompt = buildRoiAnalysisPrompt(brand, dataset);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Write the ROI executive summary for ${brand.brand_name || "the customer"} now.`,
      },
    ],
  });

  const text = response.content?.[0]?.text || "";
  if (!text.trim()) {
    // Flag malformed/empty AI output so the controller maps it to 502 (never a
    // mock), matching the project-wide AI-failure convention.
    const err = new Error("The AI response did not contain an ROI analysis");
    err.aiInvalid = true;
    throw err;
  }
  return text.trim();
}

module.exports = { buildRoiAnalysisPrompt, generateRoiAnalysis };
