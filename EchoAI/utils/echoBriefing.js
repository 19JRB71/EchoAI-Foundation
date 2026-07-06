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

/** Owner's REAL brand ids + names (the demo brand is excluded from briefings). */
async function ownerBrands(userId) {
  try {
    const r = await db.query(
      "SELECT brand_id, brand_name FROM brands WHERE user_id = $1 AND is_demo = false",
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
async function gatherWeeklyData(userId) {
  const brands = await ownerBrands(userId);
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
    intelligence: { recommendations: [], trends: [] },
    opportunities: [],
    risks: [],
    suggestions: [],
  };
  if (brandIds.length === 0) return { ...base, isEmpty: true };

  const now = Date.now();
  const weekAgo = new Date(now - 7 * 24 * 3600 * 1000);
  const twoWeeksAgo = new Date(now - 14 * 24 * 3600 * 1000);

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

  const multi = brands.length > 1;
  const tag = (brand) => (multi && brand ? ` at ${brand}` : "");

  // Proactive channel/tool suggestions from gaps in the owner's OWN account
  // (deduped 30d-shown / 90d-declined). Read-only here; delivery records them.
  let suggestions = [];
  try {
    suggestions = await computeSuggestions(userId);
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
    intelligence: { recommendations, trends },
    opportunities,
    risks,
    suggestions,
  };
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

/** Deterministic template narration for the weekly strategy briefing (AI fallback). */
function templateWeekly(firstName, data) {
  const name = firstName || "there";
  const hasSubstance =
    data.newLeadsCount ||
    (data.campaigns && data.campaigns.length) ||
    data.appointmentsCompleted ||
    data.followUpsCompleted ||
    (data.opportunities && data.opportunities.length);

  if (data.isEmpty || !hasSubstance) {
    const parts = [`Good morning ${name}. Here's your weekly strategy briefing.`];
    parts.push("It's been a quiet week — your AI marketing department is set up and ready to go.");
    if (!data.facebookConnected) {
      parts.push(
        "The single biggest move this week is connecting your Facebook account, so Atlas can start bringing in leads."
      );
    }
    parts.push("Want me to walk you through getting your first campaign live?");
    return parts.join(" ");
  }

  const parts = [`Good morning ${name}. Here's your weekly strategy briefing.`];
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
  const template =
    kind === "closing"
      ? templateClosing(firstName, data)
      : kind === "status"
        ? templateStatus(firstName, data)
        : kind === "weekly"
          ? templateWeekly(firstName, data)
          : templateMorning(firstName, data);

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
  const wordCap = kind === "weekly" ? 220 : 130;
  const maxTokens = kind === "weekly" ? 800 : 500;
  // opts.knowledge is a personalization block (tone/priority guidance only — it
  // must NOT introduce spoken facts; see echoContext.formatKnowledge mode:speech).
  const system = buildBriefingSystem(kind, ctx, wordCap) + (opts.knowledge ? "\n\n" + opts.knowledge : "");

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
};
