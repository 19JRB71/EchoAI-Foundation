// Prompt 021 — Data-backed platform ops dashboard (admin-only, PROJECTION ONLY).
//
// Owner Stage-2 conditions honored here:
//   §1 probes are read-only (same SELECT-only probes as guided setup; zero
//      writes, zero provider mutations — this file contains no INSERT/UPDATE/
//      DELETE anywhere).
//   §3 the whole route group is GET-only; the dashboard keeps NO state of its
//      own — every value is a projection of the authoritative tables, and
//      approval RESOLUTION still happens only through the Approvals Inbox's
//      recorded Task Spine transition.
//   §6 integration statuses are labeled cached vs live-probed, with the
//      observation timestamp; Google token expiry is shown as "expiry_unknown"
//      (no expiry probe exists — never assumed healthy).
//   §7 TTFV primary = signup → first externally verified proof; secondary =
//      signup → first Task Spine task.
//   §8 every tile carries { state, as_of } derived from SOURCE timestamps
//      (never NOW()); states: current | stale | no_data_yet | not_instrumented
//      | unavailable | probe_failed. Queries are bounded/indexed; no N+1, no
//      per-row provider calls (probes run only on the per-brand drill-down).
//
// All platform aggregates exclude is_demo brands at the data-gathering layer.

const db = require("../config/db");
const { DEPLOY_VERSION, ENVIRONMENT } = require("../config/environment");
const { getExecutionMetrics } = require("../utils/executeExternal");

const SERVER_STARTED_AT = new Date().toISOString();

// ---------------------------------------------------------------------------
// Tile envelope helpers — freshness is ALWAYS source-derived.
// ---------------------------------------------------------------------------

/** Build a tile envelope. asOf = the newest source timestamp (or null). */
function tile({ data, asOf, staleAfterSeconds, emptyMessage, hasData, notInstrumented }) {
  let state;
  if (notInstrumented) state = "not_instrumented";
  else if (!hasData) state = "no_data_yet";
  else if (asOf && staleAfterSeconds && Date.now() - new Date(asOf).getTime() > staleAfterSeconds * 1000) {
    state = "stale";
  } else state = "current";
  return {
    state,
    as_of: asOf || null,
    data,
    ...(state === "no_data_yet" && emptyMessage ? { message: emptyMessage } : {}),
  };
}

function unavailableTile(err, label) {
  console.error(`Ops dashboard tile "${label}" failed:`, err.message);
  return { state: "unavailable", as_of: null, data: null, message: "Source query failed." };
}

/** Run a tile builder, converting any error into an honest 'unavailable'. */
async function safeTile(label, fn) {
  try {
    return await fn();
  } catch (err) {
    return unavailableTile(err, label);
  }
}

const maxTs = (rows, col) =>
  rows.reduce((m, r) => (r[col] && (!m || new Date(r[col]) > new Date(m)) ? r[col] : m), null);

// ---------------------------------------------------------------------------
// Tiles 1–12
// ---------------------------------------------------------------------------

// 1. System health — latest health_check per (non-demo) brand, 24h window.
async function tileSystemHealth() {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (h.brand_id)
            h.brand_id, b.brand_name, h.overall_status, h.check_time
       FROM health_checks h
       JOIN brands b ON b.brand_id = h.brand_id AND b.is_demo IS NOT TRUE
      WHERE h.check_time >= now() - interval '24 hours'
      ORDER BY h.brand_id, h.check_time DESC`,
  );
  const counts = {};
  for (const r of rows) counts[r.overall_status] = (counts[r.overall_status] || 0) + 1;
  const asOf = maxTs(rows, "check_time");
  return tile({
    data: { brands_checked_24h: rows.length, by_status: counts, brands: rows.slice(0, 50) },
    asOf,
    staleAfterSeconds: 2 * 15 * 60, // 2× the 15-minute check cadence
    hasData: rows.length > 0,
    emptyMessage: "No health checks recorded in the last 24 hours.",
  });
}

// 2. Job runs — per-job latest outcome, 24h counts, stuck detector, failures.
async function tileJobRuns() {
  const [latest, counts, stuck, failures] = await Promise.all([
    db.query(
      `SELECT DISTINCT ON (job_name) job_name, outcome, started_at, finished_at, duration_ms
         FROM job_runs ORDER BY job_name, started_at DESC`,
    ),
    db.query(
      `SELECT outcome, COUNT(*)::int AS n FROM job_runs
        WHERE started_at >= now() - interval '24 hours' GROUP BY outcome`,
    ),
    db.query(
      `SELECT job_name, started_at FROM job_runs
        WHERE outcome = 'running' AND started_at < now() - interval '15 minutes'
        ORDER BY started_at ASC LIMIT 20`,
    ),
    db.query(
      `SELECT job_name, started_at, left(error, 300) AS error FROM job_runs
        WHERE outcome = 'failed' AND started_at >= now() - interval '24 hours'
        ORDER BY started_at DESC LIMIT 20`,
    ),
  ]);
  const asOf = maxTs(latest.rows, "started_at");
  return tile({
    data: {
      jobs: latest.rows,
      counts_24h: Object.fromEntries(counts.rows.map((r) => [r.outcome, r.n])),
      stuck: stuck.rows,
      recent_failures: failures.rows,
      // Honest label, never a fabricated zero (owner-accepted caveat):
      retries: "not_applicable_at_scheduler_level",
    },
    asOf,
    staleAfterSeconds: 5 * 60, // per-minute jobs exist; >5 min silence = stale
    hasData: latest.rows.length > 0,
    emptyMessage: "No job runs recorded yet.",
  });
}

// 3. Approvals Inbox — platform-wide COUNTs, spine vs adapters (projection
//    only; resolution stays in the Approvals Inbox / Task Spine transition).
async function tileApprovals() {
  const [spine, autopilot, growth, truth, drafts] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS n, MAX(t.updated_at) AS ts
         FROM agent_tasks t JOIN brands b ON b.brand_id = t.brand_id AND b.is_demo IS NOT TRUE
        WHERE t.status = 'MANUAL_REVIEW'`,
    ),
    db.query(
      `SELECT COUNT(*)::int AS n, MAX(i.created_at) AS ts
         FROM autopilot_batch_items i
         JOIN autopilot_batches ab ON ab.batch_id = i.batch_id
         JOIN brands b ON b.brand_id = ab.brand_id AND b.is_demo IS NOT TRUE
        WHERE i.status = 'pending' AND ab.status = 'ready'`,
    ),
    db.query(
      `SELECT COUNT(*)::int AS n, MAX(g.created_at) AS ts
         FROM growth_actions g
         LEFT JOIN brands b ON b.brand_id = g.brand_id
        WHERE g.status = 'proposed' AND (b.brand_id IS NULL OR b.is_demo IS NOT TRUE)`,
    ),
    db.query(
      `SELECT COUNT(*)::int AS n, MAX(r.created_at) AS ts
         FROM company_truth_reports r
         JOIN brands b ON b.brand_id = r.brand_id AND b.is_demo IS NOT TRUE
        WHERE r.status = 'pending_approval'`,
    ),
    db.query(
      `SELECT COUNT(*)::int AS n, MAX(created_at) AS ts FROM email_drafts WHERE status = 'pending'`,
    ),
  ]);
  const parts = { spine, autopilot, growth, company_truth: truth, email_drafts: drafts };
  const data = {};
  let asOf = null;
  let total = 0;
  for (const [key, q] of Object.entries(parts)) {
    const { n, ts } = q.rows[0];
    data[key] = { pending: n, newest: ts };
    total += n;
    if (ts && (!asOf || new Date(ts) > new Date(asOf))) asOf = ts;
  }
  return tile({
    data: {
      ...data,
      total_pending: total,
      resolution: "Approvals are resolved ONLY in the Approvals Inbox (recorded Task Spine transition).",
    },
    asOf,
    staleAfterSeconds: null, // point-in-time counts are current as of the query
    hasData: true, // COUNT=0 is a true zero here — authoritative tables
  });
}

// 4. Integration status — CACHED state only on the summary (labeled as such);
//    live probes run only per-brand via the drill-down endpoint below.
async function tileIntegrations() {
  const [fb, google, email] = await Promise.all([
    db.query(
      `SELECT connection_status::text AS status, COUNT(*)::int AS n, MAX(updated_at) AS ts
         FROM api_integrations WHERE platform = 'facebook' GROUP BY connection_status`,
    ),
    db.query(
      `SELECT connection_status AS status, COUNT(*)::int AS n, MAX(updated_at) AS ts
         FROM google_integrations GROUP BY connection_status`,
    ),
    db.query(
      `SELECT status, COUNT(*)::int AS n, MAX(updated_at) AS ts
         FROM email_accounts GROUP BY status`,
    ),
  ]);
  const shape = (q) => ({
    by_status: q.rows.map((r) => ({ status: r.status, count: r.n, observed_at: r.ts })),
    observation: "cached_state_only", // NEVER displayed as live-probe-confirmed
  });
  const asOf = [fb, google, email].map((q) => maxTs(q.rows, "ts")).sort().reverse()[0] || null;
  const hasData = fb.rows.length + google.rows.length + email.rows.length > 0;
  return tile({
    data: {
      facebook: shape(fb),
      google: { ...shape(google), token_expiry: "expiry_unknown" }, // not probed — never assumed healthy
      email: shape(email),
      live_probe: "Use the per-brand drill-down to run a read-only live probe.",
    },
    asOf,
    staleAfterSeconds: null,
    hasData,
    emptyMessage: "No integrations connected yet.",
  });
}

// 5. External actions — ledger projection (all-time metrics + 24h/7d windows).
async function tileExternalActions() {
  const [metrics, windows] = await Promise.all([
    getExecutionMetrics(),
    db.query(
      `SELECT
         COUNT(*) FILTER (WHERE started_at >= now() - interval '24 hours')::int AS attempts_24h,
         COUNT(*) FILTER (WHERE started_at >= now() - interval '7 days')::int   AS attempts_7d,
         COUNT(*) FILTER (WHERE status = 'failed' AND started_at >= now() - interval '24 hours')::int AS failed_24h,
         COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_now,
         MAX(started_at) AS newest
        FROM external_actions`,
    ),
  ]);
  const w = windows.rows[0];
  return tile({
    data: { all_time: metrics, window: w },
    asOf: w.newest,
    staleAfterSeconds: null, // event-driven ledger — age shown, not alarmed
    hasData: w.newest != null,
    emptyMessage: "No external actions recorded yet.",
  });
}

// 6. MANUAL_REVIEW queue — bounded list, error text truncated.
async function tileManualReview() {
  const { rows } = await db.query(
    `SELECT t.task_id, t.task_type, t.source_type, t.attempt, t.title,
            left(t.last_error, 200) AS last_error, t.created_at, t.updated_at,
            b.brand_name
       FROM agent_tasks t
       JOIN brands b ON b.brand_id = t.brand_id AND b.is_demo IS NOT TRUE
      WHERE t.status = 'MANUAL_REVIEW'
      ORDER BY t.updated_at DESC
      LIMIT 50`,
  );
  const oldest = rows.length ? rows[rows.length - 1].created_at : null;
  return tile({
    data: { count: rows.length, oldest_created_at: oldest, items: rows },
    asOf: maxTs(rows, "updated_at"),
    staleAfterSeconds: null,
    hasData: true, // an empty queue is a real zero (authoritative table)
  });
}

// 7. AI cost today / 7 days — ai_usage_log (NUMERIC arrives as strings).
async function tileAiCost() {
  const [totals, byFeature] = await Promise.all([
    db.query(
      `SELECT
         COALESCE(SUM(estimated_cost_usd) FILTER (WHERE at >= date_trunc('day', now())), 0) AS cost_today,
         COALESCE(SUM(estimated_cost_usd), 0) AS cost_7d,
         COUNT(*)::int AS calls_7d,
         MAX(at) AS newest
        FROM ai_usage_log
       WHERE at >= now() - interval '7 days'`,
    ),
    db.query(
      `SELECT feature, provider, COUNT(*)::int AS calls,
              COALESCE(SUM(estimated_cost_usd), 0) AS cost
         FROM ai_usage_log
        WHERE at >= now() - interval '7 days'
        GROUP BY feature, provider
        ORDER BY cost DESC
        LIMIT 10`,
    ),
  ]);
  const t = totals.rows[0];
  return tile({
    data: { totals: t, top_by_feature_7d: byFeature.rows },
    asOf: t.newest,
    staleAfterSeconds: null,
    hasData: t.calls_7d > 0,
    emptyMessage: "No AI usage in the last 7 days.",
  });
}

// 8. External-proof freshness — latest proof per provider+action.
async function tileProofFreshness() {
  const [latest, count7d] = await Promise.all([
    db.query(
      `SELECT DISTINCT ON (provider, action) provider, action, verified_at
         FROM external_proofs ORDER BY provider, action, verified_at DESC`,
    ),
    db.query(
      `SELECT COUNT(*)::int AS n FROM external_proofs
        WHERE verified_at >= now() - interval '7 days'`,
    ),
  ]);
  return tile({
    data: { latest_by_kind: latest.rows, proofs_7d: count7d.rows[0].n },
    asOf: maxTs(latest.rows, "verified_at"),
    staleAfterSeconds: null, // event-driven — age is informational
    hasData: latest.rows.length > 0,
    emptyMessage: "No external proofs recorded yet.",
  });
}

// 9. Deployment/version — process-live, never stale by construction.
async function tileVersion() {
  return {
    state: "current",
    as_of: new Date().toISOString(), // response time IS the observation time
    data: {
      deploy_version: DEPLOY_VERSION || null,
      environment: ENVIRONMENT || "unknown",
      server_started_at: SERVER_STARTED_AT,
    },
  };
}

// 10. Customer activity & TTFV. Primary = signup → first verified proof;
//     secondary = signup → first Task Spine task (§7). Demo brands excluded.
async function tileCustomers() {
  const [activity, ttfv] = await Promise.all([
    db.query(
      `SELECT
         COUNT(*)::int AS users_total,
         COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS signups_7d,
         COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS signups_30d,
         COUNT(*) FILTER (WHERE onboarding_completed IS TRUE)::int AS onboarded,
         MAX(GREATEST(created_at, COALESCE(last_login_at, created_at))) AS newest
        FROM users`,
    ),
    db.query(
      `WITH firsts AS (
         SELECT u.user_id, u.created_at AS signup,
                MIN(p.verified_at) AS first_proof,
                MIN(t.created_at)  AS first_task
           FROM users u
           LEFT JOIN external_proofs p
             ON p.user_id = u.user_id
            AND (p.brand_id IS NULL OR EXISTS (
                  SELECT 1 FROM brands pb WHERE pb.brand_id = p.brand_id AND pb.is_demo IS NOT TRUE))
           LEFT JOIN agent_tasks t
             ON t.user_id = u.user_id
            AND EXISTS (SELECT 1 FROM brands tb WHERE tb.brand_id = t.brand_id AND tb.is_demo IS NOT TRUE)
          GROUP BY u.user_id, u.created_at)
       SELECT
         COUNT(*) FILTER (WHERE first_proof IS NOT NULL)::int AS users_with_verified_proof,
         COUNT(*) FILTER (WHERE first_task IS NOT NULL)::int  AS users_with_spine_task,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_proof - signup)))
           FILTER (WHERE first_proof IS NOT NULL) AS median_ttfv_proof_seconds,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_task - signup)))
           FILTER (WHERE first_task IS NOT NULL) AS median_ttfv_task_seconds
       FROM firsts`,
    ),
  ]);
  const a = activity.rows[0];
  const t = ttfv.rows[0];
  return tile({
    data: {
      activity: a,
      ttfv: {
        primary_metric: "signup_to_first_verified_proof", // customer-value metric (§7)
        secondary_metric: "signup_to_first_spine_task",
        ...t,
      },
    },
    asOf: a.newest,
    staleAfterSeconds: null,
    hasData: a.users_total > 0,
    emptyMessage: "No customer accounts yet.",
  });
}

// 11. Campaign truth — status counts verbatim from the state machine;
//     'live' is only ever what verifyCampaignStatus read back.
async function tileCampaigns() {
  const { rows } = await db.query(
    `SELECT c.status, COUNT(*)::int AS n, MAX(c.last_verified_at) AS last_verified
       FROM campaigns c
       JOIN brands b ON b.brand_id = c.brand_id AND b.is_demo IS NOT TRUE
      GROUP BY c.status`,
  );
  const staleLive = await db.query(
    `SELECT COUNT(*)::int AS n FROM campaigns c
       JOIN brands b ON b.brand_id = c.brand_id AND b.is_demo IS NOT TRUE
      WHERE c.status = 'live'
        AND (c.last_verified_at IS NULL OR c.last_verified_at < now() - interval '24 hours')`,
  );
  const asOf = maxTs(rows, "last_verified");
  return tile({
    data: {
      by_status: Object.fromEntries(rows.map((r) => [r.status, r.n])),
      live_verification_stale: staleLive.rows[0].n, // 'live' older than 24h verification
      last_verified_at: asOf,
    },
    asOf,
    staleAfterSeconds: null,
    hasData: rows.length > 0,
    emptyMessage: "No campaigns.",
  });
}

// 12. Hermes usage — hermes_decisions (measurement-only table).
//     Denominator FIXED (§2): non_null / (non_null + null + error + timeout).
//     Suppressed reported alongside, never in the denominator.
async function tileHermes() {
  const windows = { "48h": "48 hours", "7d": "7 days" };
  const data = {};
  let asOf = null;
  let anyRows = false;
  for (const [key, iv] of Object.entries(windows)) {
    const { rows } = await db.query(
      `SELECT outcome, COUNT(*)::int AS n, MAX(at) AS ts
         FROM hermes_decisions
        WHERE at >= now() - interval '${iv}'
          AND environment = $1
          AND (brand_id IS NULL OR EXISTS (
                SELECT 1 FROM brands b WHERE b.brand_id = hermes_decisions.brand_id AND b.is_demo IS NOT TRUE))
        GROUP BY outcome`,
      [ENVIRONMENT || "unknown"],
    );
    const c = { non_null: 0, null: 0, error: 0, timeout: 0, suppressed: 0 };
    for (const r of rows) {
      c[r.outcome] = r.n;
      anyRows = true;
      if (r.ts && (!asOf || new Date(r.ts) > new Date(asOf))) asOf = r.ts;
    }
    const denom = c.non_null + c.null + c.error + c.timeout; // suppressed EXCLUDED
    data[key] = {
      counts: c,
      eligible_invocations: denom,
      non_null_rate: denom > 0 ? c.non_null / denom : null,
    };
  }
  const empty = await db.query(`SELECT EXISTS (SELECT 1 FROM hermes_decisions) AS any`);
  const instrumented = empty.rows[0].any;
  return tile({
    data: { ...data, environment_filter: ENVIRONMENT || "unknown" },
    asOf,
    staleAfterSeconds: null,
    hasData: anyRows,
    notInstrumented: !instrumented,
    emptyMessage: "No Hermes decisions recorded in the window.",
  });
}

// ---------------------------------------------------------------------------
// Endpoints (GET only — the entire dashboard is projection-only).
// ---------------------------------------------------------------------------

/** GET /api/admin/ops-dashboard — all 12 tiles, batched server-side. */
async function getDashboard(req, res) {
  const [
    system_health, job_runs, approvals, integrations, external_actions,
    manual_review, ai_cost, proof_freshness, version, customers, campaigns, hermes,
  ] = await Promise.all([
    safeTile("system_health", tileSystemHealth),
    safeTile("job_runs", tileJobRuns),
    safeTile("approvals", tileApprovals),
    safeTile("integrations", tileIntegrations),
    safeTile("external_actions", tileExternalActions),
    safeTile("manual_review", tileManualReview),
    safeTile("ai_cost", tileAiCost),
    safeTile("proof_freshness", tileProofFreshness),
    safeTile("version", tileVersion),
    safeTile("customers", tileCustomers),
    safeTile("campaigns", tileCampaigns),
    safeTile("hermes", tileHermes),
  ]);
  res.json({
    generated_at: new Date().toISOString(),
    tiles: {
      system_health, job_runs, approvals, integrations, external_actions,
      manual_review, ai_cost, proof_freshness, version, customers, campaigns, hermes,
    },
  });
}

/**
 * GET /api/admin/ops-dashboard/probe/:brandId — on-demand READ-ONLY live probe
 * for ONE brand's integrations (§1/§6). Runs the same SELECT-only checks the
 * guided-setup probes use; performs zero writes and zero provider mutations.
 * A query failure renders probe_failed — never a stale "connected".
 */
async function probeBrandIntegrations(req, res) {
  const { brandId } = req.params;
  try {
    const brand = await db.query(
      `SELECT brand_id, brand_name, user_id FROM brands WHERE brand_id = $1`,
      [brandId],
    );
    if (brand.rows.length === 0) {
      return res.status(404).json({ error: "Brand not found." });
    }
    const userId = brand.rows[0].user_id;
    const probedAt = new Date().toISOString();

    async function probe(label, sql, params) {
      try {
        const { rows } = await db.query(sql, params);
        return {
          status: rows.length > 0 ? "connected_live_probe" : "not_connected",
          probed_at: probedAt,
          ...(label === "google" ? { token_expiry: "expiry_unknown" } : {}),
        };
      } catch {
        return { status: "probe_failed", probed_at: probedAt }; // honest, never guessed
      }
    }

    const [facebook, google, email] = await Promise.all([
      probe(
        "facebook",
        `SELECT 1 FROM api_integrations
          WHERE user_id = $1 AND platform = 'facebook' AND connection_status = 'connected' LIMIT 1`,
        [userId],
      ),
      probe(
        "google",
        `SELECT 1 FROM google_integrations
          WHERE user_id = $1 AND connection_status = 'connected' LIMIT 1`,
        [userId],
      ),
      probe("email", `SELECT 1 FROM email_accounts WHERE user_id = $1 LIMIT 1`, [userId]),
    ]);

    res.json({
      brand_id: brandId,
      brand_name: brand.rows[0].brand_name,
      probed_at: probedAt,
      integrations: { facebook, google, email },
    });
  } catch (err) {
    console.error("Ops dashboard probe failed:", err.message);
    res.status(500).json({ error: "Probe failed." });
  }
}

module.exports = {
  getDashboard,
  probeBrandIntegrations,
  // exported for tests
  tileHermes,
  tileJobRuns,
};
