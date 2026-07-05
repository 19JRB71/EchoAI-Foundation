/**
 * Echo — Grant Writer agent.
 *
 * draftGrantApplication(context) writes a complete, submission-ready grant
 * application draft for one funding opportunity, using everything known about the
 * business: brand discovery (name, personality, voice, audience), the owner's
 * personal story / mission / values / goals, and business metrics (revenue,
 * growth signals). The draft is structured into standard grant sections so the
 * owner can review and submit with minimal edits.
 *
 * This is an AI-heavy, long-form generation, so it uses the heavy AI timeout.
 * Output is validated before persistence; bad output throws `err.aiInvalid`.
 */

const { createMessage, MODEL, HEAVY_AI_TIMEOUT_MS } = require("../config/anthropic");

function buildGrantPrompt(context) {
  const { brand, owner, opportunity, metrics } = context;
  const name = brand.brand_name || "the business";
  return [
    "You are EchoAI's Echo — an expert grant writer. You write complete, persuasive, submission-ready grant applications for small businesses.",
    "Write in the business owner's authentic voice, grounded ONLY in the real information provided. Do NOT invent financial figures, credentials, or facts that are not given — where a required detail is missing, write a clearly-marked placeholder in [brackets] the owner can fill in.",
    "",
    `FUNDING PROGRAM: ${opportunity.name} (${opportunity.source})`,
    opportunity.award_amount ? `Award: ${opportunity.award_amount}` : "",
    opportunity.eligibility ? `Eligibility: ${opportunity.eligibility}` : "",
    opportunity.description ? `Program description: ${opportunity.description}` : "",
    "",
    `BUSINESS: ${name}`,
    brand.brand_personality ? `Brand personality: ${brand.brand_personality}` : "",
    brand.voice_description ? `Brand voice: ${brand.voice_description}` : "",
    brand.tagline ? `Tagline: ${brand.tagline}` : "",
    "",
    "EVERYTHING KNOWN ABOUT THE BUSINESS & OWNER (real data, JSON):",
    "```json",
    JSON.stringify({ owner, metrics, targetAudience: brand.target_audience }, null, 2),
    "```",
    "",
    "Write the application as a set of standard grant sections. Return ONLY a JSON object (no markdown fences, no prose outside the JSON) with EXACTLY this shape:",
    "{",
    '  "summary": "<2-3 sentence overview of the application and the ask>",',
    '  "sections": [',
    '    { "heading": "Executive Summary", "content": "<full prose>" },',
    '    { "heading": "Organization Background", "content": "<full prose — the owner\'s story & mission>" },',
    '    { "heading": "Statement of Need", "content": "<full prose>" },',
    '    { "heading": "Project Description", "content": "<full prose — what the funding will be used for>" },',
    '    { "heading": "Goals & Objectives", "content": "<full prose with concrete, measurable objectives>" },',
    '    { "heading": "Budget Narrative", "content": "<full prose — how funds will be allocated; use [brackets] for exact figures the owner must supply>" },',
    '    { "heading": "Expected Impact & Outcomes", "content": "<full prose>" },',
    '    { "heading": "Sustainability Plan", "content": "<full prose>" }',
    "  ]",
    "}",
    "",
    "Rules: include all eight sections in that order; each content field is complete, well-written prose (not bullet fragments); tailor everything to THIS program and business; mark any missing hard facts with [bracketed placeholders]. Output valid JSON only.",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseJsonObject(text) {
  let cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("unparseable");
  }
}

/** Validates + normalizes the AI grant draft. Throws err.aiInvalid on bad data. */
function validateGrantDraft(parsed) {
  const fail = (msg) => {
    const err = new Error(`AI grant draft invalid: ${msg}`);
    err.aiInvalid = true;
    throw err;
  };

  if (!parsed || typeof parsed !== "object") fail("not an object");
  if (!Array.isArray(parsed.sections) || parsed.sections.length < 1) {
    fail("sections must be a non-empty array");
  }

  const sections = parsed.sections
    .map((s) => {
      if (!s || typeof s !== "object") return null;
      const heading = String(s.heading || "").trim();
      const content = String(s.content || "").trim();
      if (!heading || !content) return null;
      return { heading, content };
    })
    .filter(Boolean);

  if (sections.length === 0) fail("no valid sections after validation");

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
    sections,
  };
}

async function draftGrantApplication(context) {
  const system = buildGrantPrompt(context);

  const response = await createMessage(
    {
      model: MODEL,
      max_tokens: 6000,
      system,
      messages: [
        {
          role: "user",
          content: `Write the complete grant application draft for ${context.opportunity.name} now. JSON only.`,
        },
      ],
    },
    { timeout: HEAVY_AI_TIMEOUT_MS, label: "Grant writer" },
  );

  const text = response.content?.[0]?.text || "";
  if (!text.trim()) {
    const err = new Error("The AI returned an empty grant draft");
    err.aiInvalid = true;
    throw err;
  }

  let parsed;
  try {
    parsed = parseJsonObject(text);
  } catch {
    const err = new Error("The AI grant draft was not valid JSON");
    err.aiInvalid = true;
    throw err;
  }

  return validateGrantDraft(parsed);
}

module.exports = {
  buildGrantPrompt,
  validateGrantDraft,
  draftGrantApplication,
};
