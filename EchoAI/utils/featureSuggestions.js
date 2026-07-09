/**
 * Feature Suggestions — product intelligence from Echo's limitations.
 *
 * When any user asks Echo to do something it can't do yet, the request is
 * logged here instead of dead-ending the conversation. Similar requests are
 * merged into one suggestion (an AI call matches the new ask against existing
 * suggestion titles) so the admin sees "TikTok posting — asked 14 times", not
 * fourteen near-duplicate rows.
 *
 * logFeatureSuggestion THROWS on failure — callers must only tell the user
 * "I've noted that suggestion" when this actually succeeded (no silent
 * fallbacks, no false confirmations).
 */

const db = require("../config/db");
const { createMessage, MODEL } = require("../config/anthropic");

// config/anthropic doesn't export a text extractor; pull the joined text
// blocks out of an Anthropic response locally (same pattern as controllers).
function extractText(resp) {
  if (!resp || !Array.isArray(resp.content)) return "";
  return resp.content
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

const STATUSES = ["pending", "in_development", "completed"];

const MATCH_SYSTEM_PROMPT = `You classify a feature request for a marketing platform. You are given a list of existing feature suggestions (each with a number and title) and a new user request. Reply with EXACTLY ONE JSON object, no other text:

{ "matchIndex": <number of the existing suggestion this request is asking for, or null if none fit>, "title": "<short canonical title for the capability, max 8 words, e.g. 'TikTok posting' or 'QuickBooks integration'>" }

Rules:
- matchIndex must be one of the provided numbers, or null. Match only when the request is clearly asking for the same capability.
- Always provide "title" (used when matchIndex is null). Title the CAPABILITY, not the sentence.`;

/** Pulls the first JSON object out of an AI reply. Returns null if unparsable. */
function extractJson(resp) {
  const text = extractText(resp) || "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Classifies a request against existing suggestions. Returns
 * { suggestionId | null, title }. Exported seam so tests can stub the AI.
 */
async function classifyRequest(requestText) {
  // Most-requested first so the AI sees the likeliest matches even if the
  // list is ever truncated.
  const existing = await db.query(
    `SELECT suggestion_id, title FROM feature_suggestions
     ORDER BY request_count DESC, first_requested_at ASC
     LIMIT 200`
  );
  const list = existing.rows
    .map((r, i) => `${i + 1}. ${r.title}`)
    .join("\n");

  const resp = await createMessage(
    {
      model: MODEL,
      max_tokens: 200,
      system: MATCH_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Existing suggestions:\n${list || "(none)"}\n\nNew request: "${requestText}"`,
        },
      ],
    },
    { label: "Feature suggestion match" }
  );
  const parsed = extractJson(resp);
  if (!parsed || typeof parsed.title !== "string" || !parsed.title.trim()) {
    throw new Error("Feature-suggestion classifier returned an unusable response");
  }
  const idx = Number.isInteger(parsed.matchIndex) ? parsed.matchIndex : null;
  const matched =
    idx !== null && idx >= 1 && idx <= existing.rows.length ? existing.rows[idx - 1] : null;
  return {
    suggestionId: matched ? matched.suggestion_id : null,
    title: parsed.title.trim().slice(0, 200),
  };
}

/**
 * Logs one "Echo can't do that yet" request. Merges into an existing
 * suggestion when the AI matches one; otherwise creates a new suggestion
 * (the unique LOWER(title) index collapses concurrent same-title creates).
 * Throws on any failure so the caller never falsely confirms.
 */
async function logFeatureSuggestion(userId, requestText, summary) {
  const text = String(requestText || "").trim();
  if (!text) throw new Error("Empty feature request text");
  // Classify on Echo's distilled summary when available (cleaner signal than a
  // long utterance); the verbatim ask is what gets stored.
  const hint = String(summary || "").trim() || text;

  const { suggestionId, title } = await module.exports.classifyRequest(hint);

  let finalId = null;
  if (suggestionId) {
    const upd = await db.query(
      `UPDATE feature_suggestions
       SET request_count = request_count + 1, last_requested_at = NOW(), updated_at = NOW()
       WHERE suggestion_id = $1
       RETURNING suggestion_id`,
      [suggestionId]
    );
    finalId = upd.rows.length ? upd.rows[0].suggestion_id : null;
  }
  if (!finalId) {
    // New suggestion — or the AI-matched row vanished under us. ON CONFLICT
    // on LOWER(title) makes a concurrent identical create merge instead of
    // erroring.
    const ins = await db.query(
      `INSERT INTO feature_suggestions (title, description)
       VALUES ($1, $2)
       ON CONFLICT (LOWER(title)) DO UPDATE
         SET request_count = feature_suggestions.request_count + 1,
             last_requested_at = NOW(),
             updated_at = NOW()
       RETURNING suggestion_id`,
      [title, text]
    );
    finalId = ins.rows[0].suggestion_id;
  }

  await db.query(
    `INSERT INTO feature_suggestion_requests (suggestion_id, user_id, request_text)
     VALUES ($1, $2, $3)`,
    [finalId, userId || null, text]
  );
  return finalId;
}

module.exports = {
  STATUSES,
  classifyRequest,
  logFeatureSuggestion,
};
