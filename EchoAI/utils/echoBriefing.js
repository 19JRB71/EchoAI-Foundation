/**
 * Builds the spoken briefings for Echo:
 *  - the morning briefing ("everything since you were last here"),
 *  - the end-of-day closing summary,
 *  - the on-demand "Talk to Echo" status update.
 *
 * Data gathering is deterministic and defensive: every source is wrapped so a
 * missing table/column or an empty result degrades to zero rather than throwing.
 * The natural-sounding narration is produced by the AI; if the AI is unavailable
 * we fall back to a deterministic template built from the SAME real data — never
 * fabricated numbers. That is a deliberate deviation from the strict "AI → 502"
 * rule: a daily spoken convenience must not hard-fail on a transient AI hiccup,
 * and the fallback speaks only real, gathered figures.
 */
const db = require("../config/db");
const { createMessage, MODEL } = require("../config/anthropic");

/** Owner's brand ids + names. */
async function ownerBrands(userId) {
  try {
    const r = await db.query(
      "SELECT brand_id, brand_name FROM brands WHERE user_id = $1",
      [userId]
    );
    return r.rows;
  } catch {
    return [];
  }
}

async function safeRows(sql, params) {
  try {
    const r = await db.query(sql, params);
    return r.rows;
  } catch (err) {
    console.error("echoBriefing query skipped:", err.message);
    return [];
  }
}

/** Whether the owner has a connected Facebook integration (drives the nudge). */
async function facebookConnected(userId) {
  try {
    const r = await db.query(
      `SELECT 1 FROM api_integrations
        WHERE user_id = $1 AND platform = 'facebook'
          AND connection_status = 'connected'
        LIMIT 1`,
      [userId]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

/** True when the morning briefing has no real activity to report. */
function hasActivity(data) {
  return Boolean(
    (data.newLeads && data.newLeads.length) ||
      (data.todaysAppointments && data.todaysAppointments.length) ||
      data.followUpsCompleted ||
      (data.campaigns && data.campaigns.length) ||
      (data.sentinelFixes && data.sentinelFixes.length) ||
      data.pendingApprovals ||
      data.competitorNote
  );
}

/**
 * Gather the raw numbers/names for a morning briefing since `since`.
 */
async function gatherBriefingData(userId, since) {
  const brands = await ownerBrands(userId);
  const brandIds = brands.map((b) => b.brand_id);
  const fbConnected = await facebookConnected(userId);
  const empty = {
    brands,
    sinceISO: since ? new Date(since).toISOString() : null,
    newLeads: [],
    hotLeads: 0,
    todaysAppointments: [],
    followUpsCompleted: 0,
    campaigns: [],
    sentinelFixes: [],
    pendingApprovals: 0,
    competitorNote: null,
    facebookConnected: fbConnected,
  };
  if (brandIds.length === 0) return empty;

  const sinceParam = since ? new Date(since) : new Date(Date.now() - 24 * 3600 * 1000);

  const [newLeads, appts, followUps, campaigns, health, approvals, competitor] =
    await Promise.all([
      safeRows(
        `SELECT lead_name, temperature, created_at
           FROM leads
          WHERE brand_id = ANY($1) AND created_at > $2
          ORDER BY created_at DESC LIMIT 25`,
        [brandIds, sinceParam]
      ),
      safeRows(
        `SELECT title, contact_name, start_time, description, location
           FROM appointments
          WHERE brand_id = ANY($1) AND status = 'scheduled'
            AND start_time::date = CURRENT_DATE
          ORDER BY start_time ASC`,
        [brandIds]
      ),
      safeRows(
        `SELECT COUNT(*)::int AS n
           FROM sequence_touchpoints t
           JOIN follow_up_sequences s ON s.sequence_id = t.sequence_id
          WHERE s.brand_id = ANY($1) AND t.status = 'sent'
            AND t.scheduled_at > $2`,
        [brandIds, sinceParam]
      ),
      safeRows(
        `SELECT campaign_name, status, cost_per_lead, conversion_rate
           FROM campaigns
          WHERE brand_id = ANY($1) AND status = 'active'
          ORDER BY updated_at DESC LIMIT 10`,
        [brandIds]
      ),
      safeRows(
        `SELECT issues_auto_fixed
           FROM health_checks
          WHERE brand_id = ANY($1) AND check_time > $2
            AND jsonb_array_length(issues_auto_fixed) > 0
          ORDER BY check_time DESC LIMIT 20`,
        [brandIds, sinceParam]
      ),
      safeRows(
        `SELECT COUNT(*)::int AS n
           FROM echo_companion
          WHERE user_id = $1 AND pending_action IS NOT NULL`,
        [userId]
      ),
      safeRows(
        `SELECT intelligence_report
           FROM competitor_intelligence
          WHERE brand_id = ANY($1)
          ORDER BY created_at DESC LIMIT 1`,
        [brandIds]
      ),
    ]);

  const sentinelFixes = [];
  for (const row of health) {
    const list = Array.isArray(row.issues_auto_fixed) ? row.issues_auto_fixed : [];
    for (const item of list) {
      const label = typeof item === "string" ? item : item && (item.summary || item.title || item.issue);
      if (label) sentinelFixes.push(String(label));
    }
  }

  return {
    brands,
    sinceISO: sinceParam.toISOString(),
    newLeads,
    hotLeads: newLeads.filter((l) => l.temperature === "hot").length,
    todaysAppointments: appts,
    followUpsCompleted: followUps[0] ? followUps[0].n : 0,
    campaigns,
    sentinelFixes: sentinelFixes.slice(0, 5),
    pendingApprovals: approvals[0] ? approvals[0].n : 0,
    competitorNote:
      competitor[0] && competitor[0].intelligence_report
        ? summarizeCompetitor(competitor[0].intelligence_report)
        : null,
    facebookConnected: fbConnected,
  };
}

function summarizeCompetitor(report) {
  if (typeof report === "string") return report.slice(0, 160);
  if (report && typeof report === "object") {
    const s = report.summary || report.headline || report.overview;
    if (s) return String(s).slice(0, 160);
  }
  return null;
}

/** Deterministic template narration for the morning briefing (AI fallback). */
function templateMorning(firstName, data) {
  const name = firstName || "there";

  // A brand-new / empty account still gets a warm welcome and a concrete next
  // step — the briefing must never be silent just because there's no data yet.
  if (!hasActivity(data)) {
    const parts = [
      `Good morning ${name}. Your marketing department is ready and standing by.`,
    ];
    if (!data.facebookConnected) {
      parts.push(
        "Connect your Facebook account so Atlas can start bringing you leads."
      );
    } else {
      parts.push(
        "Your channels are connected and your agents are ready to start bringing in leads."
      );
    }
    parts.push("Your team is here and ready to work for you.");
    return parts.join(" ");
  }

  const parts = [`Good morning ${name}. Here's your briefing.`];

  if (data.newLeads.length) {
    const hot = data.hotLeads ? ` — ${data.hotLeads} of them hot` : "";
    parts.push(`You have ${data.newLeads.length} new lead${data.newLeads.length === 1 ? "" : "s"}${hot}.`);
  } else {
    parts.push("No new leads since you were last here.");
  }
  if (data.followUpsCompleted) {
    parts.push(`Pulse completed ${data.followUpsCompleted} follow-up${data.followUpsCompleted === 1 ? "" : "s"} for you.`);
  }
  if (data.todaysAppointments.length) {
    const first = data.todaysAppointments[0];
    const who = first.contact_name ? ` with ${first.contact_name}` : "";
    parts.push(
      `You have ${data.todaysAppointments.length} appointment${data.todaysAppointments.length === 1 ? "" : "s"} today, starting${who} at ${formatTime(first.start_time)}.`
    );
  }
  if (data.campaigns.length) {
    parts.push(`${data.campaigns.length} campaign${data.campaigns.length === 1 ? " is" : "s are"} running.`);
  }
  if (data.sentinelFixes.length) {
    parts.push(`Sentinel automatically fixed ${data.sentinelFixes.length} issue${data.sentinelFixes.length === 1 ? "" : "s"} overnight.`);
  }
  if (data.competitorNote) {
    parts.push(`Scout noted: ${data.competitorNote}`);
  }
  if (data.pendingApprovals) {
    parts.push(`${data.pendingApprovals} item${data.pendingApprovals === 1 ? " is" : "s are"} waiting for your approval.`);
  }
  parts.push("Are you ready to get started, or would you like me to go into more detail on anything?");
  return parts.join(" ");
}

/** Deterministic template narration for the closing summary (AI fallback). */
function templateClosing(firstName, data) {
  const name = firstName || "there";
  const parts = [`Good evening ${name}. Here's what your team accomplished today.`];
  if (data.newLeads.length) parts.push(`${data.newLeads.length} new lead${data.newLeads.length === 1 ? "" : "s"} came in.`);
  if (data.followUpsCompleted) parts.push(`${data.followUpsCompleted} follow-up${data.followUpsCompleted === 1 ? "" : "s"} went out.`);
  if (data.sentinelFixes.length) parts.push(`Sentinel resolved ${data.sentinelFixes.length} issue${data.sentinelFixes.length === 1 ? "" : "s"}.`);
  if (!data.newLeads.length && !data.followUpsCompleted && !data.sentinelFixes.length) {
    parts.push("A quiet day — no major activity to report.");
  }
  if (data.todaysAppointments.length) {
    parts.push(`Looking ahead, you have ${data.todaysAppointments.length} appointment${data.todaysAppointments.length === 1 ? "" : "s"} coming up.`);
  }
  parts.push("Rest up — I'll have your morning briefing ready tomorrow.");
  return parts.join(" ");
}

/** Deterministic template narration for the on-demand status update (AI fallback). */
function templateStatus(firstName, data) {
  const name = firstName || "there";
  const parts = [`Here's where things stand right now, ${name}.`];
  if (data.hotLeads) parts.push(`${data.hotLeads} hot lead${data.hotLeads === 1 ? " needs" : "s need"} attention.`);
  const upcoming = data.todaysAppointments.filter((a) => new Date(a.start_time) > new Date());
  if (upcoming.length) {
    const first = upcoming[0];
    const who = first.contact_name ? ` with ${first.contact_name}` : "";
    parts.push(`Your next appointment${who} is at ${formatTime(first.start_time)}.`);
  } else {
    parts.push("No more appointments on the calendar today.");
  }
  if (data.pendingApprovals) parts.push(`${data.pendingApprovals} item${data.pendingApprovals === 1 ? " is" : "s are"} waiting for your approval.`);
  if (data.newLeads.length) parts.push(`${data.newLeads.length} new lead${data.newLeads.length === 1 ? "" : "s"} today so far.`);
  if (parts.length === 2) parts.push("Everything looks calm — nothing urgent needs you right now.");
  return parts.join(" ");
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "soon";
  }
}

/**
 * Narrate the briefing with the AI for a natural, conversational feel. Falls back
 * to the deterministic template (same real data) if the AI call fails.
 * @param {"morning"|"closing"|"status"} kind
 */
async function narrate(kind, firstName, data, opts = {}) {
  const template =
    kind === "closing"
      ? templateClosing(firstName, data)
      : kind === "status"
        ? templateStatus(firstName, data)
        : templateMorning(firstName, data);

  if (!process.env.ANTHROPIC_API_KEY) {
    return { text: template, aiNarrated: false };
  }

  const morningEmpty = kind === "morning" && !hasActivity(data);
  const goal =
    kind === "closing"
      ? "an end-of-day closing summary of what the team accomplished and a preview of tomorrow"
      : kind === "status"
        ? "a short, current 'right now' status update: what's happening, what needs attention, what's coming up today"
        : morningEmpty
          ? "a short, warm welcome for an owner whose account has no activity yet: greet them by first name, reassure them their AI marketing department is ready and standing by, and — only if the data shows facebookConnected is false — encourage them to connect their Facebook account so the ads agent (Atlas) can start bringing in leads. Close warmly that their team is here and ready to work for them. Do NOT mention zero counts or that there is 'no' data"
          : "a personalized morning briefing of everything since the owner last logged in, ending by asking if they're ready to start or want more detail on anything";

  const system =
    "You are Echo, the owner's AI marketing assistant, speaking OUT LOUD to the business owner. " +
    "Write ONLY the words to be spoken — no headings, no markdown, no bullet points, no stage directions. " +
    "Warm, concise, natural spoken English. Use the owner's first name once near the start. " +
    "Use ONLY the facts in the provided data — never invent numbers, names, or events. " +
    `Produce ${goal}. Keep it under 130 words.`;

  try {
    const resp = await createMessage(
      {
        model: MODEL,
        max_tokens: 500,
        system,
        messages: [
          {
            role: "user",
            content: `Owner first name: ${firstName || "(unknown)"}\n\nData (JSON):\n${JSON.stringify(
              data
            )}\n\nSpeak the ${kind} briefing now.`,
          },
        ],
      },
      {
        label: `Echo ${kind} briefing`,
        timeout: opts.timeout || 60000,
        attempts: opts.attempts || undefined,
      }
    );
    const text = (resp.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    if (text) return { text, aiNarrated: true };
  } catch (err) {
    console.error(`Echo ${kind} narration failed, using template:`, err.message);
  }
  return { text: template, aiNarrated: false };
}

module.exports = { gatherBriefingData, narrate };
