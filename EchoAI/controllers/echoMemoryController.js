// Echo's persistent memory — recall and timeline.
//
// Two sources feed recall: (1) the explicit `echo_memory` event log, and (2) live
// aggregation across the subsystems (leads, calls, chatbot sessions, appointments,
// campaigns) matched by a name / phone / email. Echo then synthesizes a plain-
// language recollection with the AI. AI/upstream failures map to 502 (never a
// fabricated answer).

const db = require("../config/db");
const { createMessage, MODEL } = require("../config/anthropic");

async function getBrand(userId) {
  const { rows } = await db.query(
    "SELECT brand_id, brand_name FROM brands WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1",
    [userId],
  );
  return rows[0] || null;
}

function extractText(resp) {
  if (!resp || !Array.isArray(resp.content)) return "";
  return resp.content.filter((b) => b && b.type === "text").map((b) => b.text).join("").trim();
}

async function safeRows(sql, params) {
  try {
    const r = await db.query(sql, params);
    return r.rows;
  } catch (_e) {
    return [];
  }
}

// Reusable helper so any subsystem can drop a notable event into Echo's memory.
async function logEvent(userId, brandId, { entityType = null, entityRef = null, eventType, title, detail = "", occurredAt = null }) {
  try {
    await db.query(
      `INSERT INTO echo_memory (user_id, brand_id, entity_type, entity_ref, event_type, title, detail, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8, NOW()))`,
      [userId, brandId || null, entityType, entityRef, eventType, title, detail, occurredAt],
    );
  } catch (e) {
    console.error("echo_memory logEvent failed:", e.message);
  }
}

// GET /api/echo/memory — recent memory timeline.
async function timeline(req, res) {
  try {
    const userId = req.user.userId;
    const rows = await safeRows(
      `SELECT memory_id, entity_type, entity_ref, event_type, title, detail, occurred_at
       FROM echo_memory WHERE user_id = $1 ORDER BY occurred_at DESC LIMIT 50`,
      [userId],
    );
    return res.json({
      events: rows.map((r) => ({
        id: r.memory_id,
        entityType: r.entity_type,
        entityRef: r.entity_ref,
        eventType: r.event_type,
        title: r.title,
        detail: r.detail,
        occurredAt: r.occurred_at,
      })),
    });
  } catch (err) {
    console.error("echo timeline error:", err.message);
    return res.status(500).json({ error: "Failed to load Echo's memory." });
  }
}

// POST /api/echo/memory/recall  { query } — "what happened with Bob?"
async function recall(req, res) {
  try {
    const userId = req.user.userId;
    const query = req.body && typeof req.body.query === "string" ? req.body.query.trim() : "";
    if (!query) return res.status(400).json({ error: "Ask me about a lead, customer or campaign." });

    const brand = await getBrand(userId);
    const bid = brand ? brand.brand_id : null;
    const like = `%${query}%`;

    // Gather matching history across the subsystems (scoped to the owner's brand).
    const facts = [];
    if (bid) {
      const leads = await safeRows(
        `SELECT lead_name, email, phone, temperature, conversion_status, created_at, conversation_history
         FROM leads WHERE brand_id = $1 AND (lead_name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2)
         ORDER BY created_at DESC LIMIT 5`, [bid, like]);
      leads.forEach((l) => facts.push(
        `LEAD ${l.lead_name || "(unnamed)"} — ${l.email || ""} ${l.phone || ""}, temperature ${l.temperature || "unknown"}, status ${l.conversion_status || "new"}, first seen ${new Date(l.created_at).toDateString()}.`,
      ));

      const calls = await safeRows(
        `SELECT caller_phone, direction, outcome, lead_temperature, duration_seconds, created_at, transcript
         FROM calls WHERE brand_id = $1 AND (caller_phone ILIKE $2 OR transcript ILIKE $2)
         ORDER BY created_at DESC LIMIT 5`, [bid, like]);
      calls.forEach((c) => facts.push(
        `CALL ${c.direction || ""} ${c.caller_phone || ""} on ${new Date(c.created_at).toDateString()} — outcome ${c.outcome || "n/a"}, ${c.duration_seconds || 0}s.${c.transcript ? " Transcript: " + String(c.transcript).slice(0, 500) : ""}`,
      ));

      const appts = await safeRows(
        `SELECT title, contact_name, contact_phone, start_time, status
         FROM appointments WHERE brand_id = $1 AND (contact_name ILIKE $2 OR contact_phone ILIKE $2 OR title ILIKE $2)
         ORDER BY start_time DESC LIMIT 5`, [bid, like]);
      appts.forEach((a) => facts.push(
        `APPOINTMENT "${a.title || "meeting"}" with ${a.contact_name || ""} on ${new Date(a.start_time).toDateString()} — ${a.status || ""}.`,
      ));

      const chats = await safeRows(
        `SELECT temperature, started_at, conversation_history
         FROM chatbot_sessions WHERE brand_id = $1 AND conversation_history::text ILIKE $2
         ORDER BY started_at DESC LIMIT 3`, [bid, like]);
      chats.forEach((c) => facts.push(
        `WEBSITE CHAT on ${new Date(c.started_at).toDateString()} — temperature ${c.temperature || "unknown"}.`,
      ));
    }

    const memRows = await safeRows(
      `SELECT event_type, title, detail, occurred_at FROM echo_memory
       WHERE user_id = $1 AND (entity_ref ILIKE $2 OR title ILIKE $2 OR detail ILIKE $2)
       ORDER BY occurred_at DESC LIMIT 10`, [userId, like]);
    memRows.forEach((m) => facts.push(`EVENT (${m.event_type}) ${m.title} — ${m.detail || ""} [${new Date(m.occurred_at).toDateString()}]`));

    if (facts.length === 0) {
      return res.json({ answer: `I don't have anything on record matching "${query}" yet. Once there's a call, chat, lead or appointment involving them, I'll remember it.`, facts: [] });
    }

    const system = [
      "You are Echo, an AI marketing director with perfect memory of a business's customers and marketing.",
      "Answer the user's question using ONLY the records provided. Be specific — reference dates, outcomes and temperatures.",
      "Write a concise, natural recollection (2-5 sentences), as if you personally remember it. Never invent details not in the records.",
    ].join(" ");
    const user = `Question: ${query}\n\nRecords:\n${facts.join("\n")}`;

    let answer;
    try {
      const resp = await createMessage(
        { model: MODEL, max_tokens: 500, system, messages: [{ role: "user", content: user }] },
        { label: "Echo recall" },
      );
      answer = extractText(resp);
    } catch (_e) {
      const err = new Error("Echo's memory is temporarily unavailable. Please try again in a moment.");
      err.statusCode = 502;
      throw err;
    }
    if (!answer) {
      const err = new Error("Echo couldn't recall that right now. Please try again.");
      err.statusCode = 502;
      throw err;
    }
    return res.json({ answer, facts });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("echo recall error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to recall that." });
  }
}

module.exports = { timeline, recall, logEvent };
