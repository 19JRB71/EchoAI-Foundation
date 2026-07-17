/**
 * Sage V2 Phase 3 — lead outcome capture helpers (SAGE_V2_PHASE3_ARCHITECTURE.md).
 *
 * `leads.outcome` is the MEASUREMENT record; `leads.conversion_status` remains
 * the operational pipeline state. Nothing here ever drives behavior from
 * `outcome`, and nothing back-propagates outcome edits into conversion_status.
 *
 * Honesty rules enforced at this chokepoint:
 * - deal_value_cents is NEVER estimated or defaulted — NULL until a human
 *   supplies it ("won, value pending" is a first-class state).
 * - Every write is flag-gated (SAGE_V2_OUTCOME_CAPTURE); flag off = no writes,
 *   byte-identical legacy behavior.
 */

const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");

const OUTCOMES = ["won", "lost", "no_show", "unqualified"];
const OUTCOME_SOURCES = ["owner", "voice", "crm", "autonomous", "assumed_from_appointment"];
const TOUCHES = ["chatbot", "sms", "email", "phone", "manual", "voice"];

async function captureEnabled() {
  try {
    return await getSwitch("SAGE_V2_OUTCOME_CAPTURE");
  } catch (err) {
    console.error("leadOutcome: flag read failed:", err.message);
    return false; // fail dark — never write on uncertainty
  }
}

/**
 * Record an outcome on a lead. Overwrites are allowed (the owner is the
 * authority on their own outcome record). Returns the updated row or null
 * when the lead does not exist.
 */
async function recordOutcome(leadId, { outcome, reason, dealValueCents, source }) {
  if (!OUTCOMES.includes(outcome)) throw new Error(`Invalid outcome: ${outcome}`);
  if (!OUTCOME_SOURCES.includes(source)) throw new Error(`Invalid outcome source: ${source}`);
  let value = null;
  if (dealValueCents !== undefined && dealValueCents !== null && dealValueCents !== "") {
    const n = Number(dealValueCents);
    if (!Number.isInteger(n) || n < 0) throw new Error("dealValueCents must be a non-negative integer");
    value = n;
  }
  const r = await db.query(
    `UPDATE leads
     SET outcome = $2, outcome_reason = $3, deal_value_cents = $4,
         outcome_at = NOW(), outcome_source = $5, updated_at = NOW()
     WHERE lead_id = $1
     RETURNING lead_id, brand_id, outcome, outcome_reason, deal_value_cents,
               outcome_at, outcome_source`,
    [leadId, outcome, reason || null, value, source],
  );
  return r.rows[0] || null;
}

/**
 * One-way sync: an operational convert also records outcome='won' — but only
 * when no outcome exists yet (never clobbers an owner-entered record) and only
 * with the flag on. Best-effort: failures are logged, never thrown, so the
 * legacy convert path can't be broken by the measurement layer.
 */
async function markWonFromConvert(leadId, source, convertingTouch) {
  try {
    if (!(await captureEnabled())) return false;
    const touch = TOUCHES.includes(convertingTouch) ? convertingTouch : null;
    const r = await db.query(
      `UPDATE leads
       SET outcome = 'won', outcome_at = NOW(), outcome_source = $2,
           converting_touch = COALESCE(converting_touch, $3), updated_at = NOW()
       WHERE lead_id = $1 AND outcome IS NULL
       RETURNING lead_id`,
      [leadId, source, touch],
    );
    return r.rows.length > 0;
  } catch (err) {
    console.error("leadOutcome: won-sync failed:", err.message);
    return false;
  }
}

/**
 * Attribution: stamp the lead's first touch once (creation channel), only when
 * the caller genuinely knows it. Best-effort and flag-gated; never throws.
 */
async function setFirstTouch(leadId, touch) {
  try {
    if (!TOUCHES.includes(touch)) return false;
    if (!(await captureEnabled())) return false;
    const r = await db.query(
      `UPDATE leads SET first_touch = $2 WHERE lead_id = $1 AND first_touch IS NULL RETURNING lead_id`,
      [leadId, touch],
    );
    return r.rows.length > 0;
  } catch (err) {
    console.error("leadOutcome: first-touch stamp failed:", err.message);
    return false;
  }
}

/**
 * Attribution: link a lead to the campaign that genuinely produced it. Only
 * called by code paths that KNOW the campaign (never inferred retroactively).
 */
async function setCampaign(leadId, campaignId) {
  try {
    if (!campaignId) return false;
    if (!(await captureEnabled())) return false;
    const r = await db.query(
      `UPDATE leads SET campaign_id = $2 WHERE lead_id = $1 AND campaign_id IS NULL RETURNING lead_id`,
      [leadId, campaignId],
    );
    return r.rows.length > 0;
  } catch (err) {
    console.error("leadOutcome: campaign stamp failed:", err.message);
    return false;
  }
}

/**
 * Coverage math for a brand (SAGE_V2_ARCHITECTURE.md §6 honesty rule).
 * Deterministic, no AI. Excludes nothing — every lead counts in the
 * denominator. Value-less wins are reported separately, never hidden.
 */
async function coverageForBrand(brandId) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(outcome)::int AS with_outcome,
            COUNT(*) FILTER (WHERE outcome = 'won')::int AS won,
            COUNT(*) FILTER (WHERE outcome = 'won' AND deal_value_cents IS NULL)::int AS won_value_missing,
            COALESCE(SUM(deal_value_cents) FILTER (WHERE outcome = 'won'), 0)::bigint AS won_value_cents
     FROM leads WHERE brand_id = $1`,
    [brandId],
  );
  const row = r.rows[0];
  const total = row.total;
  const withOutcome = row.with_outcome;
  const pct = total > 0 ? Math.round((withOutcome / total) * 100) : 0;
  return {
    totalLeads: total,
    withOutcome,
    coveragePct: pct,
    sufficient: pct >= 30, // below 30% financial views show the prompt, not numbers
    won: row.won,
    wonValueMissing: row.won_value_missing,
    wonValueCents: Number(row.won_value_cents),
  };
}

// ---------------------------------------------------------------------------
// Voice/briefing outcome asks — ride the existing echo_open_questions
// machinery (asked in the morning briefing, answered via the Autopilot
// question endpoints). Context is tagged so the answer path can route it here.
// ---------------------------------------------------------------------------

const OUTCOME_QUESTION_TAG = "sage_outcome_ask:"; // context prefix + lead_id

/**
 * Queue outcome questions for stale hot leads that had an appointment in the
 * past but still have no recorded outcome ("did the Hendersons move
 * forward?"). Flag-gated, best-effort, dedup via the existing unique
 * (brand_id, question) constraint. Never throws.
 */
async function queueOutcomeQuestions(brandIds) {
  try {
    if (!Array.isArray(brandIds) || brandIds.length === 0) return 0;
    if (!(await captureEnabled())) return 0;
    const candidates = await db.query(
      `SELECT l.lead_id, l.brand_id, b.user_id,
              COALESCE(NULLIF(TRIM(l.lead_name), ''), 'that lead') AS display_name,
              MAX(a.start_time) AS last_appt
       FROM leads l
       JOIN brands b ON b.brand_id = l.brand_id
       JOIN appointments a ON a.lead_id = l.lead_id
       WHERE l.brand_id = ANY($1)
         AND l.outcome IS NULL
         AND l.temperature = 'hot'
         AND l.conversion_status IN ('new', 'in_progress')
         AND a.status = 'scheduled'
         AND a.end_time < NOW() - INTERVAL '2 days'
         AND l.updated_at < NOW() - INTERVAL '2 days'
       GROUP BY l.lead_id, l.brand_id, b.user_id, l.lead_name
       ORDER BY MAX(a.start_time) DESC
       LIMIT 3`,
      [brandIds],
    );
    let queued = 0;
    for (const row of candidates.rows) {
      const question = `You met with ${row.display_name} a little while back — did they move forward? (won, lost, no-show, or not a fit — and the deal value if you have it)`;
      const r = await db.query(
        `INSERT INTO echo_open_questions (brand_id, user_id, question, context)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ON CONSTRAINT uq_echo_open_questions_brand_question DO NOTHING
         RETURNING question_id`,
        [row.brand_id, row.user_id, question, `${OUTCOME_QUESTION_TAG}${row.lead_id}`],
      );
      if (r.rows.length > 0) queued += 1;
    }
    return queued;
  } catch (err) {
    console.error("leadOutcome: queueing outcome questions failed:", err.message);
    return 0;
  }
}

/** Extract the lead id from an outcome-ask question's context tag, or null. */
function outcomeAskLeadId(context) {
  if (typeof context !== "string" || !context.startsWith(OUTCOME_QUESTION_TAG)) return null;
  const id = context.slice(OUTCOME_QUESTION_TAG.length).trim();
  return id || null;
}

/**
 * Parse the owner's spoken/typed answer to an outcome ask with Hermes.
 * FAIL CLOSED: any Hermes failure, unparseable reply, or ambiguous answer
 * returns null and nothing is written — the lead-card chips remain the
 * fallback. deal_value_cents is used ONLY when the owner explicitly stated a
 * number; never guessed.
 */
async function parseOutcomeAnswer(answer) {
  const { createCompletion, hermesConfigured } = require("../config/hermes");
  if (!hermesConfigured()) return null;
  const text = String(answer || "").trim();
  if (!text) return null;
  try {
    const raw = await createCompletion(
      {
        system: [
          "You classify a business owner's answer about whether a sales lead closed.",
          'Reply with ONLY a JSON object: {"outcome": <"won"|"lost"|"no_show"|"unqualified"|"unclear">,',
          ' "dealValueDollars": <number or null>, "reason": <short string or null>}.',
          "outcome=won only if they clearly closed/bought. lost = they went elsewhere or said no.",
          "no_show = the lead never showed up / went silent. unqualified = not a fit.",
          'Anything ambiguous → "unclear". dealValueDollars ONLY if the owner explicitly stated an amount — NEVER estimate.',
        ].join("\n"),
        messages: [{ role: "user", content: text.slice(0, 600) }],
        max_tokens: 120,
        temperature: 0,
      },
      { label: "Sage outcome parse", timeout: 6000, attempts: 1 },
    );
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const obj = JSON.parse(raw.slice(start, end + 1));
    if (!obj || !OUTCOMES.includes(obj.outcome)) return null; // "unclear" fails closed here
    let dealValueCents = null;
    if (typeof obj.dealValueDollars === "number" && Number.isFinite(obj.dealValueDollars) && obj.dealValueDollars >= 0) {
      dealValueCents = Math.round(obj.dealValueDollars * 100);
    }
    return {
      outcome: obj.outcome,
      reason: typeof obj.reason === "string" && obj.reason.trim() ? obj.reason.trim().slice(0, 500) : null,
      dealValueCents,
    };
  } catch (err) {
    console.error("leadOutcome: Hermes outcome parse failed (fail closed):", err.message);
    return null;
  }
}

/**
 * Handle an answered outcome-ask question: parse (fail closed) and record the
 * outcome with source 'voice'. Best-effort — never throws, never blocks the
 * answer flow. Returns true only when an outcome was actually recorded.
 */
async function applyOutcomeAnswer(context, answer) {
  try {
    if (!(await captureEnabled())) return false;
    const leadId = outcomeAskLeadId(context);
    if (!leadId) return false;
    const parsed = await parseOutcomeAnswer(answer);
    if (!parsed) return false; // fail closed — chips remain the fallback
    const r = await db.query(
      `UPDATE leads
       SET outcome = $2, outcome_reason = $3, deal_value_cents = $4,
           outcome_at = NOW(), outcome_source = 'voice', updated_at = NOW()
       WHERE lead_id = $1 AND outcome IS NULL
       RETURNING lead_id`,
      [leadId, parsed.outcome, parsed.reason, parsed.dealValueCents],
    );
    return r.rows.length > 0;
  } catch (err) {
    console.error("leadOutcome: applying outcome answer failed:", err.message);
    return false;
  }
}

module.exports = {
  OUTCOMES,
  OUTCOME_SOURCES,
  TOUCHES,
  OUTCOME_QUESTION_TAG,
  captureEnabled,
  recordOutcome,
  markWonFromConvert,
  setFirstTouch,
  setCampaign,
  coverageForBrand,
  queueOutcomeQuestions,
  outcomeAskLeadId,
  parseOutcomeAnswer,
  applyOutcomeAnswer,
};
