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
const { buildBriefingSystem } = require("../prompts/echoPersona");
const { computeSuggestions } = require("./echoSuggestions");
const { getMetric } = require("../config/goals");
const { computeBrandGoals, monthWindow } = require("./goalMetrics");
const { greetingFor } = require("./timeOfDay");

/**
 * Owner's REAL brand ids + names (the demo brand is excluded from briefings).
 * When `brandId` is given, the list is narrowed to that single brand — this is
 * the seam that scopes an entire briefing to the active brand (every downstream
 * query filters by these ids). A foreign/unknown brandId yields [] so a
 * brand-scoped briefing can never leak another user's data.
 */
async function ownerBrands(userId, brandId = null) {
  try {
    const r = brandId
      ? await db.query(
          "SELECT brand_id, brand_name FROM brands WHERE user_id = $1 AND is_demo = false AND brand_id = $2",
          [userId, brandId]
        )
      : await db.query(
          "SELECT brand_id, brand_name FROM brands WHERE user_id = $1 AND is_demo = false",
          [userId]
        );
    return r.rows;
  } catch {
    return [];
  }
}

/**
 * The single brand whose Sage intelligence a briefing may reference. Sage is
 * strictly brand-isolated: when the briefing is brand-scoped that brand wins;
 * account-wide briefings fall back to the owner's last active brand. Returns
 * null when no owned, non-demo active brand is known — the briefing then skips
 * the Sage note entirely rather than surface another brand's intelligence.
 */
async function sageBriefingBrandId(userId, brandId, brandIds) {
  if (brandId) return brandIds.includes(brandId) ? brandId : null;
  try {
    const r = await db.query(
      `SELECT u.last_active_brand_id AS brand_id
         FROM users u
         JOIN brands b ON b.brand_id = u.last_active_brand_id
                      AND b.user_id = u.user_id AND b.is_demo = false
        WHERE u.user_id = $1`,
      [userId]
    );
    return r.rows.length ? r.rows[0].brand_id : null;
  } catch {
    return null;
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
      data.autopilotPending ||
      data.competitorNote ||
      data.newSupporters ||
      (data.upcomingCampaignEvents && data.upcomingCampaignEvents.length) ||
      data.newPropertyLeads ||
      data.newListings ||
      (data.upcomingOpenHouses && data.upcomingOpenHouses.length) ||
      // Goal state alone is worth a briefing (e.g. a quiet day where a goal has
      // slipped behind pace or run far ahead is exactly what the owner needs).
      (data.goals &&
        Array.isArray(data.goals.perBusiness) &&
        data.goals.perBusiness.length) ||
      // Personal reminders/tasks alone are worth a spoken briefing.
      (data.remindersToday && data.remindersToday.length) ||
      (data.openTasks && data.openTasks.length)
  );
}

/**
 * Owner's personal reminders due today + open tasks (from Echo's personal
 * assistant). User-scoped, not brand-scoped — an owner with no brands yet still
 * hears their reminders. High/medium tasks are spoken daily; low priority only
 * on Mondays (weekly). Both degrade to empty on any error.
 */
async function personalAgenda(userId) {
  const isMonday = new Date().getDay() === 1;
  const [reminderRows, taskRows] = await Promise.all([
    safeRows(
      `SELECT reminder_text, due_at FROM echo_reminders
        WHERE user_id = $1 AND status IN ('scheduled','notifying')
          AND due_at::date <= CURRENT_DATE + INTERVAL '1 day'
        ORDER BY due_at ASC LIMIT 10`,
      [userId]
    ),
    safeRows(
      `SELECT task_text, priority, due_date FROM echo_tasks
        WHERE user_id = $1 AND status = 'open'
          AND (priority IN ('high','medium') OR $2)
        ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                 due_date ASC NULLS LAST, created_at ASC
        LIMIT 12`,
      [userId, isMonday]
    ),
  ]);
  return {
    remindersToday: reminderRows.map((r) => ({
      text: r.reminder_text,
      dueAt: r.due_at,
    })),
    openTasks: taskRows.map((t) => ({
      text: t.task_text,
      priority: t.priority,
      dueDate: t.due_date,
      overdue: Boolean(t.due_date && new Date(t.due_date) < new Date(new Date().toDateString())),
    })),
  };
}

/**
 * Gather the raw numbers/names for a morning briefing since `since`.
 */
async function gatherBriefingData(userId, since, brandId = null) {
  const brands = await ownerBrands(userId, brandId);
  const brandIds = brands.map((b) => b.brand_id);
  const fbConnected = await facebookConnected(userId);
  const agenda = await personalAgenda(userId);
  // Email Assistant inbox counts (last 24h of monitored mail). Fail-soft: a
  // missing table or monitor hiccup must never break the briefing.
  let emailCounts = null;
  try {
    const { inboxBriefingCounts } = require("./emailMonitor");
    const counts = await inboxBriefingCounts(userId, 24);
    if (counts.total > 0) emailCounts = counts;
  } catch (_) {
    emailCounts = null;
  }
  // The single most important unfinished guided setup, so Echo can gently
  // remind the owner. topIncompleteSetup never throws (returns null on error).
  const { topIncompleteSetup } = require("./setupStatus");
  const setupReminder = await topIncompleteSetup(userId);
  // Sage V2 P1 flying-blind nudge (SAGE_V2_CONTEXT flag, default off). One nag
  // at a time: only offered when there is no setup reminder. Never throws.
  const flyingBlindNudge = setupReminder
    ? null
    : await companyTruthNudge(brandId || brandIds[0] || null);
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
    autopilotPending: 0,
    competitorNote: null,
    sageNote: null,
    learningNote: null,
    openQuestion: null,
    facebookConnected: fbConnected,
    goals: null,
    newSupporters: 0,
    upcomingCampaignEvents: [],
    newPropertyLeads: 0,
    newListings: 0,
    upcomingOpenHouses: [],
    remindersToday: agenda.remindersToday,
    openTasks: agenda.openTasks,
    emailCounts,
    setupReminder,
  };
  if (brandIds.length === 0) return empty;

  const sinceParam = since ? new Date(since) : new Date(Date.now() - 24 * 3600 * 1000);
  // Sage intelligence is strictly brand-isolated: the briefing's Sage note only
  // ever references the ACTIVE brand (never a blend across the portfolio).
  const sageBrandId = await sageBriefingBrandId(userId, brandId, brandIds);

  const [
    newLeads,
    appts,
    followUps,
    campaigns,
    health,
    approvals,
    competitor,
    goalRows,
    sageFindings,
    supporterRows,
    campaignEventRows,
    propertyLeadRows,
    newListingRows,
    openHouseRows,
    autopilotRows,
  ] = await Promise.all([
      safeRows(
        `SELECT l.lead_name, l.temperature, l.created_at, b.brand_name
           FROM leads l JOIN brands b ON b.brand_id = l.brand_id
          WHERE l.brand_id = ANY($1) AND l.created_at > $2
          ORDER BY l.created_at DESC LIMIT 25`,
        [brandIds, sinceParam]
      ),
      safeRows(
        `SELECT a.title, a.contact_name, a.start_time, a.description, a.location, b.brand_name
           FROM appointments a JOIN brands b ON b.brand_id = a.brand_id
          WHERE a.brand_id = ANY($1) AND a.status = 'scheduled'
            AND a.start_time::date = CURRENT_DATE
          ORDER BY a.start_time ASC`,
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
        `SELECT c.campaign_name, c.status, c.cost_per_lead, c.conversion_rate, b.brand_name
           FROM campaigns c JOIN brands b ON b.brand_id = c.brand_id
          WHERE c.brand_id = ANY($1) AND c.status = 'active'
          ORDER BY c.updated_at DESC LIMIT 10`,
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
      // Latest daily snapshot per active goal (per business, for the briefing).
      safeRows(
        `SELECT DISTINCT ON (g.goal_id)
                g.goal_id, g.brand_id, g.metric_key, g.label,
                b.brand_name, s.percent_to_goal
           FROM brand_goals g
           JOIN goal_snapshots s ON s.goal_id = g.goal_id
           JOIN brands b ON b.brand_id = g.brand_id
          WHERE g.brand_id = ANY($1) AND g.status = 'active'
          ORDER BY g.goal_id, s.snapshot_date DESC`,
        [brandIds]
      ),
      // Sage's most recent industry findings for the ACTIVE brand only (urgent
      // first). Sage never mixes intelligence between brands: without a known
      // active brand the briefing simply skips the Sage note.
      sageBrandId
        ? safeRows(
            `SELECT f.summary, f.why_it_matters, f.urgent, b.brand_name
               FROM sage_intelligence_feed f JOIN brands b ON b.brand_id = f.brand_id
              WHERE f.brand_id = $1 AND f.dismissed_at IS NULL AND f.created_at > $2
              ORDER BY f.urgent DESC, f.created_at DESC LIMIT 5`,
            [sageBrandId, sinceParam]
          )
        : Promise.resolve([]),
      // Political campaigns: new supporters since the last briefing.
      safeRows(
        `SELECT COUNT(*)::int AS n
           FROM supporters
          WHERE brand_id = ANY($1) AND created_at > $2`,
        [brandIds, sinceParam]
      ),
      // Political campaigns: the next few upcoming campaign events.
      safeRows(
        `SELECT e.event_name, e.event_date, e.location, b.brand_name
           FROM campaign_events e JOIN brands b ON b.brand_id = e.brand_id
          WHERE e.brand_id = ANY($1) AND e.event_date >= CURRENT_DATE
          ORDER BY e.event_date ASC LIMIT 3`,
        [brandIds]
      ),
      // Real-estate brands: new buyer/seller leads since the last briefing.
      safeRows(
        `SELECT COUNT(*)::int AS n
           FROM property_leads
          WHERE brand_id = ANY($1) AND created_at > $2`,
        [brandIds, sinceParam]
      ),
      // Real-estate brands: new listings added since the last briefing.
      safeRows(
        `SELECT COUNT(*)::int AS n
           FROM property_listings
          WHERE brand_id = ANY($1) AND created_at > $2`,
        [brandIds, sinceParam]
      ),
      // Real-estate brands: the next few upcoming open houses.
      safeRows(
        `SELECT oh.address, oh.event_date, oh.start_time, b.brand_name
           FROM open_houses oh JOIN brands b ON b.brand_id = oh.brand_id
          WHERE oh.brand_id = ANY($1) AND oh.event_date >= CURRENT_DATE
          ORDER BY oh.event_date ASC LIMIT 3`,
        [brandIds]
      ),
      // Autopilot: drafted items in READY batches still waiting for the
      // owner's yes/no — the briefing surfaces them so nothing sits unreviewed.
      safeRows(
        `SELECT COUNT(*)::int AS n
           FROM autopilot_batch_items i
           JOIN autopilot_batches ab ON ab.batch_id = i.batch_id
          WHERE ab.brand_id = ANY($1) AND ab.status = 'ready'
            AND i.status = 'pending'`,
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

  const goals = summarizeGoals(goalRows);

  // Learning Engine: what Echo learned this week, plus at most one open
  // question to ask the owner. Selecting a question marks it "asked" so the
  // same one isn't repeated every morning (re-asked only after 3 quiet days).
  let learningNote = null;
  let openQuestion = null;
  try {
    const learnedRows = await db.query(
      `SELECT COUNT(*)::int AS n FROM echo_learnings
        WHERE brand_id = ANY($1) AND active = TRUE
          AND updated_at > NOW() - INTERVAL '7 days'`,
      [brandIds]
    );
    const n = learnedRows.rows[0] ? learnedRows.rows[0].n : 0;
    if (n > 0) {
      learningNote = `I picked up ${n} new thing${n === 1 ? "" : "s"} about your preferences this week from your yes-and-no calls — my drafts already reflect ${n === 1 ? "it" : "them"}.`;
    }
    const q = await db.query(
      `UPDATE echo_open_questions SET status = 'asked', asked_at = NOW()
        WHERE question_id = (
          SELECT question_id FROM echo_open_questions
           WHERE brand_id = ANY($1)
             AND (status = 'pending'
                  OR (status = 'asked' AND asked_at < NOW() - INTERVAL '3 days'))
           ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, created_at
           LIMIT 1
           FOR UPDATE SKIP LOCKED)
        RETURNING question`,
      [brandIds]
    );
    if (q.rows[0]) openQuestion = q.rows[0].question;
  } catch (err) {
    console.error("Briefing learning lookup failed:", err.message);
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
    autopilotPending: autopilotRows[0] ? autopilotRows[0].n : 0,
    competitorNote:
      competitor[0] && competitor[0].intelligence_report
        ? summarizeCompetitor(competitor[0].intelligence_report)
        : null,
    sageNote: summarizeSageFindings(sageFindings),
    learningNote,
    openQuestion,
    facebookConnected: fbConnected,
    goals,
    newSupporters: supporterRows[0] ? supporterRows[0].n : 0,
    upcomingCampaignEvents: campaignEventRows,
    newPropertyLeads: propertyLeadRows[0] ? propertyLeadRows[0].n : 0,
    newListings: newListingRows[0] ? newListingRows[0].n : 0,
    upcomingOpenHouses: openHouseRows,
    remindersToday: agenda.remindersToday,
    openTasks: agenda.openTasks,
    emailCounts,
    setupReminder,
    flyingBlindNudge,
  };
}

/**
 * Sage V2 P1 (SAGE_V2_CONTEXT flag, default off): Echo's one-line nudge when
 * the active brand has no approved Company Truth, so the AI team is working
 * without vetted business facts. DRAFT copy from config/briefingCopy.js.
 * Fail-soft: any error means no nudge — never breaks the briefing.
 */
async function companyTruthNudge(brandId) {
  try {
    if (!brandId) return null;
    const { getSwitch } = require("../config/aiControls");
    if (!(await getSwitch("SAGE_V2_CONTEXT"))) return null;
    const { rows } = await db.query(
      "SELECT 1 FROM company_truth_reports WHERE brand_id = $1 AND status = 'approved' LIMIT 1",
      [brandId]
    );
    if (rows.length) return null;
    const { FLYING_BLIND_COPY } = require("../config/briefingCopy");
    return FLYING_BLIND_COPY.echoNudge;
  } catch (_e) {
    return null;
  }
}

/**
 * Turn Sage's recent findings into one short briefing line. Prefers the most
 * urgent finding; otherwise the freshest one. Returns null with no findings.
 */
function summarizeSageFindings(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return null;
  const pick = list.find((r) => r.urgent) || list[0];
  if (!pick || !pick.summary) return null;
  const prefix = pick.urgent ? "urgent — " : "";
  return `${prefix}${String(pick.summary).trim()}`;
}

/**
 * Roll up the latest goal snapshots into a briefing-friendly summary. Returns an
 * overall achievement score and on-track count, PLUS a per-business breakdown so
 * the briefing can speak to each brand: goals behind pace (at risk), goals
 * already achieved, and goals running far ahead (a cue to celebrate + scale).
 * No-data goals (null percent) are excluded. Returns null with no measurable goals.
 */
function summarizeGoals(goalRows) {
  const rows = Array.isArray(goalRows) ? goalRows : [];
  if (rows.length === 0) return null;

  const perBrand = new Map();
  let sum = 0;
  let counted = 0;
  let onTrack = 0;
  const atRiskAll = [];

  for (const r of rows) {
    const pct = r.percent_to_goal == null ? null : Number(r.percent_to_goal);
    if (pct == null || !Number.isFinite(pct)) continue;
    const clamped = Math.max(0, Math.min(100, pct));
    counted += 1;
    sum += clamped;

    const meta = getMetric(r.metric_key);
    const label = r.label || (meta ? meta.label : r.metric_key);

    const bid = r.brand_id;
    if (!perBrand.has(bid)) {
      perBrand.set(bid, {
        brandId: bid,
        brandName: r.brand_name || "your business",
        pctSum: 0,
        count: 0,
        atRisk: [],
        achieved: [],
        farAhead: [],
      });
    }
    const b = perBrand.get(bid);
    b.pctSum += clamped;
    b.count += 1;

    if (pct >= 90) onTrack += 1;
    if (pct >= 130) b.farAhead.push(label);
    else if (pct >= 100) b.achieved.push(label);
    else if (pct < 90) {
      b.atRisk.push(label);
      atRiskAll.push(label);
    }
  }
  if (counted === 0) return null;

  const perBusiness = [...perBrand.values()].map((b) => ({
    brandId: b.brandId,
    brandName: b.brandName,
    score: Math.round(b.pctSum / b.count),
    atRisk: b.atRisk.slice(0, 3),
    achieved: b.achieved.slice(0, 3),
    farAhead: b.farAhead.slice(0, 3),
  }));

  return {
    score: Math.round(sum / counted),
    total: counted,
    onTrack,
    atRisk: atRiskAll.slice(0, 3),
    perBusiness,
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

/** Normalize a jsonb list (of strings or objects) into short display strings. */
function normalizeList(val) {
  let arr = val;
  if (typeof val === "string") {
    try {
      arr = JSON.parse(val);
    } catch {
      return [String(val).slice(0, 200)];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object") {
        return x.recommendation || x.opportunity || x.title || x.text || x.summary || x.trend || null;
      }
      return null;
    })
    .filter(Boolean)
    .map((s) => String(s).slice(0, 200));
}

/**
 * Gather a week's worth of cross-business numbers for the weekly strategy
 * briefing, and derive deterministic top opportunities/risks from the real data
 * (shared by both the AI prompt and the template fallback). Same defensive
 * pattern as gatherBriefingData: every source degrades to zero, never throws.
 */
async function gatherWeeklyData(userId, brandId = null) {
  const brands = await ownerBrands(userId, brandId);
  const brandIds = brands.map((b) => b.brand_id);
  const fbConnected = await facebookConnected(userId);
  const base = {
    brands,
    facebookConnected: fbConnected,
    periodDays: 7,
    newLeadsCount: 0,
    newLeadsPrevCount: 0,
    leadDeltaPct: null,
    hotLeads: 0,
    leadsByBrand: [],
    appointmentsCompleted: 0,
    appointmentsUpcoming: 0,
    followUpsCompleted: 0,
    campaigns: [],
    bestCampaign: null,
    worstCampaign: null,
    sentinelFixes: 0,
    pendingApprovals: 0,
    competitorNote: null,
    sageNote: null,
    intelligence: { recommendations: [], trends: [] },
    opportunities: [],
    risks: [],
    suggestions: [],
    goals: null,
  };
  if (brandIds.length === 0) return { ...base, isEmpty: true };

  // Complete per-brand goal progress for the weekly briefing (best-effort: a
  // failure for one brand never aborts the rest of the briefing).
  const win = monthWindow();
  const perBrandGoals = [];
  for (const b of brands) {
    try {
      const { goals } = await computeBrandGoals(b.brand_id, win);
      perBrandGoals.push({ brandId: b.brand_id, brandName: b.brand_name, goals });
    } catch (err) {
      console.error(`Weekly goal summary failed for brand ${b.brand_id}:`, err.message);
    }
  }
  const goalsSummary = summarizeWeeklyGoals(perBrandGoals, win);

  const now = Date.now();
  const weekAgo = new Date(now - 7 * 24 * 3600 * 1000);
  const twoWeeksAgo = new Date(now - 14 * 24 * 3600 * 1000);
  // Sage intelligence is strictly brand-isolated — the weekly Sage note only
  // ever references the ACTIVE brand.
  const sageBrandId = await sageBriefingBrandId(userId, brandId, brandIds);

  const [
    leadsThisWeek,
    leadsPrevWeek,
    apptsDone,
    apptsUpcoming,
    followUps,
    campaignRows,
    health,
    approvals,
    competitor,
    intel,
    sageFindings,
  ] = await Promise.all([
    safeRows(
      `SELECT l.temperature, b.brand_name
         FROM leads l JOIN brands b ON b.brand_id = l.brand_id
        WHERE l.brand_id = ANY($1) AND l.created_at > $2`,
      [brandIds, weekAgo]
    ),
    safeRows(
      `SELECT COUNT(*)::int AS n FROM leads
        WHERE brand_id = ANY($1) AND created_at > $2 AND created_at <= $3`,
      [brandIds, twoWeeksAgo, weekAgo]
    ),
    safeRows(
      `SELECT COUNT(*)::int AS n FROM appointments
        WHERE brand_id = ANY($1) AND status = 'completed' AND start_time > $2`,
      [brandIds, weekAgo]
    ),
    safeRows(
      `SELECT COUNT(*)::int AS n FROM appointments
        WHERE brand_id = ANY($1) AND status = 'scheduled' AND start_time >= NOW()`,
      [brandIds]
    ),
    safeRows(
      `SELECT COUNT(*)::int AS n
         FROM sequence_touchpoints t
         JOIN follow_up_sequences s ON s.sequence_id = t.sequence_id
        WHERE s.brand_id = ANY($1) AND t.status = 'sent' AND t.scheduled_at > $2`,
      [brandIds, weekAgo]
    ),
    safeRows(
      `SELECT c.campaign_name, c.cost_per_lead, c.conversion_rate, b.brand_name
         FROM campaigns c JOIN brands b ON b.brand_id = c.brand_id
        WHERE c.brand_id = ANY($1) AND c.status = 'active'
        ORDER BY c.updated_at DESC LIMIT 25`,
      [brandIds]
    ),
    safeRows(
      `SELECT COALESCE(SUM(
          CASE WHEN jsonb_typeof(issues_auto_fixed) = 'array'
               THEN jsonb_array_length(issues_auto_fixed) ELSE 0 END), 0)::int AS n
         FROM health_checks
        WHERE brand_id = ANY($1) AND check_time > $2`,
      [brandIds, weekAgo]
    ),
    safeRows(
      `SELECT COUNT(*)::int AS n FROM echo_companion
        WHERE user_id = $1 AND pending_action IS NOT NULL`,
      [userId]
    ),
    safeRows(
      `SELECT intelligence_report FROM competitor_intelligence
        WHERE brand_id = ANY($1) ORDER BY created_at DESC LIMIT 1`,
      [brandIds]
    ),
    safeRows(
      `SELECT recommendations, trends_identified FROM customer_intelligence
        WHERE brand_id = ANY($1) ORDER BY created_at DESC LIMIT 3`,
      [brandIds]
    ),
    sageBrandId
      ? safeRows(
          `SELECT f.summary, f.why_it_matters, f.urgent, b.brand_name
             FROM sage_intelligence_feed f JOIN brands b ON b.brand_id = f.brand_id
            WHERE f.brand_id = $1 AND f.dismissed_at IS NULL AND f.created_at > $2
            ORDER BY f.urgent DESC, f.created_at DESC LIMIT 5`,
          [sageBrandId, weekAgo]
        )
      : Promise.resolve([]),
  ]);

  const newLeadsCount = leadsThisWeek.length;
  const hotLeads = leadsThisWeek.filter((l) => l.temperature === "hot").length;
  const newLeadsPrevCount = leadsPrevWeek[0] ? leadsPrevWeek[0].n : 0;
  const leadDeltaPct =
    newLeadsPrevCount > 0
      ? Math.round(((newLeadsCount - newLeadsPrevCount) / newLeadsPrevCount) * 100)
      : null;

  const byBrand = {};
  for (const l of leadsThisWeek) {
    const b = l.brand_name || "your business";
    byBrand[b] = (byBrand[b] || 0) + 1;
  }
  const leadsByBrand = Object.keys(byBrand).map((name) => ({ brand: name, count: byBrand[name] }));

  const campaigns = campaignRows.map((c) => ({
    name: c.campaign_name,
    brand: c.brand_name,
    costPerLead: c.cost_per_lead != null ? Number(c.cost_per_lead) : null,
    conversionRate: c.conversion_rate != null ? Number(c.conversion_rate) : null,
  }));
  const withCpl = campaigns.filter((c) => Number.isFinite(c.costPerLead) && c.costPerLead > 0);
  let bestCampaign = null;
  let worstCampaign = null;
  if (withCpl.length) {
    bestCampaign = withCpl.reduce((a, b) => (b.costPerLead < a.costPerLead ? b : a));
    worstCampaign = withCpl.reduce((a, b) => (b.costPerLead > a.costPerLead ? b : a));
  }

  const recommendations = [];
  const trends = [];
  for (const row of intel) {
    for (const r of normalizeList(row.recommendations)) recommendations.push(r);
    for (const t of normalizeList(row.trends_identified)) trends.push(t);
  }

  const sentinelFixes = health[0] ? health[0].n : 0;
  const pendingApprovals = approvals[0] ? approvals[0].n : 0;
  const competitorNote =
    competitor[0] && competitor[0].intelligence_report
      ? summarizeCompetitor(competitor[0].intelligence_report)
      : null;
  const sageNote = summarizeSageFindings(sageFindings);

  const multi = brands.length > 1;
  const tag = (brand) => (multi && brand ? ` at ${brand}` : "");

  // Proactive channel/tool suggestions from gaps in the owner's OWN account
  // (deduped 30d-shown / 90d-declined). Read-only here; delivery records them.
  let suggestions = [];
  try {
    suggestions = await computeSuggestions(userId, brandIds);
  } catch (_e) {
    suggestions = [];
  }

  const opportunities = [];
  if (hotLeads > 0) {
    opportunities.push(
      `${hotLeads} hot lead${hotLeads === 1 ? "" : "s"} ${hotLeads === 1 ? "is" : "are"} ready to close now`
    );
  }
  if (bestCampaign) {
    opportunities.push(
      `Put more budget behind ${bestCampaign.name}${tag(bestCampaign.brand)}, your lowest cost per lead at $${bestCampaign.costPerLead.toFixed(2)}`
    );
  }
  if (leadDeltaPct != null && leadDeltaPct >= 15) {
    opportunities.push(`Lead flow is up ${leadDeltaPct}% over last week, worth pressing on`);
  }
  for (const rec of recommendations) {
    if (opportunities.length >= 3) break;
    opportunities.push(rec);
  }

  const risks = [];
  if (campaigns.length === 0) {
    risks.push("No campaigns are running right now, so the lead pipeline will dry up without them");
  }
  if (worstCampaign && (!bestCampaign || worstCampaign.name !== bestCampaign.name)) {
    risks.push(
      `${worstCampaign.name}${tag(worstCampaign.brand)} has your highest cost per lead at $${worstCampaign.costPerLead.toFixed(2)}, worth reviewing`
    );
  }
  if (leadDeltaPct != null && leadDeltaPct <= -15) {
    risks.push(`Lead flow dropped ${Math.abs(leadDeltaPct)}% from last week, worth digging into`);
  }
  if (competitorNote) {
    risks.push(`Scout flagged competitor movement: ${competitorNote}`);
  }
  if (sageNote) {
    risks.push(`Sage flagged an industry development: ${sageNote}`);
  }
  if (pendingApprovals > 0) {
    risks.push(
      `${pendingApprovals} item${pendingApprovals === 1 ? " is" : "s are"} still waiting for your approval`
    );
  }

  return {
    brands,
    facebookConnected: fbConnected,
    periodDays: 7,
    newLeadsCount,
    newLeadsPrevCount,
    leadDeltaPct,
    hotLeads,
    leadsByBrand,
    appointmentsCompleted: apptsDone[0] ? apptsDone[0].n : 0,
    appointmentsUpcoming: apptsUpcoming[0] ? apptsUpcoming[0].n : 0,
    followUpsCompleted: followUps[0] ? followUps[0].n : 0,
    campaigns,
    bestCampaign,
    worstCampaign,
    sentinelFixes,
    pendingApprovals,
    competitorNote,
    sageNote,
    intelligence: { recommendations, trends },
    opportunities,
    risks,
    suggestions,
    goals: goalsSummary,
  };
}

/** Deterministic template narration for the morning briefing (AI fallback). */
function templateMorning(firstName, data, part = "morning") {
  const name = firstName || "there";

  // A brand-new / empty account still gets a warm welcome and a concrete next
  // step — the briefing must never be silent just because there's no data yet.
  if (!hasActivity(data)) {
    const parts = [
      `${greetingFor(part, name)} Your marketing department is ready and standing by.`,
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
    appendSetupReminder(parts, data);
    appendFlyingBlindNudge(parts, data);
    parts.push("Your team is here and ready to work for you.");
    return parts.join(" ");
  }

  const parts = [`${greetingFor(part, name)} Here's your briefing.`];

  if (data.goals) {
    const g = data.goals;
    const per = Array.isArray(g.perBusiness) ? g.perBusiness : [];
    const multi = (data.brands || []).length > 1;
    if (per.length) {
      // Each brand can carry good news AND risk at once, so report both — never
      // let a far-ahead goal silence a behind-pace one on the same business.
      for (const b of per.slice(0, 3)) {
        const who = multi ? `For ${b.brandName}, ` : "";
        const wins = [];
        if (b.farAhead.length) {
          wins.push(
            `you're far ahead on ${joinList(b.farAhead)} — well above target; ` +
              "great time to double down and scale it"
          );
        }
        if (b.achieved.length) {
          wins.push(`you've already hit ${joinList(b.achieved)}`);
        }
        if (wins.length) {
          parts.push(`${who}${wins.join(", and ")}.`);
        }
        if (b.atRisk.length) {
          const lead = wins.length
            ? multi
              ? `That said for ${b.brandName}, `
              : "That said, "
            : who;
          parts.push(
            `${lead}${joinList(b.atRisk)} ${b.atRisk.length === 1 ? "is" : "are"} ` +
              `behind pace at ${b.score}% overall.`
          );
        } else if (!wins.length) {
          parts.push(`${who}goals are on track at ${b.score}% overall.`);
        }
      }
    } else {
      parts.push(`Your goals are on track at ${g.score}% overall.`);
    }
  }

  if (data.newLeads.length) {
    const hot = data.hotLeads ? ` — ${data.hotLeads} of them hot` : "";
    parts.push(`You have ${data.newLeads.length} new lead${data.newLeads.length === 1 ? "" : "s"}${hot}.`);
    const breakdown = leadBrandBreakdown(data);
    if (breakdown) parts.push(breakdown);
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
      `You have ${data.todaysAppointments.length} appointment${data.todaysAppointments.length === 1 ? "" : "s"} today, starting${who}${brandTag(first, data)} at ${formatTime(first.start_time)}.`
    );
  }
  if (data.newSupporters) {
    parts.push(`${data.newSupporters} new supporter${data.newSupporters === 1 ? "" : "s"} joined your campaign.`);
  }
  if (Array.isArray(data.upcomingCampaignEvents) && data.upcomingCampaignEvents.length) {
    const ev = data.upcomingCampaignEvents[0];
    parts.push(
      `Your next campaign event is ${ev.event_name}${ev.location ? ` at ${ev.location}` : ""} on ${new Date(ev.event_date).toLocaleDateString("en-US", { month: "long", day: "numeric" })}.`
    );
  }
  if (data.newPropertyLeads) {
    parts.push(
      `${data.newPropertyLeads} new property lead${data.newPropertyLeads === 1 ? "" : "s"} came in — buyers and sellers are waiting in your Property CRM.`
    );
  }
  if (data.newListings) {
    parts.push(
      `${data.newListings} new listing${data.newListings === 1 ? " was" : "s were"} added, and Atlas is preparing promotion ads for ${data.newListings === 1 ? "it" : "them"}.`
    );
  }
  if (Array.isArray(data.upcomingOpenHouses) && data.upcomingOpenHouses.length) {
    const oh = data.upcomingOpenHouses[0];
    parts.push(
      `Your next open house is at ${oh.address} on ${new Date(oh.event_date).toLocaleDateString("en-US", { month: "long", day: "numeric" })}${oh.start_time ? ` at ${oh.start_time}` : ""}.`
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
  if (data.sageNote) {
    parts.push(`Sage learned something about your industry: ${data.sageNote}`);
  }
  if (data.pendingApprovals) {
    parts.push(`${data.pendingApprovals} item${data.pendingApprovals === 1 ? " is" : "s are"} waiting for your approval.`);
  }
  if (data.autopilotPending) {
    parts.push(
      `Your week's content is drafted and waiting: ${data.autopilotPending} item${data.autopilotPending === 1 ? "" : "s"} in the Autopilot batch need${data.autopilotPending === 1 ? "s" : ""} your yes or no. Just say "let's review the batch" whenever you're ready.`
    );
  }
  if (data.learningNote) {
    parts.push(data.learningNote);
  }
  if (data.openQuestion) {
    parts.push(`Quick question so I can draft better for you: ${data.openQuestion}`);
  }
  appendAgenda(parts, data);
  appendSetupReminder(parts, data);
  appendFlyingBlindNudge(parts, data);
  if (data.openTasks && data.openTasks.length) {
    parts.push("Is there anything on your task list you've already taken care of that I should mark off?");
  } else {
    parts.push("Are you ready to get started, or would you like me to go into more detail on anything?");
  }
  return parts.join(" ");
}

/**
 * Gentle nudge about the single most important unfinished guided setup — one
 * sentence, grounded in real account state (computed by utils/setupStatus).
 */
function appendSetupReminder(parts, data) {
  const r = data.setupReminder;
  if (!r || !r.label) return;
  const next = r.nextStep ? ` — the next step is to ${r.nextStep.toLowerCase()}` : "";
  // Name the brand when the owner has more than one, so a reminder about an
  // older brand can't be mistaken for the one they're currently working in.
  const multiBrand = Array.isArray(data.brands) && data.brands.length > 1;
  const forBrand = multiBrand && r.brandName ? ` for ${r.brandName}` : "";
  parts.push(
    `One more thing: your ${r.label.toLowerCase()} setup${forBrand} isn't finished yet${next}. The setup guide in that section will walk you through it.`
  );
}

/**
 * Sage V2 P1: speak the flying-blind nudge (already gated on flag + no approved
 * truth + no setup reminder in gatherBriefingData — one nag at a time).
 */
function appendFlyingBlindNudge(parts, data) {
  if (!data.flyingBlindNudge) return;
  parts.push(data.flyingBlindNudge);
}

/** Speak today's personal reminders + open tasks (shared by morning/closing). */
function appendAgenda(parts, data) {
  const reminders = data.remindersToday || [];
  if (reminders.length) {
    const first = reminders[0];
    parts.push(
      `You have ${reminders.length} reminder${reminders.length === 1 ? "" : "s"} today, starting with ${first.text} at ${formatTime(first.dueAt)}.`
    );
  }
  const ec = data.emailCounts;
  if (ec && ec.total > 0) {
    const bits = [];
    if (ec.urgent) bits.push(`${ec.urgent} urgent`);
    if (ec.important) bits.push(`${ec.important} important`);
    if (ec.contract) bits.push(`${ec.contract} with contract${ec.contract === 1 ? "" : "s"} to review`);
    if (ec.lead) bits.push(`${ec.lead} from potential customers`);
    if (ec.invoice || ec.payment) {
      bits.push(`${(ec.invoice || 0) + (ec.payment || 0)} about invoices or payments`);
    }
    const detail = bits.length ? ` — ${joinList(bits)}` : "";
    parts.push(
      `On email, ${ec.total} new message${ec.total === 1 ? "" : "s"} came in over the last day${detail}.`
    );
  }
  const tasks = data.openTasks || [];
  if (tasks.length) {
    const high = tasks.filter((t) => t.priority === "high");
    const overdue = tasks.filter((t) => t.overdue);
    const bits = [`${tasks.length} open task${tasks.length === 1 ? "" : "s"} on your list`];
    if (high.length) bits.push(`${high.length} high priority — ${joinList(high.slice(0, 3).map((t) => t.text))}`);
    if (overdue.length) bits.push(`${overdue.length} past due`);
    parts.push(`You have ${bits.join(", ")}.`);
  }
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
  if (data.openTasks && data.openTasks.length) {
    parts.push(
      `You still have ${data.openTasks.length} open task${data.openTasks.length === 1 ? "" : "s"} on your list. Did you get to any of them today that I should mark off?`
    );
  } else {
    parts.push("Rest up — I'll have your morning briefing ready tomorrow.");
  }
  return parts.join(" ");
}

/** Deterministic template narration for the on-demand status update (AI fallback). */
function templateStatus(firstName, data, part = null) {
  const name = firstName || "there";
  // Mid-conversation status updates carry no greeting; a login-time day update
  // (afternoon/evening/late) opens with the correct local-time greeting.
  const parts = part
    ? [`${greetingFor(part, name)} Here's where things stand right now.`]
    : [`Here's where things stand right now, ${name}.`];
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

function multiBrand(data) {
  return Boolean(data && data.brands && data.brands.length > 1);
}

/** ` at <brand>` when the owner runs multiple businesses (else empty). */
function brandTag(row, data) {
  return multiBrand(data) && row && row.brand_name ? ` at ${row.brand_name}` : "";
}

/** Per-business split of new leads, spoken only when >1 business is represented. */
function leadBrandBreakdown(data) {
  if (!multiBrand(data) || !data.newLeads || !data.newLeads.length) return "";
  const counts = {};
  for (const l of data.newLeads) {
    const b = l.brand_name || "your business";
    counts[b] = (counts[b] || 0) + 1;
  }
  const names = Object.keys(counts);
  if (names.length < 2) return "";
  return `That's ${names.map((n) => `${counts[n]} at ${n}`).join(", ")}.`;
}

function joinList(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function stripTrailing(s) {
  return String(s).trim().replace(/[.\s]+$/, "");
}

/** "First, X. Second, Y. Third, Z." for a short spoken ranked list. */
function numberedList(items) {
  const ord = ["First", "Second", "Third", "Fourth", "Fifth"];
  return items.map((it, i) => `${ord[i] || `${i + 1}.`}, ${stripTrailing(it)}.`).join(" ");
}

/**
 * Plain-English weekly status clause for ONE goal progress object, using the
 * pace concept the owner asked for: percent-to-goal vs percent of the month
 * elapsed. Cumulative goals get a pace read; 'latest' rate goals and cost goals
 * get an above/below-target read. Returns null for goals with no reading yet.
 */
function weeklyGoalClause(g, win = monthWindow()) {
  if (g.percentToGoal == null || !Number.isFinite(Number(g.percentToGoal))) return null;
  const pct = Math.round(Number(g.percentToGoal));
  const label = g.label;

  // Cost / "lower is better" goals: frame as % below/above target.
  if (g.direction === "decrease") {
    const target = Number(g.targetValue);
    const current = Number(g.currentValue);
    if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(current)) return null;
    if (current <= target) {
      const below = Math.round((1 - current / target) * 100);
      return below >= 1
        ? `your ${label} is running ${below}% below target, which is excellent`
        : `your ${label} is right on target`;
    }
    const above = Math.round((current / target - 1) * 100);
    return `your ${label} is running ${above}% above target, which needs attention`;
  }

  // Already met an increase goal.
  if (pct >= 100) {
    return `you've already hit your ${label} goal at ${pct}% of target`;
  }

  // Cumulative "increase" goals get the pace read (percent-to-goal vs elapsed).
  if (g.aggregation === "cumulative") {
    const remaining = Math.round(100 - (win.dayOfMonth / win.daysInMonth) * 100);
    const elapsed = 100 - remaining;
    const diff = pct - elapsed;
    let pace;
    if (diff >= 15) pace = "well ahead of pace";
    else if (diff >= 5) pace = "slightly ahead of pace";
    else if (diff > -5) pace = "right on pace";
    else if (diff > -15) pace = "slightly behind pace";
    else pace = "behind pace";
    return `you're ${pct}% of the way to your ${label} goal with ${remaining}% of the month remaining — ${pace}`;
  }

  // 'latest' rate goals (ROAS, CTR): simple share-of-target read.
  const tone = pct >= 90 ? "just under target" : "below target and needs attention";
  return `your ${label} is at ${pct}% of target, ${tone}`;
}

/**
 * Fold per-brand goal progress objects into a compact structure for the weekly
 * briefing: one clause per measurable goal, grouped by brand. Returns null when
 * no brand has any measurable goal (so the briefing simply omits the section).
 * `perBrand` = [{ brandId, brandName, goals: [progressObject...] }].
 */
function summarizeWeeklyGoals(perBrand, win = monthWindow()) {
  const perBusiness = [];
  for (const b of perBrand || []) {
    const clauses = [];
    for (const g of b.goals || []) {
      const clause = weeklyGoalClause(g, win);
      if (clause) clauses.push({ label: g.label, clause });
    }
    if (clauses.length) {
      perBusiness.push({ brandId: b.brandId, brandName: b.brandName, goals: clauses });
    }
  }
  return perBusiness.length ? { perBusiness } : null;
}

/** Capitalize the first letter of a clause so it reads as a standalone sentence. */
function capitalizeFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Render the complete per-brand, per-goal weekly progress section. Every measured
 * goal gets its own plain-English sentence so no goal is ever omitted.
 */
function renderWeeklyGoalSection(data) {
  if (!data.goals || !Array.isArray(data.goals.perBusiness) || !data.goals.perBusiness.length) {
    return [];
  }
  const multi = (data.brands || []).length > 1;
  const out = [];
  for (const b of data.goals.perBusiness) {
    const clauses = b.goals.map((g) => g.clause);
    if (!clauses.length) continue;
    const [first, ...rest] = clauses;
    const lead = multi ? `For ${b.brandName}, ` : "On your goals, ";
    out.push(`${lead}${first}.`);
    for (const c of rest) out.push(`${capitalizeFirst(c)}.`);
  }
  return out;
}

/** Deterministic template narration for the weekly strategy briefing (AI fallback). */
function templateWeekly(firstName, data, part = "morning") {
  const name = firstName || "there";
  const hasSubstance =
    data.newLeadsCount ||
    (data.campaigns && data.campaigns.length) ||
    data.appointmentsCompleted ||
    data.followUpsCompleted ||
    (data.opportunities && data.opportunities.length);

  // Every weekly briefing must carry a complete per-goal progress read.
  const goalSection = renderWeeklyGoalSection(data);

  if (data.isEmpty || (!hasSubstance && !goalSection.length)) {
    const parts = [`${greetingFor(part, name)} Here's your weekly strategy briefing.`];
    parts.push("It's been a quiet week — your AI marketing department is set up and ready to go.");
    if (!data.facebookConnected) {
      parts.push(
        "The single biggest move this week is connecting your Facebook account, so Atlas can start bringing in leads."
      );
    }
    parts.push("Want me to walk you through getting your first campaign live?");
    return parts.join(" ");
  }

  const parts = [`${greetingFor(part, name)} Here's your weekly strategy briefing.`];
  const syn = [];
  if (data.newLeadsCount) {
    syn.push(`${data.newLeadsCount} new lead${data.newLeadsCount === 1 ? "" : "s"} came in`);
  }
  if (data.appointmentsCompleted) {
    syn.push(`${data.appointmentsCompleted} appointment${data.appointmentsCompleted === 1 ? "" : "s"} happened`);
  }
  if (data.followUpsCompleted) {
    syn.push(`${data.followUpsCompleted} follow-up${data.followUpsCompleted === 1 ? "" : "s"} went out`);
  }
  if (data.sentinelFixes) {
    syn.push(`Sentinel fixed ${data.sentinelFixes} issue${data.sentinelFixes === 1 ? "" : "s"}`);
  }
  parts.push(syn.length ? `This week, ${joinList(syn)}.` : "This week was quiet on activity.");

  // Complete goal progress — every active brand, every goal, before opportunities.
  if (goalSection.length) {
    parts.push("Here's where your goals stand.");
    for (const line of goalSection) parts.push(line);
  }

  const opps = (data.opportunities || []).slice(0, 3);
  if (opps.length) {
    parts.push(
      `${opps.length === 1 ? "Your top opportunity" : "Your top opportunities"}: ${numberedList(opps)}`
    );
  }
  const risks = (data.risks || []).slice(0, 3);
  if (risks.length) {
    parts.push(`Keep an eye on: ${numberedList(risks)}`);
  }
  const suggestions = data.suggestions || [];
  if (suggestions.length) {
    const phrased = suggestions.map((s) => `${s.channel}, since ${s.reason}`);
    parts.push(
      `${suggestions.length === 1 ? "One channel worth adding" : "A couple of channels worth adding"}: ${numberedList(phrased)}`
    );
  }
  parts.push("Which one do you want to tackle first?");
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
 * @param {"morning"|"weekly"|"closing"|"status"} kind
 */
async function narrate(kind, firstName, data, opts = {}) {
  // Owner's local part of day ("morning"|"afternoon"|"evening"|"late") so the
  // spoken greeting is always right for THEIR clock. Optional: mid-conversation
  // status updates pass nothing and carry no greeting.
  const part = opts.partOfDay || null;
  const template =
    kind === "closing"
      ? templateClosing(firstName, data)
      : kind === "status"
        ? templateStatus(firstName, data, part)
        : kind === "weekly"
          ? templateWeekly(firstName, data, part || "morning")
          : templateMorning(firstName, data, part || "morning");

  if (!process.env.ANTHROPIC_API_KEY) {
    return { text: template, aiNarrated: false };
  }

  // Persona-composed system prompt: one consistent Echo voice for every kind.
  // `empty` only applies to the morning briefing; `multiBrand` drives the unified
  // cross-business synthesis in both morning and weekly briefings.
  const ctx = {
    empty: kind === "morning" && !hasActivity(data),
    multiBrand: Boolean(data.brands && data.brands.length > 1),
  };
  // The weekly strategy briefing is longer (synthesis + 3 opportunities + 3 risks).
  // A complete per-goal progress section can add several sentences, so scale the
  // budget by the number of goals being narrated (never omit a goal for length).
  let wordCap = kind === "weekly" ? 220 : 130;
  let maxTokens = kind === "weekly" ? 800 : 500;
  if (kind === "weekly" && data.goals && Array.isArray(data.goals.perBusiness)) {
    const goalCount = data.goals.perBusiness.reduce(
      (n, b) => n + (b.goals ? b.goals.length : 0),
      0
    );
    wordCap += Math.min(goalCount * 25, 300);
    maxTokens += Math.min(goalCount * 120, 1400);
  }
  // opts.knowledge is a personalization block (tone/priority guidance only — it
  // must NOT introduce spoken facts; see echoContext.formatKnowledge mode:speech).
  // Time-of-day guardrail: the greeting must match the owner's LOCAL clock.
  // "Good morning" outside the 5am–noon window is a hard error for Echo.
  const timeNote = part
    ? ` It is currently ${part === "late" ? "late at night" : `the ${part}`} for the owner. Open with the matching greeting (${
        part === "morning"
          ? '"Good morning"'
          : part === "afternoon"
            ? '"Good afternoon"'
            : part === "evening"
              ? '"Good evening"'
              : 'something like "Working late" or "Good evening"'
      }) and NEVER use a greeting for a different time of day.`
    : "";
  const system =
    buildBriefingSystem(kind, ctx, wordCap) + timeNote + (opts.knowledge ? "\n\n" + opts.knowledge : "");

  try {
    const resp = await createMessage(
      {
        model: MODEL,
        max_tokens: maxTokens,
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

module.exports = {
  gatherBriefingData,
  gatherWeeklyData,
  narrate,
  hasActivity,
  normalizeList,
  templateMorning,
  templateWeekly,
  templateClosing,
  templateStatus,
  weeklyGoalClause,
  summarizeWeeklyGoals,
};
