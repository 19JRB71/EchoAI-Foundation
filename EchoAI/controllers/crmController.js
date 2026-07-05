const db = require("../config/db");
const { decrypt } = require("../utils/encryption");
const { toJsonbParam } = require("../utils/jsonb");
const { maskPhone } = require("../utils/phone");
const {
  getPublicBaseUrl,
  buildClient,
  validateTwilioRequest,
} = require("../config/twilio");
const twilioLib = require("twilio");
const { enqueueOwnerVoiceEvent } = require("../utils/echoVoiceNotifications");

// ---------------------------------------------------------------------------
// Employee Accountability CRM
//
// Sales reps work ONE assigned lead at a time out of a per-workspace queue and
// never see a lead's real phone number — calls are placed through a Twilio
// "phone bridge" that rings the rep's own phone first, then dials the lead and
// records the conversation. Owners/admins manage the queue, monitor live call
// activity, and read a full accountability log per lead. Managers are read-only
// (enforced at the route layer). Every write here is scoped to the caller's
// workspace via a `brands.user_id = <owner>` join so a rep can never reach a
// lead outside their employer's account.
// ---------------------------------------------------------------------------

const QUEUE_ACTIVE_STATES = ["queued", "assigned"];

/** The real acting user (team member identity), not the remapped workspace owner. */
function actingUserId(req) {
  return req.user.actualUserId || req.user.userId;
}

/** Loads the acting rep's workspace membership (phone + email) or null. */
async function getRepMembership(req) {
  const ownerId = req.user.userId;
  const repId = actingUserId(req);
  const { rows } = await db.query(
    `SELECT tm.phone, u.email
       FROM team_members tm
       JOIN users u ON u.user_id = tm.invited_user_id
      WHERE tm.account_owner_user_id = $1
        AND tm.invited_user_id = $2
        AND tm.status = 'active'`,
    [ownerId, repId]
  );
  return rows[0] || null;
}

/** Shapes a lead row for a REP — phone is always masked, brand id hidden. */
function repLeadView(lead) {
  if (!lead) return null;
  return {
    leadId: lead.lead_id,
    name: lead.lead_name || null,
    email: lead.email || null,
    phoneMasked: maskPhone(lead.phone),
    hasPhone: Boolean(lead.phone),
    temperature: lead.temperature,
    conversionStatus: lead.conversion_status,
    queueState: lead.queue_state,
    assignedAt: lead.assigned_at,
    conversationHistory: Array.isArray(lead.conversation_history)
      ? lead.conversation_history
      : [],
  };
}

/** Records an accountability entry on a lead's CRM timeline. */
async function logRepActivity(leadId, action, details) {
  await db.query(
    `INSERT INTO crm_interactions (lead_id, interaction_type, interaction_details)
     VALUES ($1, 'rep_task', $2::jsonb)`,
    [leadId, toJsonbParam({ action, ...details })]
  );
}

// ===========================================================================
// SALES REP — personal one-lead-at-a-time queue
// ===========================================================================

/**
 * GET /api/crm/current  (rep only)
 * Returns the rep's in-progress lead. If they have none, atomically claims the
 * next lead in their workspace queue (targeted-to-them first, then the shared
 * pool) so two reps can never grab the same lead. Phone is masked.
 */
async function getCurrentLead(req, res) {
  const ownerId = req.user.userId;
  const repId = actingUserId(req);
  try {
    // Already working a lead? Return it.
    const existing = await db.query(
      `SELECT l.* FROM leads l
         JOIN brands b ON b.brand_id = l.brand_id
        WHERE b.user_id = $1 AND l.assigned_rep_user_id = $2
          AND l.queue_state = 'assigned'
        ORDER BY l.assigned_at ASC
        LIMIT 1`,
      [ownerId, repId]
    );
    if (existing.rows.length) {
      const remaining = await countRepQueue(ownerId, repId);
      return res.json({ lead: repLeadView(existing.rows[0]), remaining });
    }

    // Otherwise claim the next queued lead atomically. Prefer leads targeted to
    // this rep, then unclaimed pool leads; within each, honor manual priority
    // then arrival order.
    const claimed = await db.query(
      `UPDATE leads SET queue_state = 'assigned',
                        assigned_rep_user_id = $2,
                        assigned_at = NOW()
        WHERE lead_id = (
          SELECT l.lead_id FROM leads l
            JOIN brands b ON b.brand_id = l.brand_id
           WHERE b.user_id = $1
             AND l.queue_state = 'queued'
             AND (l.assigned_rep_user_id = $2 OR l.assigned_rep_user_id IS NULL)
           ORDER BY (l.assigned_rep_user_id = $2) DESC NULLS LAST,
                    l.queue_priority ASC NULLS LAST,
                    l.created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING *`,
      [ownerId, repId]
    );

    if (!claimed.rows.length) {
      return res.json({ lead: null, remaining: 0 });
    }
    const lead = claimed.rows[0];
    await logRepActivity(lead.lead_id, "claimed", {
      byUserId: repId,
      byEmail: req.user.email || null,
    });
    const remaining = await countRepQueue(ownerId, repId);
    return res.json({ lead: repLeadView(lead), remaining });
  } catch (err) {
    console.error("CRM getCurrentLead error:", err.message);
    return res.status(500).json({ error: "Failed to load your current lead." });
  }
}

/** Counts leads still waiting for this rep (targeted + pool), excluding claimed. */
async function countRepQueue(ownerId, repId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM leads l
       JOIN brands b ON b.brand_id = l.brand_id
      WHERE b.user_id = $1 AND l.queue_state = 'queued'
        AND (l.assigned_rep_user_id = $2 OR l.assigned_rep_user_id IS NULL)`,
    [ownerId, repId]
  );
  return rows[0] ? rows[0].n : 0;
}

/**
 * POST /api/crm/call  (rep only)
 * Places a bridged call to the rep's CURRENT lead. Twilio rings the rep's own
 * phone first (from the brand number); when they answer, the bridge TwiML dials
 * the lead and records. The rep never sees the lead's number.
 */
async function callCurrentLead(req, res) {
  const ownerId = req.user.userId;
  const repId = actingUserId(req);
  try {
    const membership = await getRepMembership(req);
    if (!membership || !membership.phone) {
      return res.status(400).json({
        error:
          "Your account has no phone number on file. Ask an admin to add one so calls can ring your phone.",
      });
    }

    const leadRes = await db.query(
      `SELECT l.* FROM leads l
         JOIN brands b ON b.brand_id = l.brand_id
        WHERE b.user_id = $1 AND l.assigned_rep_user_id = $2
          AND l.queue_state = 'assigned'
        LIMIT 1`,
      [ownerId, repId]
    );
    const lead = leadRes.rows[0];
    if (!lead) {
      return res
        .status(400)
        .json({ error: "You have no lead in progress to call." });
    }
    if (!lead.phone) {
      return res
        .status(400)
        .json({ error: "This lead has no phone number on file." });
    }

    const cfg = await getBrandTwilio(lead.brand_id);
    if (!cfg) {
      return res.status(400).json({
        error:
          "This workspace has no connected phone number. Ask an admin to connect Twilio in Settings.",
      });
    }

    const baseUrl = getPublicBaseUrl(req);
    if (!baseUrl) {
      return res
        .status(500)
        .json({ error: "Server public URL is not configured for calling." });
    }

    // Create the call row first so the bridge/status webhooks can find it, and
    // attribute it to the human rep for accountability.
    const insert = await db.query(
      `INSERT INTO calls
         (brand_id, lead_id, direction, caller_phone, status,
          agent_user_id, agent_name)
       VALUES ($1, $2, 'outbound', $3, 'in_progress', $4, $5)
       RETURNING call_id`,
      [lead.brand_id, lead.lead_id, lead.phone, repId, membership.email || null]
    );
    const callId = insert.rows[0].call_id;

    try {
      const client = buildClient(cfg.accountSid, cfg.authToken);
      const call = await client.calls.create({
        to: membership.phone, // ring the REP first
        from: cfg.phoneNumber,
        url: `${baseUrl}/api/crm/bridge/${callId}`,
        method: "POST",
        statusCallback: `${baseUrl}/api/crm/callstatus/${callId}`,
        statusCallbackEvent: ["completed", "no-answer", "busy", "failed"],
        statusCallbackMethod: "POST",
      });
      await db.query("UPDATE calls SET twilio_call_sid = $1 WHERE call_id = $2", [
        call.sid,
        callId,
      ]);
      await logRepActivity(lead.lead_id, "called", {
        byUserId: repId,
        byEmail: membership.email || null,
        callId,
      });
      return res.status(201).json({ callId, status: "calling" });
    } catch (err) {
      await db.query(
        "UPDATE calls SET status = 'failed', outcome = 'failed' WHERE call_id = $1",
        [callId]
      );
      return res.status(502).json({
        error: "The phone provider could not place the call.",
        detail: err.message,
      });
    }
  } catch (err) {
    console.error("CRM callCurrentLead error:", err.message);
    return res.status(500).json({ error: "Failed to place the call." });
  }
}

/**
 * POST /api/crm/complete  (rep only)
 * Marks the rep's current lead as worked (removes it from their queue), records
 * the outcome + optional notes on the accountability log, and optionally updates
 * the lead's conversion status. The rep then pulls their next lead.
 */
async function completeCurrentLead(req, res) {
  const ownerId = req.user.userId;
  const repId = actingUserId(req);
  const outcome = String(req.body.outcome || "").trim() || "contacted";
  const notes = req.body.notes ? String(req.body.notes).trim() : null;
  const conversionStatus = req.body.conversionStatus
    ? String(req.body.conversionStatus).trim()
    : null;
  const VALID_CONVERSIONS = ["new", "in_progress", "converted", "lost"];

  try {
    const leadRes = await db.query(
      `SELECT l.lead_id, l.lead_name, l.brand_id FROM leads l
         JOIN brands b ON b.brand_id = l.brand_id
        WHERE b.user_id = $1 AND l.assigned_rep_user_id = $2
          AND l.queue_state = 'assigned'
        LIMIT 1`,
      [ownerId, repId]
    );
    const lead = leadRes.rows[0];
    if (!lead) {
      return res
        .status(400)
        .json({ error: "You have no lead in progress to complete." });
    }

    if (conversionStatus && VALID_CONVERSIONS.includes(conversionStatus)) {
      await db.query(
        "UPDATE leads SET conversion_status = $1 WHERE lead_id = $2",
        [conversionStatus, lead.lead_id]
      );
    }

    await db.query(
      `UPDATE leads SET queue_state = 'completed', worked_at = NOW()
        WHERE lead_id = $1`,
      [lead.lead_id]
    );
    await logRepActivity(lead.lead_id, "completed", {
      byUserId: repId,
      byEmail: req.user.email || null,
      outcome,
      notes: notes || undefined,
      conversionStatus: conversionStatus || undefined,
    });

    // Speak a rep-completed update to the owner via Echo. Best-effort; honors
    // the owner's voice settings and never affects the completion response.
    const repLabel = req.user.email || "A rep";
    const leadLabel = lead.lead_name || "a lead";
    const outcomeNote =
      conversionStatus === "converted"
        ? " It converted — nice work."
        : conversionStatus === "lost"
          ? " It was marked lost."
          : "";
    enqueueOwnerVoiceEvent(
      ownerId,
      "rep_completed",
      (firstName) =>
        `${firstName}, ${repLabel} just finished working ${leadLabel}. Outcome: ${outcome}.${outcomeNote}`,
      {
        brandId: lead.brand_id,
        title: "Lead completed",
        payload: { leadId: lead.lead_id, outcome, conversionStatus: conversionStatus || null },
        dedupKey: `repdone:${lead.lead_id}:${Date.now()}`,
      }
    ).catch((err) => console.error("Rep-completed voice enqueue failed:", err.message));

    const remaining = await countRepQueue(ownerId, repId);
    return res.json({ completed: true, remaining });
  } catch (err) {
    console.error("CRM completeCurrentLead error:", err.message);
    return res.status(500).json({ error: "Failed to complete the lead." });
  }
}

// ===========================================================================
// OWNER / ADMIN — queue management
// ===========================================================================

/** Loads a brand's decrypted Twilio config or null (workspace-scoped by caller). */
async function getBrandTwilio(brandId) {
  const { rows } = await db.query(
    `SELECT account_sid, auth_token_encrypted, phone_number, connection_status
       FROM twilio_config WHERE brand_id = $1`,
    [brandId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    accountSid: row.account_sid,
    authToken: decrypt(row.auth_token_encrypted),
    phoneNumber: row.phone_number,
    status: row.connection_status,
  };
}

/** Confirms a lead belongs to the caller's workspace; returns it or null. */
async function getOwnedLeadRow(ownerId, leadId) {
  const { rows } = await db.query(
    `SELECT l.* FROM leads l
       JOIN brands b ON b.brand_id = l.brand_id
      WHERE l.lead_id = $1 AND b.user_id = $2`,
    [leadId, ownerId]
  );
  return rows[0] || null;
}

/**
 * GET /api/crm/queue  (owner/admin)
 * The full working queue for the workspace with rep attribution. Phone numbers
 * are shown in FULL here — only reps see masked numbers.
 */
async function listQueue(req, res) {
  const ownerId = req.user.userId;
  try {
    const { rows } = await db.query(
      `SELECT l.lead_id, l.lead_name, l.email, l.phone, l.temperature,
              l.conversion_status, l.queue_state, l.queue_priority,
              l.assigned_at, l.worked_at, l.created_at,
              l.assigned_rep_user_id, u.email AS rep_email
         FROM leads l
         JOIN brands b ON b.brand_id = l.brand_id
         LEFT JOIN users u ON u.user_id = l.assigned_rep_user_id
        WHERE b.user_id = $1 AND l.queue_state = ANY($2::text[])
        ORDER BY l.queue_state ASC,
                 l.queue_priority ASC NULLS LAST,
                 l.created_at ASC`,
      [ownerId, QUEUE_ACTIVE_STATES]
    );
    return res.json({
      queue: rows.map((l) => ({
        leadId: l.lead_id,
        name: l.lead_name || null,
        email: l.email || null,
        phone: l.phone || null,
        temperature: l.temperature,
        conversionStatus: l.conversion_status,
        queueState: l.queue_state,
        queuePriority: l.queue_priority,
        assignedAt: l.assigned_at,
        assignedRepUserId: l.assigned_rep_user_id,
        assignedRepEmail: l.rep_email || null,
        createdAt: l.created_at,
      })),
    });
  } catch (err) {
    console.error("CRM listQueue error:", err.message);
    return res.status(500).json({ error: "Failed to load the queue." });
  }
}

/**
 * POST /api/crm/queue/assign  (owner/admin)
 * Adds a lead to the working queue, optionally targeted to a specific rep. A
 * lead already being worked can't be silently reassigned (must be removed first).
 */
async function assignToQueue(req, res) {
  const ownerId = req.user.userId;
  const leadId = String(req.body.leadId || "").trim();
  const repUserId = req.body.repUserId ? String(req.body.repUserId).trim() : null;
  if (!leadId) {
    return res.status(400).json({ error: "A leadId is required." });
  }
  try {
    const lead = await getOwnedLeadRow(ownerId, leadId);
    if (!lead) return res.status(404).json({ error: "Lead not found." });
    if (lead.queue_state === "assigned") {
      return res.status(409).json({
        error: "This lead is already being worked. Remove it first to reassign.",
      });
    }

    // If targeting a rep, verify they're an active sales rep in this workspace.
    if (repUserId) {
      const ok = await db.query(
        `SELECT 1 FROM team_members
          WHERE account_owner_user_id = $1 AND invited_user_id = $2
            AND status = 'active' AND role = 'sales_rep'`,
        [ownerId, repUserId]
      );
      if (!ok.rows.length) {
        return res
          .status(400)
          .json({ error: "That team member isn't an active sales rep." });
      }
    }

    const { rows } = await db.query(
      `UPDATE leads
          SET queue_state = 'queued',
              assigned_rep_user_id = $2,
              assigned_at = NULL
        WHERE lead_id = $1
        RETURNING lead_id, queue_state`,
      [leadId, repUserId]
    );
    await logRepActivity(leadId, "queued", {
      byUserId: actingUserId(req),
      byEmail: req.user.email || null,
      targetRepUserId: repUserId || undefined,
    });
    return res.json({ leadId: rows[0].lead_id, queueState: rows[0].queue_state });
  } catch (err) {
    console.error("CRM assignToQueue error:", err.message);
    return res.status(500).json({ error: "Failed to add the lead to the queue." });
  }
}

/**
 * POST /api/crm/queue/priority  (owner/admin)
 * Sets a manual priority (lower = sooner) on a queued lead. Null clears it.
 */
async function setPriority(req, res) {
  const ownerId = req.user.userId;
  const leadId = String(req.body.leadId || "").trim();
  let priority = req.body.priority;
  if (!leadId) return res.status(400).json({ error: "A leadId is required." });
  if (priority === undefined || priority === null || priority === "") {
    priority = null;
  } else {
    priority = parseInt(priority, 10);
    if (Number.isNaN(priority)) {
      return res.status(400).json({ error: "Priority must be a number." });
    }
  }
  try {
    const { rows } = await db.query(
      `UPDATE leads SET queue_priority = $3
         FROM brands b
        WHERE leads.brand_id = b.brand_id AND b.user_id = $1
          AND leads.lead_id = $2
        RETURNING leads.lead_id, leads.queue_priority`,
      [ownerId, leadId, priority]
    );
    if (!rows.length) return res.status(404).json({ error: "Lead not found." });
    return res.json({
      leadId: rows[0].lead_id,
      queuePriority: rows[0].queue_priority,
    });
  } catch (err) {
    console.error("CRM setPriority error:", err.message);
    return res.status(500).json({ error: "Failed to update priority." });
  }
}

/**
 * POST /api/crm/queue/remove  (owner/admin)
 * Pulls a lead out of the working queue (back to 'unassigned'), clearing any rep
 * assignment. Does not delete the lead or its history.
 */
async function removeFromQueue(req, res) {
  const ownerId = req.user.userId;
  const leadId = String(req.body.leadId || "").trim();
  if (!leadId) return res.status(400).json({ error: "A leadId is required." });
  try {
    const { rows } = await db.query(
      `UPDATE leads
          SET queue_state = 'unassigned',
              assigned_rep_user_id = NULL,
              assigned_at = NULL,
              queue_priority = NULL
         FROM brands b
        WHERE leads.brand_id = b.brand_id AND b.user_id = $1
          AND leads.lead_id = $2
        RETURNING leads.lead_id`,
      [ownerId, leadId]
    );
    if (!rows.length) return res.status(404).json({ error: "Lead not found." });
    await logRepActivity(leadId, "removed_from_queue", {
      byUserId: actingUserId(req),
      byEmail: req.user.email || null,
    });
    return res.json({ leadId: rows[0].lead_id, queueState: "unassigned" });
  } catch (err) {
    console.error("CRM removeFromQueue error:", err.message);
    return res.status(500).json({ error: "Failed to remove the lead." });
  }
}

/**
 * GET /api/crm/queue/overview  (owner/admin — Pulse dept)
 * Per-rep queue distribution + throughput so managers can see who's carrying
 * what and how much has been worked today.
 */
async function queueOverview(req, res) {
  const ownerId = req.user.userId;
  try {
    const reps = await db.query(
      `SELECT tm.invited_user_id AS rep_user_id, u.email AS rep_email, tm.status
         FROM team_members tm
         JOIN users u ON u.user_id = tm.invited_user_id
        WHERE tm.account_owner_user_id = $1 AND tm.role = 'sales_rep'
          AND tm.status <> 'removed'
        ORDER BY u.email ASC`,
      [ownerId]
    );

    const stats = await db.query(
      `SELECT l.assigned_rep_user_id AS rep_user_id,
              COUNT(*) FILTER (WHERE l.queue_state = 'assigned')::int AS in_progress,
              COUNT(*) FILTER (
                WHERE l.queue_state = 'completed'
                  AND l.worked_at >= date_trunc('day', NOW())
              )::int AS completed_today,
              COUNT(*) FILTER (
                WHERE l.queue_state = 'completed'
                  AND l.worked_at >= NOW() - INTERVAL '7 days'
              )::int AS completed_week
         FROM leads l
         JOIN brands b ON b.brand_id = l.brand_id
        WHERE b.user_id = $1 AND l.assigned_rep_user_id IS NOT NULL
        GROUP BY l.assigned_rep_user_id`,
      [ownerId]
    );
    const statMap = new Map(stats.rows.map((r) => [r.rep_user_id, r]));

    const pool = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE l.queue_state = 'queued' AND l.assigned_rep_user_id IS NULL)::int AS unassigned_queued,
         COUNT(*) FILTER (WHERE l.queue_state = 'queued')::int AS total_queued
       FROM leads l JOIN brands b ON b.brand_id = l.brand_id
      WHERE b.user_id = $1`,
      [ownerId]
    );

    return res.json({
      reps: reps.rows.map((r) => {
        const s = statMap.get(r.rep_user_id) || {};
        return {
          repUserId: r.rep_user_id,
          repEmail: r.rep_email,
          status: r.status,
          inProgress: s.in_progress || 0,
          completedToday: s.completed_today || 0,
          completedWeek: s.completed_week || 0,
        };
      }),
      pool: {
        unassignedQueued: pool.rows[0].unassigned_queued,
        totalQueued: pool.rows[0].total_queued,
      },
    });
  } catch (err) {
    console.error("CRM queueOverview error:", err.message);
    return res.status(500).json({ error: "Failed to load the queue overview." });
  }
}

// ===========================================================================
// OWNER / ADMIN — accountability log & call monitoring
// ===========================================================================

/**
 * GET /api/crm/leads/:leadId/log  (owner/admin)
 * The full accountability timeline for one lead: every CRM interaction plus
 * every call (with the agent who made it). Full contact info visible.
 */
async function leadLog(req, res) {
  const ownerId = req.user.userId;
  const { leadId } = req.params;
  try {
    const lead = await getOwnedLeadRow(ownerId, leadId);
    if (!lead) return res.status(404).json({ error: "Lead not found." });

    const interactions = await db.query(
      `SELECT interaction_id, interaction_type, interaction_details, occurred_at
         FROM crm_interactions
        WHERE lead_id = $1
        ORDER BY occurred_at ASC`,
      [leadId]
    );
    const calls = await db.query(
      `SELECT call_id, direction, status, outcome, duration_seconds,
              agent_user_id, agent_name, recording_url, recording_duration,
              lead_temperature, created_at
         FROM calls
        WHERE lead_id = $1
        ORDER BY created_at ASC`,
      [leadId]
    );

    return res.json({
      lead: {
        leadId: lead.lead_id,
        name: lead.lead_name || null,
        email: lead.email || null,
        phone: lead.phone || null,
        temperature: lead.temperature,
        conversionStatus: lead.conversion_status,
        queueState: lead.queue_state,
      },
      interactions: interactions.rows,
      calls: calls.rows.map((c) => ({
        callId: c.call_id,
        direction: c.direction,
        status: c.status,
        outcome: c.outcome,
        durationSeconds: c.duration_seconds,
        agentUserId: c.agent_user_id,
        agentName: c.agent_name,
        hasRecording: Boolean(c.recording_url),
        recordingDuration: c.recording_duration,
        leadTemperature: c.lead_temperature,
        createdAt: c.created_at,
      })),
    });
  } catch (err) {
    console.error("CRM leadLog error:", err.message);
    return res.status(500).json({ error: "Failed to load the lead log." });
  }
}

/**
 * GET /api/crm/calls/today  (owner/admin — Sentinel dept)
 * Every call placed across the workspace today, newest first, with the agent
 * who made it and whether a recording is available for review.
 */
async function callsToday(req, res) {
  const ownerId = req.user.userId;
  try {
    const { rows } = await db.query(
      `SELECT c.call_id, c.direction, c.status, c.outcome, c.duration_seconds,
              c.agent_user_id, c.agent_name, c.recording_url,
              c.recording_duration, c.lead_temperature, c.created_at,
              c.lead_id, l.lead_name
         FROM calls c
         JOIN brands b ON b.brand_id = c.brand_id
         LEFT JOIN leads l ON l.lead_id = c.lead_id
        WHERE b.user_id = $1
          AND c.created_at >= date_trunc('day', NOW())
        ORDER BY c.created_at DESC`,
      [ownerId]
    );
    return res.json({
      calls: rows.map((c) => ({
        callId: c.call_id,
        direction: c.direction,
        status: c.status,
        outcome: c.outcome,
        durationSeconds: c.duration_seconds,
        agentUserId: c.agent_user_id,
        agentName: c.agent_name,
        hasRecording: Boolean(c.recording_url),
        recordingDuration: c.recording_duration,
        leadTemperature: c.lead_temperature,
        leadId: c.lead_id,
        leadName: c.lead_name || null,
        createdAt: c.created_at,
      })),
    });
  } catch (err) {
    console.error("CRM callsToday error:", err.message);
    return res.status(500).json({ error: "Failed to load today's calls." });
  }
}

/**
 * GET /api/crm/recording/:callId/audio  (owner/admin)
 * Streams a call recording for review. Twilio recording media requires HTTP
 * basic auth (accountSid:authToken), so we proxy it server-side using the
 * brand's decrypted credentials rather than ever exposing them to the client.
 */
async function streamRecording(req, res) {
  const ownerId = req.user.userId;
  const { callId } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT c.recording_url, c.brand_id
         FROM calls c
         JOIN brands b ON b.brand_id = c.brand_id
        WHERE c.call_id = $1 AND b.user_id = $2`,
      [callId, ownerId]
    );
    const call = rows[0];
    if (!call || !call.recording_url) {
      return res.status(404).json({ error: "Recording not found." });
    }
    const cfg = await getBrandTwilio(call.brand_id);
    if (!cfg) {
      return res.status(400).json({ error: "Phone provider not configured." });
    }

    const mediaUrl = call.recording_url.endsWith(".mp3")
      ? call.recording_url
      : `${call.recording_url}.mp3`;
    const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString(
      "base64"
    );
    const upstream = await fetch(mediaUrl, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!upstream.ok || !upstream.body) {
      return res
        .status(502)
        .json({ error: "Could not fetch the recording from the provider." });
    }
    res.setHeader("Content-Type", "audio/mpeg");
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.end(buf);
  } catch (err) {
    console.error("CRM streamRecording error:", err.message);
    return res.status(500).json({ error: "Failed to load the recording." });
  }
}

// ===========================================================================
// Twilio webhooks — NO auth (Twilio calls these directly). Authenticity is
// enforced with the brand's auth token + X-Twilio-Signature.
// ===========================================================================

/** Loads a call + its brand's auth token for webhook verification. */
async function getCallForWebhook(callId) {
  const { rows } = await db.query(
    `SELECT c.call_id, c.brand_id, c.lead_id,
            tc.account_sid, tc.auth_token_encrypted, tc.phone_number
       FROM calls c
       LEFT JOIN twilio_config tc ON tc.brand_id = c.brand_id
      WHERE c.call_id = $1`,
    [callId]
  );
  return rows[0] || null;
}

/**
 * POST /api/crm/bridge/:callId
 * Fired when the REP answers. Returns TwiML that dials the lead and records the
 * conversation (dual-channel), pointing the recording callback back at us.
 */
async function bridgeCall(req, res) {
  const { callId } = req.params;
  const VoiceResponse = twilioLib.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  try {
    const call = await getCallForWebhook(callId);
    if (!call || !call.auth_token_encrypted) {
      twiml.say("This call could not be connected. Goodbye.");
      twiml.hangup();
      return res.type("text/xml").send(twiml.toString());
    }
    const authToken = decrypt(call.auth_token_encrypted);
    const baseUrl = getPublicBaseUrl(req);
    if (!validateTwilioRequest(req, authToken, `${baseUrl}/api/crm/bridge/${callId}`)) {
      twiml.say("We could not verify this call. Goodbye.");
      twiml.hangup();
      return res.status(403).type("text/xml").send(twiml.toString());
    }

    const leadRes = await db.query("SELECT phone FROM leads WHERE lead_id = $1", [
      call.lead_id,
    ]);
    const leadPhone = leadRes.rows[0] && leadRes.rows[0].phone;
    if (!leadPhone) {
      twiml.say("The lead has no number on file. Goodbye.");
      twiml.hangup();
      return res.type("text/xml").send(twiml.toString());
    }

    twiml.say("Connecting you to your lead now.");
    const dial = twiml.dial({
      callerId: call.phone_number,
      record: "record-from-answer-dual",
      recordingStatusCallback: `${baseUrl}/api/crm/recording/${callId}`,
      recordingStatusCallbackMethod: "POST",
      recordingStatusCallbackEvent: "completed",
    });
    dial.number(leadPhone);
    return res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("CRM bridgeCall error:", err.message);
    twiml.say("Sorry, we could not connect the call. Goodbye.");
    twiml.hangup();
    return res.type("text/xml").send(twiml.toString());
  }
}

/**
 * POST /api/crm/recording/:callId
 * Twilio's recording-status callback. Persists the recording URL/SID/duration
 * so owners/admins can play it back. Always returns 200.
 */
async function recordingCallback(req, res) {
  const { callId } = req.params;
  try {
    const call = await getCallForWebhook(callId);
    if (!call) return res.status(200).send("");
    if (call.auth_token_encrypted) {
      const authToken = decrypt(call.auth_token_encrypted);
      const baseUrl = getPublicBaseUrl(req);
      if (
        !validateTwilioRequest(req, authToken, `${baseUrl}/api/crm/recording/${callId}`)
      ) {
        return res.status(403).send("");
      }
    }
    const recordingUrl = req.body.RecordingUrl;
    const recordingSid = req.body.RecordingSid;
    const recordingDuration = parseInt(req.body.RecordingDuration, 10) || 0;
    if (recordingUrl) {
      await db.query(
        `UPDATE calls
            SET recording_url = $1, recording_sid = $2, recording_duration = $3
          WHERE call_id = $4`,
        [recordingUrl, recordingSid || null, recordingDuration, callId]
      );
    }
    return res.status(200).send("");
  } catch (err) {
    console.error("CRM recordingCallback error:", err.message);
    return res.status(200).send("");
  }
}

/**
 * POST /api/crm/callstatus/:callId
 * Twilio's call-status callback for the rep leg. Records the final status +
 * duration for accountability. Always returns 200.
 */
async function callStatusCallback(req, res) {
  const { callId } = req.params;
  try {
    const call = await getCallForWebhook(callId);
    if (!call) return res.status(200).send("");
    if (call.auth_token_encrypted) {
      const authToken = decrypt(call.auth_token_encrypted);
      const baseUrl = getPublicBaseUrl(req);
      if (
        !validateTwilioRequest(req, authToken, `${baseUrl}/api/crm/callstatus/${callId}`)
      ) {
        return res.status(403).send("");
      }
    }
    const callStatus = req.body.CallStatus;
    const duration = parseInt(req.body.CallDuration, 10) || 0;
    const finalStatus = callStatus === "completed" ? "completed" : "failed";
    const outcome =
      callStatus === "completed" ? "contacted" : callStatus || "failed";
    await db.query(
      `UPDATE calls
          SET status = $1, duration_seconds = $2,
              outcome = COALESCE(outcome, $3)
        WHERE call_id = $4`,
      [finalStatus, duration, outcome, callId]
    );
    return res.status(200).send("");
  } catch (err) {
    console.error("CRM callStatusCallback error:", err.message);
    return res.status(200).send("");
  }
}

module.exports = {
  // rep
  getCurrentLead,
  callCurrentLead,
  completeCurrentLead,
  // owner/admin queue
  listQueue,
  assignToQueue,
  setPriority,
  removeFromQueue,
  queueOverview,
  // owner/admin monitoring
  leadLog,
  callsToday,
  streamRecording,
  // twilio webhooks
  bridgeCall,
  recordingCallback,
  callStatusCallback,
};
