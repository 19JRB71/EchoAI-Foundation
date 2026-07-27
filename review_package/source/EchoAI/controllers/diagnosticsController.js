const db = require("../config/db");

/**
 * Full Diagnostic Report (admin-only, mounted under /api/admin).
 *
 * Scans the admin/owner's OWN account — every brand it owns plus account-level
 * subsystems (subscription, integrations, API credits, team) — and renders a
 * single copyable plain-text report plus a prioritized top-10 list of fixes.
 *
 * Design invariants:
 * - Read-only aggregation over REAL data. No mocked values, no placeholders.
 * - Rule-based prioritization (deterministic). A diagnostic must still work when
 *   the AI providers are down, so it never calls Anthropic/OpenAI.
 * - Every subsystem read is wrapped so one failing table can't blank the report;
 *   a failed section is surfaced honestly ("could not be read") instead of hidden.
 */

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_LABEL = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
};

async function safeRows(sql, params) {
  try {
    const { rows } = await db.query(sql, params);
    return { rows, error: null };
  } catch (err) {
    console.error("Diagnostics query error:", err.message);
    return { rows: [], error: err.message };
  }
}

function fmtDateTime(value) {
  if (!value) return "never";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function pct(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "n/a";
  return `${Number(n).toFixed(0)}%`;
}

/**
 * Gather every subsystem signal for one account. Returns a structured object the
 * text renderer and the issue prioritizer both read from.
 */
async function gatherAccount(userId) {
  const issues = [];
  const addIssue = (severity, area, message, fix) =>
    issues.push({ severity, area, message, fix });

  // Honest-failure tracking: any subsystem read that errors is recorded so the
  // report says "could not be read" instead of silently implying "all healthy".
  const readErrors = [];
  const noteErr = (label, r) => {
    if (r && r.error) readErrors.push(`${label}: ${r.error}`);
  };

  // --- Account identity + subscription --------------------------------------
  const userRes = await safeRows(
    `SELECT u.email, u.role, u.subscription_tier, u.team_size, u.created_at,
            s.subscription_tier AS sub_tier, s.payment_status, s.is_locked,
            s.renewal_date, s.failed_payment_at
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.user_id
      WHERE u.user_id = $1
      ORDER BY s.updated_at DESC NULLS LAST
      LIMIT 1`,
    [userId],
  );
  const account = userRes.rows[0] || {};
  if (account.is_locked) {
    addIssue(
      "critical",
      "Billing",
      "Account is LOCKED (payment failure past the lockout threshold).",
      "Resolve the outstanding payment in Billing to restore full access.",
    );
  } else if (account.payment_status && account.payment_status !== "active") {
    addIssue(
      "high",
      "Billing",
      `Subscription payment status is "${account.payment_status}".`,
      "Update the payment method before the lockout window elapses.",
    );
  }

  // --- Brands owned by this account -----------------------------------------
  const brandsRes = await safeRows(
    `SELECT brand_id, brand_name, brand_personality, voice_description,
            visual_style_preferences, target_audience, created_at
       FROM brands WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId],
  );
  const brands = brandsRes.rows;

  // --- Account-level: integrations ------------------------------------------
  const integrationsRes = await safeRows(
    `SELECT platform, connection_status, updated_at
       FROM api_integrations WHERE user_id = $1 ORDER BY platform`,
    [userId],
  );
  const integrations = integrationsRes.rows;
  for (const it of integrations) {
    if (it.connection_status === "error") {
      addIssue(
        "high",
        "Integrations",
        `Integration "${it.platform}" is in an ERROR state.`,
        `Reconnect ${it.platform} from Settings to restore automated actions.`,
      );
    }
  }

  // --- Account-level: API credits / quota (platform-wide snapshots) ---------
  const quotaRes = await safeRows(
    `SELECT provider, label, status, remaining, limit_total, pct_remaining,
            unit, detail, checked_at
       FROM api_quota_snapshots ORDER BY provider`,
    [],
  );
  const quotas = quotaRes.rows;
  for (const q of quotas) {
    if (q.status === "critical") {
      addIssue(
        "critical",
        "API credits",
        `${q.label} credits are CRITICAL (${pct(q.pct_remaining)} remaining).`,
        `Top up ${q.label} immediately — AI/voice features will start failing.`,
      );
    } else if (q.status === "low") {
      addIssue(
        "high",
        "API credits",
        `${q.label} credits are LOW (${pct(q.pct_remaining)} remaining).`,
        `Add credits to ${q.label} soon to avoid interruption.`,
      );
    }
  }

  // --- Account-level: team --------------------------------------------------
  const teamRes = await safeRows(
    `SELECT role, status, email FROM team_members WHERE account_owner_user_id = $1`,
    [userId],
  );
  const team = teamRes.rows;
  const pendingInvites = team.filter((t) => t.status === "pending").length;
  if (pendingInvites > 0) {
    addIssue(
      "low",
      "Team",
      `${pendingInvites} team invite(s) still pending acceptance.`,
      "Follow up with invited members or re-send invites to free up seats.",
    );
  }

  noteErr("Account & subscription", userRes);
  noteErr("Brands", brandsRes);
  noteErr("Integrations", integrationsRes);
  noteErr("API quota", quotaRes);
  noteErr("Team", teamRes);

  // --- Per-brand deep scan ---------------------------------------------------
  const now = new Date();
  const curMonth = now.getUTCMonth() + 1;
  const curYear = now.getUTCFullYear();
  const brandReports = [];

  for (const b of brands) {
    const bid = b.brand_id;
    const br = { brand: b, sections: {} };

    // (1) Brand configuration completeness
    const missing = [];
    if (!b.brand_personality) missing.push("brand personality");
    if (!b.voice_description) missing.push("voice description");
    if (!b.target_audience) missing.push("target audience");
    if (!b.visual_style_preferences) missing.push("visual style");
    br.sections.config = { missing };
    if (missing.length) {
      addIssue(
        missing.length >= 3 ? "medium" : "low",
        "Brand config",
        `${b.brand_name}: incomplete brand profile (missing ${missing.join(", ")}).`,
        "Complete brand discovery so AI content stays on-brand.",
      );
    }

    // (2) Content posting schedule
    const calRes = await safeRows(
      `SELECT month, year, status, posting_frequency
         FROM content_calendars WHERE brand_id = $1
        ORDER BY year DESC, month DESC LIMIT 1`,
      [bid],
    );
    const postRes = await safeRows(
      `SELECT status, COUNT(*)::int AS n,
              MIN(scheduled_time) FILTER (WHERE status = 'scheduled') AS next_scheduled
         FROM social_posts WHERE brand_id = $1 GROUP BY status`,
      [bid],
    );
    const postCounts = {};
    let nextScheduled = null;
    for (const r of postRes.rows) {
      postCounts[r.status] = r.n;
      if (r.next_scheduled && (!nextScheduled || r.next_scheduled < nextScheduled))
        nextScheduled = r.next_scheduled;
    }
    const latestCal = calRes.rows[0] || null;
    br.sections.schedule = { latestCal, postCounts, nextScheduled };
    const hasCurrentCal =
      latestCal && latestCal.year === curYear && latestCal.month === curMonth;
    if (!latestCal) {
      addIssue(
        "medium",
        "Content schedule",
        `${b.brand_name}: no content calendar has ever been created.`,
        "Generate a content calendar so posts publish on a consistent cadence.",
      );
    } else if (!hasCurrentCal) {
      addIssue(
        "medium",
        "Content schedule",
        `${b.brand_name}: no content calendar for the current month.`,
        "Generate this month's calendar to keep the posting cadence going.",
      );
    }
    if (!(postCounts.scheduled > 0)) {
      addIssue(
        "medium",
        "Content schedule",
        `${b.brand_name}: no upcoming scheduled posts.`,
        "Schedule posts so the brand keeps publishing without manual work.",
      );
    }

    // (6) Automation health — failed / stuck posts
    if (postCounts.failed > 0) {
      addIssue(
        "high",
        "Automation",
        `${b.brand_name}: ${postCounts.failed} social post(s) FAILED to publish.`,
        "Open Social Media, reconnect the account if needed, and reschedule failed posts.",
      );
    }
    if (postCounts.publishing > 0) {
      addIssue(
        "medium",
        "Automation",
        `${b.brand_name}: ${postCounts.publishing} post(s) stuck in "publishing".`,
        "Check the scheduler — stuck posts usually mean an interrupted publish run.",
      );
    }

    // (3) Campaign health
    const adRes = await safeRows(
      `SELECT COUNT(*)::int AS n, AVG(conversion_rate) AS avg_conv,
              AVG(cost_per_lead) AS avg_cpl, SUM(budget) AS total_budget
         FROM campaigns WHERE brand_id = $1`,
      [bid],
    );
    const emailRes = await safeRows(
      `SELECT status, COUNT(*)::int AS n FROM email_marketing_campaigns
        WHERE brand_id = $1 GROUP BY status`,
      [bid],
    );
    const smsRes = await safeRows(
      `SELECT status, COUNT(*)::int AS n FROM sms_campaigns
        WHERE brand_id = $1 GROUP BY status`,
      [bid],
    );
    br.sections.campaigns = {
      ads: adRes.rows[0] || {},
      email: emailRes.rows,
      sms: smsRes.rows,
    };

    // (7) Integration status — per-brand social account connections
    const socialRes = await safeRows(
      `SELECT platform, connection_status FROM social_accounts
        WHERE brand_id = $1 ORDER BY platform`,
      [bid],
    );
    br.sections.social = socialRes.rows;
    for (const s of socialRes.rows) {
      if (s.connection_status === "error") {
        addIssue(
          "high",
          "Integrations",
          `${b.brand_name}: ${s.platform} account is in an ERROR state.`,
          `Reconnect ${s.platform} so scheduled posts can publish.`,
        );
      }
    }

    // (4) Lead pipeline
    const leadRes = await safeRows(
      `SELECT temperature, conversion_status, COUNT(*)::int AS n
         FROM leads WHERE brand_id = $1 GROUP BY temperature, conversion_status`,
      [bid],
    );
    let totalLeads = 0;
    let hotNew = 0;
    const byTemp = { hot: 0, warm: 0, tire_kicker: 0 };
    const byStatus = { new: 0, in_progress: 0, converted: 0, lost: 0 };
    for (const r of leadRes.rows) {
      totalLeads += r.n;
      if (byTemp[r.temperature] !== undefined) byTemp[r.temperature] += r.n;
      if (byStatus[r.conversion_status] !== undefined)
        byStatus[r.conversion_status] += r.n;
      if (r.temperature === "hot" && r.conversion_status === "new") hotNew += r.n;
    }
    br.sections.leads = { totalLeads, byTemp, byStatus, hotNew };
    if (hotNew > 0) {
      addIssue(
        "high",
        "Lead pipeline",
        `${b.brand_name}: ${hotNew} HOT lead(s) still marked "new" (un-actioned).`,
        "Contact hot leads now — they convert best while still fresh.",
      );
    }

    // (5) Goals & KPIs
    const goalsRes = await safeRows(
      `SELECT g.goal_id, g.label, g.metric_key, g.target_value, g.status,
              gs.percent_to_goal, gs.current_value, gs.snapshot_date
         FROM brand_goals g
         LEFT JOIN LATERAL (
           SELECT percent_to_goal, current_value, snapshot_date
             FROM goal_snapshots WHERE goal_id = g.goal_id
            ORDER BY snapshot_date DESC LIMIT 1
         ) gs ON TRUE
        WHERE g.brand_id = $1 AND g.status = 'active'
        ORDER BY g.sort_order`,
      [bid],
    );
    br.sections.goals = goalsRes.rows;
    if (goalsRes.rows.length === 0) {
      addIssue(
        "medium",
        "Goals & KPIs",
        `${b.brand_name}: no active goals defined.`,
        "Set monthly targets so progress and pacing can be tracked.",
      );
    } else {
      // Expected pace = fraction of the month elapsed.
      const daysInMonth = new Date(curYear, curMonth, 0).getDate();
      const expectedPct = (now.getUTCDate() / daysInMonth) * 100;
      for (const g of goalsRes.rows) {
        const p = g.percent_to_goal === null ? null : Number(g.percent_to_goal);
        if (p !== null && p + 15 < expectedPct) {
          addIssue(
            "medium",
            "Goals & KPIs",
            `${b.brand_name}: goal "${g.label || g.metric_key}" is behind pace ` +
              `(${pct(p)} vs ~${pct(expectedPct)} expected this far into the month).`,
            "Increase activity on this metric or adjust the target if unrealistic.",
          );
        }
      }
    }

    // (9) Voice system status — delivery health of Echo voice notifications
    const voiceRes = await safeRows(
      `SELECT status, COUNT(*)::int AS n, MAX(delivered_at) AS last_delivered
         FROM echo_voice_notifications WHERE user_id = $1 AND brand_id = $2
        GROUP BY status`,
      [userId, bid],
    );
    const voice = { pending: 0, delivered: 0, dismissed: 0, lastDelivered: null };
    for (const r of voiceRes.rows) {
      if (voice[r.status] !== undefined) voice[r.status] = r.n;
      if (r.last_delivered && (!voice.lastDelivered || r.last_delivered > voice.lastDelivered))
        voice.lastDelivered = r.last_delivered;
    }
    br.sections.voice = voice;

    // (10) Sage intelligence status
    const sageProfRes = await safeRows(
      `SELECT industry, last_refreshed_at,
              jsonb_array_length(COALESCE(marketing_insights, '[]'::jsonb)) AS insight_count
         FROM sage_intelligence_profiles WHERE brand_id = $1`,
      [bid],
    );
    const sageRunRes = await safeRows(
      `SELECT status, MAX(created_at) AS last_run
         FROM sage_research_runs WHERE brand_id = $1 GROUP BY status`,
      [bid],
    );
    const sageAlertRes = await safeRows(
      `SELECT COUNT(*)::int AS n FROM sage_alert_log
        WHERE brand_id = $1 AND alert_date >= CURRENT_DATE - INTERVAL '7 days'`,
      [bid],
    );
    const sageProfile = sageProfRes.rows[0] || null;
    const sageRuns = {};
    for (const r of sageRunRes.rows) sageRuns[r.status] = r.last_run;
    br.sections.sage = {
      profile: sageProfile,
      runs: sageRuns,
      recentAlerts: sageAlertRes.rows[0] ? sageAlertRes.rows[0].n : 0,
    };
    if (!sageProfile || !sageProfile.last_refreshed_at) {
      addIssue(
        "low",
        "Sage intelligence",
        `${b.brand_name}: industry intelligence has never completed a research run.`,
        "Let Sage run a deep-research cycle to unlock competitor & market insights.",
      );
    }
    if (sageRuns.failed && (!sageRuns.done || sageRuns.failed > sageRuns.done)) {
      addIssue(
        "medium",
        "Sage intelligence",
        `${b.brand_name}: most recent Sage research run FAILED.`,
        "Re-run Sage research and check API credits if it keeps failing.",
      );
    }

    for (const [label, r] of [
      ["content calendar", calRes],
      ["social posts", postRes],
      ["ad campaigns", adRes],
      ["email campaigns", emailRes],
      ["sms campaigns", smsRes],
      ["social accounts", socialRes],
      ["leads", leadRes],
      ["goals", goalsRes],
      ["voice notifications", voiceRes],
      ["Sage profile", sageProfRes],
      ["Sage research runs", sageRunRes],
      ["Sage alerts", sageAlertRes],
    ]) {
      noteErr(`${b.brand_name} — ${label}`, r);
    }

    brandReports.push(br);
  }

  if (readErrors.length > 0) {
    addIssue(
      "high",
      "Diagnostics",
      `${readErrors.length} subsystem(s) could not be read — the report may be incomplete.`,
      "Check the server logs and database; some data below is missing, not necessarily healthy.",
    );
  }

  return {
    account,
    brands,
    integrations,
    quotas,
    team,
    brandReports,
    issues,
    readErrors,
  };
}

/**
 * Render the gathered data into a single copyable plain-text report.
 */
function renderReport(data, generatedAt) {
  const L = [];
  const line = (s = "") => L.push(s);
  const rule = () => line("=".repeat(70));
  const sub = () => line("-".repeat(70));

  rule();
  line("ECHOAI — FULL DIAGNOSTIC REPORT");
  line(`Generated: ${fmtDateTime(generatedAt)}`);
  line(`Account:   ${data.account.email || "unknown"} (${data.account.role || "user"})`);
  rule();
  line();

  // Prioritized top-10 first — it is the headline of the report.
  const ranked = [...data.issues].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  const top = ranked.slice(0, 10);
  line("TOP 10 THINGS TO FIX OR IMPROVE (highest priority first)");
  sub();
  if (top.length === 0) {
    line("No issues detected — everything scanned looks healthy. 🎉");
  } else {
    top.forEach((it, i) => {
      line(`${i + 1}. [${SEVERITY_LABEL[it.severity]}] (${it.area}) ${it.message}`);
      line(`   → Fix: ${it.fix}`);
    });
    if (ranked.length > 10) {
      line();
      line(`(+${ranked.length - 10} more lower-priority items not shown above.)`);
    }
  }
  line();

  if (data.readErrors && data.readErrors.length > 0) {
    line("DATA READ ERRORS (report may be incomplete)");
    sub();
    for (const e of data.readErrors) line(`- ${e}`);
    line("These sections could not be read, so their status below is unknown, not healthy.");
    line();
  }

  // Account-level sections
  rule();
  line("ACCOUNT & BILLING");
  sub();
  line(`Plan tier:        ${data.account.sub_tier || data.account.subscription_tier || "free"}`);
  line(`Payment status:   ${data.account.payment_status || "n/a"}`);
  line(`Account locked:   ${data.account.is_locked ? "YES" : "no"}`);
  line(`Renewal date:     ${data.account.renewal_date || "n/a"}`);
  line(`Seats (team_size):${" "}${data.account.team_size ?? "n/a"}`);
  line(`Brands owned:     ${data.brands.length}`);
  line();

  line("INTEGRATION STATUS (account-level)");
  sub();
  if (data.integrations.length === 0) {
    line("No third-party integrations connected.");
  } else {
    for (const it of data.integrations) {
      line(`- ${it.platform}: ${it.connection_status} (updated ${fmtDateTime(it.updated_at)})`);
    }
  }
  line();

  line("API CREDITS / QUOTA");
  sub();
  if (data.quotas.length === 0) {
    line("No API quota snapshots recorded yet.");
  } else {
    for (const q of data.quotas) {
      const rem =
        q.pct_remaining !== null && q.pct_remaining !== undefined
          ? ` — ${pct(q.pct_remaining)} remaining`
          : "";
      line(`- ${q.label}: ${q.status}${rem}${q.detail ? ` (${q.detail})` : ""}`);
    }
    line(`(checked ${fmtDateTime(data.quotas[0].checked_at)})`);
  }
  line();

  line("TEAM PERFORMANCE SUMMARY");
  sub();
  if (data.team.length === 0) {
    line("No team members invited (solo account).");
  } else {
    const active = data.team.filter((t) => t.status === "active").length;
    const pending = data.team.filter((t) => t.status === "pending").length;
    line(`Members: ${data.team.length} total — ${active} active, ${pending} pending.`);
    const byRole = {};
    for (const t of data.team) byRole[t.role] = (byRole[t.role] || 0) + 1;
    line(
      "By role: " +
        Object.entries(byRole)
          .map(([r, n]) => `${r}=${n}`)
          .join(", "),
    );
  }
  line();

  // Per-brand sections
  for (const br of data.brandReports) {
    const b = br.brand;
    rule();
    line(`BRAND: ${b.brand_name}`);
    line(`Created: ${fmtDateTime(b.created_at)}`);
    rule();

    line("Brand configuration");
    sub();
    line(
      br.sections.config.missing.length === 0
        ? "Complete — personality, voice, audience and visual style all set."
        : `Incomplete — missing: ${br.sections.config.missing.join(", ")}.`,
    );
    line();

    line("Content posting schedule");
    sub();
    const sch = br.sections.schedule;
    if (sch.latestCal) {
      line(
        `Latest calendar: ${sch.latestCal.month}/${sch.latestCal.year} ` +
          `(${sch.latestCal.status}, ${sch.latestCal.posting_frequency}).`,
      );
    } else {
      line("Latest calendar: none created.");
    }
    const pc = sch.postCounts;
    line(
      `Posts — scheduled: ${pc.scheduled || 0}, published: ${pc.published || 0}, ` +
        `failed: ${pc.failed || 0}, draft: ${pc.draft || 0}, publishing: ${pc.publishing || 0}.`,
    );
    line(`Next scheduled post: ${fmtDateTime(sch.nextScheduled)}`);
    line();

    line("Campaign health");
    sub();
    const ads = br.sections.campaigns.ads;
    line(
      `Ad campaigns: ${ads.n || 0}` +
        (ads.n
          ? ` — avg conversion ${ads.avg_conv ? (Number(ads.avg_conv) * 100).toFixed(1) + "%" : "n/a"}, ` +
            `avg cost/lead ${ads.avg_cpl ? "$" + Number(ads.avg_cpl).toFixed(2) : "n/a"}, ` +
            `total budget ${ads.total_budget ? "$" + Number(ads.total_budget).toFixed(2) : "n/a"}`
          : ""),
    );
    const emailSummary = br.sections.campaigns.email
      .map((r) => `${r.status}=${r.n}`)
      .join(", ");
    const smsSummary = br.sections.campaigns.sms
      .map((r) => `${r.status}=${r.n}`)
      .join(", ");
    line(`Email campaigns: ${emailSummary || "none"}`);
    line(`SMS campaigns: ${smsSummary || "none"}`);
    line();

    line("Lead pipeline");
    sub();
    const lp = br.sections.leads;
    line(`Total leads: ${lp.totalLeads}`);
    line(
      `By temperature: hot=${lp.byTemp.hot}, warm=${lp.byTemp.warm}, ` +
        `tire_kicker=${lp.byTemp.tire_kicker}.`,
    );
    line(
      `By status: new=${lp.byStatus.new}, in_progress=${lp.byStatus.in_progress}, ` +
        `converted=${lp.byStatus.converted}, lost=${lp.byStatus.lost}.`,
    );
    line(`Hot leads still "new" (need attention): ${lp.hotNew}`);
    line();

    line("Goals & KPIs");
    sub();
    if (br.sections.goals.length === 0) {
      line("No active goals defined.");
    } else {
      for (const g of br.sections.goals) {
        const p = g.percent_to_goal === null ? "no data yet" : pct(g.percent_to_goal);
        line(
          `- ${g.label || g.metric_key}: ${p}` +
            (g.current_value !== null && g.current_value !== undefined
              ? ` (current ${Number(g.current_value)} / target ${Number(g.target_value)})`
              : ` (target ${Number(g.target_value)})`),
        );
      }
    }
    line();

    line("Automation health");
    sub();
    line(
      `Failed posts: ${pc.failed || 0}. Stuck in publishing: ${pc.publishing || 0}. ` +
        `Drafts awaiting scheduling: ${pc.draft || 0}.`,
    );
    line();

    line("Integration status (this brand's social accounts)");
    sub();
    if (br.sections.social.length === 0) {
      line("No social accounts connected.");
    } else {
      for (const s of br.sections.social) {
        line(`- ${s.platform}: ${s.connection_status}`);
      }
    }
    line();

    line("Voice system status");
    sub();
    const v = br.sections.voice;
    line(
      `Echo voice notifications — pending: ${v.pending}, delivered: ${v.delivered}, ` +
        `dismissed: ${v.dismissed}.`,
    );
    line(`Last voice delivery: ${fmtDateTime(v.lastDelivered)}`);
    line();

    line("Sage intelligence status");
    sub();
    const sg = br.sections.sage;
    if (sg.profile) {
      line(`Industry: ${sg.profile.industry || "not identified"}`);
      line(`Last research refresh: ${fmtDateTime(sg.profile.last_refreshed_at)}`);
      line(`Marketing insights on file: ${sg.profile.insight_count || 0}`);
    } else {
      line("No Sage intelligence profile yet.");
    }
    line(
      `Research runs — done: ${sg.runs.done ? "yes" : "no"}, ` +
        `failed: ${sg.runs.failed ? "yes" : "no"}. ` +
        `Alerts (last 7 days): ${sg.recentAlerts}.`,
    );
    line();
  }

  if (data.brandReports.length === 0) {
    rule();
    line("No brands found for this account — nothing to scan at the brand level.");
    line("Create a brand and complete brand discovery to begin.");
    rule();
  }

  line();
  line("End of report.");
  return L.join("\n");
}

/**
 * GET /api/admin/diagnostics/report
 */
async function generateReport(req, res) {
  try {
    const userId = req.user.userId;
    const generatedAt = new Date().toISOString();
    const data = await gatherAccount(userId);
    const report = renderReport(data, generatedAt);
    return res.json({ generatedAt, report });
  } catch (err) {
    console.error("Diagnostics generateReport error:", err);
    return res
      .status(500)
      .json({ error: "Failed to generate diagnostic report" });
  }
}

module.exports = { generateReport };
