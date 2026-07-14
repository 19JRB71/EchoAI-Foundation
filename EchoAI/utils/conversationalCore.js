// ---------------------------------------------------------------------------
// Zorecho Conversational Core — EXPERIMENTAL PROTOTYPE (not production).
//
// A natural-language conversation layer for Echo, fully isolated behind the
// ENABLE_CONVERSATIONAL_CORE feature flag (off by default) plus an in-memory
// emergency-disable switch. When the flag is off, none of this code runs and
// the normal Echo experience is completely unchanged.
//
// Flow: user text → Hermes intent/context detection → read-only tool adapter
// (utils/coreLabTools.js) → Claude natural-language reply → flight-recorder
// trace. The reasoning layer NEVER touches databases or third-party services
// directly — all data access goes through the tool adapters, which reuse the
// existing owner-scoped services read-only.
//
// v1 safety: every tool is read-only. Anything that would create, send,
// publish, delete, purchase, launch, or modify data is answered with a preview
// and `requiresApproval: true` — and is never executed.
// ---------------------------------------------------------------------------

const { createCompletion, hermesConfigured } = require("../config/hermes");
const { createMessage, MODEL } = require("../config/anthropic");
const coreTools = require("./coreLabTools");

// ---------------------------------------------------------------------------
// Feature flag + emergency disable
// ---------------------------------------------------------------------------

let emergencyDisabled = false;

function flagEnabled() {
  return String(process.env.ENABLE_CONVERSATIONAL_CORE || "").toLowerCase() === "true";
}

function coreEnabled() {
  return flagEnabled() && !emergencyDisabled;
}

function setEmergencyDisabled(value) {
  emergencyDisabled = Boolean(value);
  return emergencyDisabled;
}

function coreStatus() {
  return {
    flagEnabled: flagEnabled(),
    emergencyDisabled,
    enabled: coreEnabled(),
    hermesConfigured: hermesConfigured(),
  };
}

// ---------------------------------------------------------------------------
// Session memory (temporary — expires with the test session, never persisted)
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes idle
const MAX_TURNS = 12;
const sessions = new Map(); // sessionId -> { turns, lastTool, lastToolData, lastDraft, touchedAt }

function sweepSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.touchedAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

// Sessions are namespaced by userId so a guessed/colliding client-supplied
// sessionId can never read or write another user's conversational context.
function sessionKey(userId, sessionId) {
  return `${userId}:${sessionId}`;
}

function getSession(userId, sessionId) {
  sweepSessions();
  const key = sessionKey(userId, sessionId);
  let s = sessions.get(key);
  if (!s) {
    s = { turns: [], lastTool: null, lastToolData: null, lastDraft: null, touchedAt: Date.now() };
    sessions.set(key, s);
  }
  s.touchedAt = Date.now();
  return s;
}

function endSession(userId, sessionId) {
  return sessions.delete(sessionKey(userId, sessionId));
}

function memorySummary(session) {
  // A compact, sanitized view of recent context for the intent + reply prompts.
  const lines = [];
  for (const t of session.turns.slice(-6)) {
    lines.push(`${t.role === "user" ? "Owner" : "Echo"}: ${String(t.text || "").slice(0, 240)}`);
  }
  if (session.lastTool) lines.push(`(Last tool used: ${session.lastTool})`);
  if (session.lastDraft) lines.push(`(There is a current Facebook post draft in progress.)`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Flight recorder (in-memory ring buffer; sanitized — no tokens/passwords,
// no full email bodies)
// ---------------------------------------------------------------------------

const RECORDER_MAX = 50;
const recorder = [];

function record(trace) {
  recorder.push(trace);
  if (recorder.length > RECORDER_MAX) recorder.shift();
}

// Traces are recorded with the owning userId and only ever returned to that
// user — the recorder is process-global, so filtering here is mandatory.
function recentTraces(userId, limit = 20) {
  return recorder
    .filter((t) => String(t.userId) === String(userId))
    .slice(-limit)
    .reverse();
}

// ---------------------------------------------------------------------------
// Intent detection (Hermes)
// ---------------------------------------------------------------------------

const VALID_INTENTS = new Set([
  "email_summary", // summaries / "did X respond" / "summarize the message from Y"
  "calendar", // "what do I have tomorrow", "anything Friday afternoon"
  "leads", // lead counts / follow-up status
  "fb_draft", // draft or revise a Facebook post (DRAFT ONLY)
  "general", // business conversation / advice
  "clarify", // intent unclear — ask ONE brief question
  "sensitive_action", // would create/send/publish/delete/modify — preview + approval
]);

function buildIntentSystemPrompt() {
  return [
    "You are the intent-detection layer of an experimental conversational prototype for a marketing platform owner.",
    "Decide, silently, what the owner wants and return STRICT JSON only (no prose, no markdown fences).",
    "",
    "Available intents (v1 is READ-ONLY):",
    '- "email_summary": questions about their email inbox — new/important mail, whether someone replied, summarizing a message. Optional args: {"query": <sender or topic keywords, if the owner named one>}.',
    '- "calendar": questions about their schedule or appointments. Optional args: {"when": <short phrase like "tomorrow" or "friday afternoon">}.',
    '- "leads": questions about leads — counts, which came in today/yesterday, which need follow-up.',
    '- "fb_draft": asking to WRITE or REVISE a Facebook/social post draft (drafting text is allowed; publishing is NOT). Optional args: {"instruction": <what the post should say/change>}.',
    '- "general": general business conversation, advice, priorities, "what should I focus on".',
    '- "clarify": you genuinely cannot tell what they want — provide ONE brief clarifying question in "clarification".',
    '- "sensitive_action": the request would SEND, PUBLISH, DELETE, PURCHASE, LAUNCH, BOOK/CHANGE an appointment, or MODIFY any record (e.g. "send that email", "publish the post", "launch the ad", "delete that lead"). These are not executed — describe the action briefly in "preview".',
    "",
    "Follow-up understanding: use the conversation context. \"Which one should I answer first?\" after an email summary is email_summary. \"Make it shorter\" after a draft is fb_draft. \"What about yesterday?\" keeps the previous intent with the new time.",
    "",
    "Return ONLY this JSON shape:",
    '{"intent": <one of the intents above>,',
    ' "confidence": <0.0-1.0>,',
    ' "args": <object with the optional args for the intent, or {}>,',
    ' "clarification": <string, ONLY for intent "clarify", else "">,',
    ' "preview": <string, ONLY for intent "sensitive_action" — one sentence describing what WOULD happen, else "">}',
  ].join("\n");
}

function parseIntentDecision(raw) {
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
  const intent = String(obj.intent || "").toLowerCase().trim();
  if (!VALID_INTENTS.has(intent)) return null;
  let confidence = Number(obj.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.max(0, Math.min(1, confidence));
  return {
    intent,
    confidence,
    args: obj.args && typeof obj.args === "object" ? obj.args : {},
    clarification: typeof obj.clarification === "string" ? obj.clarification.trim().slice(0, 300) : "",
    preview: typeof obj.preview === "string" ? obj.preview.trim().slice(0, 400) : "",
  };
}

async function detectIntent({ text, contextSummary }) {
  if (!hermesConfigured()) return null;
  try {
    const raw = await createCompletion(
      {
        system: buildIntentSystemPrompt(),
        messages: [
          {
            role: "user",
            content: [
              contextSummary ? `Recent conversation:\n${contextSummary}\n` : "",
              `Owner's latest message: "${String(text || "").slice(0, 800)}"`,
              "",
              "Return the JSON decision now.",
            ].join("\n"),
          },
        ],
        max_tokens: 300,
        temperature: 0.1,
      },
      {
        label: "Conversational Core intent",
        timeout: Number(process.env.HERMES_ORCHESTRATOR_TIMEOUT_MS) || 6000,
        attempts: 1,
      },
    );
    return parseIntentDecision(raw);
  } catch (err) {
    console.error("Conversational Core intent detection failed:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Natural-language reply (Claude)
// ---------------------------------------------------------------------------

function buildReplySystemPrompt({ brandName, intent, dataBased }) {
  const lines = [
    "You are Echo, a professional, friendly AI Marketing Director, speaking naturally to the business owner in an experimental conversation prototype.",
    "Reply conversationally in 1-4 short sentences (this may be spoken aloud). No markdown, no lists unless truly needed.",
    brandName ? `The active business is ${brandName}. Keep everything scoped to it.` : "",
  ];
  if (intent === "fb_draft") {
    lines.push(
      "You are DRAFTING a Facebook post only. Present the draft text clearly. NEVER claim it was published or scheduled — publishing is disabled in this prototype and requires the owner's explicit approval.",
    );
  }
  if (dataBased) {
    lines.push(
      "You are given REAL data from the owner's connected account below. Base your answer strictly on it. If the data is empty, say so honestly — never invent emails, appointments, or leads.",
    );
  } else {
    lines.push(
      "No connected data was retrieved for this reply. If you offer suggestions, make clear they are general suggestions, not based on the owner's live account data.",
    );
  }
  return lines.filter(Boolean).join("\n");
}

async function composeReply({ brandName, intent, text, contextSummary, toolData }) {
  const userParts = [];
  if (contextSummary) userParts.push(`Recent conversation:\n${contextSummary}`);
  if (toolData) userParts.push(`Real account data (JSON):\n${JSON.stringify(toolData).slice(0, 6000)}`);
  userParts.push(`Owner's message: "${String(text || "").slice(0, 800)}"`);
  const response = await createMessage(
    {
      model: MODEL,
      max_tokens: 700,
      system: buildReplySystemPrompt({ brandName, intent, dataBased: Boolean(toolData) }),
      messages: [{ role: "user", content: userParts.join("\n\n") }],
    },
    { label: "Conversational Core reply", timeout: 30000, attempts: 2 },
  );
  const reply =
    response && Array.isArray(response.content) && response.content[0] && response.content[0].text
      ? response.content[0].text.trim()
      : "";
  if (!reply) {
    const e = new Error("Echo could not compose a reply.");
    e.statusCode = 502;
    throw e;
  }
  return reply;
}

// Quick spoken acknowledgment for tool-backed requests, so Echo feels responsive.
const ACKS = {
  email_summary: "I'm reviewing today's emails.",
  calendar: "Let me check your schedule.",
  leads: "I'm pulling those numbers now.",
  fb_draft: "Let me put a draft together.",
};

// ---------------------------------------------------------------------------
// Main turn handler
// ---------------------------------------------------------------------------

async function handleTurn({ userId, brandId, brandName, text, sessionId }) {
  const startedAt = Date.now();
  const trace = {
    at: new Date().toISOString(),
    userId,
    sessionId: String(sessionId || "default").slice(0, 80),
    transcript: String(text || "").slice(0, 800),
    intent: null,
    confidence: null,
    context: "",
    route: null,
    tool: null,
    toolResult: null,
    ack: null,
    reply: null,
    requiresApproval: false,
    approvalPreview: null,
    fallback: false,
    errors: [],
    timings: {},
    totalMs: null,
  };

  const session = getSession(userId, trace.sessionId);
  trace.context = memorySummary(session);

  // 1. Intent detection (Hermes). Null → safe fallback to the command system.
  const tIntent = Date.now();
  const decision = await detectIntent({ text, contextSummary: trace.context });
  trace.timings.intentMs = Date.now() - tIntent;

  if (!decision) {
    trace.fallback = true;
    trace.route = "fallback-command-system";
    trace.errors.push(
      hermesConfigured()
        ? "Intent detection unavailable (Hermes timed out or errored)."
        : "Hermes (NOUS_PORTAL_API_KEY) is not configured.",
    );
    trace.reply =
      "I couldn't work out what you meant just now — the normal Echo voice commands still work exactly as before. Try an exact command, or ask me again in a moment.";
    finishTrace(trace, session, text, startedAt);
    return trace;
  }

  trace.intent = decision.intent;
  trace.confidence = decision.confidence;

  // 2. Clarification path — one brief question, nothing else.
  if (decision.intent === "clarify" || decision.confidence < 0.35) {
    trace.route = "clarification";
    trace.reply =
      decision.clarification || "Just so I get this right — what would you like me to check or do?";
    finishTrace(trace, session, text, startedAt);
    return trace;
  }

  // 3. Sensitive actions — preview + explicit approval required; NEVER executed in v1.
  if (decision.intent === "sensitive_action") {
    trace.route = "approval-required";
    trace.requiresApproval = true;
    trace.approvalPreview = decision.preview || "This would change or send something.";
    trace.reply = `Here's what that would do: ${trace.approvalPreview} This prototype is read-only, so I won't do it — in the full version I'd ask for your explicit approval first.`;
    finishTrace(trace, session, text, startedAt);
    return trace;
  }

  // 4. Read-only tool call through the adapter layer (never direct DB access here).
  let toolData = null;
  if (coreTools.hasTool(decision.intent)) {
    trace.route = "conversational-core";
    trace.tool = decision.intent;
    trace.ack = ACKS[decision.intent] || "Let me check that.";
    const tTool = Date.now();
    try {
      toolData = await coreTools.run(decision.intent, { userId, brandId }, decision.args || {});
      trace.toolResult = summarizeToolResult(decision.intent, toolData);
    } catch (err) {
      trace.errors.push(`Tool "${decision.intent}" failed: ${err.message}`);
      toolData = null;
    }
    trace.timings.toolMs = Date.now() - tTool;
  } else {
    trace.route = "conversational-core";
  }

  // 5. Natural-language reply (Claude). Failure → honest error, safe fallback.
  const tReply = Date.now();
  try {
    trace.reply = await composeReply({
      brandName,
      intent: decision.intent,
      text,
      contextSummary: trace.context,
      toolData,
    });
    if (decision.intent === "fb_draft") {
      session.lastDraft = trace.reply.slice(0, 2000);
      trace.requiresApproval = true;
      trace.approvalPreview = "Draft only — publishing requires your explicit approval and is disabled in this prototype.";
    }
  } catch (err) {
    trace.fallback = true;
    trace.errors.push(`Reply composition failed: ${err.message}`);
    trace.reply =
      "I hit a snag putting that answer together. Your normal Echo commands still work — please try again in a moment.";
  }
  trace.timings.replyMs = Date.now() - tReply;

  if (trace.tool) {
    session.lastTool = trace.tool;
    session.lastToolData = trace.toolResult;
  }
  finishTrace(trace, session, text, startedAt);
  return trace;
}

function summarizeToolResult(intent, data) {
  // Keep the recorded tool result compact and free of sensitive bulk content.
  try {
    const json = JSON.stringify(data);
    return json.length > 2000 ? json.slice(0, 2000) + "…(truncated)" : json;
  } catch {
    return "(unserializable tool result)";
  }
}

function finishTrace(trace, session, text, startedAt) {
  trace.totalMs = Date.now() - startedAt;
  session.turns.push({ role: "user", text: String(text || "").slice(0, 400) });
  if (trace.reply) session.turns.push({ role: "echo", text: trace.reply.slice(0, 400) });
  while (session.turns.length > MAX_TURNS) session.turns.shift();
  record(trace);
}

module.exports = {
  coreEnabled,
  coreStatus,
  setEmergencyDisabled,
  handleTurn,
  endSession,
  recentTraces,
  // exported for tests
  parseIntentDecision,
  VALID_INTENTS,
  buildIntentSystemPrompt,
  _sessions: sessions,
};
