const db = require("../config/db");
const { anthropic, MODEL } = require("../config/anthropic");
const {
  buildWebsiteChatbotPrompt,
  CONVERSATION_ANALYSIS_PROMPT,
} = require("../prompts/websiteChatbotPrompt");
const emailController = require("./emailController");
const pushController = require("./pushController");
const zapierController = require("./zapierController");
const { normalizeE164 } = require("../utils/phone");

const VALID_TEMPERATURES = ["tire_kicker", "warm", "hot"];
const VALID_AVATAR_STYLES = ["initials", "robot", "circle"];

const DEFAULTS = {
  accentColor: "#f59e0b",
  avatarStyle: "initials",
};

function defaultGreeting(brandName) {
  return `Hi! 👋 Welcome to ${brandName || "our business"}. How can I help you today?`;
}

function extractText(response) {
  return (response.content || [])
    .map((block) => block.text || "")
    .join("")
    .trim();
}

/**
 * Normalizes stored conversation history into Anthropic message format. Anthropic
 * requires the first message to be from the user, so we seed an opening user turn
 * when the stored history begins with the assistant's greeting.
 */
function toAnthropicMessages(messages) {
  const mapped = messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));
  if (mapped.length > 0 && mapped[0].role === "assistant") {
    mapped.unshift({ role: "user", content: "Hi" });
  }
  return mapped;
}

/**
 * One structured-JSON pass that scores temperature AND extracts any contact
 * details the visitor shared. Returns { temperature, name, email, phone } with
 * null for anything missing. Never throws — analysis is best-effort.
 */
async function analyzeConversation(messages) {
  try {
    // The analysis must end with a user message (the model rejects assistant
    // prefill), so we serialize the whole transcript into one user turn.
    const transcript = messages
      .map((m) => `${m.role === "user" ? "Visitor" : "Assistant"}: ${m.content}`)
      .join("\n");
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: CONVERSATION_ANALYSIS_PROMPT,
      messages: [
        { role: "user", content: `Analyze this chat transcript:\n\n${transcript}` },
      ],
    });
    const text = extractText(response);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { temperature: null, name: null, email: null, phone: null };
    const parsed = JSON.parse(match[0]);
    const temperature = VALID_TEMPERATURES.includes(parsed.temperature)
      ? parsed.temperature
      : null;
    const clean = (v) =>
      typeof v === "string" && v.trim() ? v.trim() : null;
    return {
      temperature,
      name: clean(parsed.name),
      email: clean(parsed.email),
      phone: clean(parsed.phone),
    };
  } catch (err) {
    console.error("Chatbot analysis failed:", err.message);
    return { temperature: null, name: null, email: null, phone: null };
  }
}

/** Loads a brand only if it belongs to the authed user. */
async function getOwnedBrand(userId, brandId) {
  const { rows } = await db.query(
    "SELECT brand_id, brand_name FROM brands WHERE brand_id = $1 AND user_id = $2",
    [brandId, userId],
  );
  return rows[0] || null;
}

/** Loads a brand + its owner (for hot-lead alerts). Public — no ownership check. */
async function getBrandWithOwner(brandId) {
  const { rows } = await db.query(
    `SELECT b.brand_id, b.brand_name, b.brand_personality, b.voice_description,
            b.target_audience, u.email AS owner_email, u.user_id AS owner_user_id
     FROM brands b JOIN users u ON u.user_id = b.user_id
     WHERE b.brand_id = $1`,
    [brandId],
  );
  return rows[0] || null;
}

/**
 * Creates or updates the lead this session belongs to from captured contact
 * details, and links the lead back to the session. Returns the lead id, or null
 * when there is nothing actionable to store yet (no email/phone for a brand-new
 * lead). Only ever fills blank fields — never overwrites existing lead data.
 */
async function upsertLeadForSession({ brandId, session, contact }) {
  const name = contact.name || null;
  const email = contact.email || null;
  // Canonicalize to E.164 so formatting variance (e.g. "555-123-4567" vs
  // "+15551234567") can't slip past the phone-based dedup match/lock below.
  const phone = normalizeE164(contact.phone);

  // Update the existing lead this session already produced.
  if (session && session.lead_id) {
    await db.query(
      `UPDATE leads
       SET lead_name = COALESCE(lead_name, $1),
           email     = COALESCE(email, $2),
           phone     = COALESCE(phone, $3)
       WHERE lead_id = $4 AND brand_id = $5`,
      [name, email, phone, session.lead_id, brandId],
    );
    return session.lead_id;
  }

  // No lead yet: only create one once we have a real contact handle.
  if (!email && !phone) return null;

  // Reuse an existing lead in this brand matching on email OR phone (avoids
  // duplicates), else insert. The read-then-insert is wrapped in a transaction
  // guarded by advisory locks so two concurrent widget requests for the same
  // visitor can't both miss the SELECT and create duplicate leads. We use
  // advisory locks instead of a unique index because the `leads` table is shared
  // with other insert paths (leadController manual add, publicController
  // lead-qual) that don't expect a uniqueness constraint.
  //
  // The dedup predicate is "email OR phone", so we lock on EACH present identity
  // independently (a per-email key and a per-phone key) — not one combined key.
  // Otherwise two requests sharing only an email (one with a phone, one without)
  // would take different combined keys and still race. Locks are acquired in a
  // deterministic (sorted) order to avoid deadlock when both are present.
  const lockKeys = [];
  if (email) lockKeys.push(`lead:email:${brandId}|${email.toLowerCase()}`);
  if (phone) lockKeys.push(`lead:phone:${brandId}|${phone}`);
  lockKeys.sort();

  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    for (const key of lockKeys) {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [key],
      );
    }

    const existing = await client.query(
      `SELECT lead_id FROM leads
       WHERE brand_id = $1
         AND ( ($2::text IS NOT NULL AND lower(email) = lower($2))
            OR ($3::text IS NOT NULL AND phone = $3) )
       LIMIT 1`,
      [brandId, email, phone],
    );

    let leadId;
    if (existing.rows.length > 0) {
      leadId = existing.rows[0].lead_id;
      await client.query(
        `UPDATE leads
         SET lead_name = COALESCE(lead_name, $1),
             email     = COALESCE(email, $2),
             phone     = COALESCE(phone, $3)
         WHERE lead_id = $4`,
        [name, email, phone, leadId],
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO leads (brand_id, lead_name, email, phone)
         VALUES ($1, $2, $3, $4)
         RETURNING lead_id`,
        [brandId, name, email, phone],
      );
      leadId = inserted.rows[0].lead_id;
    }

    await client.query("COMMIT");
    return leadId;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * GET /api/chatbot/config/:brandId  (PUBLIC — any website can request it)
 * Returns the public widget configuration. Never returns anything sensitive.
 */
async function getChatbotConfig(req, res) {
  const { brandId } = req.params;
  try {
    const brandResult = await db.query(
      "SELECT brand_name FROM brands WHERE brand_id = $1",
      [brandId],
    );
    if (brandResult.rows.length === 0) {
      return res.status(404).json({ error: "Brand not found" });
    }
    const brandName = brandResult.rows[0].brand_name;

    const cfg = await db.query(
      `SELECT greeting_message, accent_color, avatar_style
       FROM chatbot_config WHERE brand_id = $1`,
      [brandId],
    );
    const row = cfg.rows[0] || {};

    return res.json({
      brandId,
      brandName,
      greeting: row.greeting_message || defaultGreeting(brandName),
      accentColor: row.accent_color || DEFAULTS.accentColor,
      avatarStyle: row.avatar_style || DEFAULTS.avatarStyle,
    });
  } catch (err) {
    console.error("getChatbotConfig error:", err.message);
    return res.status(500).json({ error: "Failed to load chatbot config" });
  }
}

/**
 * POST /api/chatbot/chat  (PUBLIC — website visitors are not logged in)
 * Body: { sessionId, brandId, message }
 * Drives the conversation, scores the lead, captures contact details, and
 * notifies the owner when a lead turns hot. The temperature is NOT returned.
 */
async function chat(req, res) {
  const { sessionId, brandId, message } = req.body || {};

  if (!sessionId || !brandId || !message) {
    return res
      .status(400)
      .json({ error: "sessionId, brandId, and message are required" });
  }

  try {
    const brand = await getBrandWithOwner(brandId);
    if (!brand) {
      return res.status(404).json({ error: "Brand not found" });
    }

    // Load or create the session.
    const existing = await db.query(
      `SELECT session_id, brand_id, lead_id, conversation_history, temperature
       FROM chatbot_sessions WHERE session_id = $1`,
      [sessionId],
    );
    let session = existing.rows[0] || null;
    if (session && session.brand_id !== brandId) {
      return res.status(400).json({ error: "Session does not belong to this brand" });
    }
    if (!session) {
      const created = await db.query(
        `INSERT INTO chatbot_sessions (session_id, brand_id, conversation_history)
         VALUES ($1, $2, '[]'::jsonb)
         RETURNING session_id, brand_id, lead_id, conversation_history, temperature`,
        [sessionId, brandId],
      );
      session = created.rows[0];
    }

    const messages = Array.isArray(session.conversation_history)
      ? session.conversation_history
      : [];

    // Load the brand's greeting so the agent can continue from it naturally.
    const cfg = await db.query(
      "SELECT greeting_message FROM chatbot_config WHERE brand_id = $1",
      [brandId],
    );
    const greeting =
      (cfg.rows[0] && cfg.rows[0].greeting_message) || defaultGreeting(brand.brand_name);

    const systemPrompt = buildWebsiteChatbotPrompt(brand, { greeting });

    messages.push({ role: "user", content: message, at: new Date().toISOString() });

    let reply;
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: toAnthropicMessages(messages),
      });
      reply = extractText(response);
    } catch (err) {
      console.error("Chatbot AI error:", err.message);
      return res
        .status(502)
        .json({ error: "The assistant is temporarily unavailable. Please try again." });
    }

    messages.push({ role: "assistant", content: reply, at: new Date().toISOString() });

    // Score + extract contact in one pass (best-effort).
    const analysis = await analyzeConversation(messages);

    // Capture any contact details surfaced during the conversation.
    let leadId = session.lead_id;
    if (analysis.name || analysis.email || analysis.phone) {
      try {
        leadId =
          (await upsertLeadForSession({
            brandId,
            session,
            contact: analysis,
          })) || leadId;
      } catch (err) {
        console.error("Chatbot lead capture failed:", err.message);
      }
    }

    const wasHot = session.temperature === "hot";
    const temperature =
      analysis.temperature && VALID_TEMPERATURES.includes(analysis.temperature)
        ? analysis.temperature
        : session.temperature || null;

    await db.query(
      `UPDATE chatbot_sessions
       SET conversation_history = $1::jsonb,
           temperature = $2,
           lead_id = $3,
           last_active_at = NOW()
       WHERE session_id = $4`,
      [JSON.stringify(messages), temperature, leadId || null, sessionId],
    );

    // Keep the linked lead's temperature in sync so the dashboard's lead views
    // reflect website-chat scoring too.
    if (leadId && temperature) {
      await db
        .query("UPDATE leads SET temperature = $1 WHERE lead_id = $2", [
          temperature,
          leadId,
        ])
        .catch((err) => console.error("Lead temperature sync failed:", err.message));
    }

    // Alert the owner the instant a lead turns hot (best-effort, never blocks).
    // Only fire on the non-hot -> hot transition AND only once a lead with real
    // contact details exists, so anonymous visitors can't spam the owner with
    // notifications by repeatedly posting "hot" messages to the public endpoint.
    if (temperature === "hot" && !wasHot && leadId) {
      const summary = messages
        .filter((m) => m.role === "user")
        .slice(-5)
        .map((m) => m.content)
        .join(" ");
      if (brand.owner_email) {
        emailController
          .sendHotLeadAlert({
            ownerEmail: brand.owner_email,
            brandName: brand.brand_name,
            lead: { lead_name: analysis.name, email: analysis.email, phone: analysis.phone },
            summary,
          })
          .catch((err) => console.error("Hot lead alert failed:", err.message));
      }
      if (brand.owner_user_id) {
        pushController
          .sendPushToUser(brand.owner_user_id, {
            title: "🔥 Hot lead!",
            body: `${analysis.name || "A website visitor"} just turned HOT${
              brand.brand_name ? ` for ${brand.brand_name}` : ""
            }. Reach out now.`,
            url: "/dashboard",
            tag: `hot-lead-${sessionId}`,
          })
          .catch((err) => console.error("Hot lead push failed:", err.message));
      }

      // Outbound webhook (Zapier etc.) on the non-hot -> hot transition.
      zapierController.triggerWebhook(brandId, "lead_temperature_hot", {
        leadId,
        name: analysis.name || null,
        email: analysis.email || null,
        phone: analysis.phone || null,
        temperature,
        source: "website_chatbot",
        summary,
      });
    }

    return res.json({ sessionId, reply });
  } catch (err) {
    console.error("Chatbot chat error:", err.message);
    return res.status(500).json({ error: "Chatbot conversation failed" });
  }
}

/**
 * POST /api/chatbot/capture  (PUBLIC)
 * Body: { sessionId, brandId, name, email, phone }
 * Explicit contact capture (e.g. the widget's contact form). Saves the visitor's
 * details to the leads table and links the lead to the session.
 */
async function captureLead(req, res) {
  const { sessionId, brandId, name, email, phone } = req.body || {};

  if (!brandId) {
    return res.status(400).json({ error: "brandId is required" });
  }
  if (!email && !phone) {
    return res.status(400).json({ error: "An email or phone number is required" });
  }

  try {
    const brandResult = await db.query(
      "SELECT brand_id FROM brands WHERE brand_id = $1",
      [brandId],
    );
    if (brandResult.rows.length === 0) {
      return res.status(404).json({ error: "Brand not found" });
    }

    let session = null;
    if (sessionId) {
      const existing = await db.query(
        "SELECT session_id, brand_id, lead_id FROM chatbot_sessions WHERE session_id = $1",
        [sessionId],
      );
      session = existing.rows[0] || null;
      if (session && session.brand_id !== brandId) {
        return res.status(400).json({ error: "Session does not belong to this brand" });
      }
    }

    const leadId = await upsertLeadForSession({
      brandId,
      session,
      contact: { name, email, phone },
    });

    if (sessionId && leadId) {
      await db.query(
        `INSERT INTO chatbot_sessions (session_id, brand_id, lead_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id)
         DO UPDATE SET lead_id = EXCLUDED.lead_id, last_active_at = NOW()`,
        [sessionId, brandId, leadId],
      );
    }

    return res.json({ leadId, captured: true });
  } catch (err) {
    console.error("captureLead error:", err.message);
    return res.status(500).json({ error: "Failed to capture lead" });
  }
}

/**
 * GET /api/chatbot/sessions/:brandId  (AUTH + lockout)
 * Returns all chatbot sessions for an owned brand, newest-first, with their
 * transcript and the lead outcome (contact + temperature + conversion status).
 */
async function getChatbotSessions(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) {
      return res.status(404).json({ error: "Brand not found" });
    }

    const { rows } = await db.query(
      `SELECT s.session_id, s.temperature, s.started_at, s.last_active_at,
              s.conversation_history,
              l.lead_id, l.lead_name, l.email AS lead_email, l.phone AS lead_phone,
              l.conversion_status
       FROM chatbot_sessions s
       LEFT JOIN leads l ON l.lead_id = s.lead_id
       WHERE s.brand_id = $1
       ORDER BY s.last_active_at DESC
       LIMIT 100`,
      [brandId],
    );

    const sessions = rows.map((r) => ({
      sessionId: r.session_id,
      temperature: r.temperature,
      startedAt: r.started_at,
      lastActiveAt: r.last_active_at,
      transcript: Array.isArray(r.conversation_history) ? r.conversation_history : [],
      lead: r.lead_id
        ? {
            leadId: r.lead_id,
            name: r.lead_name,
            email: r.lead_email,
            phone: r.lead_phone,
            conversionStatus: r.conversion_status,
          }
        : null,
    }));

    return res.json({ sessions });
  } catch (err) {
    console.error("getChatbotSessions error:", err.message);
    return res.status(500).json({ error: "Failed to load chatbot sessions" });
  }
}

/**
 * GET /api/chatbot/admin-config/:brandId  (AUTH + lockout)
 * Returns the brand's saved widget config for the dashboard editor (with the
 * resolved defaults), so the owner can edit it.
 */
async function getChatbotConfigForOwner(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) {
      return res.status(404).json({ error: "Brand not found" });
    }
    const cfg = await db.query(
      "SELECT greeting_message, accent_color, avatar_style FROM chatbot_config WHERE brand_id = $1",
      [brandId],
    );
    const row = cfg.rows[0] || {};
    return res.json({
      brandId,
      brandName: brand.brand_name,
      greeting: row.greeting_message || defaultGreeting(brand.brand_name),
      accentColor: row.accent_color || DEFAULTS.accentColor,
      avatarStyle: row.avatar_style || DEFAULTS.avatarStyle,
    });
  } catch (err) {
    console.error("getChatbotConfigForOwner error:", err.message);
    return res.status(500).json({ error: "Failed to load chatbot config" });
  }
}

/**
 * PUT /api/chatbot/config/:brandId  (AUTH + lockout)
 * Saves the brand's widget customization.
 */
async function saveChatbotConfig(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  const { greeting, accentColor, avatarStyle } = req.body || {};

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) {
      return res.status(404).json({ error: "Brand not found" });
    }

    if (accentColor && !/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
      return res.status(400).json({ error: "accentColor must be a 6-digit hex color (e.g. #f59e0b)" });
    }
    if (avatarStyle && !VALID_AVATAR_STYLES.includes(avatarStyle)) {
      return res.status(400).json({
        error: `avatarStyle must be one of: ${VALID_AVATAR_STYLES.join(", ")}`,
      });
    }
    const greetingValue =
      typeof greeting === "string" ? greeting.trim().slice(0, 500) : null;

    await db.query(
      `INSERT INTO chatbot_config (brand_id, greeting_message, accent_color, avatar_style)
       VALUES ($1, $2, COALESCE($3, '#f59e0b'), COALESCE($4, 'initials'))
       ON CONFLICT (brand_id) DO UPDATE SET
         greeting_message = EXCLUDED.greeting_message,
         accent_color = EXCLUDED.accent_color,
         avatar_style = EXCLUDED.avatar_style`,
      [brandId, greetingValue, accentColor || null, avatarStyle || null],
    );

    return res.json({
      brandId,
      greeting: greetingValue || defaultGreeting(brand.brand_name),
      accentColor: accentColor || DEFAULTS.accentColor,
      avatarStyle: avatarStyle || DEFAULTS.avatarStyle,
    });
  } catch (err) {
    console.error("saveChatbotConfig error:", err.message);
    return res.status(500).json({ error: "Failed to save chatbot config" });
  }
}

module.exports = {
  getChatbotConfig,
  chat,
  captureLead,
  getChatbotSessions,
  getChatbotConfigForOwner,
  saveChatbotConfig,
};
