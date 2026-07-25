// ---------------------------------------------------------------------------
// Zorecho Conversational Core — READ-ONLY tool adapters (prototype).
//
// The ONLY data-access layer of the Conversational Core. Each adapter reuses
// the existing owner-scoped services/tables through clearly defined read-only
// queries — nothing here creates, sends, publishes, deletes, or modifies
// anything. All results are compact and sanitized (snippets, no full bodies).
// ---------------------------------------------------------------------------

const db = require("../config/db");

// ---------------------------------------------------------------------------
// Email (Echo Email Assistant, owner-scoped)
// ---------------------------------------------------------------------------

async function emailSummary({ userId }, args = {}) {
  const emailMonitor = require("./emailMonitor");
  const counts = await emailMonitor.inboxBriefingCounts(userId, 24);

  const params = [userId];
  let where = `m.user_id = $1`;
  const query = typeof args.query === "string" ? args.query.trim().slice(0, 120) : "";
  if (query) {
    params.push(`%${query}%`);
    where += ` AND (m.from_name ILIKE $2 OR m.from_address ILIKE $2 OR m.subject ILIKE $2)`;
  }
  const { rows } = await db.query(
    `SELECT m.from_name, m.from_address, m.subject, m.category, m.snippet,
            m.ai_summary, m.received_at
       FROM email_messages m
      WHERE ${where}
      ORDER BY m.received_at DESC
      LIMIT 10`,
    params,
  );
  return {
    source: "connected email accounts (real data)",
    query: query || null,
    counts,
    messages: rows.map((m) => ({
      from: m.from_name || m.from_address,
      subject: m.subject,
      category: m.category,
      summary: (m.ai_summary || m.snippet || "").slice(0, 200),
      receivedAt: m.received_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Calendar / appointments (brand-scoped, ownership enforced via join)
// ---------------------------------------------------------------------------

async function calendar({ userId, brandId }, args = {}) {
  if (!brandId) return { source: "appointments (real data)", appointments: [], note: "No business selected." };
  const { rows } = await db.query(
    `SELECT a.start_time, a.end_time, a.status, a.contact_name, a.source
       FROM appointments a
       JOIN brands b ON b.brand_id = a.brand_id AND b.user_id = $2
      WHERE a.brand_id = $1
        AND a.status = 'scheduled'
        AND a.start_time > NOW()
        AND a.start_time < NOW() + INTERVAL '14 days'
      ORDER BY a.start_time ASC
      LIMIT 15`,
    [brandId, userId],
  );
  return {
    source: "appointments (real data)",
    when: typeof args.when === "string" ? args.when.slice(0, 80) : null,
    appointments: rows.map((a) => ({
      startTime: a.start_time,
      endTime: a.end_time,
      with: a.contact_name || "(no name)",
      bookedVia: a.source,
    })),
  };
}

// ---------------------------------------------------------------------------
// Leads (brand-scoped, ownership enforced via join)
// ---------------------------------------------------------------------------

async function leads({ userId, brandId }) {
  if (!brandId) return { source: "leads (real data)", note: "No business selected." };
  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE l.created_at::date = CURRENT_DATE)::int AS today,
            COUNT(*) FILTER (WHERE l.created_at::date = CURRENT_DATE - 1)::int AS yesterday,
            COUNT(*) FILTER (WHERE l.created_at > NOW() - INTERVAL '7 days')::int AS this_week,
            COUNT(*) FILTER (WHERE l.conversion_status = 'new')::int AS awaiting_followup,
            COUNT(*) FILTER (WHERE l.temperature = 'hot')::int AS hot
       FROM leads l
       JOIN brands b ON b.brand_id = l.brand_id AND b.user_id = $2
      WHERE l.brand_id = $1`,
    [brandId, userId],
  );
  const { rows: needRows } = await db.query(
    `SELECT l.lead_name, l.temperature, l.conversion_status, l.created_at
       FROM leads l
       JOIN brands b ON b.brand_id = l.brand_id AND b.user_id = $2
      WHERE l.brand_id = $1 AND l.conversion_status = 'new'
      ORDER BY (l.temperature = 'hot') DESC, l.created_at DESC
      LIMIT 10`,
    [brandId, userId],
  );
  return {
    source: "leads (real data)",
    counts: countRows[0],
    needingFollowUp: needRows.map((l) => ({
      name: l.lead_name || "(no name)",
      temperature: l.temperature,
      status: l.conversion_status,
      createdAt: l.created_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Facebook post drafting context (READ brand voice only — never publishes)
// ---------------------------------------------------------------------------

async function fbDraft({ userId, brandId }, args = {}) {
  let brand = null;
  if (brandId) {
    const { rows } = await db.query(
      `SELECT brand_name, brand_personality, voice_description, target_audience
         FROM brands WHERE brand_id = $1 AND user_id = $2`,
      [brandId, userId],
    );
    brand = rows[0] || null;
  }
  return {
    source: brand ? "brand profile (real data)" : "no brand profile",
    draftOnly: true,
    instruction: typeof args.instruction === "string" ? args.instruction.slice(0, 500) : null,
    brandVoice: brand
      ? {
          name: brand.brand_name,
          personality: textish(brand.brand_personality),
          voice: textish(brand.voice_description),
          audience: textish(brand.target_audience),
        }
      : null,
  };
}

// Brand-discovery fields can be JSON objects — always coerce to text.
function textish(v) {
  if (v == null) return null;
  if (typeof v === "string") return v.slice(0, 400);
  try {
    return JSON.stringify(v).slice(0, 400);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TOOLS = {
  email_summary: emailSummary,
  calendar,
  leads,
  fb_draft: fbDraft,
};

function hasTool(intent) {
  return Object.prototype.hasOwnProperty.call(TOOLS, intent);
}

async function run(intent, ctx, args) {
  const fn = TOOLS[intent];
  if (!fn) throw new Error(`Unknown Conversational Core tool: ${intent}`);
  return fn(ctx, args);
}

module.exports = { hasTool, run, TOOLS };
