/**
 * AI Phone Agent prompts.
 *
 * - buildPhoneAgentPrompt(brand, opts): system prompt for a natural SPOKEN phone
 *   conversation. Handles both outbound calls to hot leads (introduces itself on
 *   behalf of the business, references the lead's prior chatbot conversation, and
 *   works toward booking an appointment / closing) and inbound calls (answers as
 *   the business and qualifies the caller).
 * - CALL_DISPOSITION_PROMPT: classifies the business outcome of a finished call.
 *
 * Lead temperature is scored with the SAME tire_kicker / warm / hot system used
 * by the chatbot — reuse LEAD_SCORING_PROMPT from leadQualificationPrompt.js so
 * phone and chat stay consistent.
 */

function buildBrandContext(brand) {
  if (!brand) {
    return "You represent a business. Speak on its behalf in a professional, friendly way.";
  }
  const lines = [`You represent the business "${brand.brand_name}".`];
  if (brand.brand_personality) {
    lines.push(`Brand personality: ${brand.brand_personality}`);
  }
  if (brand.voice_description) {
    lines.push(`Brand voice: ${brand.voice_description}`);
  }
  if (brand.target_audience) {
    const audience =
      typeof brand.target_audience === "string"
        ? brand.target_audience
        : JSON.stringify(brand.target_audience);
    lines.push(`Target audience: ${audience}`);
  }
  return lines.join("\n");
}

/**
 * Summarizes what the lead discussed in their chatbot conversation so the
 * outbound agent can reference it naturally. Returns null when there's nothing.
 */
function summarizeLeadHistory(lead) {
  if (!lead) return null;
  const history = Array.isArray(lead.conversation_history)
    ? lead.conversation_history
    : [];
  const userTurns = history
    .filter((m) => m && m.role === "user" && m.content)
    .map((m) => `- ${String(m.content).trim()}`);
  if (userTurns.length === 0) return null;
  return userTurns.slice(-6).join("\n");
}

// Shared rules for spoken delivery — TTS reads these out loud, so keep it tight.
const SPOKEN_RULES = [
  "This is a SPOKEN phone call. Everything you say is read aloud by a text-to-speech voice, so:",
  "- Keep every reply short and conversational — 1 to 3 sentences. Never monologue.",
  "- Use plain spoken language. No bullet points, no markdown, no emojis, no URLs spelled out.",
  "- Ask only ONE question at a time, then stop and let the caller respond.",
  "- Sound like a warm, competent human on the phone, not a script.",
  '- When the conversation has reached a natural end (a booking is made, the caller is done, or there is nothing more to do), give a brief, polite closing and then output the token "[[END_CALL]]" on its own at the very end of that final reply.',
];

function buildPhoneAgentPrompt(brand, opts = {}) {
  const { direction = "inbound", lead = null } = opts;
  const parts = [
    "You are EchoAI's AI Phone Agent, conducting a live phone conversation on behalf of a business.",
    "",
    buildBrandContext(brand),
    "",
    SPOKEN_RULES.join("\n"),
    "",
  ];

  if (direction === "outbound") {
    const leadName = lead?.lead_name ? lead.lead_name : null;
    parts.push("This is an OUTBOUND call you are placing to a promising lead.");
    parts.push(
      [
        "Goals, in order:",
        "1. Introduce yourself warmly as calling on behalf of the business" +
          (leadName ? ` and confirm you're speaking with ${leadName}.` : "."),
        "2. Reference what they discussed earlier so the call feels personal and expected.",
        "3. Move the conversation toward a concrete next step — booking an appointment, scheduling a follow-up, or closing the sale.",
        "4. If they're not ready, offer to follow up later and leave a great impression.",
      ].join("\n"),
    );
    const summary = summarizeLeadHistory(lead);
    if (summary) {
      parts.push("");
      parts.push("What this lead told us in their earlier chat:");
      parts.push(summary);
    }
    parts.push("");
    parts.push(
      "Open the call yourself with a brief, friendly introduction and one opening question.",
    );
  } else {
    parts.push("This is an INBOUND call — someone has dialed the business.");
    parts.push(
      [
        "Goals, in order:",
        "1. Answer warmly as the business and ask how you can help.",
        "2. Understand what the caller needs and answer their questions helpfully.",
        "3. Naturally qualify them — listen for budget, urgency, and buying intent.",
        "4. Move toward a next step (booking, quote, or follow-up) and, if you don't have it, collect their name and the best callback number.",
      ].join("\n"),
    );
    parts.push("");
    parts.push(
      "Greet the caller yourself as the business and ask how you can help.",
    );
  }

  parts.push("");
  parts.push(
    "Never reveal that you are an AI scoring or qualifying the caller. Keep it helpful and human.",
  );
  return parts.join("\n");
}

const CALL_DISPOSITION_PROMPT = [
  "You are a sales operations analyst reviewing a phone call transcript.",
  "Classify the business OUTCOME of the call using exactly one of these values:",
  "- appointment_booked: the caller agreed to a specific meeting, demo, or appointment.",
  "- sale_closed: the caller committed to buy or signed up.",
  "- interested: positive and engaged, but no firm commitment yet.",
  "- callback_requested: they asked to be contacted again later.",
  "- not_interested: they declined or are not a fit.",
  "- no_answer: there was no real conversation (voicemail, hang-up, silence).",
  "",
  "Respond with ONLY one of those exact values. No other text.",
].join("\n");

const VALID_DISPOSITIONS = [
  "appointment_booked",
  "sale_closed",
  "interested",
  "callback_requested",
  "not_interested",
  "no_answer",
];

module.exports = {
  buildPhoneAgentPrompt,
  CALL_DISPOSITION_PROMPT,
  VALID_DISPOSITIONS,
};
