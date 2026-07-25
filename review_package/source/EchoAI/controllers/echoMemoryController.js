// Echo's persistent memory — recall, timeline, search, capture and delete.
//
// Two sources feed recall: (1) the explicit `echo_memory` event log (now including
// owner-shared conversations, preferences, goals, concerns and decisions), plus the
// owner profile + per-person relationship profiles, and (2) live aggregation across
// the subsystems (leads, calls, chatbot sessions, appointments, campaigns) matched
// by a name / phone / email. Echo then synthesizes a plain-language recollection
// with the AI. AI/upstream failures map to 502 (never a fabricated answer).

const db = require("../config/db");
const { createMessage, MODEL } = require("../config/anthropic");
const echoContext = require("../utils/echoContext");

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
// Delegates to echoContext.insertMemory so the category/source columns are always
// populated (defaults to an event/system memory for legacy callers).
async function logEvent(userId, brandId, opts = {}) {
  return echoContext.insertMemory(userId, brandId, {
    category: opts.category || "event",
    source: opts.source || "system",
    entityType: opts.entityType || null,
    entityRef: opts.entityRef || null,
    eventType: opts.eventType,
    title: opts.title,
    detail: opts.detail || "",
    importance: opts.importance || 0,
    occurredAt: opts.occurredAt || null,
  });
}

function mapEvent(r) {
  return {
    id: r.memory_id,
    entityType: r.entity_type,
    entityRef: r.entity_ref,
    eventType: r.event_type,
    category: r.category,
    source: r.source,
    title: r.title,
    detail: r.detail,
    occurredAt: r.occurred_at,
  };
}

// GET /api/echo/memory — recent memory timeline (excludes soft-deleted).
async function timeline(req, res) {
  try {
    const userId = req.user.userId;
    const rows = await safeRows(
      `SELECT memory_id, entity_type, entity_ref, event_type, category, source, title, detail, occurred_at
       FROM echo_memory WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY occurred_at DESC LIMIT 50`,
      [userId],
    );
    return res.json({ events: rows.map(mapEvent) });
  } catch (err) {
    console.error("echo timeline error:", err.message);
    return res.status(500).json({ error: "Failed to load Echo's memory." });
  }
}

// GET /api/echo/memory/search?q= — full-text (with ILIKE fallback) over memory.
async function search(req, res) {
  try {
    const userId = req.user.userId;
    const q = req.query && typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
      const recent = await safeRows(
        `SELECT memory_id, entity_type, entity_ref, event_type, category, source, title, detail, occurred_at
         FROM echo_memory WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY occurred_at DESC LIMIT 50`,
        [userId],
      );
      return res.json({ query: "", events: recent.map(mapEvent) });
    }
    // Prefer full-text ranking; fall back to ILIKE so partial words still match.
    let rows = await safeRows(
      `SELECT memory_id, entity_type, entity_ref, event_type, category, source, title, detail, occurred_at,
              ts_rank(search_tsv, websearch_to_tsquery('english', $2)) AS rank
       FROM echo_memory
       WHERE user_id = $1 AND deleted_at IS NULL
         AND search_tsv @@ websearch_to_tsquery('english', $2)
       ORDER BY rank DESC, occurred_at DESC LIMIT 60`,
      [userId, q],
    );
    if (rows.length === 0) {
      const like = `%${q}%`;
      rows = await safeRows(
        `SELECT memory_id, entity_type, entity_ref, event_type, category, source, title, detail, occurred_at
         FROM echo_memory
         WHERE user_id = $1 AND deleted_at IS NULL
           AND (title ILIKE $2 OR detail ILIKE $2 OR entity_ref ILIKE $2)
         ORDER BY occurred_at DESC LIMIT 60`,
        [userId, like],
      );
    }
    return res.json({ query: q, events: rows.map(mapEvent) });
  } catch (err) {
    console.error("echo memory search error:", err.message);
    return res.status(500).json({ error: "Failed to search Echo's memory." });
  }
}

// POST /api/echo/memory — owner manually records something for Echo to remember.
async function capture(req, res) {
  try {
    const userId = req.user.userId;
    const b = req.body || {};
    const title = typeof b.title === "string" ? b.title.trim() : "";
    if (!title) return res.status(400).json({ error: "Give the memory a short title." });
    const category = echoContext.MEMORY_CATEGORIES.has(b.category) ? b.category : "note";
    const brand = await getBrand(userId);
    await echoContext.insertMemory(userId, brand ? brand.brand_id : null, {
      category,
      source: "owner",
      eventType: "note",
      entityType: typeof b.entityType === "string" ? b.entityType.slice(0, 60) : null,
      entityRef: typeof b.entityRef === "string" ? b.entityRef.slice(0, 200) : null,
      title: title.slice(0, 200),
      detail: typeof b.detail === "string" ? b.detail.slice(0, 4000) : "",
      importance: 2,
    });
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("echo memory capture error:", err.message);
    return res.status(500).json({ error: "Failed to save that memory." });
  }
}

// DELETE /api/echo/memory/:id — soft-delete one of the owner's memories.
async function remove(req, res) {
  try {
    const userId = req.user.userId;
    const id = req.params.id;
    const { rowCount } = await db.query(
      `UPDATE echo_memory SET deleted_at = NOW()
       WHERE memory_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [id, userId],
    );
    if (rowCount === 0) return res.status(404).json({ error: "Memory not found." });
    return res.json({ ok: true });
  } catch (err) {
    console.error("echo memory remove error:", err.message);
    return res.status(500).json({ error: "Failed to delete that memory." });
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

    // Relationship profiles Echo maintains for this person.
    const profs = await safeRows(
      `SELECT person_name, person_type, cares_about, history, next_step, sentiment
       FROM echo_relationship_profiles
       WHERE user_id = $1 AND (person_name ILIKE $2 OR entity_ref ILIKE $2)
       ORDER BY importance DESC, updated_at DESC LIMIT 5`, [userId, like]);
    profs.forEach((p) => facts.push(
      `RELATIONSHIP ${p.person_name} (${p.person_type || "contact"}) — ${[p.cares_about && "cares about " + p.cares_about, p.history, p.next_step && "next step: " + p.next_step, p.sentiment && "sentiment " + p.sentiment].filter(Boolean).join("; ")}.`,
    ));

    const memRows = await safeRows(
      `SELECT event_type, category, title, detail, occurred_at FROM echo_memory
       WHERE user_id = $1 AND deleted_at IS NULL AND (entity_ref ILIKE $2 OR title ILIKE $2 OR detail ILIKE $2)
       ORDER BY occurred_at DESC LIMIT 12`, [userId, like]);
    memRows.forEach((m) => facts.push(`MEMORY (${m.category || m.event_type}) ${m.title} — ${m.detail || ""} [${new Date(m.occurred_at).toDateString()}]`));

    if (facts.length === 0) {
      return res.json({ answer: `I don't have anything on record matching "${query}" yet. Once there's a call, chat, lead, appointment or note involving them, I'll remember it.`, facts: [] });
    }

    const system = [
      "You are Echo, an AI marketing director with perfect memory of a business's customers, relationships and marketing.",
      "Answer the user's question using ONLY the records provided. Be specific — reference dates, outcomes, temperatures and the right next step when it's in the records.",
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

module.exports = { timeline, recall, search, capture, remove, logEvent };
