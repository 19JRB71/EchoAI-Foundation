const db = require("../config/db");
const { anthropic, MODEL } = require("../config/anthropic");
const {
  BRAND_DISCOVERY_SYSTEM_PROMPT,
  BRAND_PROFILE_SYNTHESIS_PROMPT,
} = require("../prompts/brandDiscoveryPrompt");

function toAnthropicMessages(messages) {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function extractText(response) {
  return (response.content || [])
    .map((block) => block.text || "")
    .join("")
    .trim();
}

/**
 * Calls the Anthropic API to get the agent's conversational reply.
 */
async function getAssistantReply(messages) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: BRAND_DISCOVERY_SYSTEM_PROMPT,
    messages: toAnthropicMessages(messages),
  });
  return extractText(response);
}

/**
 * Calls the Anthropic API to synthesize a structured brand profile (JSON) from
 * the full conversation.
 */
async function synthesizeProfile(messages) {
  const synthesisMessages = messages.concat([
    {
      role: "user",
      content:
        "Based on everything we discussed, output the final brand profile now as a single JSON object only.",
    },
  ]);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: BRAND_PROFILE_SYNTHESIS_PROMPT,
    messages: toAnthropicMessages(synthesisMessages),
  });

  const text = extractText(response);
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const error = new Error("Failed to parse the synthesized brand profile from the AI response");
    error.statusCode = 502;
    throw error;
  }
}

/**
 * Saves a synthesized brand profile to the brands table. Updates an existing
 * brand when brandId is provided, otherwise creates a new one.
 */
async function saveProfile(userId, brandId, profile) {
  const brandName = profile.brand_name || "Untitled Brand";
  const personality = profile.brand_personality || null;
  const voice = profile.voice_description || null;
  const visualStyle =
    profile.visual_style_preferences != null ? JSON.stringify(profile.visual_style_preferences) : null;
  const audience =
    profile.target_audience != null ? JSON.stringify(profile.target_audience) : null;

  if (brandId) {
    const updated = await db.query(
      `UPDATE brands
         SET brand_name = $1,
             brand_personality = $2,
             voice_description = $3,
             visual_style_preferences = $4::jsonb,
             target_audience = $5::jsonb
       WHERE brand_id = $6 AND user_id = $7
       RETURNING brand_id, brand_name, brand_personality, voice_description,
                 visual_style_preferences, target_audience, updated_at`,
      [brandName, personality, voice, visualStyle, audience, brandId, userId]
    );
    if (updated.rows.length > 0) {
      return updated.rows[0];
    }
  }

  const inserted = await db.query(
    `INSERT INTO brands
       (user_id, brand_name, brand_personality, voice_description,
        visual_style_preferences, target_audience)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     RETURNING brand_id, brand_name, brand_personality, voice_description,
               visual_style_preferences, target_audience, created_at`,
    [userId, brandName, personality, voice, visualStyle, audience]
  );

  return inserted.rows[0];
}

/**
 * POST /api/brands/discovery
 * Drives the three-part brand discovery conversation.
 *
 * Request body:
 *  - sessionId (optional): continue an existing session; omit to start a new one
 *  - message   (optional): the user's latest message
 *  - brandId   (optional): an existing brand to enrich on completion
 *  - confirm   (optional): when true, synthesize and save the brand profile
 *
 * Behavior:
 *  - New session (no sessionId): seeds the conversation so the agent opens with
 *    its greeting + first question.
 *  - Continuing: appends the user message and returns the agent's reply.
 *  - Confirming: synthesizes the profile, saves it, and completes the session.
 */
async function discovery(req, res) {
  const userId = req.user.userId;
  const { sessionId, message, brandId, confirm } = req.body;

  try {
    // Load or create the session.
    let session;
    if (sessionId) {
      const result = await db.query(
        "SELECT * FROM brand_discovery_sessions WHERE session_id = $1 AND user_id = $2",
        [sessionId, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Discovery session not found" });
      }
      session = result.rows[0];
      if (session.status === "completed") {
        return res.status(400).json({ error: "This discovery session is already complete" });
      }
    } else {
      // If enriching an existing brand, verify it belongs to this user.
      if (brandId) {
        const owned = await db.query(
          "SELECT brand_id FROM brands WHERE brand_id = $1 AND user_id = $2",
          [brandId, userId]
        );
        if (owned.rows.length === 0) {
          return res.status(404).json({ error: "Brand not found" });
        }
      }

      const result = await db.query(
        `INSERT INTO brand_discovery_sessions (user_id, brand_id, messages)
         VALUES ($1, $2, '[]'::jsonb)
         RETURNING *`,
        [userId, brandId || null]
      );
      session = result.rows[0];
    }

    const messages = Array.isArray(session.messages) ? session.messages : [];

    // Confirmation path: synthesize the profile and save it.
    if (confirm === true) {
      if (messages.length === 0) {
        return res.status(400).json({ error: "Cannot confirm an empty conversation" });
      }
      const profile = await synthesizeProfile(messages);
      const savedBrand = await saveProfile(userId, session.brand_id, profile);

      await db.query(
        `UPDATE brand_discovery_sessions
           SET status = 'completed', draft_profile = $1::jsonb, brand_id = $2
         WHERE session_id = $3`,
        [JSON.stringify(profile), savedBrand.brand_id, session.session_id]
      );

      return res.json({
        sessionId: session.session_id,
        status: "completed",
        brand: savedBrand,
      });
    }

    // Conversation path.
    if (message) {
      messages.push({ role: "user", content: message });
    } else if (messages.length === 0) {
      // Seed a kickoff turn so the agent produces its opening greeting.
      messages.push({ role: "user", content: "Please begin the brand discovery conversation." });
    } else {
      return res.status(400).json({ error: "message is required to continue the conversation" });
    }

    const reply = await getAssistantReply(messages);
    messages.push({ role: "assistant", content: reply });

    await db.query(
      "UPDATE brand_discovery_sessions SET messages = $1::jsonb WHERE session_id = $2",
      [JSON.stringify(messages), session.session_id]
    );

    return res.json({
      sessionId: session.session_id,
      status: session.status,
      reply,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Brand discovery error:", err.message);
    return res.status(status).json({ error: err.message || "Brand discovery failed" });
  }
}

module.exports = { discovery };
