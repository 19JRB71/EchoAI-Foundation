// Echo Self-Review — Sage's weekly study of the PLATFORM itself (admin-only).
//
// Every Monday Sage reads the past week of real operational data — publish
// failures, SMS/email failures, health-check results, API quota alerts,
// customer feedback, feature requests, learning signals, support tickets and
// feature adoption — and asks Claude to distill it into ranked, evidence-based
// improvement recommendations for the platform admin.
//
// Invariants (match the platform's honesty + concurrency rules):
//  - RECOMMENDATION-ONLY. This module never changes any system; it only writes
//    its own report tables.
//  - Every probe is read-only and individually guarded: a failed read is
//    recorded in evidence.readErrors ("could not be read") — never silently
//    reported as zero/healthy.
//  - Demo brands (brands.is_demo) are excluded at the query layer.
//  - One report per ISO week, claimed atomically via the UNIQUE week_start
//    INSERT. Terminal writes are status-guarded (WHERE status = 'running').
//  - Evidence is persisted BEFORE the AI call, so a failed report still shows
//    the real gathered data. AI failure marks the report 'failed' with the
//    honest reason — nothing is fabricated.

const db = require("../config/db");
const { MODEL, createMessage } = require("../config/anthropic");

const EVIDENCE_WINDOW_DAYS = 7;
const MAX_RECOMMENDATIONS = 10;

/** Monday (UTC date string YYYY-MM-DD) of the week containing `now`. */
function weekStartOf(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

async function safeRows(sql, params) {
  try {
    const { rows } = await db.query(sql, params);
    return { rows, error: null };
  } catch (err) {
    console.error("Self-review probe error:", err.message);
    return { rows: [], error: err.message };
  }
}

/**
 * Gather the week's platform evidence. Read-only; never throws. Every probe
 * failure is surfaced in `readErrors` so the report can say "could not be
 * read" instead of implying "all healthy".
 */
async function gatherEvidence() {
  const readErrors = [];
  const note = (label, r) => {
    if (r && r.error) readErrors.push(`${label}: ${r.error}`);
  };

  // --- Operational failures --------------------------------------------------
  const failedPosts = await safeRows(
    `SELECT sp.platform, COUNT(*)::int AS n,
            MAX(sp.engagement_metrics ->> 'error') AS sample_error
       FROM social_posts sp
       JOIN brands b ON b.brand_id = sp.brand_id AND b.is_demo = false
      WHERE sp.status = 'failed'
        AND sp.updated_at >= NOW() - ($1 || ' days')::interval
      GROUP BY sp.platform
      ORDER BY n DESC`,
    [EVIDENCE_WINDOW_DAYS],
  );
  note("Failed social posts", failedPosts);

  const smsFailures = await safeRows(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE m.error_permanent IS TRUE)::int AS permanent,
            MAX(m.error_message) AS sample_error
       FROM sms_messages m
       JOIN brands b ON b.brand_id = m.brand_id AND b.is_demo = false
      WHERE m.direction = 'outbound'
        AND m.delivery_status = 'failed'
        AND m.created_at >= NOW() - ($1 || ' days')::interval`,
    [EVIDENCE_WINDOW_DAYS],
  );
  note("SMS failures", smsFailures);

  const emailFailures = await safeRows(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE r.send_error_permanent IS TRUE)::int AS permanent,
            MAX(r.send_error) AS sample_error
       FROM email_marketing_recipients r
       JOIN email_marketing_campaigns c ON c.campaign_id = r.campaign_id
       JOIN brands b ON b.brand_id = c.brand_id AND b.is_demo = false
      WHERE r.delivery_status = 'failed'
        AND r.updated_at >= NOW() - ($1 || ' days')::interval`,
    [EVIDENCE_WINDOW_DAYS],
  );
  note("Email failures", emailFailures);

  const healthChecks = await safeRows(
    `SELECT hc.overall_status, COUNT(*)::int AS n
       FROM health_checks hc
       JOIN brands b ON b.brand_id = hc.brand_id AND b.is_demo = false
      WHERE hc.created_at >= NOW() - ($1 || ' days')::interval
      GROUP BY hc.overall_status
      ORDER BY n DESC`,
    [EVIDENCE_WINDOW_DAYS],
  );
  note("Health checks", healthChecks);

  const quotaAlerts = await safeRows(
    `SELECT provider, label, status, pct_remaining, detail, checked_at
       FROM api_quota_snapshots
      WHERE status IN ('low', 'critical', 'error')
      ORDER BY provider`,
    [],
  );
  note("API quota levels", quotaAlerts);

  const quotaAlertLog = await safeRows(
    `SELECT provider, severity, COUNT(*)::int AS n
       FROM api_quota_alert_log
      WHERE created_at >= NOW() - ($1 || ' days')::interval
      GROUP BY provider, severity`,
    [EVIDENCE_WINDOW_DAYS],
  );
  note("API quota alert log", quotaAlertLog);

  const supportTickets = await safeRows(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE resolution_status = 'open')::int AS open
       FROM support_tickets
      WHERE created_at >= NOW() - ($1 || ' days')::interval`,
    [EVIDENCE_WINDOW_DAYS],
  );
  note("Support tickets", supportTickets);

  // --- Customer voice ---------------------------------------------------------
  const featureSuggestions = await safeRows(
    `SELECT title, request_count, status
       FROM feature_suggestions
      WHERE status = 'pending'
      ORDER BY request_count DESC, created_at DESC
      LIMIT 8`,
    [],
  );
  note("Feature suggestions", featureSuggestions);

  const feedback = await safeRows(
    `SELECT COUNT(*)::int AS responses,
            ROUND(AVG(sr.sentiment_score)::numeric, 1) AS avg_sentiment
       FROM survey_responses sr
       JOIN surveys s ON s.survey_id = sr.survey_id
       JOIN brands b ON b.brand_id = s.brand_id AND b.is_demo = false
      WHERE sr.created_at >= NOW() - ($1 || ' days')::interval`,
    [EVIDENCE_WINDOW_DAYS],
  );
  note("Customer feedback", feedback);

  const learningSignals = await safeRows(
    `SELECT ls.source, ls.action, COUNT(*)::int AS n
       FROM echo_learning_signals ls
       JOIN brands b ON b.brand_id = ls.brand_id AND b.is_demo = false
      WHERE ls.created_at >= NOW() - ($1 || ' days')::interval
      GROUP BY ls.source, ls.action
      ORDER BY ls.source, ls.action`,
    [EVIDENCE_WINDOW_DAYS],
  );
  note("Learning signals", learningSignals);

  // --- Adoption (what real brands actually used this week) -------------------
  const adoption = await safeRows(
    `SELECT
       (SELECT COUNT(*)::int FROM social_posts sp
          JOIN brands b ON b.brand_id = sp.brand_id AND b.is_demo = false
         WHERE sp.created_at >= NOW() - ($1 || ' days')::interval) AS social_posts,
       (SELECT COUNT(*)::int FROM email_marketing_campaigns c
          JOIN brands b ON b.brand_id = c.brand_id AND b.is_demo = false
         WHERE c.created_at >= NOW() - ($1 || ' days')::interval) AS email_campaigns,
       (SELECT COUNT(*)::int FROM sms_messages m
          JOIN brands b ON b.brand_id = m.brand_id AND b.is_demo = false
         WHERE m.direction = 'outbound'
           AND m.created_at >= NOW() - ($1 || ' days')::interval) AS sms_sent,
       (SELECT COUNT(*)::int FROM brands WHERE is_demo = false) AS real_brands`,
    [EVIDENCE_WINDOW_DAYS],
  );
  note("Feature adoption", adoption);

  return {
    windowDays: EVIDENCE_WINDOW_DAYS,
    gatheredAt: new Date().toISOString(),
    failedSocialPosts: failedPosts.rows,
    smsFailures: smsFailures.rows[0] || null,
    emailFailures: emailFailures.rows[0] || null,
    healthChecks: healthChecks.rows,
    quotaAlerts: quotaAlerts.rows,
    quotaAlertLog: quotaAlertLog.rows,
    supportTickets: supportTickets.rows[0] || null,
    featureSuggestions: featureSuggestions.rows,
    feedback: feedback.rows[0] || null,
    learningSignals: learningSignals.rows,
    adoption: adoption.rows[0] || null,
    readErrors,
  };
}

function buildPrompt(evidence) {
  return [
    "You are Sage, the strategy analyst for Zorecho, an AI marketing platform.",
    "Below is REAL operational data from the past week. Study it and propose",
    "the highest-impact platform improvements.",
    "",
    "STRICT RULES:",
    "- Base every recommendation ONLY on the data below. Never invent numbers,",
    "  users, failures or trends that are not in the data.",
    "- If a section could not be read (see readErrors), you may recommend",
    "  investigating it, but never guess what it would have contained.",
    "- If the data is thin, return fewer recommendations — an empty week is a",
    "  valid answer with 1-2 modest recommendations.",
    `- At most ${MAX_RECOMMENDATIONS} recommendations, ranked by impact.`,
    "- Each recommendation must cite its evidence (the actual counts/errors).",
    "",
    "DATA:",
    JSON.stringify(evidence, null, 2),
    "",
    "Respond with ONLY this JSON (no prose, no code fences):",
    '{ "summary": "2-4 sentence executive summary of the week",',
    '  "recommendations": [ { "title": "...", "recommendation": "what to improve and why",',
    '    "evidence": "the real data backing this", "impact": "high|medium|low" } ] }',
  ].join("\n");
}

function parseAiReport(raw) {
  const text = String(raw || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("AI returned no JSON report");
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("AI returned unparseable JSON");
  }
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  if (!summary) throw new Error("AI report missing summary");
  const recs = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  const items = recs
    .filter(
      (r) =>
        r &&
        typeof r.title === "string" &&
        r.title.trim() &&
        typeof r.recommendation === "string" &&
        r.recommendation.trim(),
    )
    .slice(0, MAX_RECOMMENDATIONS)
    .map((r, i) => ({
      rank: i + 1,
      title: r.title.trim().slice(0, 200),
      recommendation: r.recommendation.trim().slice(0, 2000),
      evidence: typeof r.evidence === "string" ? r.evidence.trim().slice(0, 1000) : null,
      impact: ["high", "medium", "low"].includes(r.impact) ? r.impact : "medium",
    }));
  if (items.length === 0) throw new Error("AI report contained no valid recommendations");
  return { summary: summary.slice(0, 4000), items };
}

/**
 * Generate the report body for an already-claimed 'running' report row.
 * Returns { status: 'completed' | 'failed', error? }.
 */
async function generateReport(reportId) {
  // 1. Gather (never throws) and persist evidence FIRST — even a failed report
  //    shows the real data that was collected.
  const evidence = await module.exports.gatherEvidence();
  await db.query(
    `UPDATE self_review_reports SET evidence = $2
      WHERE report_id = $1 AND status = 'running'`,
    [reportId, JSON.stringify(evidence)],
  );

  // 2. AI distillation. Failure → honest 'failed' report, never fabricated.
  let report;
  try {
    const response = await createMessage(
      {
        model: MODEL,
        max_tokens: 3000,
        messages: [{ role: "user", content: buildPrompt(evidence) }],
      },
      { timeout: 120000, label: "Self-review study" },
    );
    const text = (response.content || [])
      .filter((blk) => blk.type === "text")
      .map((blk) => blk.text)
      .join("\n");
    report = parseAiReport(text);
  } catch (err) {
    const reason = `AI study failed: ${err.message}`.slice(0, 500);
    await db.query(
      `UPDATE self_review_reports
          SET status = 'failed', error = $2, completed_at = NOW()
        WHERE report_id = $1 AND status = 'running'`,
      [reportId, reason],
    );
    return { status: "failed", error: reason };
  }

  // 3. Persist items + finalize in one transaction, status-guarded so an
  //    out-of-band change to the row is never clobbered.
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const finalized = await client.query(
      `UPDATE self_review_reports
          SET status = 'completed', summary = $2, completed_at = NOW()
        WHERE report_id = $1 AND status = 'running'`,
      [reportId, report.summary],
    );
    if (finalized.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: "failed", error: "Report row changed out-of-band; not finalized" };
    }
    for (const item of report.items) {
      await client.query(
        `INSERT INTO self_review_items
           (report_id, rank, title, recommendation, evidence, impact)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [reportId, item.rank, item.title, item.recommendation, item.evidence, item.impact],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { status: "completed" };
}

/**
 * Run the self-review for the current week. Claims the week atomically —
 * overlapping runs (cron + manual, double ticks) resolve to exactly one
 * generation. `rerunFailed: true` (manual runs) atomically resets a 'failed'
 * week and regenerates it.
 *
 * Returns { status: 'completed'|'failed'|'skipped'|'already_completed'|
 *           'already_running', reportId?, error? }.
 */
async function runWeeklySelfReview({ rerunFailed = false } = {}) {
  const weekStart = weekStartOf();

  // Atomic claim: INSERT the unique week row; losers get no row back.
  const claimed = await db.query(
    `INSERT INTO self_review_reports (week_start)
     VALUES ($1)
     ON CONFLICT (week_start) DO NOTHING
     RETURNING report_id`,
    [weekStart],
  );

  let reportId = claimed.rows[0] && claimed.rows[0].report_id;

  if (!reportId) {
    // Week already has a row — completed, running, or failed.
    const existing = await db.query(
      `SELECT report_id, status FROM self_review_reports WHERE week_start = $1`,
      [weekStart],
    );
    const row = existing.rows[0];
    if (!row) return { status: "skipped" };
    if (row.status === "completed")
      return { status: "already_completed", reportId: row.report_id };
    if (row.status === "running") return { status: "already_running", reportId: row.report_id };
    // status === 'failed'
    if (!rerunFailed) return { status: "failed", reportId: row.report_id };
    // Atomic rerun reset: the status-guarded failed->running flip AND the
    // stale-item delete commit together (or not at all), so a crash between
    // them can never leave a 'running' week still carrying the old items.
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const reset = await client.query(
        `UPDATE self_review_reports
            SET status = 'running', error = NULL, summary = NULL, completed_at = NULL
          WHERE week_start = $1 AND status = 'failed'
          RETURNING report_id`,
        [weekStart],
      );
      if (reset.rowCount === 0) {
        // Someone else reset/completed it between our read and update.
        await client.query("ROLLBACK");
        return { status: "already_running", reportId: row.report_id };
      }
      reportId = reset.rows[0].report_id;
      await client.query(`DELETE FROM self_review_items WHERE report_id = $1`, [reportId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  const result = await module.exports.generateReport(reportId);
  if (result.status === "completed") {
    console.log(`Self-review complete for week ${weekStart}.`);
  } else {
    console.error(`Self-review failed for week ${weekStart}: ${result.error}`);
  }
  return { ...result, reportId };
}

module.exports = {
  weekStartOf,
  gatherEvidence,
  buildPrompt,
  parseAiReport,
  generateReport,
  runWeeklySelfReview,
  EVIDENCE_WINDOW_DAYS,
  MAX_RECOMMENDATIONS,
};
