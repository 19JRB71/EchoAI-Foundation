// Mission Control V2 — the single aggregation endpoint behind the redesigned
// Headquarters screen (approved ChatGPT concept, July 2026).
//
// PRESENTATION/aggregation layer only: read-only queries over the live tables
// every subsystem already writes. Nothing here is fabricated — a metric with no
// real data source returns null (the client reserves the space or shows an
// honest empty state). Every brand-scoped query is guarded by the ownership
// join in getBrand, mirroring agentsController.
//
// One round-trip returns everything the screen needs: KPI row with day-over-day
// deltas, the unified cross-agent activity feed, attention items, the Zorecho
// Score (real goals achievement) with its real snapshot history, today-at-a-
// glance counts, opportunities, tier-aware Sage insights, system status, and
// the reorganized legacy Mission Control data (upcoming, geo, goal alerts,
// failed posts) so nothing valuable is lost.

const db = require("../config/db");
const { parseGeo, geoSummaryText } = require("../utils/geoTargeting");
const { userPartOfDay, greetingBare } = require("../utils/timeOfDay");
const { computeBrandGoals } = require("../utils/goalMetrics");
const { getUserTier } = require("../middleware/featureGate");
const { meetsTier } = require("../config/tiers");
const { computeRoi } = require("./roiController");
const agentsController = require("./agentsController");

// ---------------------------------------------------------------------------
// Safe query helpers (a status endpoint must degrade, never 500 on one table)
// ---------------------------------------------------------------------------
async function n(sql, params) {
  try {
    const r = await db.query(sql, params);
    return Number(r.rows[0] && r.rows[0].n) || 0;
  } catch (_e) {
    return 0;
  }
}
// Executive Command Panel workforce summary — real platform counts only.
// Without a brand context the counts are null (never a fabricated 0), so the
// client renders "—".
async function computeWorkforce(brandId, activeCampaigns) {
  if (!brandId) return { campaignsRunning: null, conversationsActive: null };
  const conversationsActive = await n(
    "SELECT COUNT(*)::int AS n FROM autonomous_conversations WHERE brand_id = $1 AND status IN ('active','awaiting_owner')",
    [brandId],
  );
  const campaigns = Number(activeCampaigns);
  return {
    campaignsRunning: Number.isFinite(campaigns) ? campaigns : null,
    conversationsActive,
  };
}

async function rows(sql, params) {
  try {
    const r = await db.query(sql, params);
    return r.rows;
  } catch (_e) {
    return [];
  }
}

async function getBrand(userId, brandId = null) {
  const r = brandId
    ? await rows(
        "SELECT brand_id, brand_name, geo_targeting FROM brands WHERE user_id = $1 AND brand_id = $2 LIMIT 1",
        [userId, brandId],
      )
    : await rows(
        "SELECT brand_id, brand_name, geo_targeting FROM brands WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1",
        [userId],
      );
  return r[0] || null;
}

// ---------------------------------------------------------------------------
// KPI counting. Each KPI is a real per-day count; "yesterday" gives the honest
// baseline for the delta. deltaPct is null when there is no baseline (never a
// fabricated percentage).
// ---------------------------------------------------------------------------
function delta(today, yesterday) {
  if (!Number.isFinite(today) || !Number.isFinite(yesterday) || yesterday <= 0) return null;
  return Math.round(((today - yesterday) / yesterday) * 100);
}

// day: 0 = today, 1 = yesterday (date bucketing in DB server time, matching the
// existing Mission Control "completedToday" convention).
async function dayCount(sql, bid, day) {
  const d = day === 0 ? "CURRENT_DATE" : "CURRENT_DATE - 1";
  return n(sql.replaceAll("__DAY__", d), [bid]);
}

const KPI_SQL = {
  postsPublished: "SELECT COUNT(*)::int AS n FROM social_posts WHERE brand_id = $1 AND published_time::date = __DAY__",
  leadsCaptured: "SELECT COUNT(*)::int AS n FROM leads WHERE brand_id = $1 AND created_at::date = __DAY__",
  callsAnswered: "SELECT COUNT(*)::int AS n FROM calls WHERE brand_id = $1 AND created_at::date = __DAY__",
  appointmentsBooked: "SELECT COUNT(*)::int AS n FROM appointments WHERE brand_id = $1 AND created_at::date = __DAY__ AND status NOT IN ('cancelled','canceled')",
  emailsSent: "SELECT COUNT(*)::int AS n FROM email_sends es JOIN email_campaigns ec ON ec.campaign_id = es.campaign_id WHERE ec.brand_id = $1 AND es.sent_at::date = __DAY__",
  smsSent: "SELECT COUNT(*)::int AS n FROM sms_messages WHERE brand_id = $1 AND direction = 'outbound' AND COALESCE(sent_at, created_at)::date = __DAY__",
  leadsFollowedUp: "SELECT COUNT(DISTINCT ci.lead_id)::int AS n FROM crm_interactions ci JOIN leads l ON l.lead_id = ci.lead_id WHERE l.brand_id = $1 AND ci.occurred_at::date = __DAY__",
  issuesFixed: "SELECT COALESCE(SUM(issues_auto_fixed),0)::int AS n FROM health_checks WHERE brand_id = $1 AND check_time::date = __DAY__",
  reviewsResponded: "SELECT COUNT(*)::int AS n FROM reviews WHERE brand_id = $1 AND response_status = 'responded' AND updated_at::date = __DAY__",
};

async function computeKpis(bid) {
  if (!bid) return [];
  const keys = Object.keys(KPI_SQL);
  const today = {};
  const yesterday = {};
  await Promise.all(
    keys.map(async (k) => {
      today[k] = await dayCount(KPI_SQL[k], bid, 0);
      yesterday[k] = await dayCount(KPI_SQL[k], bid, 1);
    }),
  );

  // "Tasks completed" = every real completed AI action today (same family of
  // sources as the legacy completedToday stat, widened to all action tables).
  const sum = (o) =>
    o.postsPublished + o.leadsCaptured + o.callsAnswered + o.appointmentsBooked +
    o.emailsSent + o.smsSent + o.issuesFixed + o.reviewsResponded;

  const t = { ...today, tasksCompleted: sum(today) };
  const y = { ...yesterday, tasksCompleted: sum(yesterday) };

  const kpi = (key, label) => ({
    key,
    label,
    period: "day",
    today: t[key],
    yesterday: y[key],
    deltaPct: delta(t[key], y[key]),
  });

  return [
    kpi("tasksCompleted", "Tasks Completed"),
    kpi("appointmentsBooked", "Appointments Booked"),
    kpi("callsAnswered", "Calls Answered"),
    kpi("leadsFollowedUp", "Leads Followed Up"),
  ];
}

// ---------------------------------------------------------------------------
// Zorecho Score — the real cross-goal achievement score (mean of clamped
// percent-to-goal across measurable active goals), exactly the number the
// existing Goals Overview reports. History comes from the real daily
// goal_snapshots the 05:45 scheduler already writes — no new table, no
// fabricated backfill: accounts without snapshots simply have a short line.
// ---------------------------------------------------------------------------
function letterGrade(score) {
  if (score == null) return null;
  if (score >= 97) return "A+";
  if (score >= 93) return "A";
  if (score >= 90) return "A-";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B-";
  if (score >= 77) return "C+";
  if (score >= 73) return "C";
  if (score >= 70) return "C-";
  if (score >= 60) return "D";
  return "F";
}
function scoreLabel(score) {
  if (score == null) return null;
  if (score >= 90) return "Excellent Performance";
  if (score >= 80) return "Strong Performance";
  if (score >= 70) return "Good Performance";
  if (score >= 60) return "Needs Attention";
  return "Off Track";
}

async function computeZorechoScore(userId, requestedBrandId) {
  // Live score: same computation the Goals Overview uses (per real brand,
  // averaged). Scoped to the active brand when one is requested.
  const brands = await rows(
    `SELECT brand_id FROM brands WHERE user_id = $1 AND is_demo = false
      ${requestedBrandId ? "AND brand_id = $2" : ""} ORDER BY created_at ASC`,
    requestedBrandId ? [userId, requestedBrandId] : [userId],
  );
  let scored = 0;
  let sum = 0;
  for (const b of brands) {
    try {
      const { score } = await computeBrandGoals(b.brand_id);
      if (score != null) {
        scored += 1;
        sum += score;
      }
    } catch (_e) {
      /* one broken brand never kills the endpoint */
    }
  }
  const score = scored ? Math.round(sum / scored) : null;

  // History: daily average of clamped percent-to-goal from the real snapshots
  // (mirrors the live formula), last 14 recorded days.
  const history = await rows(
    `SELECT s.snapshot_date AS date,
            ROUND(AVG(LEAST(s.percent_to_goal, 100)))::int AS score
       FROM goal_snapshots s
       JOIN brands b ON b.brand_id = s.brand_id
      WHERE b.user_id = $1 AND b.is_demo = false
        ${requestedBrandId ? "AND b.brand_id = $2" : ""}
        AND s.snapshot_date >= CURRENT_DATE - INTERVAL '14 days'
      GROUP BY s.snapshot_date
      ORDER BY s.snapshot_date ASC`,
    requestedBrandId ? [userId, requestedBrandId] : [userId],
  );

  return {
    score,
    grade: letterGrade(score),
    label: scoreLabel(score),
    history: history.map((h) => ({ date: h.date, score: Number(h.score) })),
  };
}

// ---------------------------------------------------------------------------
// Unified activity feed — real events from every department's own table, each
// attributed to its agent, merged newest-first. Timestamps are the rows' real
// timestamps; the client renders honest relative times from them.
// ---------------------------------------------------------------------------
async function computeActivityFeed(userId, bid) {
  if (!bid) return [];
  const feeds = await Promise.all([
    rows(
      "SELECT platform, published_time AS ts FROM social_posts WHERE brand_id = $1 AND status = 'published' AND published_time IS NOT NULL ORDER BY published_time DESC LIMIT 6",
      [bid],
    ).then((r) => r.map((p) => ({ agentId: "nova", text: `Nova published a ${p.platform} post`, ts: p.ts }))),
    rows(
      "SELECT lead_name, source, created_at AS ts FROM leads WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 6",
      [bid],
    ).then((r) => r.map((l) => ({ agentId: "pulse", text: `Pulse captured a new lead${l.source ? ` from ${l.source}` : ""}`, ts: l.ts }))),
    rows(
      "SELECT direction, outcome, created_at AS ts FROM calls WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 6",
      [bid],
    ).then((r) => r.map((c) => ({ agentId: "voice", text: `Voice ${c.direction === "outbound" ? "placed" : "answered"} a call${c.outcome ? ` — ${c.outcome}` : ""}`, ts: c.ts }))),
    rows(
      "SELECT title, start_time, created_at AS ts FROM appointments WHERE brand_id = $1 AND status NOT IN ('cancelled','canceled') ORDER BY created_at DESC LIMIT 4",
      [bid],
    ).then((r) => r.map((a) => ({ agentId: "pulse", text: `Pulse booked ${a.title ? `"${a.title}"` : "an appointment"}`, ts: a.ts }))),
    rows(
      "SELECT campaign_name, created_at AS ts FROM campaigns WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 4",
      [bid],
    ).then((r) => r.map((c) => ({ agentId: "atlas", text: `Atlas created campaign "${c.campaign_name}"`, ts: c.ts }))),
    rows(
      "SELECT created_at AS ts FROM images WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 4",
      [bid],
    ).then((r) => r.map((i) => ({ agentId: "forge", text: "Forge generated a new creative asset", ts: i.ts }))),
    rows(
      "SELECT summary, urgent, created_at AS ts FROM sage_intelligence_feed WHERE brand_id = $1 AND dismissed_at IS NULL ORDER BY created_at DESC LIMIT 4",
      [bid],
    ).then((r) => r.map((s) => ({ agentId: "sage", text: s.summary ? `Sage: ${String(s.summary).slice(0, 90)}` : "Sage logged an industry finding", ts: s.ts, urgent: s.urgent === true }))),
    rows(
      "SELECT overall_status, issues_auto_fixed, check_time AS ts FROM health_checks WHERE brand_id = $1 ORDER BY check_time DESC LIMIT 3",
      [bid],
    ).then((r) => r.map((h) => ({
      agentId: "sentinel",
      text: h.issues_auto_fixed > 0
        ? `Sentinel auto-fixed ${h.issues_auto_fixed} issue${h.issues_auto_fixed === 1 ? "" : "s"}`
        : `Sentinel ran a health sweep — ${h.overall_status}`,
      ts: h.ts,
    }))),
    rows(
      "SELECT competitor_names, created_at AS ts FROM competitor_intelligence WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 3",
      [bid],
    ).then((r) => r.map((c) => ({ agentId: "scout", text: "Scout completed a competitor report", ts: c.ts }))),
    rows(
      "SELECT title, occurred_at AS ts FROM echo_memory WHERE user_id = $1 ORDER BY occurred_at DESC LIMIT 4",
      [userId],
    ).then((r) => r.map((e) => ({ agentId: "echo", text: e.title ? `Echo: ${String(e.title).slice(0, 90)}` : "Echo logged an update", ts: e.ts }))),
  ]);

  return feeds
    .flat()
    .filter((e) => e.ts)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))
    .slice(0, 20);
}

// ---------------------------------------------------------------------------
// Needs Your Attention — normalized from the real signals the platform already
// tracks: agents in "attention" state, failed posts, goal alerts, urgent Sage
// signals. Priorities reflect the underlying severity, not decoration.
// ---------------------------------------------------------------------------
function buildAttention({ agents, failedPosts, goalAlerts, sageUrgent }) {
  const items = [];
  for (const p of failedPosts) {
    items.push({
      id: `post-${p.postId}`,
      type: "failed_post",
      text: `A ${p.platform} post failed to publish — ${p.reason}`,
      priority: "high",
      section: "social",
      ts: p.failedAt,
    });
  }
  for (const a of agents.filter((x) => x.status === "attention")) {
    items.push({
      id: `agent-${a.id}`,
      type: "agent",
      agentId: a.id,
      text: `${a.name}: ${a.currentTask}`,
      priority: "high",
      section: a.section,
      ts: null,
    });
  }
  for (const g of goalAlerts.filter((x) => !x.muted && x.kind === "at_risk")) {
    items.push({
      id: `goal-${g.alertId}`,
      type: "goal",
      text: `Goal "${g.label}" is at risk${g.percentToGoal != null ? ` (${Math.round(g.percentToGoal)}% to target)` : ""}`,
      priority: "medium",
      section: "missioncontrol",
      ts: g.createdAt,
    });
  }
  for (const s of sageUrgent) {
    items.push({
      id: `sage-${s.feed_id || s.ts}`,
      type: "sage",
      text: `Sage flagged: ${String(s.summary || "an urgent industry signal").slice(0, 110)}`,
      priority: "medium",
      section: "sage",
      ts: s.ts,
    });
  }
  return items.slice(0, 10);
}

// ---------------------------------------------------------------------------
// GET /api/agents/mission-control/v2
// ---------------------------------------------------------------------------
async function getMissionControlV2(req, res) {
  try {
    const userId = req.user.userId;
    const requestedBrandId = req.query.brandId ? String(req.query.brandId).trim() : null;
    const brand = await getBrand(userId, requestedBrandId);
    if (requestedBrandId && !brand) {
      return res.status(404).json({ error: "Brand not found" });
    }
    const bid = brand ? brand.brand_id : null;

    // Identity + tier (drives premium panels' honest upgrade states).
    const userRow = (await rows(
      "SELECT preferred_name, first_name, email FROM users WHERE user_id = $1",
      [userId],
    ))[0] || {};
    const { tier, role } = await getUserTier(userId);
    const isAdmin = Boolean(req.user.isPlatformAdmin);
    const effectiveTier = isAdmin ? "enterprise" : tier;

    // Roster (Sentinel filtered for non-owners, exactly as the legacy endpoint).
    const computed = await agentsController.computeAgents(userId, brand);
    const roster = (req.user.isPlatformAdmin || req.user.workspaceRole === "owner")
      ? computed
      : computed.filter((a) => a.id !== "sentinel");

    // KPIs + score + feed in parallel.
    const [kpis, zorechoScore, activityFeed] = await Promise.all([
      computeKpis(bid),
      computeZorechoScore(userId, requestedBrandId),
      computeActivityFeed(userId, bid),
    ]);

    // Revenue impact + time saved — the existing honest ROI model (industry-
    // average estimate, labeled as such client-side). Null when unavailable.
    let revenueImpact = null;
    let timeSaved = null;
    let revenueTrend = [];
    if (brand) {
      try {
        const roi = await computeRoi(userId, brand);
        if (roi && roi.headline) {
          revenueImpact = {
            totalValueGenerated: roi.headline.totalValueGenerated,
            roiPercent: roi.headline.roiPercent,
            period: "month",
            estimate: true,
          };
          timeSaved = {
            hoursSaved: roi.headline.hoursSaved,
            moneySaved: roi.headline.moneySaved,
            breakdown: roi.automation ? roi.automation.breakdown : [],
            period: "month",
            estimate: true,
          };
        }
      } catch (_e) {
        /* ROI unavailable → panels reserve space, never fabricate */
      }
      revenueTrend = (await rows(
        `SELECT period_start, period_end, total_revenue FROM roi_advanced_snapshots
          WHERE brand_id = $1 ORDER BY period_end DESC LIMIT 8`,
        [bid],
      ))
        .reverse()
        .map((r) => ({
          periodStart: r.period_start,
          periodEnd: r.period_end,
          revenue: r.total_revenue == null ? null : Number(r.total_revenue),
        }));
    }

    // Legacy Mission Control data, reorganized in (nothing lost).
    const upcomingPosts = bid ? await rows("SELECT platform, scheduled_time FROM social_posts WHERE brand_id = $1 AND status = 'scheduled' AND scheduled_time > NOW() ORDER BY scheduled_time ASC LIMIT 5", [bid]) : [];
    const upcomingAppts = bid ? await rows("SELECT title, start_time FROM appointments WHERE brand_id = $1 AND start_time > NOW() AND status NOT IN ('cancelled','canceled') ORDER BY start_time ASC LIMIT 5", [bid]) : [];
    const upcoming = [
      ...upcomingPosts.map((p) => ({ type: "post", label: `${p.platform} post`, when: p.scheduled_time })),
      ...upcomingAppts.map((a) => ({ type: "appointment", label: a.title || "Appointment", when: a.start_time })),
    ].sort((x, y) => new Date(x.when) - new Date(y.when)).slice(0, 6);

    const goalAlertsRaw = await rows(
      `SELECT l.alert_id, l.goal_id, l.kind, l.alert_date, l.created_at,
              l.percent_to_goal, g.label, g.metric_key, g.alerts_muted,
              b.brand_id, b.brand_name
         FROM goal_alert_log l
         JOIN brand_goals g ON g.goal_id = l.goal_id
         JOIN brands b ON b.brand_id = g.brand_id
        WHERE b.user_id = $1 AND b.is_demo = false
          ${requestedBrandId ? "AND b.brand_id = $2" : ""}
          AND l.dismissed_at IS NULL
          AND l.alert_date >= CURRENT_DATE - INTERVAL '7 days'
        ORDER BY l.created_at DESC LIMIT 20`,
      requestedBrandId ? [userId, requestedBrandId] : [userId],
    );
    const goalAlerts = goalAlertsRaw.map((a) => ({
      alertId: a.alert_id,
      goalId: a.goal_id,
      kind: a.kind,
      label: a.label,
      metricKey: a.metric_key,
      brandId: a.brand_id,
      brandName: a.brand_name,
      alertDate: a.alert_date,
      createdAt: a.created_at,
      percentToGoal: a.percent_to_goal == null ? null : Number(a.percent_to_goal),
      muted: a.alerts_muted === true,
    }));

    const failedPostsRaw = await rows(
      `SELECT sp.post_id, sp.platform, sp.scheduled_time, sp.updated_at,
              sp.engagement_metrics->>'error' AS reason,
              b.brand_id, b.brand_name
         FROM social_posts sp
         JOIN brands b ON b.brand_id = sp.brand_id
        WHERE b.user_id = $1 AND b.is_demo = false
          ${requestedBrandId ? "AND b.brand_id = $2" : ""}
          AND sp.status = 'failed'
        ORDER BY sp.updated_at DESC LIMIT 20`,
      requestedBrandId ? [userId, requestedBrandId] : [userId],
    );
    const failedPosts = failedPostsRaw.map((p) => ({
      postId: p.post_id,
      platform: p.platform,
      brandId: p.brand_id,
      brandName: p.brand_name,
      reason: p.reason || "Unknown error",
      scheduledTime: p.scheduled_time,
      failedAt: p.updated_at,
    }));

    const sageUrgent = bid
      ? await rows(
          "SELECT feed_id, summary, created_at AS ts FROM sage_intelligence_feed WHERE brand_id = $1 AND dismissed_at IS NULL AND urgent = true AND created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 5",
          [bid],
        )
      : [];

    const attention = buildAttention({ agents: roster, failedPosts, goalAlerts, sageUrgent });

    // Today at a glance — real per-day counts (reuses the KPI SQL, today only).
    const glance = bid
      ? {
          postsPublished: await dayCount(KPI_SQL.postsPublished, bid, 0),
          newLeads: await dayCount(KPI_SQL.leadsCaptured, bid, 0),
          callsAnswered: await dayCount(KPI_SQL.callsAnswered, bid, 0),
          appointmentsBooked: await dayCount(KPI_SQL.appointmentsBooked, bid, 0),
          issuesResolved: await dayCount(KPI_SQL.issuesFixed, bid, 0),
          reviewsResponded: await dayCount(KPI_SQL.reviewsResponded, bid, 0),
        }
      : null;

    // Top opportunities — real actionable counts with deep links.
    const hotLeads = bid ? await n("SELECT COUNT(*)::int AS n FROM leads WHERE brand_id = $1 AND temperature = 'hot' AND conversion_status NOT IN ('converted','lost')", [bid]) : 0;
    const proposals = await n("SELECT COUNT(*)::int AS n FROM growth_actions WHERE user_id = $1 AND status = 'proposed'", [userId]);
    const scheduledPosts = bid ? await n("SELECT COUNT(*)::int AS n FROM social_posts WHERE brand_id = $1 AND status = 'scheduled'", [bid]) : 0;
    const pendingReviews = bid ? await n("SELECT COUNT(*)::int AS n FROM reviews WHERE brand_id = $1 AND response_status = 'pending'", [bid]) : 0;
    const opportunities = [
      { key: "hotLeads", label: "Hot leads to close", value: hotLeads, section: "leads" },
      { key: "proposals", label: "Growth proposals awaiting review", value: proposals, section: "echogrowth" },
      { key: "scheduledPosts", label: "Posts scheduled ahead", value: scheduledPosts, section: "social" },
      { key: "pendingReviews", label: "Reviews awaiting response", value: pendingReviews, section: "reputation" },
      { key: "sageUrgent", label: "Urgent industry signals", value: sageUrgent.length, section: "sage" },
    ].filter((o) => o.value > 0);

    // Executive insights (Sage) — premium panel. Locked (not hidden, not
    // fabricated) below Enterprise; admin bypasses like every feature gate.
    const insightsUnlocked = meetsTier(effectiveTier, "enterprise");
    let insights = { locked: !insightsUnlocked, requiredTier: "enterprise", items: [], lastRefreshedAt: null };
    if (insightsUnlocked && bid) {
      const prof = (await rows(
        "SELECT marketing_insights, last_refreshed_at FROM sage_intelligence_profiles WHERE brand_id = $1",
        [bid],
      ))[0];
      insights = {
        locked: false,
        requiredTier: "enterprise",
        items: prof && Array.isArray(prof.marketing_insights) ? prof.marketing_insights.slice(0, 5) : [],
        lastRefreshedAt: prof ? prof.last_refreshed_at : null,
      };
    }

    // System status — real, verifiable signals only (decision #4: no "Last
    // Backup"). DB is trivially "connected" (this response proves it); the
    // health line comes from the latest real Sentinel sweep.
    const lastHealth = bid
      ? (await rows("SELECT overall_status, check_time FROM health_checks WHERE brand_id = $1 ORDER BY check_time DESC LIMIT 1", [bid]))[0]
      : null;
    const systemStatus = {
      database: "connected",
      health: lastHealth ? lastHealth.overall_status : "unknown",
      lastHealthCheck: lastHealth ? lastHealth.check_time : null,
    };

    // Greeting + briefing (owner's local clock — never "Good morning" at 5pm).
    const tod = await userPartOfDay(userId);
    const leadsWeek = bid ? await n("SELECT COUNT(*)::int AS n FROM leads WHERE brand_id = $1 AND created_at > NOW() - INTERVAL '7 days'", [bid]) : 0;
    const activeCampaigns = bid ? await n("SELECT COUNT(*)::int AS n FROM campaigns WHERE brand_id = $1 AND status = 'active'", [bid]) : 0;
    const fixesWeek = bid ? await n("SELECT COALESCE(SUM(issues_auto_fixed),0)::int AS n FROM health_checks WHERE brand_id = $1 AND check_time > NOW() - INTERVAL '7 days'", [bid]) : 0;
    const attentionNames = roster.filter((a) => a.status === "attention").map((a) => a.name);
    const briefing =
      `${greetingBare(tod.part)} ${leadsWeek} new lead${leadsWeek === 1 ? "" : "s"} this week and ${activeCampaigns} live campaign${activeCampaigns === 1 ? "" : "s"}. ` +
      (attentionNames.length ? `${attentionNames.join(" and ")} need${attentionNames.length === 1 ? "s" : ""} your attention. ` : "The whole team is running smoothly. ") +
      (fixesWeek ? `Sentinel auto-fixed ${fixesWeek} issue${fixesWeek === 1 ? "" : "s"} this week.` : "No problems detected.");

    const workforce = await computeWorkforce(bid, activeCampaigns);

    const geo = (brand ? parseGeo(brand.geo_targeting) : null) || { areas: [], exclusions: [] };
    const geoCoverage = brand
      ? {
          summary: geoSummaryText(brand.geo_targeting) || null,
          configured: Boolean(geo.areas.length || geo.exclusions.length),
          areaCount: geo.areas.length,
          exclusionCount: geo.exclusions.length,
        }
      : null;

    return res.json({
      brandName: brand ? brand.brand_name : null,
      ownerName: userRow.preferred_name || userRow.first_name || null,
      partOfDay: tod.part,
      briefing,
      tier: { tier: effectiveTier, role, isAdmin },
      agents: roster,
      kpis,
      zorechoScore,
      activityFeed,
      attention,
      todayAtAGlance: glance,
      revenueImpact,
      timeSaved,
      revenueTrend,
      opportunities,
      insights,
      upcoming,
      geoCoverage,
      goalAlerts,
      failedPosts,
      systemStatus,
      workforce,
    });
  } catch (err) {
    console.error("getMissionControlV2 error:", err.message);
    return res.status(500).json({ error: "Failed to load Mission Control." });
  }
}

module.exports = {
  getMissionControlV2,
  // exported for tests
  computeWorkforce,
  computeKpis,
  computeZorechoScore,
  computeActivityFeed,
  buildAttention,
  letterGrade,
  delta,
};
