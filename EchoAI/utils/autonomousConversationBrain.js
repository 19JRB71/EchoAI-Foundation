// ---------------------------------------------------------------------------
// Autonomous conversation BRAIN, powered by Hermes 4 (config/hermes.js).
//
// This is the "conversation intelligence" half of the Two-Way Autonomous
// Conversation system (see SUBSYSTEMS.md). Given a lead's latest reply plus the
// running transcript, Hermes decides — in ONE small, fast call — what the lead
// intends and what the conversation should do next:
//
//   state:         continue | stop | booked | converted
//   buyingSignal:  is the lead showing a STRONG buying signal right now?
//   temperature:   tire_kicker | warm | hot (feeds the live lead score)
//   directive:     one sentence steering Claude's actual reply content
//
// Architecture split (see replit.md): Hermes does the thinking/deciding here;
// Anthropic Claude writes the actual reply (in the engine). This module mirrors
// utils/echoOrchestrator.js: advisory + non-breaking. If Hermes is unconfigured,
// slow, or errors, analyzeReply() returns null and the engine falls back to a
// safe default (continue, no escalation). The brain sharpens Echo; it is never a
// single point of failure.
// ---------------------------------------------------------------------------

const { createCompletion, hermesConfigured } = require("../config/hermes");

const VALID_STATES = new Set(["continue", "stop", "booked", "converted"]);
const VALID_TEMPERATURES = new Set(["tire_kicker", "warm", "hot"]);

const RULES = [
  "You are triaging ONE lead's reply inside an ongoing sales conversation the AI is handling on the business's behalf.",
  "Decide the single best next state for the conversation, honestly, from the lead's actual words — never invent enthusiasm that is not there.",
  "state 'stop' ONLY when the lead clearly wants out: 'stop', 'unsubscribe', 'not interested', 'leave me alone', 'remove me', 'no thanks stop contacting me'. A hard no to one offer is NOT necessarily stop if they are still engaging.",
  "state 'booked' ONLY when the lead has agreed to a specific appointment/meeting time in this exchange.",
  "state 'converted' ONLY when the lead has clearly agreed to buy / sign up / become a customer now.",
  "Otherwise state is 'continue'.",
  "buyingSignal is true ONLY for a STRONG signal: explicit intent to buy, asking about price/plans to purchase, asking how to get started/sign up, requesting a call/demo, or urgency ('I need this today'). General curiosity is NOT a strong signal.",
  "temperature reflects the lead's interest overall: hot = strong buying intent, warm = engaged/interested, tire_kicker = low intent or just browsing.",
];

function buildSystemPrompt() {
  return [
    "You are the reasoning core of Echo, an AI that autonomously handles two-way sales conversations with leads.",
    "Your job is NOT to write the reply. Your job is to DECIDE, silently, the state of THIS conversation from the lead's latest message, and return that decision as strict JSON.",
    "",
    "Rules you must respect when deciding:",
    ...RULES.map((r) => `- ${r}`),
    "",
    "Return ONLY a JSON object (no prose, no markdown fences) with exactly these keys:",
    '{"intent": <short snake_case label, e.g. asking_price|ready_to_buy|book_appointment|question|objection|opt_out|small_talk>,',
    ' "state": <one of: continue|stop|booked|converted>,',
    ' "buyingSignal": <true|false — is the lead showing a STRONG buying signal right now>,',
    ' "temperature": <one of: tire_kicker|warm|hot>,',
    ' "directive": <one sentence telling the writer exactly what to focus the reply on to move this lead forward>}',
  ].join("\n");
}

function buildUserPrompt({ brand, channel, history, latestInbound }) {
  const recent = Array.isArray(history) ? history.slice(-10) : [];
  const transcript = recent
    .map((m) => {
      const who = m.role === "assistant" ? "Echo" : "Lead";
      const content = typeof m.content === "string" ? m.content : "";
      return `${who}: ${content}`;
    })
    .filter(Boolean)
    .join("\n");

  const lines = [
    `Business: ${(brand && brand.brand_name) || "(unnamed)"}. Channel: ${channel}.`,
    brand && brand.brand_personality
      ? `Business personality: ${String(brand.brand_personality).slice(0, 300)}`
      : "",
    "",
    "Recent conversation so far:",
    transcript || "(this is the lead's first reply)",
    "",
    `Lead's latest message: "${String(latestInbound || "").slice(0, 800)}"`,
    "",
    "Decide and return the JSON object now.",
  ];
  return lines.filter((l) => l !== null && l !== undefined).join("\n");
}

/** Parse Hermes's reply into a decision object, tolerating stray fences/prose. */
function parseDecision(raw) {
  if (!raw || typeof raw !== "string") return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const state = String(obj.state || "").toLowerCase().trim();
  const temperature = String(obj.temperature || "").toLowerCase().trim();
  return {
    intent:
      typeof obj.intent === "string" ? obj.intent.trim().slice(0, 60) : "question",
    state: VALID_STATES.has(state) ? state : "continue",
    buyingSignal: obj.buyingSignal === true,
    temperature: VALID_TEMPERATURES.has(temperature) ? temperature : null,
    directive:
      typeof obj.directive === "string" ? obj.directive.trim().slice(0, 400) : "",
  };
}

/**
 * Analyze a lead's latest reply. Returns a decision object, or null when the
 * brain is unavailable/unconfigured (the engine falls back to a safe default).
 * NEVER throws.
 *
 * @param {object} ctx
 * @param {object} ctx.brand
 * @param {string} ctx.channel        'sms' | 'email' | 'chatbot'
 * @param {Array}  ctx.history        [{role, content}] prior turns
 * @param {string} ctx.latestInbound  the lead's newest message text
 */
async function analyzeReply(ctx = {}) {
  if (!hermesConfigured()) return null;
  try {
    const raw = await createCompletion(
      {
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: buildUserPrompt(ctx) }],
        max_tokens: 300,
        temperature: 0.1,
      },
      {
        label: "Autonomous conversation brain",
        timeout: Number(process.env.HERMES_ORCHESTRATOR_TIMEOUT_MS) || 6000,
        attempts: 1,
      },
    );
    return parseDecision(raw);
  } catch (err) {
    console.error(
      "Autonomous conversation brain (Hermes) unavailable — falling back:",
      err.message,
    );
    return null;
  }
}

/**
 * Turn a decision into a directive line injected into Claude's reply prompt.
 * Returns "" when there is no usable decision (Claude then relies on its own
 * channel prompt + brand voice).
 */
function directiveForPrompt(decision) {
  if (!decision || !decision.directive) return "";
  return [
    "CONVERSATION INTELLIGENCE (decided by Hermes, your reasoning brain — follow it):",
    `The lead's intent is "${decision.intent}".`,
    `Focus this reply on: ${decision.directive}`,
    "Keep it natural and human, in the brand's voice, and move the lead one concrete step forward.",
  ].join(" ");
}

module.exports = {
  analyzeReply,
  parseDecision,
  directiveForPrompt,
  buildSystemPrompt,
  VALID_STATES,
  VALID_TEMPERATURES,
  RULES,
};
