/**
 * AI Email Campaign agent prompt + generator.
 *
 * - MIN_EMAILS / MAX_EMAILS: the supported sequence length bounds.
 * - buildEmailCampaignPrompt(brand, goal, audience, numEmails): builds the
 *   system prompt that instructs the LLM to produce a complete, on-brand email
 *   sequence.
 * - generateEmailSequence(brand, goal, audience, numEmails): calls the Anthropic
 *   API with the brand profile and returns the parsed array of email objects.
 */

const { anthropic, MODEL } = require("../config/anthropic");

const MIN_EMAILS = 3;
const MAX_EMAILS = 10;

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

/**
 * Builds the LLM instruction prompt for generating an on-brand email sequence.
 */
function buildEmailCampaignPrompt(brand, goal, audience, numEmails) {
  const name = brand.brand_name || "the brand";
  const personality = brand.brand_personality || "professional and approachable";
  const voice = brand.voice_description || "clear, friendly, and benefit-focused";
  const audienceText = audience || describeAudience(brand.target_audience);

  return [
    "You are Zorecho's Email Campaign agent. You write high-converting email marketing sequences that feel personal and human, never corporate.",
    "",
    "Brand profile:",
    `- Name: ${name}`,
    `- Personality: ${personality}`,
    `- Voice: ${voice}`,
    "",
    `Campaign goal: ${goal}`,
    `Target audience: ${audienceText}`,
    `Number of emails in the sequence: ${numEmails}`,
    "",
    "Follow proven email marketing principles: open loops, storytelling, and value before the ask. Match the brand voice and personality EXACTLY. Write copy a real person would send, not a marketing department.",
    "",
    `Produce EXACTLY ${numEmails} emails forming a coherent sequence that builds toward the goal.`,
    "",
    "Return ONLY a JSON array of email objects (no prose, no markdown fences). Each object must have these keys:",
    '- "subject": a compelling subject line.',
    '- "previewText": the inbox preview/preheader text.',
    '- "body": the full email body in the brand voice. Use \\n for line breaks between paragraphs.',
    '- "callToAction": the single clear call to action for the email.',
    '- "sendTiming": when to send relative to sequence start (e.g. "Day 1", "Day 3", "Day 7").',
  ].join("\n");
}

/**
 * Extracts a JSON array from an LLM response that may include prose or code
 * fences. Throws if no array can be parsed.
 */
function extractJsonArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Could not parse the email sequence from the AI response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Generates an email sequence for a brand using the Anthropic API. Returns an
 * array of email objects.
 */
async function generateEmailSequence(brand, goal, audience, numEmails) {
  const systemPrompt = buildEmailCampaignPrompt(brand, goal, audience, numEmails);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Write a ${numEmails}-email sequence for the goal: ${goal}. Respond with only the JSON array.`,
      },
    ],
  });

  const text = response.content?.[0]?.text || "";
  const emails = extractJsonArray(text);
  if (!Array.isArray(emails) || emails.length === 0) {
    throw new Error("The AI response did not contain any emails");
  }
  return emails;
}

module.exports = {
  MIN_EMAILS,
  MAX_EMAILS,
  buildEmailCampaignPrompt,
  generateEmailSequence,
};
