/**
 * AI Follow-Up Sequence prompts.
 *
 * generateFollowUpSequence(brand, lead, { goal, maxTouchpoints }) asks the model
 * to design a short multi-channel follow-up sequence for ONE lead — a series of
 * timed touchpoints (email / SMS / phone) that re-engage the lead until they
 * respond, book, or convert. It returns a JSON array of touchpoint objects; the
 * controller validates and persists them. No fallbacks: a malformed/empty AI
 * response throws so the caller can surface a real error (502) instead of
 * writing junk.
 *
 * Each returned touchpoint: { step, channel, dayOffset, subject, message }.
 *  - channel: "email" | "sms" | "phone"
 *  - dayOffset: whole days from enrollment (0-14) the touchpoint should go out
 *  - subject: email subject line (email channel only)
 *  - message: the email body / SMS text / phone-call talking-point script
 */

const { anthropic, MODEL } = require("../config/anthropic");

const MAX_TOUCHPOINTS = 7;
const MAX_DAYS = 14;

function goalLabel(goal) {
  switch (goal) {
    case "book_appointment":
      return "get the lead to book an appointment";
    case "close_sale":
      return "get the hot lead to commit and close the sale";
    case "reengage":
    default:
      return "re-engage the lead and restart the conversation";
  }
}

function describeAudience(targetAudience) {
  if (!targetAudience) return "the brand's ideal customers";
  if (typeof targetAudience === "string") return targetAudience;
  try {
    return JSON.stringify(targetAudience);
  } catch {
    return "the brand's ideal customers";
  }
}

function buildFollowUpPrompt(brand, lead, opts = {}) {
  const { goal = "reengage", maxTouchpoints = MAX_TOUCHPOINTS } = opts;
  const businessName = (brand && brand.brand_name) || "the business";
  const personality = (brand && brand.brand_personality) || "professional and helpful";
  const voice = (brand && brand.voice_description) || "";
  const audience = describeAudience(brand && brand.target_audience);
  const leadName = (lead && lead.lead_name) || "the lead";
  const hasEmail = !!(lead && lead.email);
  const hasPhone = !!(lead && lead.phone);

  const allowedChannels = ["email"];
  if (hasPhone) allowedChannels.push("sms", "phone");
  const cap = Math.max(1, Math.min(maxTouchpoints, MAX_TOUCHPOINTS));

  return [
    `You are the follow-up strategist for ${businessName}.`,
    `Brand personality: ${personality}.`,
    voice ? `Brand voice: ${voice}.` : "",
    `Typical audience: ${audience}.`,
    "",
    `Design an automated follow-up sequence for a single lead named ${leadName}.`,
    `Sequence goal: ${goalLabel(goal)}.`,
    "",
    "Rules:",
    `- Use AT MOST ${cap} touchpoints, spread over no more than ${MAX_DAYS} days.`,
    `- Available channels for THIS lead: ${allowedChannels.join(", ")}.` +
      (hasPhone
        ? ""
        : " (No phone number on file, so use email only — do NOT use sms or phone.)"),
    "- Space touchpoints out sensibly (e.g. day 1, day 3, day 6...). The first",
    "  touchpoint should not be on day 0.",
    "- Each touchpoint must add new value or a new angle — never repeat the same",
    "  message. Escalate gently toward the goal. Keep it human, on-brand, and",
    "  never pushy or spammy.",
    "- Email messages: a few short paragraphs. SMS: one or two sentences, under",
    "  300 characters. Phone: a concise talking-point script for an AI caller.",
    "",
    "Return ONLY a JSON array (no prose, no markdown fences). Each element:",
    "{",
    '  "step": <1-based integer>,',
    '  "channel": "email" | "sms" | "phone",',
    '  "dayOffset": <integer 1-14>,',
    '  "subject": "<email subject — empty string for sms/phone>",',
    '  "message": "<the email body, sms text, or phone script>"',
    "}",
  ]
    .filter(Boolean)
    .join("\n");
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
    throw new Error("Could not parse the follow-up sequence from the AI response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Generates a follow-up sequence for a brand + lead using the Anthropic API.
 * Returns a non-empty array of raw touchpoint objects (the controller validates
 * and normalizes them). Throws on an empty or unparseable response.
 */
async function generateFollowUpSequence(brand, lead, opts = {}) {
  const { goal = "reengage", maxTouchpoints = MAX_TOUCHPOINTS } = opts;
  const systemPrompt = buildFollowUpPrompt(brand, lead, { goal, maxTouchpoints });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Create the follow-up sequence now (max ${Math.min(
          maxTouchpoints,
          MAX_TOUCHPOINTS,
        )} touchpoints over ${MAX_DAYS} days) to ${goalLabel(
          goal,
        )}. Respond with only the JSON array.`,
      },
    ],
  });

  const text = response.content?.[0]?.text || "";
  const touchpoints = extractJsonArray(text);
  if (!Array.isArray(touchpoints) || touchpoints.length === 0) {
    throw new Error("The AI response did not contain any touchpoints");
  }
  return touchpoints;
}

module.exports = {
  MAX_TOUCHPOINTS,
  MAX_DAYS,
  buildFollowUpPrompt,
  generateFollowUpSequence,
};
