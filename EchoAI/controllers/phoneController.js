const db = require("../config/db");
const twilioLib = require("twilio");
const { encrypt, decrypt } = require("../utils/encryption");
const { anthropic, MODEL } = require("../config/anthropic");
const {
  buildPhoneAgentPrompt,
  CALL_DISPOSITION_PROMPT,
  VALID_DISPOSITIONS,
} = require("../prompts/phoneAgentPrompt");
const { LEAD_SCORING_PROMPT } = require("../prompts/leadQualificationPrompt");
const {
  getPublicBaseUrl,
  buildClient,
  validateTwilioRequest,
} = require("../config/twilio");
const emailController = require("./emailController");
const pushController = require("./pushController");
const mobilePushController = require("./mobilePushController");
const zapierController = require("./zapierController");
const feedbackController = require("./feedbackController");
const { normalizeE164 } = require("../utils/phone");

const VALID_TEMPERATURES = ["tire_kicker", "warm", "hot"];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function extractText(response) {
  return (response.content || [])
    .map((block) => block.text || "")
    .join("")
    .trim();
}

/** Loads a brand only if it belongs to the authed user. */
async function getOwnedBrand(userId, brandId) {
  const { rows } = await db.query(
    `SELECT brand_id, brand_name, brand_personality, voice_description, target_audience
     FROM brands WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId],
  );
  return rows[0] || null;
}

/** Loads a brand's Twilio config (decrypted auth token) or null. */
async function getTwilioConfig(brandId) {
  const { rows } = await db.query(
    `SELECT config_id, brand_id, account_sid, auth_token_encrypted,
            phone_number, connection_status
     FROM twilio_config WHERE brand_id = $1`,
    [brandId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    configId: row.config_id,
    brandId: row.brand_id,
    accountSid: row.account_sid,
    authToken: decrypt(row.auth_token_encrypted),
    phoneNumber: row.phone_number,
    status: row.connection_status,
  };
}

/** Maps an Anthropic message array from our transcript shape. */
function toAnthropicMessages(transcript) {
  const mapped = (transcript || []).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));
  if (mapped.length > 0 && mapped[0].role === "assistant") {
    mapped.unshift({ role: "user", content: "Hello" });
  }
  return mapped;
}

/** Scores the call transcript into a lead temperature (or null). */
async function scoreTranscript(transcript) {
  const messages = toAnthropicMessages(transcript);
  if (messages.length === 0) return null;
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 10,
    system: LEAD_SCORING_PROMPT,
    messages,
  });
  const text = extractText(response).toLowerCase();
  if (text.includes("hot")) return "hot";
  if (text.includes("warm")) return "warm";
  if (text.includes("tire")) return "tire_kicker";
  return null;
}

/** Classifies the business outcome of a finished call (or null). */
async function classifyOutcome(transcript) {
  const messages = toAnthropicMessages(transcript);
  if (messages.length === 0) return "no_answer";
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 10,
    system: CALL_DISPOSITION_PROMPT,
    messages,
  });
  const text = extractText(response).toLowerCase().trim();
  return VALID_DISPOSITIONS.find((d) => text.includes(d)) || "interested";
}

/** Generates the agent's next spoken line. Returns { speech, end }. */
async function generateAgentReply(systemPrompt, transcript) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: systemPrompt,
    messages: toAnthropicMessages(transcript),
  });
  let speech = extractText(response);
  const end = speech.includes("[[END_CALL]]");
  speech = speech.replace(/\[\[END_CALL\]\]/g, "").trim();
  return { speech, end };
}

// ---------------------------------------------------------------------------
// Twilio config (Settings panel) — auth + lockout
// ---------------------------------------------------------------------------

/**
 * POST /api/phone/config  { brandId, accountSid, authToken, phoneNumber }
 * Verifies the credentials against Twilio, then stores them (auth token
 * encrypted) brand-scoped. Verification failure -> 502 (not silently saved).
 */
async function saveTwilioConfig(req, res) {
  const userId = req.user.userId;
  const { brandId, accountSid, authToken, phoneNumber } = req.body || {};
  try {
    if (!brandId || !accountSid || !authToken || !phoneNumber) {
      return res.status(400).json({
        error: "brandId, accountSid, authToken, and phoneNumber are required",
      });
    }
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const normalized = normalizeE164(phoneNumber);
    if (!normalized) {
      return res.status(400).json({
        error: "Enter a valid phone number in E.164 format, e.g. +15551234567.",
      });
    }

    // Verify the credentials are real AND that the number actually belongs to
    // this Twilio account — otherwise a user could claim a number they don't own
    // and poison inbound routing for that number.
    try {
      const client = buildClient(accountSid, authToken);
      await client.api.accounts(accountSid).fetch();
      const owned = await client.incomingPhoneNumbers.list({
        phoneNumber: normalized,
        limit: 20,
      });
      const match = owned.some(
        (n) => normalizeE164(n.phoneNumber) === normalized,
      );
      if (!match) {
        return res.status(400).json({
          error:
            "That phone number is not provisioned on this Twilio account. Add the number in Twilio first, then connect it here.",
        });
      }
    } catch (err) {
      return res.status(502).json({
        error:
          "Could not verify those Twilio credentials. Check the Account SID and Auth Token and try again.",
        detail: err.message,
      });
    }

    const encrypted = encrypt(authToken);
    let rows;
    try {
      ({ rows } = await db.query(
        `INSERT INTO twilio_config
           (brand_id, account_sid, auth_token_encrypted, phone_number, connection_status)
         VALUES ($1, $2, $3, $4, 'connected')
         ON CONFLICT (brand_id)
         DO UPDATE SET account_sid = EXCLUDED.account_sid,
                       auth_token_encrypted = EXCLUDED.auth_token_encrypted,
                       phone_number = EXCLUDED.phone_number,
                       connection_status = 'connected'
         RETURNING config_id, phone_number, account_sid, connection_status`,
        [brandId, accountSid, encrypted, normalized],
      ));
    } catch (err) {
      // 23505 = the global UNIQUE(phone_number) — another brand already owns it.
      if (err.code === "23505") {
        return res.status(409).json({
          error: "That phone number is already connected to another brand.",
        });
      }
      throw err;
    }
    const row = rows[0];
    return res.status(201).json({
      configured: true,
      phoneNumber: row.phone_number,
      accountSid: row.account_sid,
      status: row.connection_status,
    });
  } catch (err) {
    console.error("Save Twilio config error:", err.message);
    return res.status(500).json({ error: "Failed to save Twilio configuration" });
  }
}

/**
 * GET /api/phone/config/:brandId
 * Returns the connection state WITHOUT the auth token.
 */
async function getTwilioConfigStatus(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const cfg = await getTwilioConfig(brandId);
    if (!cfg) return res.json({ configured: false });
    return res.json({
      configured: true,
      phoneNumber: cfg.phoneNumber,
      accountSid: cfg.accountSid,
      status: cfg.status,
    });
  } catch (err) {
    console.error("Get Twilio config error:", err.message);
    return res.status(500).json({ error: "Failed to load Twilio configuration" });
  }
}

/** DELETE /api/phone/config/:brandId — disconnect Twilio for a brand. */
async function deleteTwilioConfig(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    await db.query("DELETE FROM twilio_config WHERE brand_id = $1", [brandId]);
    return res.json({ configured: false });
  } catch (err) {
    console.error("Delete Twilio config error:", err.message);
    return res.status(500).json({ error: "Failed to disconnect Twilio" });
  }
}

// ---------------------------------------------------------------------------
// Outbound calls — auth + lockout
// ---------------------------------------------------------------------------

/**
 * POST /api/phone/outbound  { leadId }
 * Places an outbound call to a lead and connects them to the AI Phone Agent.
 */
async function initiateOutboundCall(req, res) {
  const userId = req.user.userId;
  const { leadId } = req.body || {};
  try {
    if (!leadId) return res.status(400).json({ error: "leadId is required" });

    // Load the lead + its brand, enforcing ownership via the brand's user_id.
    const { rows } = await db.query(
      `SELECT l.lead_id, l.brand_id, l.lead_name, l.phone, l.temperature,
              l.conversation_history
       FROM leads l
       JOIN brands b ON b.brand_id = l.brand_id
       WHERE l.lead_id = $1 AND b.user_id = $2`,
      [leadId, userId],
    );
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!lead.phone) {
      return res
        .status(400)
        .json({ error: "This lead has no phone number on file." });
    }
    // The AI Phone Agent's outbound mode is for closing HOT leads (it references
    // their chat and pushes to book). Cooler leads aren't called automatically.
    if (lead.temperature !== "hot") {
      return res.status(400).json({
        error:
          "Outbound AI calls are reserved for hot leads. This lead isn't hot yet.",
      });
    }

    const cfg = await getTwilioConfig(lead.brand_id);
    if (!cfg) {
      return res.status(400).json({
        error:
          "Connect a Twilio phone number for this brand in Settings before making calls.",
      });
    }

    const baseUrl = getPublicBaseUrl(req);
    if (!baseUrl) {
      return res.status(500).json({
        error: "Server public URL is not configured for Twilio webhooks.",
      });
    }

    // Create the call record first so the voice webhook can find it.
    const callInsert = await db.query(
      `INSERT INTO calls (brand_id, lead_id, direction, caller_phone, status)
       VALUES ($1, $2, 'outbound', $3, 'in_progress')
       RETURNING call_id`,
      [lead.brand_id, lead.lead_id, lead.phone],
    );
    const callId = callInsert.rows[0].call_id;

    try {
      const client = buildClient(cfg.accountSid, cfg.authToken);
      const call = await client.calls.create({
        to: lead.phone,
        from: cfg.phoneNumber,
        url: `${baseUrl}/api/phone/voice/${callId}`,
        method: "POST",
        statusCallback: `${baseUrl}/api/phone/status`,
        statusCallbackEvent: ["completed", "no-answer", "busy", "failed"],
        statusCallbackMethod: "POST",
      });
      await db.query("UPDATE calls SET twilio_call_sid = $1 WHERE call_id = $2", [
        call.sid,
        callId,
      ]);
      return res.status(201).json({ callId, twilioCallSid: call.sid, status: "calling" });
    } catch (err) {
      await db.query(
        "UPDATE calls SET status = 'failed', outcome = 'failed' WHERE call_id = $1",
        [callId],
      );
      return res.status(502).json({
        error: "Twilio could not place the call.",
        detail: err.message,
      });
    }
  } catch (err) {
    console.error("Initiate outbound call error:", err.message);
    return res.status(500).json({ error: "Failed to initiate call" });
  }
}

// ---------------------------------------------------------------------------
// Twilio voice webhooks — NO auth (Twilio calls them directly)
// ---------------------------------------------------------------------------

/** Builds a <Gather speech> TwiML turn that says `speech` then listens. */
function sayAndGather(twiml, callId, baseUrl, speech) {
  const gather = twiml.gather({
    input: "speech",
    speechTimeout: "auto",
    action: `${baseUrl}/api/phone/voice/${callId}`,
    method: "POST",
  });
  if (speech) gather.say(speech);
  // If the caller says nothing, gently re-prompt then hang up.
  twiml.say("I didn't catch that. Please call back any time. Goodbye.");
  twiml.hangup();
}

/**
 * POST /api/phone/inbound
 * Twilio hits this when someone dials a connected business number. Resolves the
 * brand by the dialed number, creates a call record, greets the caller, and
 * starts gathering speech.
 */
async function handleInboundCall(req, res) {
  const VoiceResponse = twilioLib.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const baseUrl = getPublicBaseUrl(req);
  try {
    // Twilio sends `To` in E.164, but normalize anyway so the lookup matches the
    // canonical form we store (and never resolves the wrong tenant on odd input).
    const toNumber = normalizeE164(req.body.To);
    const fromNumber = req.body.From;
    const callSid = req.body.CallSid;

    const { rows } = await db.query(
      `SELECT tc.brand_id, tc.auth_token_encrypted,
              b.brand_name, b.brand_personality, b.voice_description, b.target_audience
       FROM twilio_config tc
       JOIN brands b ON b.brand_id = tc.brand_id
       WHERE tc.phone_number = $1`,
      [toNumber],
    );
    const cfg = rows[0];
    if (!cfg) {
      twiml.say("This number is not configured to take calls right now. Goodbye.");
      twiml.hangup();
      res.type("text/xml").send(twiml.toString());
      return;
    }

    // Verify the request truly came from Twilio (brand-scoped auth token).
    const authToken = decrypt(cfg.auth_token_encrypted);
    if (!validateTwilioRequest(req, authToken, `${baseUrl}/api/phone/inbound`)) {
      twiml.say("We could not verify this call. Goodbye.");
      twiml.hangup();
      res.status(403).type("text/xml").send(twiml.toString());
      return;
    }

    const brand = {
      brand_name: cfg.brand_name,
      brand_personality: cfg.brand_personality,
      voice_description: cfg.voice_description,
      target_audience: cfg.target_audience,
    };
    const systemPrompt = buildPhoneAgentPrompt(brand, { direction: "inbound" });
    const { speech } = await generateAgentReply(systemPrompt, [
      { role: "user", content: "The caller has just connected. Greet them." },
    ]);

    const transcript = [
      { role: "assistant", content: speech, at: new Date().toISOString() },
    ];
    const { rows: created } = await db.query(
      `INSERT INTO calls (brand_id, direction, caller_phone, twilio_call_sid, transcript, status)
       VALUES ($1, 'inbound', $2, $3, $4::jsonb, 'in_progress')
       RETURNING call_id`,
      [cfg.brand_id, fromNumber, callSid, JSON.stringify(transcript)],
    );
    const callId = created[0].call_id;

    // Outbound webhook (Zapier etc.) for the inbound call. Fire-and-forget.
    zapierController.triggerWebhook(cfg.brand_id, "inbound_call_received", {
      callId,
      direction: "inbound",
      callerPhone: fromNumber,
      twilioCallSid: callSid,
    });

    sayAndGather(twiml, callId, baseUrl, speech);
    res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("Inbound call error:", err.message);
    twiml.say("Sorry, we are having trouble right now. Please call back later.");
    twiml.hangup();
    res.type("text/xml").send(twiml.toString());
  }
}

/**
 * POST /api/phone/voice/:callId
 * The per-turn conversation webhook. Twilio posts the caller's SpeechResult;
 * we append it, generate the agent's reply, and return TwiML to say it and
 * listen again (or close the call). ALWAYS returns 200 TwiML — never 500 —
 * so the call doesn't drop badly on an internal error.
 */
async function handleVoiceTurn(req, res) {
  const VoiceResponse = twilioLib.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const baseUrl = getPublicBaseUrl(req);
  const { callId } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT c.call_id, c.brand_id, c.direction, c.lead_id, c.transcript,
              tc.auth_token_encrypted,
              b.brand_name, b.brand_personality, b.voice_description, b.target_audience
       FROM calls c
       JOIN brands b ON b.brand_id = c.brand_id
       LEFT JOIN twilio_config tc ON tc.brand_id = c.brand_id
       WHERE c.call_id = $1`,
      [callId],
    );
    const call = rows[0];
    if (!call) {
      twiml.say("This call session has expired. Goodbye.");
      twiml.hangup();
      res.type("text/xml").send(twiml.toString());
      return;
    }

    // Signature verification (best-effort; needs the brand's auth token).
    if (call.auth_token_encrypted) {
      const authToken = decrypt(call.auth_token_encrypted);
      if (!validateTwilioRequest(req, authToken, `${baseUrl}/api/phone/voice/${callId}`)) {
        twiml.say("We could not verify this call. Goodbye.");
        twiml.hangup();
        res.status(403).type("text/xml").send(twiml.toString());
        return;
      }
    }

    const transcript = Array.isArray(call.transcript) ? call.transcript : [];
    const speechResult = (req.body.SpeechResult || "").trim();

    // Load lead conversation history for outbound personalization.
    let lead = null;
    if (call.direction === "outbound" && call.lead_id) {
      const { rows: lrows } = await db.query(
        "SELECT lead_name, conversation_history FROM leads WHERE lead_id = $1",
        [call.lead_id],
      );
      lead = lrows[0] || null;
    }

    const brand = {
      brand_name: call.brand_name,
      brand_personality: call.brand_personality,
      voice_description: call.voice_description,
      target_audience: call.target_audience,
    };
    const systemPrompt = buildPhoneAgentPrompt(brand, {
      direction: call.direction,
      lead,
    });

    if (speechResult) {
      transcript.push({
        role: "user",
        content: speechResult,
        at: new Date().toISOString(),
      });
    } else if (transcript.length === 0 && call.direction === "outbound") {
      // First outbound turn — prompt the agent to open the call.
      transcript.push({
        role: "user",
        content: "The lead has answered. Introduce yourself and begin.",
        at: new Date().toISOString(),
      });
    }

    const { speech, end } = await generateAgentReply(systemPrompt, transcript);
    transcript.push({
      role: "assistant",
      content: speech,
      at: new Date().toISOString(),
    });

    await db.query(
      "UPDATE calls SET transcript = $1::jsonb WHERE call_id = $2",
      [JSON.stringify(transcript), callId],
    );

    if (end) {
      twiml.say(speech);
      twiml.hangup();
    } else {
      sayAndGather(twiml, callId, baseUrl, speech);
    }
    res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("Voice turn error:", err.message);
    twiml.say("Sorry, I'm having trouble. Please try again later. Goodbye.");
    twiml.hangup();
    res.type("text/xml").send(twiml.toString());
  }
}

/**
 * POST /api/phone/status
 * Twilio's call-status callback. On completion we record the duration, score the
 * transcript into a lead temperature, classify the outcome, and (when linked to
 * a lead) update the lead + fire hot-lead alerts. Always returns 200.
 */
async function handleCallStatus(req, res) {
  try {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus; // completed | no-answer | busy | failed | canceled
    const duration = parseInt(req.body.CallDuration, 10) || 0;
    if (!callSid) return res.status(200).send("");

    const { rows } = await db.query(
      `SELECT c.call_id, c.brand_id, c.lead_id, c.transcript, c.direction,
              c.caller_phone, tc.auth_token_encrypted,
              b.brand_name, u.email AS owner_email, u.user_id AS owner_user_id
       FROM calls c
       JOIN brands b ON b.brand_id = c.brand_id
       JOIN users u ON u.user_id = b.user_id
       LEFT JOIN twilio_config tc ON tc.brand_id = c.brand_id
       WHERE c.twilio_call_sid = $1`,
      [callSid],
    );
    const call = rows[0];
    if (!call) return res.status(200).send("");

    // Verify the callback came from Twilio.
    if (call.auth_token_encrypted) {
      const authToken = decrypt(call.auth_token_encrypted);
      const baseUrl = getPublicBaseUrl(req);
      if (!validateTwilioRequest(req, authToken, `${baseUrl}/api/phone/status`)) {
        return res.status(403).send("");
      }
    }

    const transcript = Array.isArray(call.transcript) ? call.transcript : [];
    const hadConversation = transcript.some((m) => m.role === "user");

    let temperature = null;
    let outcome = null;
    if (callStatus === "completed" && hadConversation) {
      try {
        temperature = await scoreTranscript(transcript);
      } catch (err) {
        console.error("Call scoring failed:", err.message);
      }
      try {
        outcome = await classifyOutcome(transcript);
      } catch (err) {
        console.error("Call outcome classification failed:", err.message);
      }
    } else {
      outcome = callStatus === "completed" ? "no_answer" : callStatus;
    }

    await db.query(
      `UPDATE calls
       SET status = 'completed', duration_seconds = $1, outcome = $2,
           lead_temperature = $3
       WHERE call_id = $4`,
      [
        duration,
        outcome,
        temperature && VALID_TEMPERATURES.includes(temperature) ? temperature : null,
        call.call_id,
      ],
    );

    // Outbound webhook (Zapier etc.) when an outbound call completes.
    if (call.direction === "outbound" && callStatus === "completed") {
      zapierController.triggerWebhook(call.brand_id, "outbound_call_completed", {
        callId: call.call_id,
        direction: "outbound",
        callerPhone: call.caller_phone,
        twilioCallSid: callSid,
        durationSeconds: duration,
        outcome,
        leadTemperature:
          temperature && VALID_TEMPERATURES.includes(temperature) ? temperature : null,
      });
    }

    // Propagate the temperature to the linked lead and alert on hot leads.
    if (call.lead_id && temperature && VALID_TEMPERATURES.includes(temperature)) {
      await db.query("UPDATE leads SET temperature = $1 WHERE lead_id = $2", [
        temperature,
        call.lead_id,
      ]);
      if (temperature === "hot") {
        const summary = transcript
          .filter((m) => m.role === "user")
          .slice(-5)
          .map((m) => m.content)
          .join(" ");
        if (call.owner_email) {
          emailController
            .sendHotLeadAlert({
              ownerEmail: call.owner_email,
              brandName: call.brand_name,
              lead: { lead_name: null, email: null, phone: call.caller_phone },
              summary,
            })
            .catch((err) => console.error("Hot lead alert failed:", err.message));
        }
        if (call.owner_user_id) {
          const hotCallBody = `A phone call just scored HOT${call.brand_name ? ` for ${call.brand_name}` : ""}. Follow up now.`;
          pushController
            .sendPushToUser(call.owner_user_id, {
              title: "🔥 Hot lead from a call!",
              body: hotCallBody,
              url: "/dashboard",
              tag: `hot-call-${call.call_id}`,
            })
            .catch((err) => console.error("Hot call push failed:", err.message));

          // Mirror the alert to the owner's native mobile devices via FCM.
          mobilePushController
            .sendToUser(call.owner_user_id, {
              title: "🔥 Hot lead from a call!",
              body: hotCallBody,
              data: { type: "hot_lead_call", callId: String(call.call_id) },
            })
            .catch((err) => console.error("Hot call mobile push failed:", err.message));
        }
      }
    }

    // Auto-send a short satisfaction survey by SMS once a call completes and we
    // have the caller's number. Fire-and-forget; dedupes per recipient in 24h.
    if (callStatus === "completed" && call.caller_phone) {
      feedbackController.autoSendSurvey({
        brandId: call.brand_id,
        surveyType: "post_call",
        leadId: call.lead_id || null,
        phone: call.caller_phone,
        channel: "sms",
      });
    }

    return res.status(200).send("");
  } catch (err) {
    console.error("Call status webhook error:", err.message);
    return res.status(200).send("");
  }
}

// ---------------------------------------------------------------------------
// Call history — auth + lockout
// ---------------------------------------------------------------------------

/**
 * GET /api/phone/history/:brandId
 * Returns the brand's call records (newest first) plus simple stats.
 */
async function getCallHistory(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const { rows: calls } = await db.query(
      `SELECT c.call_id, c.brand_id, c.lead_id, c.direction, c.caller_phone,
              c.duration_seconds, c.transcript, c.outcome, c.lead_temperature,
              c.status, c.created_at, c.updated_at, l.lead_name
       FROM calls c
       LEFT JOIN leads l ON l.lead_id = c.lead_id
       WHERE c.brand_id = $1
       ORDER BY c.created_at DESC`,
      [brandId],
    );

    const total = calls.length;
    const inbound = calls.filter((c) => c.direction === "inbound").length;
    const outbound = total - inbound;
    const hot = calls.filter((c) => c.lead_temperature === "hot").length;
    const totalDuration = calls.reduce((s, c) => s + (c.duration_seconds || 0), 0);

    return res.json({
      brandId,
      calls,
      stats: { total, inbound, outbound, hot, totalDurationSeconds: totalDuration },
    });
  } catch (err) {
    console.error("Get call history error:", err.message);
    return res.status(500).json({ error: "Failed to load call history" });
  }
}

module.exports = {
  saveTwilioConfig,
  getTwilioConfigStatus,
  deleteTwilioConfig,
  initiateOutboundCall,
  handleInboundCall,
  handleVoiceTurn,
  handleCallStatus,
  getCallHistory,
};
