// Echo's memory context layer — the single place that (1) turns everything Echo
// knows about the owner and their relationships into a compact block for any AI
// interaction, and (2) captures durable facts back out of a conversation.
//
// Design notes:
//   * Every function that touches the AI or the DB is best-effort and NEVER throws
//     into its caller — memory must never break a chat, a briefing, or a recall.
//   * The pure helpers (parseCaptureJSON, mergeOwnerProfile, formatKnowledge) hold
//     the tricky logic and are unit-tested without a database.
//   * SPOKEN invariant is preserved: for `mode: "speech"` the knowledge block is
//     framed as tone/priority guidance only — the briefing must still speak facts
//     ONLY from its own gathered data (see prompts/echoPersona.js).

const db = require("../config/db");
const { createMessage, MODEL } = require("../config/anthropic");

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function extractText(resp) {
  if (!resp || !Array.isArray(resp.content)) return "";
  return resp.content
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

function clampStr(v, n) {
  return typeof v === "string" ? v.trim().slice(0, n) : "";
}

async function safeRows(sql, params) {
  try {
    const r = await db.query(sql, params);
    return r.rows;
  } catch (_e) {
    return [];
  }
}

// Map the AI's camelCase profile keys to the echo_owner_profile columns.
const OWNER_FIELD_MAP = {
  riskTolerance: "risk_tolerance",
  values: "core_values",
  blindSpots: "blind_spots",
  decisionPatterns: "decision_patterns",
  preferences: "preferences",
  communicationStyle: "communication_style",
  goals: "goals",
};

const MEMORY_CATEGORIES = new Set([
  "conversation",
  "preference",
  "goal",
  "concern",
  "decision",
  "personal_context",
  "relationship",
  "event",
  "note",
]);
const RELATIONSHIP_TYPES = new Set(["lead", "customer", "partner", "team_member", "other"]);

// ---------------------------------------------------------------------------
// PURE — parse the extraction model's JSON (tolerant of fences / stray prose).
// ---------------------------------------------------------------------------
function parseCaptureJSON(text) {
  if (!text || typeof text !== "string") return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return null;
  let obj;
  try {
    obj = JSON.parse(s.slice(first, last + 1));
  } catch (_e) {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const memories = (Array.isArray(obj.memories) ? obj.memories : [])
    .slice(0, 8)
    .map((m) => ({
      category: m && MEMORY_CATEGORIES.has(m.category) ? m.category : "note",
      title: clampStr(m && m.title, 160),
      detail: clampStr(m && m.detail, 800),
      person: clampStr(m && m.person, 120) || null,
      personType:
        m && RELATIONSHIP_TYPES.has(m.personType) ? m.personType : null,
    }))
    .filter((m) => m.title);

  const relationships = (Array.isArray(obj.relationships) ? obj.relationships : [])
    .slice(0, 8)
    .map((r) => ({
      name: clampStr(r && r.name, 120),
      type: r && RELATIONSHIP_TYPES.has(r.type) ? r.type : "other",
      caresAbout: clampStr(r && r.caresAbout, 400),
      history: clampStr(r && r.history, 600),
      nextStep: clampStr(r && r.nextStep, 300),
      sentiment: clampStr(r && r.sentiment, 40),
    }))
    .filter((r) => r.name);

  const puIn = obj.profileUpdates && typeof obj.profileUpdates === "object" ? obj.profileUpdates : {};
  const profileUpdates = {};
  for (const k of Object.keys(OWNER_FIELD_MAP)) {
    const v = clampStr(puIn[k], 600);
    if (v) profileUpdates[k] = v;
  }

  return { memories, relationships, profileUpdates };
}

// ---------------------------------------------------------------------------
// PURE — merge learned updates onto an existing owner-profile row. Provided
// (non-empty) fields overwrite; the running history lives in echo_memory rows.
// ---------------------------------------------------------------------------
function mergeOwnerProfile(existing, updates) {
  const merged = { ...(existing || {}) };
  for (const [key, col] of Object.entries(OWNER_FIELD_MAP)) {
    const v = updates && typeof updates[key] === "string" ? updates[key].trim() : "";
    if (v) merged[col] = v;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// PURE — render what Echo knows into a compact prompt block. `mode` controls the
// framing so spoken briefings treat it as guidance (never new spoken facts).
// ---------------------------------------------------------------------------
function formatKnowledge({ ownerProfile, profiles = [], memories = [], focusProfile = null, mode = "chat" } = {}) {
  const lines = [];
  const op = ownerProfile || {};
  const ownerParts = [];
  if (op.goals) ownerParts.push(`Goals: ${op.goals}`);
  if (op.core_values) ownerParts.push(`Values: ${op.core_values}`);
  if (op.risk_tolerance) ownerParts.push(`Risk tolerance: ${op.risk_tolerance}`);
  if (op.preferences) ownerParts.push(`Preferences: ${op.preferences}`);
  if (op.decision_patterns) ownerParts.push(`Decision patterns: ${op.decision_patterns}`);
  if (op.communication_style) ownerParts.push(`Communication style: ${op.communication_style}`);
  if (op.blind_spots) ownerParts.push(`Blind spots to watch for: ${op.blind_spots}`);
  if (ownerParts.length) lines.push("About the owner — " + ownerParts.join("; ") + ".");

  if (focusProfile && focusProfile.person_name) {
    const fp = [
      focusProfile.cares_about && `cares about ${focusProfile.cares_about}`,
      focusProfile.history && String(focusProfile.history).slice(0, 500),
      focusProfile.next_step && `next step: ${focusProfile.next_step}`,
      focusProfile.sentiment && `sentiment ${focusProfile.sentiment}`,
    ]
      .filter(Boolean)
      .join("; ");
    lines.push(`About ${focusProfile.person_name} (${focusProfile.person_type || "contact"}): ${fp}.`);
  }

  const others = (profiles || [])
    .filter((p) => !focusProfile || p.profile_id !== focusProfile.profile_id)
    .slice(0, 6);
  if (others.length) {
    lines.push(
      "Key relationships — " +
        others
          .map((p) => `${p.person_name} (${p.person_type || "contact"}${p.next_step ? ", next: " + p.next_step : ""})`)
          .join("; ") +
        ".",
    );
  }

  const mem = (memories || []).slice(0, 8);
  if (mem.length) {
    lines.push(
      "Recent things the owner shared or that happened — " +
        mem.map((m) => `${m.title}${m.detail ? ": " + String(m.detail).slice(0, 200) : ""}`).join(" | ") +
        ".",
    );
  }

  if (!lines.length) return "";
  const header =
    mode === "speech"
      ? "PERSONALIZATION GUIDANCE (use ONLY to choose tone, warmth, and what to emphasize; do NOT state any of it as a spoken fact unless it also appears in the briefing data):"
      : "WHAT YOU KNOW about this owner and their business relationships (draw on it to be personal and specific; never invent anything beyond it):";
  return header + "\n" + lines.join("\n");
}

// PURE — a guardrail instruction appended when the owner has stated values/prefs,
// so Echo proactively flags a request that conflicts with them.
function valuesGuardrail(ownerProfile) {
  const op = ownerProfile || {};
  if (!op.core_values && !op.preferences && !op.risk_tolerance) return "";
  return (
    "If the owner's request — or an action you're about to recommend — appears to conflict with their stated values, preferences, or risk tolerance above, " +
    "gently point out the conflict and why before going along with it, then let them decide. Do not refuse; just make sure they're choosing it with eyes open."
  );
}

// ---------------------------------------------------------------------------
// DB — low-level memory insert (used by logEvent and by capture).
// ---------------------------------------------------------------------------
async function insertMemory(userId, brandId, {
  category = "event",
  source = "system",
  entityType = null,
  entityRef = null,
  eventType,
  title,
  detail = "",
  importance = 0,
  occurredAt = null,
} = {}) {
  try {
    await db.query(
      `INSERT INTO echo_memory
         (user_id, brand_id, entity_type, entity_ref, event_type, title, detail, category, source, importance, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11, NOW()))`,
      [userId, brandId || null, entityType, entityRef, eventType || category, title, detail, category, source, importance, occurredAt],
    );
  } catch (e) {
    console.error("echo insertMemory failed:", e.message);
  }
}

async function getOwnerProfileRow(userId) {
  const rows = await safeRows("SELECT * FROM echo_owner_profile WHERE user_id = $1", [userId]);
  return rows[0] || null;
}

// Write the owner profile row exactly as given (authoritative). `row` holds
// DB-column keys already; missing/empty values are persisted as NULL, so this is
// used for manual owner edits where an empty field must CLEAR the stored value.
async function writeOwnerProfileRow(userId, row) {
  try {
    await db.query(
      `INSERT INTO echo_owner_profile
         (user_id, risk_tolerance, core_values, blind_spots, decision_patterns, preferences, communication_style, goals, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         risk_tolerance      = EXCLUDED.risk_tolerance,
         core_values         = EXCLUDED.core_values,
         blind_spots         = EXCLUDED.blind_spots,
         decision_patterns   = EXCLUDED.decision_patterns,
         preferences         = EXCLUDED.preferences,
         communication_style = EXCLUDED.communication_style,
         goals               = EXCLUDED.goals,
         updated_at          = NOW()`,
      [
        userId,
        row.risk_tolerance || null,
        row.core_values || null,
        row.blind_spots || null,
        row.decision_patterns || null,
        row.preferences || null,
        row.communication_style || null,
        row.goals || null,
      ],
    );
  } catch (e) {
    console.error("echo writeOwnerProfileRow failed:", e.message);
  }
  return row;
}

// AI-learned merge: only non-empty incoming values overwrite existing columns
// (Echo never blanks a field it simply didn't mention this turn).
async function mergeOwnerProfileRow(userId, updates) {
  const existing = await getOwnerProfileRow(userId);
  const merged = mergeOwnerProfile(existing, updates);
  return writeOwnerProfileRow(userId, merged);
}

// Authoritative owner edit: the submitted values ARE the profile. Empty strings
// clear the corresponding column. `updates` uses app-facing keys (OWNER_FIELD_MAP).
async function setOwnerProfileRow(userId, updates) {
  const row = {};
  for (const [key, col] of Object.entries(OWNER_FIELD_MAP)) {
    const v = updates && typeof updates[key] === "string" ? updates[key].trim() : "";
    row[col] = v || null;
  }
  return writeOwnerProfileRow(userId, row);
}

async function upsertRelationship(userId, brandId, rel) {
  if (!rel || !rel.name) return;
  const type = RELATIONSHIP_TYPES.has(rel.type) ? rel.type : "other";
  try {
    await db.query(
      `INSERT INTO echo_relationship_profiles
         (user_id, brand_id, person_name, person_type, entity_ref, cares_about, history, next_step, sentiment, importance)
       VALUES ($1,$2,$3,$4, NULLIF($5,''), NULLIF($6,''), NULLIF($7,''), NULLIF($8,''), NULLIF($9,''), $10)
       ON CONFLICT (user_id, person_type, lower(person_name)) DO UPDATE SET
         brand_id    = COALESCE(EXCLUDED.brand_id, echo_relationship_profiles.brand_id),
         entity_ref  = COALESCE(EXCLUDED.entity_ref, echo_relationship_profiles.entity_ref),
         cares_about = COALESCE(EXCLUDED.cares_about, echo_relationship_profiles.cares_about),
         next_step   = COALESCE(EXCLUDED.next_step, echo_relationship_profiles.next_step),
         sentiment   = COALESCE(EXCLUDED.sentiment, echo_relationship_profiles.sentiment),
         importance  = GREATEST(echo_relationship_profiles.importance, EXCLUDED.importance),
         history     = CASE
             WHEN EXCLUDED.history IS NULL THEN echo_relationship_profiles.history
             WHEN echo_relationship_profiles.history IS NULL OR echo_relationship_profiles.history = '' THEN EXCLUDED.history
             ELSE left(echo_relationship_profiles.history || E'\n' || EXCLUDED.history, 4000)
           END,
         updated_at  = NOW()`,
      [
        userId,
        brandId || null,
        rel.name,
        type,
        rel.entityRef || "",
        rel.caresAbout || "",
        rel.history || "",
        rel.nextStep || "",
        rel.sentiment || "",
        Number(rel.importance) || 0,
      ],
    );
  } catch (e) {
    console.error("echo upsertRelationship failed:", e.message);
  }
}

// ---------------------------------------------------------------------------
// DB — assemble the knowledge block for an interaction. Best-effort; "" on any
// failure so the caller proceeds without personalization.
// ---------------------------------------------------------------------------
async function buildKnowledgeContext(userId, brandId, { focusName = "", mode = "chat" } = {}) {
  try {
    const ownerProfile = await getOwnerProfileRow(userId);
    const profiles = await safeRows(
      `SELECT profile_id, person_name, person_type, cares_about, history, next_step, sentiment
         FROM echo_relationship_profiles
        WHERE user_id = $1
        ORDER BY importance DESC, updated_at DESC
        LIMIT 12`,
      [userId],
    );
    const memories = await safeRows(
      `SELECT title, detail, category
         FROM echo_memory
        WHERE user_id = $1 AND deleted_at IS NULL
          AND category IN ('preference','goal','concern','decision','personal_context')
        ORDER BY importance DESC, occurred_at DESC
        LIMIT 10`,
      [userId],
    );

    let focusProfile = null;
    const fn = clampStr(focusName, 120);
    if (fn) {
      const hit = await safeRows(
        `SELECT profile_id, person_name, person_type, cares_about, history, next_step, sentiment
           FROM echo_relationship_profiles
          WHERE user_id = $1 AND lower(person_name) = lower($2)
          LIMIT 1`,
        [userId, fn],
      );
      focusProfile = hit[0] || null;
    }

    return formatKnowledge({ ownerProfile, profiles, memories, focusProfile, mode });
  } catch (_e) {
    return "";
  }
}

// The extraction system prompt: pull ONLY durable, reusable facts as strict JSON.
const CAPTURE_SYSTEM = [
  "You maintain the long-term memory of Echo, an AI marketing director, about a specific business owner.",
  "From the exchange you are given, extract ONLY durable, reusable facts worth remembering for months — not small talk, tasks, or one-off requests.",
  "Return STRICT JSON (no prose, no markdown) with this exact shape:",
  '{"memories":[{"category":"preference|goal|concern|decision|personal_context|note","title":"short label","detail":"the fact in one sentence","person":"name or null","personType":"lead|customer|partner|team_member|other or null"}],',
  '"relationships":[{"name":"person name","type":"lead|customer|partner|team_member|other","caresAbout":"","history":"","nextStep":"","sentiment":"positive|neutral|at_risk|negative"}],',
  '"profileUpdates":{"riskTolerance":"","values":"","blindSpots":"","decisionPatterns":"","preferences":"","communicationStyle":"","goals":""}}',
  "Only include a memory, relationship, or profile field when the exchange gives real evidence for it. If nothing is durable, return empty arrays and an empty profileUpdates object.",
  "Never invent facts. Keep every string concise.",
].join(" ");

// ---------------------------------------------------------------------------
// DB + AI — capture durable memory from a chat exchange. Fire-and-forget safe:
// always records the raw exchange; AI extraction is skipped on any failure.
// ---------------------------------------------------------------------------
async function captureFromConversation(userId, brandId, ownerText, echoReply = "") {
  const text = typeof ownerText === "string" ? ownerText.trim() : "";
  if (!text) return;
  // 1. Always remember the exchange itself (cheap, no AI).
  await insertMemory(userId, brandId, {
    category: "conversation",
    source: "owner",
    eventType: "chat",
    title: text.slice(0, 140),
    detail: text.slice(0, 2000),
  });

  // 2. Extract durable facts (best-effort). Skip trivial messages / no API key.
  if (!process.env.ANTHROPIC_API_KEY || text.length < 12) return;
  let raw = "";
  try {
    const resp = await createMessage(
      {
        model: MODEL,
        max_tokens: 700,
        system: CAPTURE_SYSTEM,
        messages: [
          {
            role: "user",
            content: `Owner said: "${text}"\nEcho replied: "${clampStr(echoReply, 1000)}"\n\nExtract durable memory as JSON.`,
          },
        ],
      },
      { label: "Echo memory capture", timeout: 20000, attempts: 1 },
    );
    raw = extractText(resp);
  } catch (_e) {
    return; // extraction is optional; the exchange is already remembered
  }

  const parsed = parseCaptureJSON(raw);
  if (!parsed) return;

  for (const m of parsed.memories) {
    await insertMemory(userId, brandId, {
      category: m.category,
      source: "echo",
      eventType: "insight",
      entityType: m.personType || null,
      entityRef: m.person || null,
      title: m.title,
      detail: m.detail,
      importance: 1,
    });
  }
  for (const r of parsed.relationships) {
    await upsertRelationship(userId, brandId, r);
  }
  if (Object.keys(parsed.profileUpdates).length) {
    await mergeOwnerProfileRow(userId, parsed.profileUpdates);
  }
}

module.exports = {
  // pure
  parseCaptureJSON,
  mergeOwnerProfile,
  formatKnowledge,
  valuesGuardrail,
  OWNER_FIELD_MAP,
  RELATIONSHIP_TYPES,
  MEMORY_CATEGORIES,
  // db / ai
  insertMemory,
  getOwnerProfileRow,
  mergeOwnerProfileRow,
  setOwnerProfileRow,
  upsertRelationship,
  buildKnowledgeContext,
  captureFromConversation,
};
