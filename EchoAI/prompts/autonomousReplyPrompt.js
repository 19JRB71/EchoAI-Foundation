// ---------------------------------------------------------------------------
// Autonomous conversation REPLY writer (Claude).
//
// The Two-Way Autonomous Conversation system splits the work: Hermes 4 decides
// what the conversation should do (utils/autonomousConversationBrain.js); Claude
// WRITES the actual reply here, in the brand's voice, steered by the Hermes
// directive. Used for the SMS and email channels (the website chatbot keeps its
// own richer, slot-aware reply generator).
//
// AI failures / empty output are marked `err.aiInvalid = true` so callers keep
// the conversation intact and simply skip sending this turn (never mock a reply).
// ---------------------------------------------------------------------------

const { createMessage, MODEL, DEFAULT_AI_TIMEOUT_MS } = require("../config/anthropic");

function extractText(response) {
  if (!response || !Array.isArray(response.content)) return "";
  return response.content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
}

function toApiMessages(history) {
  const list = Array.isArray(history) ? history : [];
  const mapped = list
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .map((m) => ({ role: m.role, content: String(m.content) }));
  // The Anthropic API requires the first turn to be a user turn.
  while (mapped.length && mapped[0].role !== "user") mapped.shift();
  return mapped;
}

function channelGuidance(channel) {
  if (channel === "sms") {
    return [
      "This is an SMS text conversation.",
      "Keep the reply to 1–2 short sentences (under ~320 characters). No markdown, no bullet lists, no links unless essential.",
      "Sound like a real person texting, not a marketing blast.",
    ];
  }
  if (channel === "email") {
    return [
      "This is an email conversation.",
      "Write 1–2 short, warm paragraphs. Plain text only (no markdown). You may end with a brief, natural sign-off.",
      "Sound like a helpful human from the business, not an automated newsletter.",
    ];
  }
  return ["Write a natural, concise conversational reply."];
}

function buildAutonomousReplyPrompt(brand, { channel, directive } = {}) {
  const b = brand || {};
  const audience =
    b.target_audience && typeof b.target_audience === "object"
      ? JSON.stringify(b.target_audience)
      : b.target_audience
        ? String(b.target_audience)
        : "";

  const lines = [
    `You are the voice of ${b.brand_name || "this business"}, replying to a lead who responded to one of your messages.`,
    "You are handling this conversation on the business's behalf, autonomously, to move the lead toward booking an appointment or becoming a customer.",
    "",
    "BRAND VOICE (established during discovery — match it exactly):",
    b.brand_personality ? `- Personality: ${String(b.brand_personality).slice(0, 500)}` : "- Personality: warm, professional, helpful.",
    b.voice_description ? `- Voice & tone: ${String(b.voice_description).slice(0, 500)}` : "",
    audience ? `- Who you're talking to: ${audience.slice(0, 300)}` : "",
    "",
    "HOW TO REPLY:",
    ...channelGuidance(channel).map((g) => `- ${g}`),
    "- Answer the lead's actual question or objection first, honestly. Never invent facts, prices, or promises you don't know.",
    "- Always move the conversation one concrete step forward (a question, a helpful next step, or an offer to set up a time).",
    "- Never say you are an AI or a bot unless the lead directly asks.",
    "- Do not repeat phrasing you already used earlier in the thread.",
  ];
  if (directive) {
    lines.push("", directive);
  }
  lines.push(
    "",
    "Reply with ONLY the message text the lead should receive — no preamble, no quotes, no labels.",
  );
  return lines.filter((l) => l !== "" || true).join("\n");
}

/**
 * Generate the lead-facing reply for one autonomous turn. Returns the reply
 * string. Throws (with err.aiInvalid) on AI failure or empty output.
 *
 * @param {object} args
 * @param {object} args.brand
 * @param {string} args.channel        'sms' | 'email'
 * @param {Array}  args.history        [{role, content}] prior turns
 * @param {string} args.latestInbound  the lead's newest message
 * @param {string} [args.directive]    Hermes directive line
 */
async function generateAutonomousReply({ brand, channel, history, latestInbound, directive }) {
  const system = buildAutonomousReplyPrompt(brand, { channel, directive });
  const priorMessages = toApiMessages(history);

  let response;
  try {
    response = await createMessage(
      {
        model: MODEL,
        max_tokens: channel === "email" ? 700 : 350,
        system,
        messages: [
          ...priorMessages,
          { role: "user", content: String(latestInbound || "") },
        ],
      },
      { timeout: DEFAULT_AI_TIMEOUT_MS, label: "Autonomous reply" },
    );
  } catch (err) {
    err.aiInvalid = true;
    throw err;
  }

  const reply = extractText(response);
  if (!reply) {
    const err = new Error("The AI response did not contain a reply");
    err.aiInvalid = true;
    throw err;
  }
  return reply;
}

module.exports = {
  buildAutonomousReplyPrompt,
  generateAutonomousReply,
};
