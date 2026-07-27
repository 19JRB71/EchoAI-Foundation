// ---------------------------------------------------------------------------
// Echo's orchestration BRAIN, powered by Hermes 4 (config/hermes.js).
//
// Given the owner's message plus context (their businesses, the ACTIVE one, and
// whether something is awaiting approval), Hermes decides — in ONE small, fast
// call — the intent, which of the nine AI teammates owns it, whether the
// request is on-topic, and a short directive for how Claude should answer. The
// directive is fed into the existing Claude reply pipeline so Echo stays on
// topic, never mixes brands, and routes to the right teammate.
//
// This is advisory + non-breaking by design: if Hermes is unconfigured, slow,
// or errors, decide() returns null and Echo falls back to its existing
// behavior. The brain sharpens Echo; it never becomes a single point of failure.
// ---------------------------------------------------------------------------

const { createCompletion, hermesConfigured } = require("../config/hermes");

// The nine AI teammates and the kind of request each one owns. Kept aligned
// with client/src/lib/departments.js (agent roster + tool cards).
const TEAM = [
  "Echo (Marketing Director): overall strategy, approvals, briefings, memory, reminders/tasks, email assistant, anything cross-cutting or unclear.",
  "Scout (Research Specialist): market/customer intelligence, competitors, grants & funding, Google/SEO rankings.",
  "Atlas (Advertising Manager): Facebook ad campaigns, ad budgets & ROI, connecting Facebook.",
  "Nova (Social Media Manager): content calendar and scheduled/published social posts.",
  "Pulse (CRM Manager): leads, sales queue, follow-up sequences, appointments, email & SMS marketing, voter/property CRM.",
  "Voice (AI Receptionist): the phone agent and the website chatbot.",
  "Forge (Creative Director): image studio, video content, ad creative, sales scripts.",
  "Sentinel (Oversight Agent): call monitoring, platform health, auto-fix and error history.",
  "Sage (Industry Intelligence): the living read on the industry — trends, competitor moves, opportunities and threats for the ACTIVE business only.",
];

const RULES = [
  "Stay strictly on the current topic until it is complete; do not drift to unrelated topics.",
  "One intent per turn: pick the single thing the owner is actually asking for, and one teammate to own it.",
  "Never mix data between businesses. Everything is about the ACTIVE business unless the owner explicitly asks to switch or compare.",
  "The active business is locked once selected — never assume a switch the owner did not ask for.",
  "Understand casual speech: 'hold up' = stop, 'run it' = execute/approve, \"what's good\" = give me an update.",
  "Never repeat the same phrasing twice in a row.",
];

function buildSystemPrompt() {
  return [
    "You are the reasoning core of Echo, a professional, friendly AI Marketing Director.",
    "Your job here is NOT to talk to the owner. Your job is to DECIDE, silently, how Echo should handle the owner's latest message, and return that decision as strict JSON.",
    "",
    "The AI team you can route to:",
    ...TEAM.map((t) => `- ${t}`),
    "",
    "Rules you must respect when deciding:",
    ...RULES.map((r) => `- ${r}`),
    "",
    "Return ONLY a JSON object (no prose, no markdown fences) with exactly these keys:",
    '{"agent": <one of: echo|scout|atlas|nova|pulse|voice|forge|sentinel|sage>,',
    ' "intent": <short snake_case label, e.g. report_status|launch_ads|write_content|navigate|approve_pending|switch_business|small_talk|unsupported_feature>,',
    ' "onTopic": <true|false — is this about the active business / marketing, vs. an unrelated tangent>,',
    ' "brandSwitchRequested": <true|false — did the owner explicitly ask to change or compare businesses>,',
    ' "directive": <one sentence telling Echo exactly what to focus the reply on, scoped to the active business>}',
  ].join("\n");
}

function buildUserPrompt({ activeBrandName, businesses, pendingAction, message }) {
  const names = Array.isArray(businesses) ? businesses.map((b) => b.brand_name || b.name).filter(Boolean) : [];
  const lines = [
    `Active business: ${activeBrandName || "(none selected yet)"}.`,
    names.length > 1
      ? `The owner runs ${names.length} businesses: ${names.join(", ")}.`
      : "The owner runs one business.",
    pendingAction
      ? "There is an action awaiting the owner's approval right now."
      : "Nothing is awaiting approval.",
    "",
    `Owner's latest message: "${(message || "").slice(0, 800)}"`,
    "",
    "Decide and return the JSON object now.",
  ];
  return lines.join("\n");
}

const VALID_AGENTS = new Set([
  "echo",
  "scout",
  "atlas",
  "nova",
  "pulse",
  "voice",
  "forge",
  "sentinel",
  "sage",
]);

/** Parse Hermes's reply into a decision object, tolerating stray fences/prose. */
function parseDecision(raw) {
  if (!raw || typeof raw !== "string") return null;
  let text = raw.trim();
  // Strip ```json ... ``` fences if the model added them.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // Isolate the first {...} block.
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
  const agent = String(obj.agent || "").toLowerCase().trim();
  const decision = {
    agent: VALID_AGENTS.has(agent) ? agent : "echo",
    intent: typeof obj.intent === "string" ? obj.intent.trim().slice(0, 60) : "general",
    onTopic: obj.onTopic !== false, // default to on-topic unless explicitly false
    brandSwitchRequested: obj.brandSwitchRequested === true,
    directive: typeof obj.directive === "string" ? obj.directive.trim().slice(0, 400) : "",
  };
  return decision;
}

/**
 * Decide how Echo should handle a message. Returns a decision object, or null
 * when the brain is unavailable/unconfigured (caller falls back to existing
 * behavior). NEVER throws.
 */
async function decide(ctx = {}) {
  if (!hermesConfigured()) return null;
  try {
    const raw = await createCompletion(
      {
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: buildUserPrompt(ctx) }],
        max_tokens: 300,
        temperature: 0.1,
      },
      // The brain gates a live (often spoken) reply, so keep it snappy: one
      // short-budget attempt. If Hermes is slow/down we fall back fast rather
      // than making the owner wait — Echo must never feel frozen on the brain.
      {
        label: "Echo orchestrator",
        timeout: Number(process.env.HERMES_ORCHESTRATOR_TIMEOUT_MS) || 6000,
        attempts: 1,
      },
    );
    return parseDecision(raw);
  } catch (err) {
    console.error("Echo orchestrator (Hermes) unavailable — falling back:", err.message);
    return null;
  }
}

/**
 * Turn a decision into the guidance line injected into Claude's system prompt.
 * Returns "" when there is no usable decision.
 */
function directiveForPrompt(decision, activeBrandName) {
  if (!decision) return "";
  const parts = [
    `ORCHESTRATION (decided by Hermes, your reasoning brain — follow it):`,
    `This request is owned by teammate "${decision.agent}". Intent: ${decision.intent}.`,
  ];
  if (decision.directive) parts.push(`Focus the reply strictly on: ${decision.directive}`);
  if (activeBrandName && !decision.brandSwitchRequested) {
    parts.push(
      `Keep everything scoped to ${activeBrandName}; do not reference or mix in any other business.`,
    );
  }
  if (!decision.onTopic) {
    parts.push(
      "The owner drifted off-topic; answer briefly, then guide them back to what they were working on.",
    );
  }
  parts.push("Give ONE focused response for this ONE intent. Do not repeat phrasing you just used.");
  return parts.join(" ");
}

module.exports = {
  decide,
  parseDecision,
  directiveForPrompt,
  buildSystemPrompt,
  TEAM,
  RULES,
};
