/**
 * Two-Way SMS Marketing AI prompts + generators.
 *
 * - generateSmsVariations(brand, goal, audienceSegment, callToAction): returns an
 *   array of short (<160 char) on-brand SMS copy variations for a bulk campaign.
 * - generateSmsAutoReply(brand, incomingMessage, history): returns
 *   { reply, temperature } for a single inbound SMS — a conversational on-brand
 *   reply plus a lead-temperature score so hot leads can be flagged.
 *
 * Both validate the AI output before returning; callers map upstream failures to
 * 502 and reject empty/malformed responses (no mocks, no placeholder data).
 */

const { anthropic, MODEL } = require("../config/anthropic");

const NUM_VARIATIONS = 5;
const VALID_TEMPERATURES = ["tire_kicker", "warm", "hot"];

function describeAudience(targetAudience) {
  if (!targetAudience) return "your ideal customers";
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

function extractText(response) {
  return (response.content || [])
    .map((block) => block.text || "")
    .join("")
    .trim();
}

function extractJsonArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Could not parse the SMS variations from the AI response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Could not parse the SMS reply from the AI response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

// ---------------------------------------------------------------------------
// Campaign copy variations
// ---------------------------------------------------------------------------

function buildVariationsPrompt(brand, goal, audienceSegment, callToAction) {
  const name = brand.brand_name || "the brand";
  const personality = brand.brand_personality || "professional and approachable";
  const voice = brand.voice_description || "clear, friendly, and benefit-focused";
  const audienceText = audienceSegment || describeAudience(brand.target_audience);

  return [
    "You are Zorecho's SMS Marketing agent. You write short, high-converting, human marketing text messages that feel personal — never spammy or corporate.",
    "",
    "Brand profile:",
    `- Name: ${name}`,
    `- Personality: ${personality}`,
    `- Voice: ${voice}`,
    "",
    `Campaign goal: ${goal}`,
    `Recipient segment: ${audienceText}`,
    callToAction ? `Desired call to action: ${callToAction}` : "",
    "",
    "Rules for every message:",
    "- Keep each message UNDER 160 characters (a single SMS segment).",
    `- Identify the brand ("${name}") naturally so it doesn't read as spam.`,
    "- Match the brand voice and personality EXACTLY.",
    "- Include one clear call to action.",
    '- End with a brief opt-out note such as "Reply STOP to opt out".',
    "- No emojis unless they genuinely fit the brand voice.",
    "",
    `Produce EXACTLY ${NUM_VARIATIONS} distinct variations.`,
    "",
    'Return ONLY a JSON array of strings (no prose, no markdown fences). Each string is one complete SMS message.',
  ]
    .filter(Boolean)
    .join("\n");
}

async function generateSmsVariations(brand, goal, audienceSegment, callToAction) {
  const systemPrompt = buildVariationsPrompt(brand, goal, audienceSegment, callToAction);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Write ${NUM_VARIATIONS} SMS variations for the goal: ${goal}. Respond with only the JSON array of strings.`,
      },
    ],
  });

  const text = extractText(response);
  let variations;
  try {
    const raw = extractJsonArray(text);
    if (!Array.isArray(raw)) {
      throw new Error("The AI response was not a JSON array of SMS variations");
    }
    variations = raw
      .map((v) => (typeof v === "string" ? v : v && v.message))
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter((v) => v.length > 0);
  } catch (err) {
    // Any parse/shape failure is an invalid-AI-output condition -> 502, not 500.
    err.aiInvalid = true;
    throw err;
  }
  if (variations.length < NUM_VARIATIONS) {
    const err = new Error(
      `The AI returned only ${variations.length} of ${NUM_VARIATIONS} required SMS variations`,
    );
    err.aiInvalid = true;
    throw err;
  }
  return variations.slice(0, NUM_VARIATIONS);
}

// ---------------------------------------------------------------------------
// Two-way auto-reply
// ---------------------------------------------------------------------------

function buildAutoReplyPrompt(brand) {
  const name = brand.brand_name || "the brand";
  const personality = brand.brand_personality || "professional and approachable";
  const voice = brand.voice_description || "clear, friendly, and benefit-focused";

  return [
    `You are the SMS assistant for "${name}", replying to a customer's text message.`,
    "",
    "Brand profile:",
    `- Name: ${name}`,
    `- Personality: ${personality}`,
    `- Voice: ${voice}`,
    "",
    "Your job:",
    "- Reply helpfully and conversationally in the brand voice, keeping it under 320 characters.",
    "- Answer questions, handle objections, and move the conversation toward booking, visiting, or buying.",
    "- Sound like a real human on the team, never a generic bot.",
    "",
    "Also score the lead's buying temperature from this conversation:",
    '- "hot": ready to buy/book now, asking about price/availability/scheduling, or strong intent.',
    '- "warm": interested and engaged but not ready to commit.',
    '- "tire_kicker": low intent, just browsing, or off-topic.',
    "",
    'Return ONLY a JSON object (no prose, no markdown fences) with exactly these keys:',
    '- "reply": the SMS reply text to send back.',
    '- "temperature": one of "hot", "warm", or "tire_kicker".',
  ].join("\n");
}

function toApiMessages(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((m) => {
      const content = typeof m?.content === "string" ? m.content.trim() : "";
      if (!content) return null;
      const role = m.role === "assistant" ? "assistant" : "user";
      return { role, content };
    })
    .filter(Boolean);
}

async function generateSmsAutoReply(brand, incomingMessage, history) {
  const systemPrompt = buildAutoReplyPrompt(brand);
  const priorMessages = toApiMessages(history);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: systemPrompt,
    messages: [
      ...priorMessages,
      {
        role: "user",
        content: `${incomingMessage}\n\nRespond with only the JSON object.`,
      },
    ],
  });

  const text = extractText(response);
  let reply;
  let temperature;
  try {
    const parsed = extractJsonObject(text);
    reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    if (!reply) {
      throw new Error("The AI response did not contain a reply");
    }
    temperature = VALID_TEMPERATURES.includes(parsed.temperature)
      ? parsed.temperature
      : null;
  } catch (err) {
    // Parse/shape failure -> invalid AI output (callers map to 502, never mock).
    err.aiInvalid = true;
    throw err;
  }
  return { reply, temperature };
}

module.exports = {
  NUM_VARIATIONS,
  VALID_TEMPERATURES,
  buildVariationsPrompt,
  generateSmsVariations,
  buildAutoReplyPrompt,
  generateSmsAutoReply,
};
