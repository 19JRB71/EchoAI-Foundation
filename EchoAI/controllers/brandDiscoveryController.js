const db = require("../config/db");
const { anthropic, MODEL } = require("../config/anthropic");
const brandKnowledge = require("../utils/brandKnowledge");
const {
  BRAND_DISCOVERY_SYSTEM_PROMPT,
  BRAND_PROFILE_SYNTHESIS_PROMPT,
} = require("../prompts/brandDiscoveryPrompt");

// Hidden completion marker the discovery agent appends once the user confirms
// the reflected profile (see prompts/brandDiscoveryPrompt.js). Tolerates minor
// whitespace drift inside the brackets. Detection regex is deliberately
// non-global (a /g/ regex's .test() is stateful); stripping uses its own
// global copy so repeated/drifted markers never leak into the transcript.
const PROFILE_CONFIRMED_MARKER = /\[\[\s*PROFILE_CONFIRMED\s*\]\]/i;
const PROFILE_CONFIRMED_STRIP = /\[\[\s*PROFILE_CONFIRMED\s*\]\]/gi;

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
async function saveProfile(userId, brandId, profile, sessionId = null) {
  const brandName = profile.brand_name || "Untitled Brand";
  const visualStyle =
    profile.visual_style_preferences != null ? JSON.stringify(profile.visual_style_preferences) : null;

  // Prompt 011 ruling B5: the owner's end-of-interview confirmation IS the
  // approval — the synthesized profile lands as approved knowledge versions
  // with source 'inferred', an interview basis, and session lineage.
  // visual_style_preferences stays an OPERATIONAL column write (ruling B1).
  const knowledgeFields = [];
  const interviewProvenance = (label) => ({
    sources: [
      {
        source: "inferred",
        basis:
          `Synthesized by AI from the owner's answers in the brand discovery interview (${label}); ` +
          "confirmed by the owner at the end of the conversation.",
      },
    ],
    confidence: "high",
    conflict: false,
    alternatives: [],
    ...(sessionId ? { discovery_session_id: sessionId } : {}),
  });
  knowledgeFields.push({
    fieldKey: "business_name",
    value: brandName,
    sourceKind: "inferred",
    provenance: interviewProvenance("business name"),
  });
  if (profile.brand_personality) {
    knowledgeFields.push({
      fieldKey: "brand_personality",
      value: profile.brand_personality,
      sourceKind: "inferred",
      provenance: interviewProvenance("brand personality"),
    });
  }
  if (profile.voice_description) {
    knowledgeFields.push({
      fieldKey: "voice_description",
      value: profile.voice_description,
      sourceKind: "inferred",
      provenance: interviewProvenance("voice description"),
    });
  }
  if (profile.target_audience != null) {
    knowledgeFields.push({
      fieldKey: "target_audience",
      value: profile.target_audience,
      sourceKind: "inferred",
      provenance: interviewProvenance("target audience"),
    });
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    let effectiveBrandId = null;
    if (brandId) {
      const existing = await client.query(
        "SELECT brand_id FROM brands WHERE brand_id = $1 AND user_id = $2",
        [brandId, userId]
      );
      if (existing.rows.length > 0) effectiveBrandId = existing.rows[0].brand_id;
    }
    if (!effectiveBrandId) {
      // Enumerated exception to the knowledge write boundary: the brand row
      // must exist before its version rows can reference it.
      const inserted = await client.query(
        `INSERT INTO brands (user_id, brand_name) VALUES ($1, $2) RETURNING brand_id`,
        [userId, brandName]
      );
      effectiveBrandId = inserted.rows[0].brand_id;
    }
    if (visualStyle != null) {
      await client.query(
        `UPDATE brands SET visual_style_preferences = $1::jsonb WHERE brand_id = $2`,
        [visualStyle, effectiveBrandId]
      );
    }
    await brandKnowledge.ownerEditFields({
      brandId: effectiveBrandId,
      userId,
      fields: knowledgeFields,
      proposedBy: "brand_discovery",
      refId: sessionId,
      client,
    });
    const row = await client.query(
      `SELECT brand_id, brand_name, brand_personality, voice_description,
              visual_style_preferences, target_audience, created_at, updated_at
         FROM brands WHERE brand_id = $1`,
      [effectiveBrandId]
    );
    await client.query("COMMIT");
    return row.rows[0];
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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
      const savedBrand = await saveProfile(userId, session.brand_id, profile, session.session_id);

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

    const rawReply = await getAssistantReply(messages);

    // The agent appends [[PROFILE_CONFIRMED]] when the user has confirmed the
    // reflected profile. Strip it before showing/storing the reply and auto-save
    // the brand right here — the user should never have to click a save button
    // after Echo tells them they're all set.
    const confirmed = PROFILE_CONFIRMED_MARKER.test(rawReply);
    const reply = rawReply.replace(PROFILE_CONFIRMED_STRIP, "").trim();
    messages.push({ role: "assistant", content: reply });

    await db.query(
      "UPDATE brand_discovery_sessions SET messages = $1::jsonb WHERE session_id = $2",
      [JSON.stringify(messages), session.session_id]
    );

    if (confirmed) {
      try {
        const profile = await synthesizeProfile(messages);
        const savedBrand = await saveProfile(userId, session.brand_id, profile, session.session_id);
        await db.query(
          `UPDATE brand_discovery_sessions
             SET status = 'completed', draft_profile = $1::jsonb, brand_id = $2
           WHERE session_id = $3`,
          [JSON.stringify(profile), savedBrand.brand_id, session.session_id]
        );
        return res.json({
          sessionId: session.session_id,
          status: "completed",
          reply,
          brand: savedBrand,
        });
      } catch (saveErr) {
        // Deliberate exception to the "AI failures → 502" rule: this turn's
        // PRIMARY job (Echo's conversational reply) already succeeded and is
        // persisted — a 502 here would throw that reply away in the UI. The
        // failure is surfaced honestly via saveError (never silently), and the
        // explicit "Finish & save" retry path still maps AI failures to 502.
        console.error("Brand discovery auto-save failed:", saveErr.message);
        return res.json({
          sessionId: session.session_id,
          status: session.status,
          reply,
          saveError:
            "Your answers are safe, but saving the brand profile failed. Please click \"Finish & save brand profile\" to retry.",
        });
      }
    }

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
