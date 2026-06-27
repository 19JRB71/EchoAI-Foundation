/**
 * AI Sales Script agent prompt + generator.
 *
 * - SALE_TYPES: the conversation types the agent can write a script for.
 * - buildSalesScriptPrompt(brand, input): builds the system prompt that instructs
 *   the LLM to produce a complete, on-brand, natural-sounding sales script.
 * - generateSalesScript(brand, input): calls the Anthropic API with the brand
 *   profile + sale context and returns the parsed sales-script object.
 */

const { anthropic, MODEL } = require("../config/anthropic");

const SALE_TYPES = ["cold_call", "warm_follow_up", "in_person_meeting"];

// Human-readable direction for each sale type so each script feels right for the
// setting it will be used in.
const SALE_TYPE_GUIDELINES = {
  cold_call:
    "Cold call to a prospect who does not yet know the business. Earn attention and permission in the first 10 seconds, be respectful of their time, and lead with a relevant reason for the call — never a generic pitch.",
  warm_follow_up:
    "Warm follow-up with a prospect who has already engaged (downloaded, replied, met, or expressed interest). Reference the prior touchpoint, pick the conversation back up naturally, and move it toward a decision.",
  in_person_meeting:
    "In-person (or face-to-face video) meeting. There is room for genuine rapport and a more consultative, conversational flow; read the room and use body language cues in the stage directions.",
};

function describeAudience(targetAudience) {
  if (!targetAudience) return "their ideal customers";
  if (typeof targetAudience === "string") return targetAudience;
  if (typeof targetAudience === "object") {
    return (
      targetAudience.description ||
      targetAudience.summary ||
      [targetAudience.demographics, targetAudience.interests]
        .filter(Boolean)
        .join(", ") ||
      JSON.stringify(targetAudience)
    );
  }
  return String(targetAudience);
}

/**
 * Normalizes the caller-supplied list of common objections into a clean array of
 * non-empty strings. Accepts either an array or a newline/semicolon separated
 * string.
 */
function normalizeObjections(commonObjections) {
  let list = [];
  if (Array.isArray(commonObjections)) {
    list = commonObjections;
  } else if (typeof commonObjections === "string") {
    list = commonObjections.split(/\r?\n|;/);
  }
  return list.map((o) => String(o).trim()).filter(Boolean);
}

/**
 * Builds the LLM instruction prompt for generating a complete sales script.
 */
function buildSalesScriptPrompt(brand, input) {
  const { saleType, targetPersona, objections, desiredOutcome } = input;
  const name = brand.brand_name || "the business";
  const personality = brand.brand_personality || "professional and approachable";
  const voice = brand.voice_description || "clear, warm, and consultative";
  const audience = describeAudience(brand.target_audience);
  const typeRule =
    SALE_TYPE_GUIDELINES[saleType] ||
    "Write a clear, natural sales conversation script appropriate to the setting.";
  const objectionList =
    objections.length > 0
      ? objections.map((o, i) => `${i + 1}. ${o}`).join("\n")
      : "(none provided — anticipate the most likely objections for this business and persona)";

  return [
    "You are EchoAI's Sales Script agent. You write complete, ready-to-use sales scripts that sound completely natural and human — like a top-performing rep who genuinely cares about the prospect. Never robotic, never cheesy, never 'salesy'.",
    "",
    "Brand profile:",
    `- Name: ${name}`,
    `- Personality: ${personality}`,
    `- Voice: ${voice}`,
    `- Typical audience: ${audience}`,
    "",
    `Conversation type: ${saleType}`,
    `Setting direction: ${typeRule}`,
    `Target customer persona for this script: ${targetPersona}`,
    `Desired outcome of the conversation: ${desiredOutcome}`,
    "",
    "The business's most common objections (write handling responses for THESE specifically):",
    objectionList,
    "",
    "The script must match the brand's voice and personality EXACTLY and feel like a real, two-way human conversation, not a monologue.",
    "",
    "Return ONLY a single JSON object (no prose, no markdown fences) with these keys:",
    '- "opening": a strong opening that builds rapport immediately and earns the right to continue the conversation (written as what the rep says, with brief stage directions in parentheses where helpful).',
    '- "discoveryQuestions": an array of 4-7 open-ended discovery questions that uncover the prospect\'s pain points, goals, and priorities. Each item is a string.',
    '- "pitch": a pitch section that connects the product/service directly to what the prospect just shared during discovery. Reference their answers naturally rather than a generic feature dump.',
    '- "objectionHandling": an array of objects, one per common objection above. Each object has "objection" (the objection text) and "response" (a natural, empathetic, persuasive response that does not get defensive).',
    '- "closingTechniques": an array of EXACTLY 3 objects, each with "name" (the technique name), "style" (one of "soft", "medium", "direct"), and "script" (what the rep actually says). Order them soft -> medium -> direct.',
    '- "followUpSequence": an array of EXACTLY 3 objects for after the call, each with "day" (1, 3, or 7), "channel" (e.g. "email", "text", "call"), and "message" (the suggested follow-up message).',
    "",
    "Make every section sound like this specific brand talking to this specific persona.",
  ].join("\n");
}

/**
 * Extracts a JSON object from an LLM response that may include prose or code
 * fences. Throws if no object can be parsed.
 */
function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Could not parse the sales script from the AI response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Generates a complete sales script for a brand using the Anthropic API. Returns
 * the parsed sales-script object.
 */
async function generateSalesScript(brand, input) {
  const systemPrompt = buildSalesScriptPrompt(brand, input);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Write a complete ${input.saleType} sales script for the "${input.targetPersona}" persona. Respond with only the JSON object.`,
      },
    ],
  });

  const text = response.content?.[0]?.text || "";
  const script = extractJsonObject(text);
  const nonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
  const nonEmptyArray = (v) => Array.isArray(v) && v.length > 0;
  if (
    !script ||
    typeof script !== "object" ||
    !nonEmptyString(script.opening) ||
    !nonEmptyString(script.pitch) ||
    !nonEmptyArray(script.discoveryQuestions) ||
    !nonEmptyArray(script.objectionHandling) ||
    !nonEmptyArray(script.closingTechniques) ||
    !nonEmptyArray(script.followUpSequence)
  ) {
    throw new Error("The AI response did not contain a valid sales script");
  }
  return script;
}

module.exports = {
  SALE_TYPES,
  SALE_TYPE_GUIDELINES,
  normalizeObjections,
  buildSalesScriptPrompt,
  generateSalesScript,
};
