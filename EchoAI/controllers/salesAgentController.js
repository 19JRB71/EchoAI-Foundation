/**
 * AI Sales Agent controller — Zorecho's OWN inbound demo sales line ("Echo").
 *
 * This is platform-level (Zorecho selling itself) and admin-managed, so it is
 * deliberately SEPARATE from the per-brand phone agent (controllers/
 * phoneController.js). Key differences:
 *   - Twilio creds come from platform env vars (SALES_TWILIO_*), not the
 *     per-brand `twilio_config` table.
 *   - Calls are stored in `sales_calls` (not brand-scoped `calls`).
 *   - Settings live in the singleton `sales_agent_config` row.
 *
 * Conventions mirrored from the phone agent: `<Gather speech>` conversation
 * loop, AI failures surfaced as 502, Twilio webhooks always return 200 TwiML,
 * X-Twilio-Signature validated with the sales auth token.
 */

const db = require("../config/db");
const twilioLib = require("twilio");
const { anthropic, MODEL } = require("../config/anthropic");
const {
  buildSalesAgentPrompt,
  buildCoPilotPrompt,
  INTEREST_SCORING_PROMPT,
  buildSalesSummaryPrompt,
  VALID_SALES_OUTCOMES,
} = require("../prompts/salesAgentPrompt");
const {
  getPublicBaseUrl,
  buildClient,
  validateTwilioRequest,
} = require("../config/twilio");
const { normalizeE164 } = require("../utils/phone");

const HEY_ECHO_RE = /\bhey,?\s+echo\b/i;

// ---------------------------------------------------------------------------
// Config / credentials helpers
// ---------------------------------------------------------------------------

/** Platform sales Twilio credentials (dedicated Zorecho sales number). */
function getSalesTwilioCreds() {
  const accountSid = process.env.SALES_TWILIO_ACCOUNT_SID;
  const authToken = process.env.SALES_TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.SALES_TWILIO_NUMBER;
  if (!accountSid || !authToken || !phoneNumber) return null;
  return { accountSid, authToken, phoneNumber };
}

/** Loads (creating if missing) the singleton sales agent config row. */
async function loadConfig() {
  const { rows } = await db.query(
    "SELECT * FROM sales_agent_config WHERE config_key = 'singleton'",
  );
  if (rows[0]) return rows[0];
  const { rows: created } = await db.query(
    `INSERT INTO sales_agent_config (config_key) VALUES ('singleton')
     ON CONFLICT (config_key) DO UPDATE SET config_key = 'singleton'
     RETURNING *`,
  );
  return created[0];
}

// ---------------------------------------------------------------------------
// AI helpers — all wrap Anthropic so upstream failures become 502.
// ---------------------------------------------------------------------------

function extractText(response) {
  return (response.content || [])
    .map((block) => block.text || "")
    .join("")
    .trim();
}

/** Raised by AI helpers so callers can map to HTTP 502 / TwiML fallback. */
class AiError extends Error {}

async function callAnthropic({ system, messages, maxTokens }) {
  try {
    return await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    });
  } catch (err) {
    // SDK errors don't reliably carry `.status`; force a clear upstream error.
    throw new AiError(err.message || "AI request failed");
  }
}

/** Maps our transcript shape to Anthropic messages (first turn must be user). */
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

/** Generates the sales agent's next spoken line. Returns { speech, end }. */
async function generateAgentReply(systemPrompt, transcript) {
  const response = await callAnthropic({
    system: systemPrompt,
    messages: toAnthropicMessages(transcript),
    maxTokens: 300,
  });
  let speech = extractText(response);
  if (!speech) throw new AiError("Empty AI reply");
  const end = speech.includes("[[END_CALL]]");
  speech = speech.replace(/\[\[END_CALL\]\]/g, "").trim();
  return { speech, end };
}

/** Scores prospect interest 1-10 from the transcript (best-effort → 0). */
async function scoreInterest(transcript) {
  const messages = toAnthropicMessages(transcript);
  if (messages.length === 0) return 0;
  try {
    const response = await callAnthropic({
      system: INTEREST_SCORING_PROMPT,
      messages,
      maxTokens: 5,
    });
    const n = parseInt(extractText(response).replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 10) return n;
    return 0;
  } catch {
    return 0;
  }
}

/** Generates a co-pilot answer for a "Hey Echo" question. */
async function generateCoPilotReply(config, transcript, question) {
  const messages = toAnthropicMessages(transcript);
  messages.push({
    role: "user",
    content: `The host asked Echo: "${question}". Give the concise answer.`,
  });
  const response = await callAnthropic({
    system: buildCoPilotPrompt(config),
    messages,
    maxTokens: 200,
  });
  const text = extractText(response);
  if (!text) throw new AiError("Empty co-pilot reply");
  return text;
}

// ---------------------------------------------------------------------------
// SMS helper (uses the platform sales number)
// ---------------------------------------------------------------------------

async function sendSalesSms(to, bodyText) {
  const creds = getSalesTwilioCreds();
  if (!creds) return false;
  const normalized = normalizeE164(to);
  if (!normalized) return false;
  try {
    const client = buildClient(creds.accountSid, creds.authToken);
    await client.messages.create({
      to: normalized,
      from: creds.phoneNumber,
      body: bodyText,
    });
    return true;
  } catch (err) {
    console.error("Sales SMS failed:", err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// TwiML helpers
// ---------------------------------------------------------------------------

function sayAndGather(twiml, callId, baseUrl, speech) {
  const gather = twiml.gather({
    input: "speech",
    speechTimeout: "auto",
    action: `${baseUrl}/api/sales-agent/voice/${callId}`,
    method: "POST",
  });
  if (speech) gather.say(speech);
  twiml.say("I didn't catch that. Please call back any time. Goodbye.");
  twiml.hangup();
}

// ---------------------------------------------------------------------------
// Twilio webhooks — NO auth (Twilio calls these directly; signature-validated)
// ---------------------------------------------------------------------------

/**
 * POST /api/sales-agent/inbound
 * A prospect dials the dedicated Zorecho sales number. Greets them as Echo and
 * starts the qualification conversation. Always returns 200 TwiML.
 */
async function initiateDemoCall(req, res) {
  const VoiceResponse = twilioLib.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const baseUrl = getPublicBaseUrl(req);
  try {
    const creds = getSalesTwilioCreds();
    if (!creds) {
      twiml.say("The sales line is not configured right now. Goodbye.");
      twiml.hangup();
      res.type("text/xml").send(twiml.toString());
      return;
    }

    if (
      !validateTwilioRequest(
        req,
        creds.authToken,
        `${baseUrl}/api/sales-agent/inbound`,
      )
    ) {
      twiml.say("We could not verify this call. Goodbye.");
      twiml.hangup();
      res.status(403).type("text/xml").send(twiml.toString());
      return;
    }

    const config = await loadConfig();
    if (!config.enabled) {
      twiml.say(
        "Thanks for calling Zorecho. Our AI assistant is currently offline. Please try again later.",
      );
      twiml.hangup();
      res.type("text/xml").send(twiml.toString());
      return;
    }

    const fromNumber = req.body.From || null;
    const callSid = req.body.CallSid || null;

    const systemPrompt = buildSalesAgentPrompt(config);
    const { speech } = await generateAgentReply(systemPrompt, [
      { role: "user", content: "The prospect has just connected. Greet them." },
    ]);

    const transcript = [
      { role: "assistant", content: speech, at: new Date().toISOString() },
    ];
    const { rows } = await db.query(
      `INSERT INTO sales_calls (twilio_call_sid, prospect_phone, conversation_history, status)
       VALUES ($1, $2, $3::jsonb, 'in_progress')
       RETURNING call_id`,
      [callSid, fromNumber, JSON.stringify(transcript)],
    );
    const callId = rows[0].call_id;

    sayAndGather(twiml, callId, baseUrl, speech);
    res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("Sales inbound call error:", err.message);
    twiml.say("Sorry, we're having trouble right now. Please call back later.");
    twiml.hangup();
    res.type("text/xml").send(twiml.toString());
  }
}

/**
 * POST /api/sales-agent/voice/:callId
 * Per-turn conversation webhook. Appends the prospect's speech, checks for a
 * "Hey Echo" co-pilot request, otherwise generates Echo's next reply, rescoring
 * interest and firing the three-way invite once the prospect crosses 7.
 * Always returns 200 TwiML.
 */
async function handleSalesConversation(req, res) {
  const VoiceResponse = twilioLib.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const baseUrl = getPublicBaseUrl(req);
  const { callId } = req.params;
  try {
    const creds = getSalesTwilioCreds();
    if (creds &&
      !validateTwilioRequest(
        req,
        creds.authToken,
        `${baseUrl}/api/sales-agent/voice/${callId}`,
      )
    ) {
      twiml.say("We could not verify this call. Goodbye.");
      twiml.hangup();
      res.status(403).type("text/xml").send(twiml.toString());
      return;
    }

    const { rows } = await db.query(
      "SELECT * FROM sales_calls WHERE call_id = $1",
      [callId],
    );
    const call = rows[0];
    if (!call) {
      twiml.say("This call session has expired. Goodbye.");
      twiml.hangup();
      res.type("text/xml").send(twiml.toString());
      return;
    }

    const config = await loadConfig();
    const transcript = Array.isArray(call.conversation_history)
      ? call.conversation_history
      : [];
    const speechResult = (req.body.SpeechResult || "").trim();

    if (speechResult) {
      transcript.push({
        role: "user",
        content: speechResult,
        at: new Date().toISOString(),
      });
    }

    // "Hey Echo" co-pilot: if the caller/host invokes Echo, answer that directly
    // instead of continuing the normal sales flow.
    if (speechResult && HEY_ECHO_RE.test(speechResult)) {
      const question = speechResult.replace(HEY_ECHO_RE, "").trim() || speechResult;
      let coPilot;
      try {
        coPilot = await generateCoPilotReply(config, transcript, question);
      } catch {
        coPilot = "Let me have James follow up with the exact details on that.";
      }
      transcript.push({
        role: "assistant",
        content: coPilot,
        coPilot: true,
        at: new Date().toISOString(),
      });
      await db.query(
        "UPDATE sales_calls SET conversation_history = $1::jsonb WHERE call_id = $2",
        [JSON.stringify(transcript), callId],
      );

      // In SMS mode, text the answer to the owner instead of speaking it aloud.
      if (config.hey_echo_mode === "sms" && config.owner_phone) {
        await sendSalesSms(config.owner_phone, `Echo co-pilot: ${coPilot}`);
        sayAndGather(twiml, callId, baseUrl, "One moment.");
      } else {
        sayAndGather(twiml, callId, baseUrl, coPilot);
      }
      res.type("text/xml").send(twiml.toString());
      return;
    }

    // Normal sales turn.
    const systemPrompt = buildSalesAgentPrompt(config);
    let speech;
    let end;
    try {
      ({ speech, end } = await generateAgentReply(systemPrompt, transcript));
    } catch {
      twiml.say("Sorry, I'm having trouble. Please try again later. Goodbye.");
      twiml.hangup();
      res.type("text/xml").send(twiml.toString());
      return;
    }
    transcript.push({
      role: "assistant",
      content: speech,
      at: new Date().toISOString(),
    });

    // Rescore interest from the updated transcript.
    const interest = await scoreInterest(transcript);
    const newScore = interest || call.interest_score || 0;

    await db.query(
      `UPDATE sales_calls
       SET conversation_history = $1::jsonb, interest_score = $2
       WHERE call_id = $3`,
      [JSON.stringify(transcript), newScore, callId],
    );

    // Fire the three-way invite once, the first time interest crosses 7.
    if (newScore >= 7 && !call.invite_sent) {
      await sendThreeWayInvite(callId).catch((e) =>
        console.error("Three-way invite failed:", e.message),
      );
    }

    if (end) {
      twiml.say(speech);
      twiml.hangup();
    } else {
      sayAndGather(twiml, callId, baseUrl, speech);
    }
    res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("Sales conversation error:", err.message);
    twiml.say("Sorry, I'm having trouble. Please try again later. Goodbye.");
    twiml.hangup();
    res.type("text/xml").send(twiml.toString());
  }
}

/**
 * POST /api/sales-agent/status
 * Twilio call-status callback. On completion records duration and generates the
 * AI call summary. Always returns 200.
 */
async function handleSalesCallStatus(req, res) {
  try {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;
    const duration = parseInt(req.body.CallDuration, 10) || 0;
    if (!callSid) return res.status(200).send("");

    const creds = getSalesTwilioCreds();
    if (
      creds &&
      !validateTwilioRequest(
        req,
        creds.authToken,
        `${getPublicBaseUrl(req)}/api/sales-agent/status`,
      )
    ) {
      return res.status(403).send("");
    }

    const { rows } = await db.query(
      "SELECT * FROM sales_calls WHERE twilio_call_sid = $1",
      [callSid],
    );
    const call = rows[0];
    if (!call) return res.status(200).send("");

    if (callStatus === "completed") {
      await finalizeSalesCall(call, duration);
    } else {
      await db.query(
        "UPDATE sales_calls SET status = 'completed', call_duration = $1, outcome = COALESCE(outcome, $2) WHERE call_id = $3",
        [duration, callStatus, call.call_id],
      );
    }
    return res.status(200).send("");
  } catch (err) {
    console.error("Sales call status error:", err.message);
    return res.status(200).send("");
  }
}

/**
 * Chooses the final outcome from the parsed AI summary, defaulting sensibly when
 * the model gave nothing usable: a call with real prospect turns is "interested",
 * an empty/abandoned call is "not_interested".
 */
function deriveOutcome(parsed, hadConversation) {
  if (parsed && VALID_SALES_OUTCOMES.includes(parsed.outcome)) {
    return parsed.outcome;
  }
  return hadConversation ? "interested" : "not_interested";
}

/** Clamps the final interest score to 1-10, falling back to the running score. */
function clampInterest(parsed, priorScore) {
  if (parsed && Number.isFinite(parsed.interest_score)) {
    return Math.max(1, Math.min(10, parsed.interest_score));
  }
  return priorScore || 0;
}

/**
 * Generates and persists the end-of-call summary + structured fields. Shared by
 * the status webhook and the on-demand admin summary endpoint. Best-effort AI.
 */
async function finalizeSalesCall(call, duration) {
  const transcript = Array.isArray(call.conversation_history)
    ? call.conversation_history
    : [];
  const hadConversation = transcript.some((m) => m.role === "user");

  let summaryText = null;
  let parsed = null;
  if (hadConversation) {
    try {
      const response = await callAnthropic({
        system: buildSalesSummaryPrompt(),
        messages: toAnthropicMessages(transcript),
        maxTokens: 600,
      });
      const raw = extractText(response);
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Model wrapped JSON in prose/fences — extract the object.
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      }
      summaryText = raw;
    } catch (err) {
      console.error("Sales summary generation failed:", err.message);
    }
  }

  const outcome = deriveOutcome(parsed, hadConversation);
  const interest = clampInterest(parsed, call.interest_score);

  await db.query(
    `UPDATE sales_calls
     SET status = 'completed',
         call_duration = $1,
         summary = COALESCE($2, summary),
         prospect_name = COALESCE($3, prospect_name),
         business_type = COALESCE($4, business_type),
         interest_score = $5,
         outcome = $6
     WHERE call_id = $7`,
    [
      duration,
      summaryText,
      parsed?.prospect_name || null,
      parsed?.business_type || null,
      interest,
      outcome,
      call.call_id,
    ],
  );
  return { summary: summaryText, parsed, outcome, interest };
}

// ---------------------------------------------------------------------------
// Three-way invite + conference bridge
// ---------------------------------------------------------------------------

/**
 * Sends the platform owner an SMS with a join link so they can hop onto a live
 * sales call as a co-pilot. Marks invite_sent so it only fires once per call.
 * Called automatically at interest>=7 and manually from the admin Join button.
 */
async function sendThreeWayInvite(callId, reqBaseUrl) {
  const config = await loadConfig();
  if (!config.owner_phone) return { sent: false, reason: "no_owner_phone" };

  const { rows } = await db.query(
    "SELECT * FROM sales_calls WHERE call_id = $1",
    [callId],
  );
  const call = rows[0];
  if (!call) return { sent: false, reason: "not_found" };

  const baseUrl =
    reqBaseUrl || getPublicBaseUrl(null) || process.env.PUBLIC_BASE_URL || "";
  const joinLink = `${baseUrl}/api/sales-agent/join/${callId}`;
  const who = call.prospect_name || call.prospect_phone || "a prospect";
  const body = `🔥 Hot Zorecho sales call — ${who} is at interest ${call.interest_score}/10. Tap to join as co-pilot: ${joinLink}`;

  const sent = await sendSalesSms(config.owner_phone, body);
  await db.query(
    "UPDATE sales_calls SET invite_sent = TRUE WHERE call_id = $1",
    [callId],
  );
  return { sent, joinLink };
}

/**
 * GET /api/sales-agent/join/:callId
 * The owner taps the SMS link on their phone. We dial the owner and bridge them
 * into a Twilio <Conference> with the live prospect call, then show a small
 * confirmation page. Public (link-based) — no session; guarded by the opaque
 * call UUID + the fact it only bridges an in-progress call.
 */
async function handleJoinCall(req, res) {
  const { callId } = req.params;
  try {
    const creds = getSalesTwilioCreds();
    const config = await loadConfig();
    if (!creds || !config.owner_phone) {
      return res
        .status(503)
        .send(joinPage("Sales line is not fully configured."));
    }

    const { rows } = await db.query(
      "SELECT * FROM sales_calls WHERE call_id = $1",
      [callId],
    );
    const call = rows[0];
    if (!call || call.status !== "in_progress" || !call.twilio_call_sid) {
      return res.status(404).send(joinPage("This call is no longer active."));
    }

    const baseUrl = getPublicBaseUrl(req);
    const conferenceUrl = `${baseUrl}/api/sales-agent/conference/${callId}`;
    const client = buildClient(creds.accountSid, creds.authToken);

    // Move the prospect's live call into the conference room…
    await client.calls(call.twilio_call_sid).update({ url: conferenceUrl, method: "POST" });
    // …and dial the owner into the same room.
    await client.calls.create({
      to: normalizeE164(config.owner_phone),
      from: creds.phoneNumber,
      url: conferenceUrl,
      method: "POST",
    });

    return res.send(
      joinPage("Connecting you now — your phone will ring to join the call."),
    );
  } catch (err) {
    console.error("Join call error:", err.message);
    return res.status(502).send(joinPage("Could not connect you to the call."));
  }
}

/** POST /api/sales-agent/conference/:callId — TwiML placing a caller in the room. */
function handleConference(req, res) {
  const VoiceResponse = twilioLib.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const { callId } = req.params;

  // Twilio requests this webhook to bridge each leg into the room — validate the
  // signature like the other webhooks so a forged request can't hijack the call.
  const creds = getSalesTwilioCreds();
  if (
    creds &&
    !validateTwilioRequest(
      req,
      creds.authToken,
      `${getPublicBaseUrl(req)}/api/sales-agent/conference/${callId}`,
    )
  ) {
    twiml.say("We could not verify this call. Goodbye.");
    twiml.hangup();
    res.status(403).type("text/xml").send(twiml.toString());
    return;
  }

  const dial = twiml.dial();
  dial.conference(`sales-${callId}`, {
    startConferenceOnEnter: true,
    endConferenceOnExit: false,
  });
  res.type("text/xml").send(twiml.toString());
}

function joinPage(message) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zorecho Sales Co-Pilot</title></head><body style="font-family:system-ui;background:#0b1020;color:#e5e7eb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0"><div style="text-align:center;padding:24px"><h1 style="font-size:20px">Zorecho Sales Co-Pilot</h1><p style="color:#9ca3af">${message}</p></div></body></html>`;
}

// ---------------------------------------------------------------------------
// Admin endpoints — auth + admin (mounted behind adminRoutes middleware)
// ---------------------------------------------------------------------------

function serializeConfig(row) {
  return {
    ownerPhone: row.owner_phone || "",
    heyEchoMode: row.hey_echo_mode || "sms",
    bookingLink: row.booking_link || "",
    objections: Array.isArray(row.objections) ? row.objections : [],
    enabled: row.enabled !== false,
    twilioConfigured: !!getSalesTwilioCreds(),
    salesNumber: getSalesTwilioCreds()?.phoneNumber || null,
  };
}

/** GET /api/sales-agent/config */
async function getConfig(req, res) {
  try {
    const row = await loadConfig();
    return res.json({ config: serializeConfig(row) });
  } catch (err) {
    console.error("Get sales config error:", err.message);
    return res.status(500).json({ error: "Failed to load sales agent config" });
  }
}

/** PUT /api/sales-agent/config */
async function saveConfig(req, res) {
  try {
    const { ownerPhone, heyEchoMode, bookingLink, objections, enabled } =
      req.body || {};

    let normalizedOwner = null;
    if (ownerPhone) {
      normalizedOwner = normalizeE164(ownerPhone);
      if (!normalizedOwner) {
        return res.status(400).json({
          error: "Enter the owner phone in E.164 format, e.g. +15551234567.",
        });
      }
    }

    const mode = heyEchoMode === "voice" ? "voice" : "sms";

    // Keep only well-formed {objection,response} pairs, max 5.
    const cleanObjections = (Array.isArray(objections) ? objections : [])
      .map((o) => ({
        objection: String(o?.objection || "").trim(),
        response: String(o?.response || "").trim(),
      }))
      .filter((o) => o.objection && o.response)
      .slice(0, 5);

    const { rows } = await db.query(
      `UPDATE sales_agent_config
       SET owner_phone = $1, hey_echo_mode = $2, booking_link = $3,
           objections = $4::jsonb, enabled = $5
       WHERE config_key = 'singleton'
       RETURNING *`,
      [
        normalizedOwner,
        mode,
        bookingLink ? String(bookingLink).trim() : null,
        JSON.stringify(cleanObjections),
        enabled !== false,
      ],
    );
    return res.json({ config: serializeConfig(rows[0]) });
  } catch (err) {
    console.error("Save sales config error:", err.message);
    return res.status(500).json({ error: "Failed to save sales agent config" });
  }
}

function serializeCall(row) {
  return {
    callId: row.call_id,
    prospectPhone: row.prospect_phone,
    prospectName: row.prospect_name,
    businessType: row.business_type,
    interestScore: row.interest_score,
    outcome: row.outcome,
    callDuration: row.call_duration,
    summary: row.summary,
    bookedDemo: row.booked_demo,
    followUpScheduled: row.follow_up_scheduled,
    inviteSent: row.invite_sent,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    turns: Array.isArray(row.conversation_history)
      ? row.conversation_history.length
      : 0,
  };
}

/** GET /api/sales-agent/calls — all sales calls (history). */
async function getSalesCalls(req, res) {
  try {
    const { rows } = await db.query(
      "SELECT * FROM sales_calls ORDER BY created_at DESC LIMIT 500",
    );
    return res.json({ calls: rows.map(serializeCall) });
  } catch (err) {
    console.error("Get sales calls error:", err.message);
    return res.status(500).json({ error: "Failed to load sales calls" });
  }
}

/** GET /api/sales-agent/live — currently active sales calls. */
async function getLiveCalls(req, res) {
  try {
    const { rows } = await db.query(
      "SELECT * FROM sales_calls WHERE status = 'in_progress' ORDER BY created_at DESC",
    );
    return res.json({ calls: rows.map(serializeCall) });
  } catch (err) {
    console.error("Get live sales calls error:", err.message);
    return res.status(500).json({ error: "Failed to load live calls" });
  }
}

/** GET /api/sales-agent/calls/:callId — full detail incl. transcript. */
async function getSalesCallDetail(req, res) {
  try {
    const { rows } = await db.query(
      "SELECT * FROM sales_calls WHERE call_id = $1",
      [req.params.callId],
    );
    const call = rows[0];
    if (!call) return res.status(404).json({ error: "Call not found" });
    return res.json({
      call: {
        ...serializeCall(call),
        conversationHistory: Array.isArray(call.conversation_history)
          ? call.conversation_history
          : [],
      },
    });
  } catch (err) {
    console.error("Get sales call detail error:", err.message);
    return res.status(500).json({ error: "Failed to load call" });
  }
}

/** POST /api/sales-agent/calls/:callId/invite — manual three-way invite. */
async function triggerInvite(req, res) {
  try {
    const result = await sendThreeWayInvite(
      req.params.callId,
      getPublicBaseUrl(req),
    );
    if (result.reason === "not_found") {
      return res.status(404).json({ error: "Call not found" });
    }
    if (result.reason === "no_owner_phone") {
      return res.status(400).json({
        error: "Set an owner phone number in Configuration first.",
      });
    }
    if (!result.sent) {
      return res.status(502).json({
        error:
          "Could not send the invite SMS. Check the sales Twilio configuration.",
      });
    }
    return res.json({ sent: true, joinLink: result.joinLink });
  } catch (err) {
    console.error("Trigger invite error:", err.message);
    return res.status(500).json({ error: "Failed to send invite" });
  }
}

/**
 * POST /api/sales-agent/calls/:callId/ask-echo  { question }
 * Co-pilot on demand (e.g. after the owner has joined the conference). Returns
 * the answer and, in SMS mode, texts it to the owner. AI failure → 502.
 */
async function askEcho(req, res) {
  try {
    const { question } = req.body || {};
    if (!question || !String(question).trim()) {
      return res.status(400).json({ error: "question is required" });
    }
    const { rows } = await db.query(
      "SELECT * FROM sales_calls WHERE call_id = $1",
      [req.params.callId],
    );
    const call = rows[0];
    if (!call) return res.status(404).json({ error: "Call not found" });

    const config = await loadConfig();
    const transcript = Array.isArray(call.conversation_history)
      ? call.conversation_history
      : [];
    let answer;
    try {
      answer = await generateCoPilotReply(config, transcript, String(question));
    } catch (err) {
      return res.status(502).json({
        error: "The co-pilot could not generate an answer right now.",
        detail: err.message,
      });
    }
    if (config.hey_echo_mode === "sms" && config.owner_phone) {
      await sendSalesSms(config.owner_phone, `Echo co-pilot: ${answer}`);
    }
    return res.json({ answer });
  } catch (err) {
    console.error("Ask Echo error:", err.message);
    return res.status(500).json({ error: "Failed to ask Echo" });
  }
}

/**
 * POST /api/sales-agent/calls/:callId/book-demo
 * Marks the prospect as moving forward: texts the booking link, flags the call
 * booked + follow-up scheduled. NOTE: the brand-scoped follow-up SEQUENCE system
 * (leads/brands) does not apply to platform sales prospects — there is no brand
 * or lead record — so the follow-up is tracked on the sales_calls row itself.
 */
async function bookDemo(req, res) {
  try {
    const { rows } = await db.query(
      "SELECT * FROM sales_calls WHERE call_id = $1",
      [req.params.callId],
    );
    const call = rows[0];
    if (!call) return res.status(404).json({ error: "Call not found" });

    const config = await loadConfig();
    if (!config.booking_link) {
      return res.status(400).json({
        error: "Set a booking link in Configuration before booking a demo.",
      });
    }

    let smsSent = false;
    if (call.prospect_phone) {
      smsSent = await sendSalesSms(
        call.prospect_phone,
        `Thanks for your interest in Zorecho! Book your demo here: ${config.booking_link}`,
      );
    }

    const { rows: updated } = await db.query(
      `UPDATE sales_calls
       SET booked_demo = TRUE, follow_up_scheduled = TRUE,
           outcome = 'booked_demo'
       WHERE call_id = $1
       RETURNING *`,
      [call.call_id],
    );
    return res.json({ call: serializeCall(updated[0]), smsSent });
  } catch (err) {
    console.error("Book demo error:", err.message);
    return res.status(500).json({ error: "Failed to book demo" });
  }
}

/** GET /api/sales-agent/performance — this-month metrics. */
async function getPerformance(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT * FROM sales_calls
       WHERE created_at >= date_trunc('month', now())`,
    );
    const total = rows.length;
    const scored = rows.filter((r) => r.interest_score > 0);
    const avgInterest = scored.length
      ? scored.reduce((s, r) => s + r.interest_score, 0) / scored.length
      : 0;
    const booked = rows.filter((r) => r.booked_demo).length;
    const conversionRate = total ? (booked / total) * 100 : 0;

    // Objection breakdown parsed from stored summaries (best-effort).
    const objectionCounts = {};
    for (const r of rows) {
      if (!r.summary) continue;
      try {
        const match = r.summary.match(/\{[\s\S]*\}/);
        if (!match) continue;
        const parsed = JSON.parse(match[0]);
        (parsed.objections_raised || []).forEach((o) => {
          const key = String(o).trim().toLowerCase();
          if (key) objectionCounts[key] = (objectionCounts[key] || 0) + 1;
        });
      } catch {
        /* ignore malformed summary */
      }
    }
    const commonObjections = Object.entries(objectionCounts)
      .map(([objection, count]) => ({ objection, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return res.json({
      performance: {
        totalCalls: total,
        avgInterestScore: Math.round(avgInterest * 10) / 10,
        bookedDemos: booked,
        conversionRate: Math.round(conversionRate * 10) / 10,
        commonObjections,
      },
    });
  } catch (err) {
    console.error("Get sales performance error:", err.message);
    return res.status(500).json({ error: "Failed to load performance" });
  }
}

module.exports = {
  // Twilio webhooks
  initiateDemoCall,
  handleSalesConversation,
  handleSalesCallStatus,
  handleJoinCall,
  handleConference,
  // Admin
  getConfig,
  saveConfig,
  getSalesCalls,
  getLiveCalls,
  getSalesCallDetail,
  triggerInvite,
  askEcho,
  bookDemo,
  getPerformance,
  // exported for tests
  finalizeSalesCall,
  sendThreeWayInvite,
  deriveOutcome,
  clampInterest,
  serializeConfig,
  serializeCall,
};
