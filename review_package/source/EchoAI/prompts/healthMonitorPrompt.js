/**
 * Health Monitor AI agents.
 *
 * Two agents power the AI Health Monitor + Screenshot Support system:
 *
 *  1. generateHealthAnalysis(brand, report) — the AI Health Analyst. Given a
 *     structured 24-hour health report for a brand (all detected issues, what
 *     was auto-fixed silently, and what still needs the owner's attention), it
 *     writes a short, plain-English analysis a non-technical business owner can
 *     understand: what's wrong, the likely root cause, and what (if anything)
 *     they need to do. Grounded ONLY in the real issues passed in.
 *
 *  2. analyzeSupportScreenshot({ brand, description, imageBase64, mediaType }) —
 *     the AI Screenshot Support agent. Given a screenshot of what the user is
 *     seeing plus their description, it analyzes the image (vision) and either
 *     explains what's happening in plain English or describes the fix. Returns a
 *     structured result the controller persists as a support ticket.
 *
 * Both follow the platform-wide convention: empty/malformed AI output throws an
 * `aiInvalid` error so callers can map it to 502 (never a mock/placeholder).
 */

const { anthropic, MODEL } = require("../config/anthropic");

function issueLines(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return "  - (none)";
  return issues
    .map(
      (i) =>
        `  - [${(i.severity || "info").toUpperCase()}] ${i.system || "system"}: ` +
        `${i.message || "issue"}${i.detail ? ` (${i.detail})` : ""}`,
    )
    .join("\n");
}

function buildHealthAnalysisPrompt(brand, report) {
  const name = brand.brand_name || "the business";
  const found = report.issuesFound || [];
  const fixed = report.issuesAutoFixed || [];
  const attention = report.issuesRequiringAttention || [];

  return [
    "You are Zorecho's Health Analyst — a calm, honest engineer explaining a system health check to a busy, non-technical business owner.",
    "Tone: reassuring but truthful. Plain English, no jargon, no markdown headers or bullet lists — short flowing paragraphs. Use 'you/your'.",
    "",
    `Business / brand: ${name}`,
    `Overall status: ${report.overallStatus || "unknown"}`,
    "",
    "Issues detected in the last 24 hours:",
    issueLines(found),
    "",
    "Issues Zorecho already fixed automatically (no action needed):",
    issueLines(fixed),
    "",
    "Issues that still need the owner's attention:",
    issueLines(attention),
    "",
    "Write a 90-180 word analysis that:",
    "1. Opens with the honest bottom line — is everything healthy, are there warnings, or is something critical?",
    "2. If issues were auto-fixed, briefly reassure them it was handled and no action is needed.",
    "3. For anything still needing attention, explain the likely ROOT CAUSE in plain terms and the ONE concrete step they should take (e.g. reconnect Facebook, update the card on file).",
    "4. If everything is healthy, say so warmly and stop — do not invent problems.",
    "",
    "Never fabricate issues beyond those listed. Do not mention internal table or system names the owner wouldn't recognize.",
  ].join("\n");
}

async function generateHealthAnalysis(brand, report) {
  const systemPrompt = buildHealthAnalysisPrompt(brand, report);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Write the health analysis for ${brand.brand_name || "the customer"} now.`,
      },
    ],
  });

  const text = response.content?.[0]?.text || "";
  if (!text.trim()) {
    const err = new Error("The AI response did not contain a health analysis");
    err.aiInvalid = true;
    throw err;
  }
  return text.trim();
}

function buildSupportSystemPrompt(brand) {
  const name = brand?.brand_name || "the business";
  return [
    "You are Zorecho's Screenshot Support agent — a patient, expert product-support engineer.",
    `You are helping a user of ${name}'s Zorecho dashboard.`,
    "You are shown a screenshot of what the user is currently seeing plus their own description of the problem.",
    "Analyze the screenshot and the description together, then respond ONLY with a single JSON object (no markdown, no prose outside the JSON) of the exact shape:",
    "{",
    '  "summary": string,        // one short sentence naming what the user is looking at / experiencing',
    '  "diagnosis": string,      // plain-English explanation of what is happening and the likely cause',
    '  "resolution": string,     // clear step-by-step guidance the user can follow, OR an explanation if nothing is actually broken',
    '  "category": "bug" | "how_to" | "account" | "billing" | "not_an_issue" | "other",',
    '  "severity": "critical" | "warning" | "info"',
    "}",
    "Rules: Be concrete and reference what is actually visible in the screenshot. Never invent features that are not visible. If the screenshot shows an error message, quote the relevant part. If it is a how-to question, walk them through it. Keep each field concise and jargon-free.",
  ].join("\n");
}

async function analyzeSupportScreenshot({ brand, description, imageBase64, mediaType }) {
  const content = [];
  if (imageBase64) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType || "image/png",
        data: imageBase64,
      },
    });
  }
  content.push({
    type: "text",
    text:
      `The user describes their problem as: "${(description || "").trim() || "(no description provided)"}".\n` +
      "Analyze the screenshot (if provided) and their description, and respond with the JSON object described.",
  });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 900,
    system: buildSupportSystemPrompt(brand),
    messages: [{ role: "user", content }],
  });

  const text = response.content?.[0]?.text || "";
  if (!text.trim()) {
    const err = new Error("The AI response did not contain a support analysis");
    err.aiInvalid = true;
    throw err;
  }

  let parsed;
  try {
    // The model is instructed to return pure JSON, but strip any accidental
    // ```json fences before parsing.
    const cleaned = text.replace(/```json\s*|\s*```/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    const err = new Error("The AI support response was not valid JSON");
    err.aiInvalid = true;
    throw err;
  }

  if (!parsed || typeof parsed.diagnosis !== "string" || !parsed.diagnosis.trim()) {
    const err = new Error("The AI support response was missing a diagnosis");
    err.aiInvalid = true;
    throw err;
  }

  const allowedCat = ["bug", "how_to", "account", "billing", "not_an_issue", "other"];
  const allowedSev = ["critical", "warning", "info"];
  return {
    summary: String(parsed.summary || "").trim(),
    diagnosis: String(parsed.diagnosis).trim(),
    resolution: String(parsed.resolution || "").trim(),
    category: allowedCat.includes(parsed.category) ? parsed.category : "other",
    severity: allowedSev.includes(parsed.severity) ? parsed.severity : "info",
  };
}

module.exports = {
  buildHealthAnalysisPrompt,
  generateHealthAnalysis,
  buildSupportSystemPrompt,
  analyzeSupportScreenshot,
};
