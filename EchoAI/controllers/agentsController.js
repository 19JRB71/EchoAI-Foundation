// AI Marketing Department — per-agent status + weekly results aggregation and the
// Mission Control org-wide rollup.
//
// This is a PRESENTATION/aggregation layer over the existing subsystems. It reads
// (read-only) from the live tables each subsystem already writes, so the "team"
// reflects real activity — nothing is faked. Every query is scoped to the account
// owner's brand (auth middleware remaps team-member userId -> owner upstream).

const db = require("../config/db");

// ---------------------------------------------------------------------------
// Team roster (static metadata). `section` links a card into the existing feature
// section so clicking through opens the underlying tool.
// ---------------------------------------------------------------------------
const AGENTS = [
  {
    id: "echo",
    name: "Echo",
    title: "Marketing Director",
    color: "#14B8A6",
    blurb: "Runs the whole operation. Knows every campaign, customer and result, and briefs you every morning.",
    section: "overview",
  },
  {
    id: "scout",
    name: "Scout",
    title: "Research Specialist",
    color: "#0EA5E9",
    blurb: "Watches competitors, finds trends, keywords and audiences, and reports opportunities weekly.",
    section: "intelligence",
  },
  {
    id: "atlas",
    name: "Atlas",
    title: "Advertising Manager",
    color: "#6366F1",
    blurb: "Builds and manages Facebook & Google ads, optimizes budgets, and tracks ROI.",
    section: "adstudio",
  },
  {
    id: "nova",
    name: "Nova",
    title: "Social Media Manager",
    color: "#EC4899",
    blurb: "Posts daily, builds content calendars, and keeps your brand visible across platforms.",
    section: "contentcalendar",
  },
  {
    id: "pulse",
    name: "Pulse",
    title: "CRM Manager",
    color: "#F97316",
    blurb: "Never forgets a lead — follows up, books appointments and scores every prospect.",
    section: "leads",
  },
  {
    id: "voice",
    name: "Voice",
    title: "AI Receptionist",
    color: "#8B5CF6",
    blurb: "Answers the phone, qualifies leads and books appointments around the clock.",
    section: "phone",
  },
  {
    id: "forge",
    name: "Forge",
    title: "Creative Director",
    color: "#EAB308",
    blurb: "Creates ad images, video scripts, copy and social visuals with AI generation tools.",
    section: "image",
  },
  {
    id: "sentinel",
    name: "Sentinel",
    title: "Oversight Agent",
    color: "#EF4444",
    blurb: "Watches everyone else every night, catches problems, and fixes them automatically.",
    section: "admin",
  },
];

// ---------------------------------------------------------------------------
// Small safe query helpers (never throw — a status endpoint must degrade, not 500)
// ---------------------------------------------------------------------------
async function n(sql, params) {
  try {
    const r = await db.query(sql, params);
    return Number(r.rows[0] && r.rows[0].n) || 0;
  } catch (_e) {
    return 0;
  }
}
async function rows(sql, params) {
  try {
    const r = await db.query(sql, params);
    return r.rows;
  } catch (_e) {
    return [];
  }
}

async function getBrand(userId) {
  const r = await rows(
    "SELECT brand_id, brand_name FROM brands WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1",
    [userId],
  );
  return r[0] || null;
}

// Sentinel is the owner-facing oversight/health agent — invited team members
// never see it (only the account owner or a platform admin). Applied to every
// roster response so a team member can use the same team-based navigation for
// every OTHER department.
function canSeeSentinel(req) {
  return Boolean(
    req.user && (req.user.isPlatformAdmin || req.user.workspaceRole === "owner"),
  );
}
function filterAgentsFor(req, agents) {
  return canSeeSentinel(req) ? agents : agents.filter((a) => a.id !== "sentinel");
}

const WEEK = "created_at > NOW() - INTERVAL '7 days'";

// ---------------------------------------------------------------------------
// Compute the live status + weekly results for every agent.
// status: "active" | "working" | "attention"
// ---------------------------------------------------------------------------
async function computeAgents(userId, brand) {
  const bid = brand ? brand.brand_id : null;

  // Echo — director. Reflects activation + whether anything awaits approval.
  const echoRow = (await rows("SELECT activation_status, pending_action FROM echo_companion WHERE user_id = $1", [userId]))[0];
  const proposals = await n("SELECT COUNT(*)::int AS n FROM growth_actions WHERE user_id = $1 AND status = 'proposed'", [userId]);
  const leadsWeek = bid ? await n(`SELECT COUNT(*)::int AS n FROM leads WHERE brand_id = $1 AND ${WEEK}`, [bid]) : 0;
  const campaignsTotal = await n("SELECT COUNT(*)::int AS n FROM campaigns WHERE user_id = $1", [userId]);

  // Atlas — ads. Facebook connection is the key "attention" trigger.
  const fbConnected = await n(
    "SELECT COUNT(*)::int AS n FROM api_integrations WHERE user_id = $1 AND platform = 'facebook' AND connection_status = 'connected'",
    [userId],
  );
  const activeCampaigns = bid ? await n("SELECT COUNT(*)::int AS n FROM campaigns WHERE brand_id = $1 AND status = 'active'", [bid]) : 0;
  const campaignsWeek = bid ? await n(`SELECT COUNT(*)::int AS n FROM campaigns WHERE brand_id = $1 AND ${WEEK}`, [bid]) : 0;

  // Nova — social.
  const postsScheduled = bid ? await n("SELECT COUNT(*)::int AS n FROM social_posts WHERE brand_id = $1 AND status = 'scheduled'", [bid]) : 0;
  const postsWeek = bid ? await n("SELECT COUNT(*)::int AS n FROM social_posts WHERE brand_id = $1 AND published_time > NOW() - INTERVAL '7 days'", [bid]) : 0;
  const activeCal = bid ? await n("SELECT COUNT(*)::int AS n FROM content_calendars WHERE brand_id = $1 AND status = 'active'", [bid]) : 0;

  // Pulse — CRM.
  const leadsTotal = bid ? await n("SELECT COUNT(*)::int AS n FROM leads WHERE brand_id = $1", [bid]) : 0;
  const hotLeads = bid ? await n("SELECT COUNT(*)::int AS n FROM leads WHERE brand_id = $1 AND temperature = 'hot'", [bid]) : 0;
  const seqActive = bid ? await n("SELECT COUNT(*)::int AS n FROM follow_up_sequences WHERE brand_id = $1 AND status = 'active'", [bid]) : 0;
  const apptUpcoming = bid ? await n("SELECT COUNT(*)::int AS n FROM appointments WHERE brand_id = $1 AND start_time > NOW() AND status NOT IN ('cancelled','canceled')", [bid]) : 0;

  // Voice — phone + website chatbot.
  const callsWeek = bid ? await n(`SELECT COUNT(*)::int AS n FROM calls WHERE brand_id = $1 AND ${WEEK}`, [bid]) : 0;
  const chatsWeek = bid ? await n("SELECT COUNT(*)::int AS n FROM chatbot_sessions WHERE brand_id = $1 AND started_at > NOW() - INTERVAL '7 days'", [bid]) : 0;
  const twilio = bid ? await n("SELECT COUNT(*)::int AS n FROM twilio_config WHERE brand_id = $1", [bid]) : 0;

  // Forge — creative.
  const imagesWeek = bid ? await n(`SELECT COUNT(*)::int AS n FROM images WHERE brand_id = $1 AND ${WEEK}`, [bid]) : 0;
  const videosWeek = bid ? await n(`SELECT COUNT(*)::int AS n FROM video_scripts WHERE brand_id = $1 AND ${WEEK}`, [bid]) : 0;
  const creativesWeek = bid ? await n(`SELECT COUNT(*)::int AS n FROM ad_creatives WHERE brand_id = $1 AND ${WEEK}`, [bid]) : 0;

  // Scout — research.
  const compIntel = bid ? await n("SELECT COUNT(*)::int AS n FROM competitor_intelligence WHERE brand_id = $1 AND updated_at > NOW() - INTERVAL '7 days'", [bid]) : 0;
  const custIntel = bid ? await n("SELECT COUNT(*)::int AS n FROM customer_intelligence WHERE brand_id = $1 AND created_at > NOW() - INTERVAL '7 days'", [bid]) : 0;
  const intelTotal = bid ? await n("SELECT COUNT(*)::int AS n FROM competitor_intelligence WHERE brand_id = $1", [bid]) : 0;

  // Sentinel — oversight (latest health check).
  const health = bid ? (await rows("SELECT overall_status, issues_found, issues_auto_fixed, check_time FROM health_checks WHERE brand_id = $1 ORDER BY check_time DESC LIMIT 1", [bid]))[0] : null;
  const fixesWeek = bid ? await n("SELECT COALESCE(SUM(issues_auto_fixed),0)::int AS n FROM health_checks WHERE brand_id = $1 AND check_time > NOW() - INTERVAL '7 days'", [bid]) : 0;

  const byId = {
    echo: {
      status: proposals > 0 || (echoRow && echoRow.pending_action) ? "working" : "active",
      currentTask: proposals > 0 ? `${proposals} proposal${proposals === 1 ? "" : "s"} for your review`
        : (echoRow && echoRow.pending_action) ? "Waiting on your approval"
        : "Overseeing your marketing operation",
      weekly: [
        { label: "New leads", value: leadsWeek },
        { label: "Campaigns", value: campaignsTotal },
        { label: "Proposals", value: proposals },
      ],
    },
    scout: {
      status: compIntel > 0 || custIntel > 0 ? "active" : intelTotal > 0 ? "working" : "attention",
      currentTask: compIntel > 0 ? "Fresh competitor & market report ready" : "Scanning competitors and trends",
      weekly: [
        { label: "Competitor reports", value: compIntel },
        { label: "Intelligence briefs", value: custIntel },
      ],
    },
    atlas: {
      status: fbConnected === 0 ? "attention" : activeCampaigns > 0 ? "active" : "working",
      currentTask: fbConnected === 0 ? "Needs Facebook connected to run ads" : activeCampaigns > 0 ? `Managing ${activeCampaigns} live campaign${activeCampaigns === 1 ? "" : "s"}` : "Ready to launch your first campaign",
      weekly: [
        { label: "Active campaigns", value: activeCampaigns },
        { label: "Launched (7d)", value: campaignsWeek },
      ],
    },
    nova: {
      status: activeCal > 0 || postsScheduled > 0 ? "active" : "working",
      currentTask: postsScheduled > 0 ? `${postsScheduled} post${postsScheduled === 1 ? "" : "s"} scheduled` : "Ready to build your content calendar",
      weekly: [
        { label: "Published (7d)", value: postsWeek },
        { label: "Scheduled", value: postsScheduled },
      ],
    },
    pulse: {
      status: hotLeads > 0 ? "attention" : seqActive > 0 || leadsTotal > 0 ? "active" : "working",
      currentTask: hotLeads > 0 ? `${hotLeads} hot lead${hotLeads === 1 ? "" : "s"} to close` : seqActive > 0 ? `Nurturing ${seqActive} follow-up sequence${seqActive === 1 ? "" : "s"}` : "Watching for new leads",
      weekly: [
        { label: "New leads", value: leadsWeek },
        { label: "Hot leads", value: hotLeads },
        { label: "Appointments", value: apptUpcoming },
      ],
    },
    voice: {
      status: twilio === 0 ? "attention" : callsWeek > 0 || chatsWeek > 0 ? "active" : "working",
      currentTask: twilio === 0 ? "Connect a phone number to take calls" : "Answering calls and chats 24/7",
      weekly: [
        { label: "Calls (7d)", value: callsWeek },
        { label: "Chats (7d)", value: chatsWeek },
      ],
    },
    forge: {
      status: imagesWeek + videosWeek + creativesWeek > 0 ? "active" : "working",
      currentTask: "Producing on-brand creative assets",
      weekly: [
        { label: "Images", value: imagesWeek },
        { label: "Video scripts", value: videosWeek },
        { label: "Ad creatives", value: creativesWeek },
      ],
    },
    sentinel: {
      status: !health ? "working" : health.overall_status === "critical" ? "attention" : health.overall_status === "warning" ? "working" : "active",
      currentTask: !health ? "Standing by — first nightly sweep pending" : health.overall_status === "healthy" ? "All systems healthy" : `${health.issues_found || 0} issue${(health.issues_found || 0) === 1 ? "" : "s"} being handled`,
      weekly: [
        { label: "Issues fixed (7d)", value: fixesWeek },
        { label: "Status", value: health ? health.overall_status : "pending" },
      ],
    },
  };

  return AGENTS.map((a) => ({ ...a, ...byId[a.id] }));
}

// ---------------------------------------------------------------------------
// GET /api/agents  — the team roster with live status + weekly results.
// ---------------------------------------------------------------------------
async function getAgents(req, res) {
  try {
    const userId = req.user.userId;
    const brand = await getBrand(userId);
    const agents = filterAgentsFor(req, await computeAgents(userId, brand));
    return res.json({ agents, brandName: brand ? brand.brand_name : null });
  } catch (err) {
    console.error("getAgents error:", err.message);
    return res.status(500).json({ error: "Failed to load your AI team." });
  }
}

// ---------------------------------------------------------------------------
// GET /api/agents/:agentId  — detailed view: activity log, tasks, metrics.
// ---------------------------------------------------------------------------
async function getAgentDetail(req, res) {
  try {
    const userId = req.user.userId;
    const agentId = req.params.agentId;
    const meta = AGENTS.find((a) => a.id === agentId);
    if (!meta) return res.status(404).json({ error: "Unknown team member." });
    // Team members can't open the owner-only Sentinel oversight department.
    if (agentId === "sentinel" && !canSeeSentinel(req)) {
      return res.status(404).json({ error: "Unknown team member." });
    }
    const brand = await getBrand(userId);
    const bid = brand ? brand.brand_id : null;
    const all = await computeAgents(userId, brand);
    const summary = all.find((a) => a.id === agentId);

    let activity = [];
    if (bid) {
      const map = {
        atlas: ["SELECT campaign_name AS title, status, created_at FROM campaigns WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 10", (r) => ({ title: r.title, meta: r.status, ts: r.created_at })],
        nova: ["SELECT platform, status, COALESCE(published_time, scheduled_time, created_at) AS ts, post_content FROM social_posts WHERE brand_id = $1 ORDER BY ts DESC LIMIT 10", (r) => ({ title: `${r.platform} post`, meta: r.status, ts: r.ts, detail: (r.post_content || "").slice(0, 120) })],
        pulse: ["SELECT lead_name, temperature, conversion_status, created_at FROM leads WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 10", (r) => ({ title: r.lead_name || "New lead", meta: `${r.temperature || "cold"} · ${r.conversion_status || "new"}`, ts: r.created_at })],
        voice: ["SELECT direction, caller_phone, outcome, duration_seconds, created_at FROM calls WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 10", (r) => ({ title: `${r.direction || "call"} · ${r.caller_phone || ""}`, meta: `${r.outcome || "handled"} · ${r.duration_seconds || 0}s`, ts: r.created_at })],
        forge: ["SELECT purpose AS title, status, created_at FROM images WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 10", (r) => ({ title: r.title || "Image", meta: r.status, ts: r.created_at })],
        scout: ["SELECT competitor_names, created_at FROM competitor_intelligence WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 10", (r) => ({ title: "Competitor report", meta: Array.isArray(r.competitor_names) ? r.competitor_names.join(", ") : "", ts: r.created_at })],
        sentinel: ["SELECT overall_status, issues_found, issues_auto_fixed, check_time FROM health_checks WHERE brand_id = $1 ORDER BY check_time DESC LIMIT 10", (r) => ({ title: `Health sweep — ${r.overall_status}`, meta: `${r.issues_found || 0} found · ${r.issues_auto_fixed || 0} fixed`, ts: r.check_time })],
      };
      if (agentId === "echo") {
        activity = (await rows("SELECT title, detail, event_type, occurred_at FROM echo_memory WHERE user_id = $1 ORDER BY occurred_at DESC LIMIT 10", [userId]))
          .map((r) => ({ title: r.title, meta: r.event_type, detail: r.detail, ts: r.occurred_at }));
      } else if (map[agentId]) {
        const [sql, fmt] = map[agentId];
        activity = (await rows(sql, [bid])).map(fmt);
      }
    }

    return res.json({ agent: summary, activity });
  } catch (err) {
    console.error("getAgentDetail error:", err.message);
    return res.status(500).json({ error: "Failed to load team member details." });
  }
}

// ---------------------------------------------------------------------------
// GET /api/agents/mission-control  — the org-wide command center rollup.
// ---------------------------------------------------------------------------
async function getMissionControl(req, res) {
  try {
    const userId = req.user.userId;
    const brand = await getBrand(userId);
    const bid = brand ? brand.brand_id : null;
    const agents = filterAgentsFor(req, await computeAgents(userId, brand));

    const leadsWeek = bid ? await n(`SELECT COUNT(*)::int AS n FROM leads WHERE brand_id = $1 AND ${WEEK}`, [bid]) : 0;
    const activeCampaigns = bid ? await n("SELECT COUNT(*)::int AS n FROM campaigns WHERE brand_id = $1 AND status = 'active'", [bid]) : 0;
    const activeCal = bid ? await n("SELECT COUNT(*)::int AS n FROM content_calendars WHERE brand_id = $1 AND status = 'active'", [bid]) : 0;
    const seqActive = bid ? await n("SELECT COUNT(*)::int AS n FROM follow_up_sequences WHERE brand_id = $1 AND status = 'active'", [bid]) : 0;
    const postsToday = bid ? await n("SELECT COUNT(*)::int AS n FROM social_posts WHERE brand_id = $1 AND published_time::date = CURRENT_DATE", [bid]) : 0;
    const leadsToday = bid ? await n("SELECT COUNT(*)::int AS n FROM leads WHERE brand_id = $1 AND created_at::date = CURRENT_DATE", [bid]) : 0;
    const callsToday = bid ? await n("SELECT COUNT(*)::int AS n FROM calls WHERE brand_id = $1 AND created_at::date = CURRENT_DATE", [bid]) : 0;
    const sentinelFixes = bid ? await n("SELECT COALESCE(SUM(issues_auto_fixed),0)::int AS n FROM health_checks WHERE brand_id = $1 AND check_time > NOW() - INTERVAL '7 days'", [bid]) : 0;

    // Upcoming planned actions: next scheduled posts + upcoming appointments.
    const upcomingPosts = bid ? await rows("SELECT platform, scheduled_time FROM social_posts WHERE brand_id = $1 AND status = 'scheduled' AND scheduled_time > NOW() ORDER BY scheduled_time ASC LIMIT 5", [bid]) : [];
    const upcomingAppts = bid ? await rows("SELECT title, start_time FROM appointments WHERE brand_id = $1 AND start_time > NOW() AND status NOT IN ('cancelled','canceled') ORDER BY start_time ASC LIMIT 5", [bid]) : [];
    const upcoming = [
      ...upcomingPosts.map((p) => ({ type: "post", label: `${p.platform} post`, when: p.scheduled_time })),
      ...upcomingAppts.map((a) => ({ type: "appointment", label: a.title || "Appointment", when: a.start_time })),
    ].sort((x, y) => new Date(x.when) - new Date(y.when)).slice(0, 6);

    // Revenue: honest — only surface if an ROI snapshot exists; otherwise null.
    const roi = bid ? (await rows("SELECT * FROM roi_advanced_snapshots WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 1", [bid]))[0] : null;

    // Goal alerts the daily sweep logged for THIS user's real brands (last 7
    // days). These are surfaced in the attention panel so goal alerts are visibly
    // logged, not only sent over voice/push. Scoped by user_id + non-demo.
    // Dismissed alerts and alerts for muted goals are hidden from the feed;
    // the rows stay in goal_alert_log because they double as the daily claim.
    const goalAlerts = await rows(
      `SELECT l.alert_id, l.goal_id, l.kind, l.alert_date, l.created_at,
              l.percent_to_goal, g.label, g.metric_key, g.alerts_muted,
              b.brand_id, b.brand_name
         FROM goal_alert_log l
         JOIN brand_goals g ON g.goal_id = l.goal_id
         JOIN brands b ON b.brand_id = g.brand_id
        WHERE b.user_id = $1 AND b.is_demo = false
          AND l.dismissed_at IS NULL
          AND l.alert_date >= CURRENT_DATE - INTERVAL '7 days'
        ORDER BY l.created_at DESC
        LIMIT 20`,
      [userId]
    );

    // Posts currently stuck in 'failed' across ALL the user's real brands.
    // Push already alerts installed-PWA owners the moment a publish fails;
    // this feed catches everyone else at next login. Rows disappear on their
    // own once the post is rescheduled (failed -> scheduled) or deleted,
    // because the query keys off the live status — no separate log to clear.
    const failedPosts = await rows(
      `SELECT sp.post_id, sp.platform, sp.scheduled_time, sp.updated_at,
              sp.engagement_metrics->>'error' AS reason,
              b.brand_id, b.brand_name
         FROM social_posts sp
         JOIN brands b ON b.brand_id = sp.brand_id
        WHERE b.user_id = $1 AND b.is_demo = false
          AND sp.status = 'failed'
        ORDER BY sp.updated_at DESC
        LIMIT 20`,
      [userId]
    );

    const attention = agents.filter((a) => a.status === "attention").map((a) => a.name);
    const briefing =
      `Good morning. ${leadsWeek} new lead${leadsWeek === 1 ? "" : "s"} this week and ${activeCampaigns} live campaign${activeCampaigns === 1 ? "" : "s"}. ` +
      (attention.length ? `${attention.join(" and ")} need${attention.length === 1 ? "s" : ""} your attention. ` : "The whole team is running smoothly. ") +
      (sentinelFixes ? `Sentinel auto-fixed ${sentinelFixes} issue${sentinelFixes === 1 ? "" : "s"} this week.` : "No problems detected.");

    return res.json({
      brandName: brand ? brand.brand_name : null,
      briefing,
      agents,
      stats: {
        leadsThisWeek: leadsWeek,
        activeCampaigns,
        tasksRunning: activeCampaigns + activeCal + seqActive,
        completedToday: postsToday + leadsToday + callsToday,
        sentinelFixes,
        revenueEstimate: roi && roi.total_revenue != null ? Number(roi.total_revenue) : null,
      },
      upcoming,
      goalAlerts: goalAlerts.map((a) => ({
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
      })),
      failedPosts: failedPosts.map((p) => ({
        postId: p.post_id,
        platform: p.platform,
        brandId: p.brand_id,
        brandName: p.brand_name,
        reason: p.reason || "Unknown error",
        scheduledTime: p.scheduled_time,
        failedAt: p.updated_at,
      })),
    });
  } catch (err) {
    console.error("getMissionControl error:", err.message);
    return res.status(500).json({ error: "Failed to load Mission Control." });
  }
}

module.exports = { AGENTS, computeAgents, getAgents, getAgentDetail, getMissionControl };
