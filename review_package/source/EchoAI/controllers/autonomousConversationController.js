// ---------------------------------------------------------------------------
// Two-Way Autonomous Conversation ENGINE.
//
// When a lead REPLIES to any outbound message (SMS, email, or the website
// chatbot), this engine runs the whole autonomous loop:
//
//   1. Hermes 4 reads the reply and decides the conversation state + intent +
//      buying signal + live temperature (utils/autonomousConversationBrain.js).
//   2. Claude writes the actual reply in the brand's voice (SMS/email; the
//      chatbot supplies its own richer, slot-aware reply).
//   3. Every exchange is logged to the CRM (leads.conversation_history) AND to
//      the conversation's own transcript (autonomous_conversations).
//   4. The lead's temperature is updated in real time.
//   5. On a STRONG buying signal, the owner is alerted by voice + SMS with a
//      transfer-or-keep-handling offer (once per conversation).
//   6. The loop continues until a terminal condition: the lead books, converts,
//      says stop/not-interested, goes 48h silent (cron sweep), or the owner
//      takes over (transfer).
//
// Architecture invariants (see replit.md): AI failures never mock a reply — the
// turn is skipped and the conversation stays intact. Escalation is best-effort
// (voice/SMS failure never breaks the lead-facing reply). Terminal transitions
// are status-guarded so overlapping ticks can't resurrect a closed/transferred
// conversation.
// ---------------------------------------------------------------------------

const db = require("../config/db");
const brain = require("../utils/autonomousConversationBrain");
const { generateAutonomousReply } = require("../prompts/autonomousReplyPrompt");
const { enqueueOwnerVoiceEvent } = require("../utils/echoVoiceNotifications");
const { buildClient } = require("../config/twilio");
const { decrypt } = require("../utils/encryption");
const { toJsonbParam } = require("../utils/jsonb");
const { normalizeE164 } = require("../utils/phone");
const leadOutcome = require("../utils/leadOutcome");

const VALID_TEMPERATURES = ["tire_kicker", "warm", "hot"];
const OPEN_STATUSES = ["active", "awaiting_owner"];

// The exact spoken/SMS line Echo uses to offer a handoff on a hot live lead.
function transferOfferText(brandName) {
  const forBrand = brandName ? ` for ${brandName}` : "";
  return (
    `Sir, I'm having a live conversation with a hot lead right now${forBrand}. ` +
    "Want me to transfer them to you, or keep handling it?"
  );
}

// ---------------------------------------------------------------------------
// Conversation lifecycle
// ---------------------------------------------------------------------------

/**
 * Get the open conversation for (brand, lead, channel), or create a fresh one.
 * Concurrency-safe: the partial unique index (open statuses) + ON CONFLICT means
 * two simultaneous inbound replies can't create duplicate threads.
 */
async function getOrCreateConversation({ brandId, leadId, channel }) {
  // Include 'transferred' so a conversation the owner has taken over is found
  // and returned (the caller short-circuits and Echo stays silent). Prefer a
  // transferred row if both somehow exist so the handoff always wins.
  const existing = await db.query(
    `SELECT * FROM autonomous_conversations
     WHERE brand_id = $1 AND lead_id = $2 AND channel = $3
       AND status IN ('active', 'awaiting_owner', 'transferred')
     ORDER BY (status = 'transferred') DESC
     LIMIT 1`,
    [brandId, leadId, channel],
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await db.query(
    `INSERT INTO autonomous_conversations (brand_id, lead_id, channel, status)
     VALUES ($1, $2, $3, 'active')
     ON CONFLICT (brand_id, lead_id, channel)
       WHERE status IN ('active', 'awaiting_owner')
     DO NOTHING
     RETURNING *`,
    [brandId, leadId, channel],
  );
  if (inserted.rows[0]) return inserted.rows[0];

  // Lost the race — another inbound created it first; read it back.
  const raced = await db.query(
    `SELECT * FROM autonomous_conversations
     WHERE brand_id = $1 AND lead_id = $2 AND channel = $3
       AND status IN ('active', 'awaiting_owner')
     LIMIT 1`,
    [brandId, leadId, channel],
  );
  return raced.rows[0] || null;
}

/**
 * Map a Hermes decision state to a terminal close_reason (or null to continue).
 */
function closeReasonForState(state, bookedHint) {
  if (bookedHint) return "booked";
  if (state === "booked") return "booked";
  if (state === "converted") return "converted";
  if (state === "stop") return "stopped";
  return null;
}

// ---------------------------------------------------------------------------
// Owner escalation (voice + SMS)
// ---------------------------------------------------------------------------

/**
 * Alert the owner about a hot live lead by voice AND SMS, offering to transfer
 * or keep handling. Best-effort: never throws into the reply flow. Fires at most
 * once per conversation (the caller stamps owner_alerted_at atomically first).
 */
async function escalateToOwner({ conversation, brand, ownerUserId, lead }) {
  const spoken = transferOfferText(brand && brand.brand_name);

  // 1) Voice — surfaced through the owner's Echo voice queue.
  try {
    await enqueueOwnerVoiceEvent(
      ownerUserId,
      "autonomous_hot_lead",
      () => spoken,
      {
        brandId: brand.brand_id,
        title: "Hot live lead — transfer or keep handling?",
        payload: {
          type: "autonomous_hot_lead",
          conversationId: conversation.conversation_id,
          leadId: lead.lead_id,
          channel: conversation.channel,
          action: "autonomous_transfer",
          offer: { yes: "transfer", no: "continue" },
        },
        dedupKey: `autoconv-hot-${conversation.conversation_id}`,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    );
  } catch (err) {
    console.error("Autonomous escalation voice failed:", err.message);
  }

  // 2) SMS — sent from the brand's own Twilio number to the owner's phone.
  try {
    const { rows } = await db.query(
      `SELECT u.phone AS owner_phone,
              tc.account_sid, tc.auth_token_encrypted, tc.phone_number
       FROM users u
       LEFT JOIN twilio_config tc ON tc.brand_id = $2
       WHERE u.user_id = $1`,
      [ownerUserId, brand.brand_id],
    );
    const row = rows[0];
    const ownerPhone = row && normalizeE164(row.owner_phone);
    if (ownerPhone && row.account_sid && row.auth_token_encrypted && row.phone_number) {
      const client = buildClient(row.account_sid, decrypt(row.auth_token_encrypted));
      await client.messages.create({
        to: ownerPhone,
        from: row.phone_number,
        body: spoken + " Reply TRANSFER to take over.",
      });
    }
  } catch (err) {
    console.error("Autonomous escalation SMS failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Core: handle one inbound reply
// ---------------------------------------------------------------------------

/**
 * Handle a single inbound reply from a lead and drive the autonomous loop.
 *
 * @param {object} args
 * @param {object} args.brand        { brand_id, brand_name, brand_personality, voice_description, target_audience }
 * @param {string} args.ownerUserId  owner user id (for escalation)
 * @param {object} args.lead         { lead_id, conversation_history, temperature, ... }
 * @param {string} args.channel      'sms' | 'email' | 'chatbot'
 * @param {string} args.inboundText  the lead's newest message
 * @param {Array}  [args.history]    prior turns [{role, content}] (defaults to lead.conversation_history)
 * @param {string} [args.existingReply]  a reply already generated by the channel (chatbot); engine won't call Claude
 * @param {boolean} [args.bookedHint]    the channel already booked an appointment this turn (chatbot bookIso)
 * @returns {Promise<{reply: string|null, temperature: string|null, state: string, closed: boolean, closeReason: string|null, transferred: boolean}>}
 */
async function handleInboundReply(args) {
  const {
    brand,
    ownerUserId,
    lead,
    channel,
    inboundText,
    existingReply,
    bookedHint = false,
  } = args || {};

  const history = Array.isArray(args.history)
    ? args.history
    : Array.isArray(lead && lead.conversation_history)
      ? lead.conversation_history
      : [];

  const conversation = await getOrCreateConversation({
    brandId: brand.brand_id,
    leadId: lead.lead_id,
    channel,
  });

  // Owner has taken over — Echo stays silent and does not auto-reply.
  if (!conversation || conversation.status === "transferred") {
    return { reply: null, temperature: null, state: "transferred", closed: true, closeReason: "transferred", transferred: true };
  }

  // 1) Hermes decides. Fall back to a safe "continue, no escalation" default.
  const decision =
    (await brain.analyzeReply({ brand, channel, history, latestInbound: inboundText })) || {
      intent: "question",
      state: "continue",
      buyingSignal: false,
      temperature: null,
      directive: "",
    };

  const closeReason = closeReasonForState(decision.state, bookedHint);
  const closing = Boolean(closeReason);

  // 2) Produce the reply. The chatbot supplies its own reply; SMS/email use
  //    Claude here. We never generate a reply for a hard "stop" (respect the
  //    lead's wish to be left alone).
  let reply = existingReply != null ? existingReply : null;
  if (existingReply == null && decision.state !== "stop") {
    try {
      reply = await generateAutonomousReply({
        brand,
        channel,
        history,
        latestInbound: inboundText,
        directive: brain.directiveForPrompt(decision),
      });
    } catch (err) {
      console.error("Autonomous reply generation failed:", err.message);
      // Keep the conversation intact; skip this turn's reply (never mock).
      reply = null;
    }
  }

  // 3) Persist: transcript (conversation) + CRM history (lead) + live temperature.
  const nowIso = new Date().toISOString();
  const priorTranscript = Array.isArray(conversation.transcript) ? conversation.transcript : [];
  const newTranscript = [...priorTranscript, { role: "user", content: inboundText, at: nowIso }];
  if (reply) newTranscript.push({ role: "assistant", content: reply, at: nowIso });

  const newLeadHistory = [...history, { role: "user", content: inboundText, at: nowIso }];
  if (reply) newLeadHistory.push({ role: "assistant", content: reply, at: nowIso });

  const newTemp =
    decision.temperature && VALID_TEMPERATURES.includes(decision.temperature)
      ? decision.temperature
      : lead.temperature || null;

  const nextStatus = closing ? "closed" : conversation.status;

  // Single atomic conversation update (status-guarded so a concurrent
  // transfer/close wins and this can't resurrect the thread).
  const updated = await db.query(
    `UPDATE autonomous_conversations
     SET transcript = $2::jsonb,
         message_count = message_count + $3,
         last_inbound_at = NOW(),
         last_outbound_at = CASE WHEN $4 THEN NOW() ELSE last_outbound_at END,
         last_intent = $5,
         buying_signal = buying_signal OR $6,
         status = $7,
         close_reason = $8,
         updated_at = NOW()
     WHERE conversation_id = $1 AND status IN ('active', 'awaiting_owner')
     RETURNING conversation_id, status`,
    [
      conversation.conversation_id,
      toJsonbParam(newTranscript),
      reply ? 2 : 1,
      Boolean(reply),
      decision.intent,
      decision.buyingSignal === true,
      nextStatus,
      closeReason,
    ],
  );

  // Someone transferred/closed this conversation between our read and write —
  // abort silently (don't send, don't escalate).
  if (updated.rows.length === 0) {
    return { reply: null, temperature: newTemp, state: decision.state, closed: true, closeReason: null, transferred: true };
  }

  // CRM: full conversation history on the lead + live temperature + conversion.
  try {
    await db.query(
      `UPDATE leads
       SET conversation_history = $1,
           temperature = $2,
           conversion_status = CASE WHEN $4 THEN 'converted'::conversion_status ELSE conversion_status END,
           updated_at = NOW()
       WHERE lead_id = $3`,
      [JSON.stringify(newLeadHistory), newTemp, lead.lead_id, closeReason === "converted"],
    );
  } catch (err) {
    console.error("Autonomous CRM history update failed:", err.message);
  }

  // Sage V2 P3 (flag-gated no-op when dark): a machine-detected convert also
  // records the measurement outcome — won, value pending (NEVER estimated) —
  // and the converting touch (this conversation's channel).
  if (closeReason === "converted") {
    leadOutcome.markWonFromConvert(lead.lead_id, "autonomous", channel).catch(() => {});
    // Jobber hook (best-effort): a converted lead becomes a Jobber client.
    require("./jobberController")
      .autoCreateClientForLead(lead.lead_id)
      .catch(() => {});
  }

  // 4) Escalate on a strong buying signal (best-effort). Fire at most once per
  //    conversation via an atomic compare-and-set: the alert only runs for the
  //    turn that actually flips owner_alerted_at from NULL, so two concurrent
  //    buying-signal turns can't both send the owner voice+SMS. Skip on a
  //    terminal turn (booked/converted/stopped) — a handoff offer is moot then.
  if (decision.buyingSignal === true && !closing) {
    const claim = await db.query(
      `UPDATE autonomous_conversations
       SET owner_alerted_at = NOW(), updated_at = NOW()
       WHERE conversation_id = $1
         AND owner_alerted_at IS NULL
         AND status IN ('active', 'awaiting_owner')
       RETURNING conversation_id`,
      [conversation.conversation_id],
    );
    if (claim.rows.length > 0) {
      await escalateToOwner({ conversation, brand, ownerUserId, lead });
    }
  }

  return {
    reply,
    temperature: newTemp,
    state: decision.state,
    closed: closing,
    closeReason,
    transferred: false,
  };
}

// ---------------------------------------------------------------------------
// 48h-silence timeout sweep (cron)
// ---------------------------------------------------------------------------

/**
 * Close open conversations whose lead has gone 48h without replying. Atomic +
 * status-guarded. Best-effort: logs and returns a count, never throws.
 */
async function runAutonomousTimeoutSweep() {
  try {
    const { rows } = await db.query(
      `UPDATE autonomous_conversations
       SET status = 'closed', close_reason = 'timed_out', updated_at = NOW()
       WHERE status IN ('active', 'awaiting_owner')
         AND last_inbound_at IS NOT NULL
         AND last_inbound_at < NOW() - INTERVAL '48 hours'
       RETURNING conversation_id`,
    );
    if (rows.length) {
      console.log(`Autonomous timeout sweep closed ${rows.length} idle conversation(s).`);
    }
    return rows.length;
  } catch (err) {
    console.error("Autonomous timeout sweep failed:", err.message);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Owner handoff (transfer / resume)
// ---------------------------------------------------------------------------

/** Verify the conversation belongs to the given user (brand owner) or admin. */
async function loadOwnedConversation(conversationId, userId, isAdmin) {
  const { rows } = await db.query(
    `SELECT ac.*, b.user_id AS brand_owner_id, b.brand_name
     FROM autonomous_conversations ac
     JOIN brands b ON b.brand_id = ac.brand_id
     WHERE ac.conversation_id = $1`,
    [conversationId],
  );
  const row = rows[0];
  if (!row) return null;
  if (!isAdmin && row.brand_owner_id !== userId) return null;
  return row;
}

/**
 * Flip a live conversation to a human handoff. Status-guarded so it only affects
 * an open conversation. Returns the updated row, or null (not found / not open).
 */
async function requestTransfer({ conversationId, userId, isAdmin }) {
  const owned = await loadOwnedConversation(conversationId, userId, isAdmin);
  if (!owned) return null;
  const { rows } = await db.query(
    `UPDATE autonomous_conversations
     SET status = 'transferred', close_reason = 'transferred',
         handoff_requested_at = NOW(), handoff_by = $2, updated_at = NOW()
     WHERE conversation_id = $1 AND status IN ('active', 'awaiting_owner')
     RETURNING *`,
    [conversationId, userId],
  );
  return rows[0] || null;
}

/** Hand a transferred conversation back to Echo (reopen it). */
async function resumeConversation({ conversationId, userId, isAdmin }) {
  const owned = await loadOwnedConversation(conversationId, userId, isAdmin);
  if (!owned) return null;
  const { rows } = await db.query(
    `UPDATE autonomous_conversations
     SET status = 'active', close_reason = NULL,
         handoff_requested_at = NULL, handoff_by = NULL, updated_at = NOW()
     WHERE conversation_id = $1 AND status = 'transferred'
     RETURNING *`,
    [conversationId],
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// HTTP handlers (owner dashboard) — mounted at /api/autonomous
// ---------------------------------------------------------------------------

function isAdminReq(req) {
  return Boolean(req.user && req.user.role === "admin");
}

/** GET /api/autonomous?brandId=&status= — list the owner's conversations. */
async function listConversations(req, res) {
  try {
    const { brandId, status } = req.query;
    const params = [req.user.userId];
    let where = "b.user_id = $1";
    if (isAdminReq(req)) {
      where = "TRUE";
      params.length = 0;
    }
    if (brandId) {
      params.push(brandId);
      where += ` AND ac.brand_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      where += ` AND ac.status = $${params.length}`;
    }
    const { rows } = await db.query(
      `SELECT ac.conversation_id, ac.brand_id, ac.lead_id, ac.channel, ac.status,
              ac.close_reason, ac.last_intent, ac.buying_signal, ac.owner_alerted_at,
              ac.handoff_requested_at, ac.message_count, ac.last_inbound_at,
              ac.last_outbound_at, ac.created_at, ac.updated_at,
              l.lead_name, l.email, l.phone, l.temperature, b.brand_name
       FROM autonomous_conversations ac
       JOIN brands b ON b.brand_id = ac.brand_id
       JOIN leads l ON l.lead_id = ac.lead_id
       WHERE ${where}
       ORDER BY ac.updated_at DESC
       LIMIT 200`,
      params,
    );
    return res.json({ conversations: rows });
  } catch (err) {
    console.error("listConversations failed:", err.message);
    return res.status(500).json({ error: "Failed to load conversations" });
  }
}

/** GET /api/autonomous/:id — one conversation with its full transcript. */
async function getConversation(req, res) {
  try {
    const owned = await loadOwnedConversation(req.params.id, req.user.userId, isAdminReq(req));
    if (!owned) return res.status(404).json({ error: "Conversation not found" });
    return res.json({ conversation: owned });
  } catch (err) {
    console.error("getConversation failed:", err.message);
    return res.status(500).json({ error: "Failed to load conversation" });
  }
}

/** POST /api/autonomous/:id/transfer — owner takes over the live conversation. */
async function transfer(req, res) {
  try {
    const row = await requestTransfer({
      conversationId: req.params.id,
      userId: req.user.userId,
      isAdmin: isAdminReq(req),
    });
    if (!row) {
      return res
        .status(404)
        .json({ error: "Conversation not found or no longer active" });
    }
    return res.json({ conversation: row });
  } catch (err) {
    console.error("transfer failed:", err.message);
    return res.status(500).json({ error: "Failed to transfer conversation" });
  }
}

/** POST /api/autonomous/:id/resume — hand a transferred conversation back to Echo. */
async function resume(req, res) {
  try {
    const row = await resumeConversation({
      conversationId: req.params.id,
      userId: req.user.userId,
      isAdmin: isAdminReq(req),
    });
    if (!row) {
      return res
        .status(404)
        .json({ error: "Conversation not found or not transferred" });
    }
    return res.json({ conversation: row });
  } catch (err) {
    console.error("resume failed:", err.message);
    return res.status(500).json({ error: "Failed to resume conversation" });
  }
}

module.exports = {
  // engine
  handleInboundReply,
  getOrCreateConversation,
  escalateToOwner,
  runAutonomousTimeoutSweep,
  requestTransfer,
  resumeConversation,
  transferOfferText,
  closeReasonForState,
  // http
  listConversations,
  getConversation,
  transfer,
  resume,
};
