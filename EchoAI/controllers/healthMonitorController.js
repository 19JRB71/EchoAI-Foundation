// AI Health Monitor + Screenshot Support controller.
//
// The Health Monitor continuously watches every brand for errors across every
// integrated system (Facebook, Twilio, Stripe, email, scheduler, OAuth tokens,
// follow-ups, SMS, webhooks), silently auto-fixes safe/transient problems, and
// only bothers the owner when something CRITICAL needs them or an auto-fix
// failed. Screenshot Support lets a user send a screenshot + description to an
// AI agent that analyzes what they see and explains or resolves it.
//
// Conventions honored:
//  - Ownership: brand-scoped reads/writes join brands on user_id (getOwnedBrand).
//  - AI failures → 502 on user-facing endpoints (never mocked). Background runs
//    swallow AI failures (best-effort) so one brand can't stop the hourly sweep.
//  - Detection probes are individually try/caught so a single failing probe (or
//    a not-yet-migrated table) never crashes the whole health check.
//  - Screenshots are persisted to disk (uploads/support); only the permanent
//    relative URL is stored.

const crypto = require("crypto");
const path = require("path");
const fs = require("fs/promises");
const db = require("../config/db");
const {
  generateHealthAnalysis,
  analyzeSupportScreenshot,
} = require("../prompts/healthMonitorPrompt");
const pushController = require("./pushController");
const mobilePushController = require("./mobilePushController");
const { sendEmail } = require("../utils/email");

const UPLOADS_DIR = path.join(__dirname, "..", "uploads", "support");
const PUBLIC_PREFIX = "/uploads/support";
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024; // 8 MB

// Severity ranking so overall status is the worst severity present.
const SEVERITY_RANK = { info: 1, warning: 2, critical: 3 };

async function getOwnedBrand(userId, brandId) {
  const result = await db.query(
    `SELECT brand_id, brand_name, user_id
     FROM brands
     WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId],
  );
  return result.rows[0] || null;
}

function statusFromIssues(issues) {
  let worst = 0;
  for (const i of issues) {
    const r = SEVERITY_RANK[i.severity] || 1;
    if (r > worst) worst = r;
  }
  if (worst >= 3) return "critical";
  if (worst >= 2) return "warning";
  return "healthy";
}

// --- Detection probes -------------------------------------------------------
// Each probe returns an array of issue objects:
//   { type, system, severity, message, detail?, autoFixable }
// Probes never throw (individually try/caught by runHealthCheck's caller of
// safeProbe) so a single failure can't abort the whole check.

async function probeFacebook(brandId) {
  const { rows } = await db.query(
    `SELECT platform, connection_status
     FROM social_accounts
     WHERE brand_id = $1 AND platform = 'facebook' AND connection_status = 'error'`,
    [brandId],
  );
  return rows.map(() => ({
    type: "facebook_connection_error",
    system: "Facebook",
    severity: "warning",
    message: "Your Facebook connection is reporting an error.",
    detail: "Reconnect Facebook so ads and lead syncing keep working.",
    autoFixable: false,
  }));
}

async function probeTwilio(brandId) {
  const { rows } = await db.query(
    `SELECT connection_status
     FROM twilio_config
     WHERE brand_id = $1 AND connection_status <> 'connected'`,
    [brandId],
  );
  return rows.map((r) => ({
    type: "twilio_connection_error",
    system: "Twilio (phone/SMS)",
    severity: "warning",
    message: "Your phone/SMS (Twilio) connection is not active.",
    detail: `Connection status is "${r.connection_status}". Reconnect Twilio in Settings.`,
    autoFixable: false,
  }));
}

async function probeStripe(brandId, userId) {
  // Billing is per-user, not per-brand. A past-due or locked subscription is a
  // critical issue the owner must resolve to keep using EchoAI.
  const { rows } = await db.query(
    `SELECT payment_status, is_locked, failed_payment_at
     FROM subscriptions
     WHERE user_id = $1`,
    [userId],
  );
  const s = rows[0];
  if (!s) return [];
  const issues = [];
  if (s.is_locked) {
    issues.push({
      type: "subscription_locked",
      system: "Billing",
      severity: "critical",
      message: "Your account is locked due to a billing problem.",
      detail: "Update your payment method to restore full access.",
      autoFixable: false,
    });
  } else if (s.payment_status && s.payment_status !== "active") {
    issues.push({
      type: "subscription_payment_failed",
      system: "Billing",
      severity: "critical",
      message: "Your last payment did not go through.",
      detail: "Update the card on file before your account is locked.",
      autoFixable: false,
    });
  }
  return issues;
}

async function probeExpiredTokens(brandId) {
  // OAuth/social tokens that dropped to a non-connected state (excluding the
  // Facebook error already reported above) indicate an expired/revoked token.
  const { rows } = await db.query(
    `SELECT platform, connection_status
     FROM social_accounts
     WHERE brand_id = $1 AND connection_status = 'error' AND platform <> 'facebook'`,
    [brandId],
  );
  return rows.map((r) => ({
    type: "expired_token",
    system: `${r.platform} connection`,
    severity: "warning",
    message: `Your ${r.platform} connection needs to be reauthorized.`,
    detail: "Reconnect the account so scheduled posts keep publishing.",
    autoFixable: false,
  }));
}

async function probeScheduler(brandId) {
  // If touchpoints are well past their scheduled time but still pending, the
  // scheduler is likely not keeping up (or is down) — a warning worth surfacing.
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM sequence_touchpoints t
     JOIN follow_up_sequences s ON s.sequence_id = t.sequence_id
     WHERE s.brand_id = $1
       AND t.status = 'pending'
       AND t.scheduled_at < now() - interval '2 hours'`,
    [brandId],
  );
  const n = rows[0]?.n || 0;
  if (n === 0) return [];
  return [
    {
      type: "scheduler_backlog",
      system: "Scheduler",
      severity: "warning",
      message: `${n} follow-up message${n === 1 ? "" : "s"} are overdue and haven't sent.`,
      detail: "The automated scheduler is behind. EchoAI will retry these automatically.",
      autoFixable: false,
    },
  ];
}

async function probeEmailFailures(brandId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM sequence_touchpoints t
     JOIN follow_up_sequences s ON s.sequence_id = t.sequence_id
     WHERE s.brand_id = $1
       AND t.channel = 'email'
       AND t.status = 'failed'
       AND t.updated_at > now() - interval '24 hours'`,
    [brandId],
  );
  const n = rows[0]?.n || 0;
  if (n === 0) return [];
  return [
    {
      type: "email_delivery_failed",
      system: "Email delivery",
      severity: "warning",
      message: `${n} follow-up email${n === 1 ? "" : "s"} failed to send in the last 24 hours.`,
      detail: "Check the recipient addresses and your email settings.",
      autoFixable: false,
    },
  ];
}

async function probeFollowUpFailures(brandId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM sequence_touchpoints t
     JOIN follow_up_sequences s ON s.sequence_id = t.sequence_id
     WHERE s.brand_id = $1
       AND t.channel <> 'email'
       AND t.status = 'failed'
       AND t.updated_at > now() - interval '24 hours'`,
    [brandId],
  );
  const n = rows[0]?.n || 0;
  if (n === 0) return [];
  return [
    {
      type: "followup_failed",
      system: "Follow-up sequences",
      severity: "info",
      message: `${n} follow-up touchpoint${n === 1 ? "" : "s"} failed in the last 24 hours.`,
      detail: "Some automated follow-ups could not be delivered.",
      autoFixable: false,
    },
  ];
}

async function probeSmsFailures(brandId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM sms_messages
     WHERE brand_id = $1
       AND direction = 'outbound'
       AND delivery_status IN ('failed', 'undelivered')
       AND created_at > now() - interval '24 hours'`,
    [brandId],
  );
  const n = rows[0]?.n || 0;
  if (n === 0) return [];
  return [
    {
      type: "sms_delivery_failed",
      system: "SMS delivery",
      severity: "warning",
      message: `${n} text message${n === 1 ? "" : "s"} failed to deliver in the last 24 hours.`,
      detail: "Verify the phone numbers and your Twilio number's status.",
      autoFixable: false,
    },
  ];
}

async function probeWebhookFailures(brandId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM webhook_delivery_logs l
     JOIN webhooks w ON w.webhook_id = l.webhook_id
     WHERE w.brand_id = $1
       AND l.success = FALSE
       AND l.delivered_at > now() - interval '24 hours'`,
    [brandId],
  );
  const n = rows[0]?.n || 0;
  if (n === 0) return [];
  return [
    {
      type: "webhook_delivery_failed",
      system: "Webhooks (Zapier)",
      severity: "info",
      message: `${n} webhook${n === 1 ? "" : "s"} failed to deliver in the last 24 hours.`,
      detail: "Check that your connected automation endpoint is online.",
      autoFixable: false,
    },
  ];
}

async function probeStaleSendingSms(brandId) {
  // An SMS campaign stuck in 'sending' for over an hour is a safe, auto-fixable
  // cleanup: no send is in flight that long, so we mark it failed.
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM sms_campaigns
     WHERE brand_id = $1
       AND status = 'sending'
       AND updated_at < now() - interval '1 hour'`,
    [brandId],
  );
  const n = rows[0]?.n || 0;
  if (n === 0) return [];
  return [
    {
      type: "stale_sending_sms_campaign",
      system: "SMS campaigns",
      severity: "info",
      message: `${n} SMS campaign${n === 1 ? "" : "s"} appear stuck mid-send.`,
      detail: "EchoAI cleared the stuck state automatically.",
      autoFixable: true,
    },
  ];
}

const PROBES = [
  (brand) => probeFacebook(brand.brand_id),
  (brand) => probeTwilio(brand.brand_id),
  (brand) => probeStripe(brand.brand_id, brand.user_id),
  (brand) => probeExpiredTokens(brand.brand_id),
  (brand) => probeScheduler(brand.brand_id),
  (brand) => probeEmailFailures(brand.brand_id),
  (brand) => probeFollowUpFailures(brand.brand_id),
  (brand) => probeSmsFailures(brand.brand_id),
  (brand) => probeWebhookFailures(brand.brand_id),
  (brand) => probeStaleSendingSms(brand.brand_id),
];

async function safeProbe(fn, brand) {
  try {
    const result = await fn(brand);
    return Array.isArray(result) ? result : [];
  } catch (err) {
    console.error(`Health probe failed for brand ${brand.brand_id}:`, err.message);
    return [];
  }
}

// --- Auto-fix ---------------------------------------------------------------
// Deterministic, SAFE fixes only. Returns true if the fix succeeded.

async function applyAutoFix(issue, brand) {
  switch (issue.type) {
    case "stale_sending_sms_campaign": {
      await db.query(
        `UPDATE sms_campaigns
         SET status = 'failed'
         WHERE brand_id = $1
           AND status = 'sending'
           AND updated_at < now() - interval '1 hour'`,
        [brand.brand_id],
      );
      return true;
    }
    default:
      return false;
  }
}

// --- Core: run a health check for one brand ---------------------------------

/**
 * Runs a full health check for a brand: detects issues across every system,
 * silently auto-fixes fixable ones, generates the AI Health Analyst write-up,
 * persists a health_checks row, and (when requested) notifies the owner on
 * critical issues or failed auto-fixes.
 *
 * @param {object} brand  { brand_id, brand_name, user_id }
 * @param {object} opts   { notify?: boolean, aiRequired?: boolean }
 * @returns the persisted health check record.
 */
async function runHealthCheck(brand, opts = {}) {
  const { notify = false, aiRequired = false } = opts;

  const detected = [];
  for (const probe of PROBES) {
    const issues = await safeProbe(probe, brand);
    detected.push(...issues);
  }

  const issuesAutoFixed = [];
  const issuesRequiringAttention = [];
  let autoFixFailed = false;

  for (const issue of detected) {
    if (issue.autoFixable) {
      try {
        const ok = await applyAutoFix(issue, brand);
        if (ok) {
          issuesAutoFixed.push(issue);
          continue;
        }
        autoFixFailed = true;
        issuesRequiringAttention.push({ ...issue, autoFixFailed: true });
      } catch (err) {
        console.error(`Auto-fix failed for ${issue.type} (brand ${brand.brand_id}):`, err.message);
        autoFixFailed = true;
        issuesRequiringAttention.push({ ...issue, autoFixFailed: true });
      }
    } else {
      issuesRequiringAttention.push(issue);
    }
  }

  const overallStatus = statusFromIssues(issuesRequiringAttention);

  // Look up the previous status so owner alerts only fire on a real transition
  // INTO a bad state, not every hour while the same issue persists (honors the
  // "alert on state transitions, not every tick" convention).
  const prev = await db.query(
    `SELECT overall_status FROM health_checks
     WHERE brand_id = $1 ORDER BY check_time DESC LIMIT 1`,
    [brand.brand_id],
  );
  const previousStatus = prev.rows[0]?.overall_status || null;

  // AI Health Analyst write-up. Required (→502) on user-facing runs; best-effort
  // (swallowed) on the background sweep so one AI hiccup can't stop the hourly
  // job. Skip the AI call entirely when nothing was found and it's a background
  // run, to avoid needless spend.
  let aiAnalysis = null;
  const report = {
    overallStatus,
    issuesFound: detected,
    issuesAutoFixed,
    issuesRequiringAttention,
  };
  if (aiRequired || detected.length > 0) {
    try {
      aiAnalysis = await generateHealthAnalysis(brand, report);
    } catch (err) {
      if (aiRequired) throw err;
      console.error(`Health analysis AI failed for brand ${brand.brand_id}:`, err.message);
    }
  }

  const { rows } = await db.query(
    `INSERT INTO health_checks
       (brand_id, overall_status, issues_found, issues_auto_fixed,
        issues_requiring_attention, ai_analysis)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6)
     RETURNING check_id, brand_id, check_time, overall_status, issues_found,
               issues_auto_fixed, issues_requiring_attention, ai_analysis`,
    [
      brand.brand_id,
      overallStatus,
      JSON.stringify(detected),
      JSON.stringify(issuesAutoFixed),
      JSON.stringify(issuesRequiringAttention),
      aiAnalysis,
    ],
  );
  const record = rows[0];

  // Notify the owner ONLY when something critical needs them or an auto-fix
  // failed, AND the account newly degraded (status changed since the last
  // check). Minor issues that were fixed silently never generate a notification,
  // and a persistent problem alerts once — not every hourly sweep.
  const needsAttention = overallStatus === "critical" || autoFixFailed;
  const newlyDegraded = overallStatus !== previousStatus;
  if (notify && needsAttention && newlyDegraded) {
    await notifyOwner(brand, record).catch((err) =>
      console.error(`Health notification failed for brand ${brand.brand_id}:`, err.message),
    );
  }

  // Speak a Sentinel "I fixed it" update via Echo whenever an auto-fix landed.
  // Best-effort; honors the owner's voice settings. Dedup by check_id so it
  // speaks once per sweep, never repeats for the same recorded check.
  if (notify && issuesAutoFixed.length > 0) {
    const n = issuesAutoFixed.length;
    const what = issuesAutoFixed[0].message || issuesAutoFixed[0].type || "an issue";
    enqueueOwnerVoiceEvent(
      brand.user_id,
      "sentinel_fixed",
      (firstName) =>
        n === 1
          ? `${firstName}, Sentinel just auto-fixed an issue on ${brand.brand_name || "your account"}: ${what}. Everything's back to normal.`
          : `${firstName}, Sentinel just auto-fixed ${n} issues on ${brand.brand_name || "your account"}. Everything's back to normal.`,
      {
        brandId: brand.brand_id,
        title: "Sentinel auto-fix",
        payload: { checkId: record.check_id, fixed: n },
        dedupKey: `sentinel:${record.check_id}`,
        expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
      }
    ).catch((err) => console.error("Sentinel voice enqueue failed:", err.message));
  }

  return record;
}

async function notifyOwner(brand, record) {
  const owner = await db.query("SELECT email FROM users WHERE user_id = $1", [brand.user_id]);
  const email = owner.rows[0]?.email;
  const critical = record.overall_status === "critical";
  const title = critical ? "⚠️ Action needed on your account" : "A setup issue needs your attention";
  const summary =
    record.ai_analysis ||
    "EchoAI's health monitor found an issue that needs your attention. Open your dashboard to review it.";

  if (email) {
    const html = `<p>Hi,</p><p>${summary.replace(/\n/g, "<br/>")}</p>` +
      `<p>Open your EchoAI dashboard and click the health indicator to see the details.</p>`;
    await sendEmail({ to: email, subject: `${title} — ${brand.brand_name || "EchoAI"}`, html }).catch(
      (err) => console.error("Health email failed:", err.message),
    );
  }

  pushController
    .sendPushToUser(brand.user_id, {
      title,
      body: `${brand.brand_name || "Your account"} needs a quick check.`,
      url: "/dashboard",
      tag: `health-${brand.brand_id}`,
    })
    .catch((err) => console.error("Health web push failed:", err.message));

  mobilePushController
    .sendToUser(brand.user_id, {
      title,
      body: `${brand.brand_name || "Your account"} needs a quick check.`,
      data: { type: "health_alert", brandId: String(brand.brand_id) },
    })
    .catch((err) => console.error("Health mobile push failed:", err.message));
}

// --- HTTP handlers ----------------------------------------------------------

/** POST /api/health-monitor/:brandId/check — run an on-demand health check. */
async function runCheck(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const record = await runHealthCheck(brand, { aiRequired: true, notify: false });
    return res.json(record);
  } catch (err) {
    if (err.aiInvalid || (typeof err.status === "number" && err.status >= 400)) {
      return res.status(502).json({
        error: "The AI provider could not analyze your account health. Please try again shortly.",
      });
    }
    console.error("runCheck error:", err);
    return res.status(500).json({ error: "Failed to run health check" });
  }
}

/** GET /api/health-monitor/:brandId/status — latest status for the nav dot. */
async function getStatus(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { rows } = await db.query(
      `SELECT check_id, overall_status, check_time, ai_analysis,
              issues_requiring_attention
       FROM health_checks
       WHERE brand_id = $1
       ORDER BY check_time DESC
       LIMIT 1`,
      [brand.brand_id],
    );
    if (!rows[0]) return res.json({ overallStatus: "unknown", lastCheck: null });
    const r = rows[0];
    return res.json({
      overallStatus: r.overall_status,
      lastCheck: r.check_time,
      aiAnalysis: r.ai_analysis,
      issuesRequiringAttention: r.issues_requiring_attention || [],
    });
  } catch (err) {
    console.error("getStatus error:", err);
    return res.status(500).json({ error: "Failed to fetch health status" });
  }
}

/** GET /api/health-monitor/:brandId/history — recent checks. */
async function getHistory(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { rows } = await db.query(
      `SELECT check_id, check_time, overall_status, issues_found,
              issues_auto_fixed, issues_requiring_attention, ai_analysis
       FROM health_checks
       WHERE brand_id = $1
       ORDER BY check_time DESC
       LIMIT 20`,
      [brand.brand_id],
    );
    return res.json({ checks: rows });
  } catch (err) {
    console.error("getHistory error:", err);
    return res.status(500).json({ error: "Failed to fetch health history" });
  }
}

// --- Screenshot support -----------------------------------------------------

async function persistScreenshot(dataUrl) {
  // Accept a browser-produced data URL: "data:image/png;base64,AAAA...".
  const match = /^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i.exec(dataUrl || "");
  if (!match) return { url: null, base64: null, mediaType: null };
  const mediaType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const base64 = match[3];
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > MAX_SCREENSHOT_BYTES) {
    const err = new Error("Screenshot exceeds the maximum allowed size");
    err.tooLarge = true;
    throw err;
  }
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const ext = mediaType === "image/png" ? "png" : mediaType === "image/webp" ? "webp" : "jpg";
  const filename = `${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(UPLOADS_DIR, filename), buffer);
  return { url: `${PUBLIC_PREFIX}/${filename}`, base64, mediaType };
}

async function handleTicketSubmission({ userId, brandId, description, screenshot, res }) {
  let stored = { url: null, base64: null, mediaType: null };
  try {
    stored = await persistScreenshot(screenshot);
  } catch (err) {
    if (err.tooLarge) {
      return res.status(413).json({ error: "That screenshot is too large. Please try a smaller one." });
    }
    throw err;
  }

  if (!stored.base64 && !(description || "").trim()) {
    return res.status(400).json({ error: "Add a screenshot or describe what you're seeing." });
  }

  let brand = null;
  if (userId && brandId) {
    brand = await getOwnedBrand(userId, brandId);
  }

  const analysis = await analyzeSupportScreenshot({
    brand: brand || {},
    description,
    imageBase64: stored.base64,
    mediaType: stored.mediaType,
  });

  const { rows } = await db.query(
    `INSERT INTO support_tickets
       (user_id, brand_id, screenshot_url, user_description, ai_analysis, resolution_status)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'analyzed')
     RETURNING ticket_id, screenshot_url, user_description, ai_analysis,
               resolution_status, created_at`,
    [
      userId || null,
      brand ? brand.brand_id : null,
      stored.url,
      description || null,
      JSON.stringify(analysis),
    ],
  );
  return res.json(rows[0]);
}

/** POST /api/health-monitor/support — authenticated screenshot support. */
async function submitSupportTicket(req, res) {
  try {
    return await handleTicketSubmission({
      userId: req.user.userId,
      brandId: req.body?.brandId,
      description: req.body?.description,
      screenshot: req.body?.screenshot,
      res,
    });
  } catch (err) {
    if (err.aiInvalid || (typeof err.status === "number" && err.status >= 400)) {
      return res.status(502).json({
        error: "The AI support agent is temporarily unavailable. Please try again shortly.",
      });
    }
    console.error("submitSupportTicket error:", err);
    return res.status(500).json({ error: "Failed to submit support request" });
  }
}

/** POST /api/public/support — public screenshot support (login screen). */
async function submitPublicSupportTicket(req, res) {
  try {
    return await handleTicketSubmission({
      userId: null,
      brandId: null,
      description: req.body?.description,
      screenshot: req.body?.screenshot,
      res,
    });
  } catch (err) {
    if (err.aiInvalid || (typeof err.status === "number" && err.status >= 400)) {
      return res.status(502).json({
        error: "The AI support agent is temporarily unavailable. Please try again shortly.",
      });
    }
    console.error("submitPublicSupportTicket error:", err);
    return res.status(500).json({ error: "Failed to submit support request" });
  }
}

/** GET /api/health-monitor/support — the current user's recent tickets. */
async function listSupportTickets(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT ticket_id, brand_id, screenshot_url, user_description, ai_analysis,
              resolution_status, created_at
       FROM support_tickets
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.user.userId],
    );
    return res.json({ tickets: rows });
  } catch (err) {
    console.error("listSupportTickets error:", err);
    return res.status(500).json({ error: "Failed to fetch support tickets" });
  }
}

// --- Background sweep (hourly scheduler) ------------------------------------

/**
 * Runs a health check for every active brand, auto-fixing silently and
 * notifying owners only on critical issues / failed auto-fixes. Best-effort per
 * brand: one brand's failure never stops the sweep.
 */
async function runHourlyHealthSweep() {
  const brands = await db.query(
    `SELECT b.brand_id, b.brand_name, b.user_id
     FROM brands b
     JOIN users u ON u.user_id = b.user_id`,
  );

  let checked = 0;
  let alerted = 0;
  for (const brand of brands.rows) {
    try {
      const record = await runHealthCheck(brand, { notify: true, aiRequired: false });
      checked += 1;
      if (record.overall_status === "critical") alerted += 1;
    } catch (err) {
      console.error(`Hourly health check failed for brand ${brand.brand_id}:`, err.message);
    }
  }
  console.log(`Hourly health sweep complete: ${checked}/${brands.rows.length} brands checked, ${alerted} critical.`);
}

module.exports = {
  runHealthCheck,
  runHourlyHealthSweep,
  runCheck,
  getStatus,
  getHistory,
  submitSupportTicket,
  submitPublicSupportTicket,
  listSupportTickets,
  // exported for tests
  statusFromIssues,
  persistScreenshot,
};
