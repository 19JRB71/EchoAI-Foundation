const db = require("../config/db");
const { sendEmail } = require("./email");

/**
 * Beta Program helpers: slot accounting, feature-usage tracking, and the
 * daily sweep (inactive-warning emails + waitlist "a spot opened" emails).
 *
 * Slot rule: a beta slot is CONSUMED by a beta user (users.is_beta) whose
 * account is NOT locked. Locking a beta account (admin one-click) frees the
 * slot immediately; converting to paid clears is_beta and frees it too.
 */

/** Reads the singleton settings row (created by migration 080). */
async function getBetaSettings(client) {
  const runner = client || db;
  const { rows } = await runner.query(
    `SELECT max_slots, active_threshold_days, warning_after_days, updated_at
       FROM beta_settings WHERE id = 1`
  );
  if (!rows[0]) {
    // Defensive: the migration seeds this row; never fabricate silently.
    throw new Error("beta_settings row is missing — run migrations");
  }
  return rows[0];
}

/** Number of beta slots currently in use (unlocked beta users). */
async function countUsedSlots(client) {
  const runner = client || db;
  const { rows } = await runner.query(
    `SELECT COUNT(*)::int AS used
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.user_id
      WHERE u.is_beta = TRUE
        AND u.role = 'user'
        AND COALESCE(s.is_locked, FALSE) = FALSE`
  );
  return rows[0].used;
}

// ---------------------------------------------------------------------------
// Feature-usage tracking (fire-and-forget from the auth middleware)
// ---------------------------------------------------------------------------

// Route mounts that aren't product features.
const UNTRACKED = new Set(["auth", "admin", "public", "v2", "webhooks-inbound"]);

// In-memory throttle: one write per user+feature per window. Best-effort —
// resets on restart, which only means one extra upsert.
const THROTTLE_MS = 10 * 60 * 1000;
const recentWrites = new Map();

function featureFromBaseUrl(baseUrl) {
  const m = /^\/api\/([a-z0-9-]+)/i.exec(baseUrl || "");
  if (!m) return null;
  const feature = m[1].toLowerCase();
  if (UNTRACKED.has(feature)) return null;
  return feature.slice(0, 80);
}

/**
 * Records that a user touched a feature (derived from the API mount path).
 * Fire-and-forget: never throws, never blocks the request.
 */
function trackFeatureUse(userId, baseUrl) {
  const feature = featureFromBaseUrl(baseUrl);
  if (!userId || !feature) return;

  const key = `${userId}:${feature}`;
  const now = Date.now();
  const last = recentWrites.get(key);
  if (last && now - last < THROTTLE_MS) return;
  recentWrites.set(key, now);

  // Cap the throttle map so it can't grow unbounded.
  if (recentWrites.size > 5000) {
    for (const [k, ts] of recentWrites) {
      if (now - ts > THROTTLE_MS) recentWrites.delete(k);
    }
    if (recentWrites.size > 5000) recentWrites.clear();
  }

  db.query(
    `INSERT INTO beta_feature_usage (user_id, feature, uses, last_used_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (user_id, feature)
     DO UPDATE SET uses = beta_feature_usage.uses + 1, last_used_at = NOW()`,
    [userId, feature]
  ).catch((err) => {
    // A missing user (deleted mid-flight) or transient DB error must never
    // surface to the request path.
    if (err.code !== "23503") {
      console.error("Feature usage tracking failed:", err.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Daily sweep
// ---------------------------------------------------------------------------

function warningEmailHtml(name) {
  const who = name ? ` ${name}` : "";
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color:#1f2937;">Hey${who}, we noticed you haven't logged in recently 👋</h2>
      <p style="color:#374151; font-size:15px; line-height:1.6;">
        Your free beta access to EchoAI is reserved for active testers.
        Log in this week to keep your spot — we'd hate to give it away!
      </p>
      <p style="color:#374151; font-size:15px; line-height:1.6;">
        Jump back in, try the AI agents, and tell us what you think. Your
        feedback is exactly what the beta is for.
      </p>
      <p style="color:#6b7280; font-size:13px;">— Echo, your AI marketing team</p>
    </div>`;
}

function waitlistEmailHtml() {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color:#1f2937;">A beta spot just opened up! 🎉</h2>
      <p style="color:#374151; font-size:15px; line-height:1.6;">
        Good news — a spot in the EchoAI beta program is now available.
        Head to the signup page and create your free account before the
        spot fills up again.
      </p>
      <p style="color:#6b7280; font-size:13px;">— The EchoAI team</p>
    </div>`;
}

/**
 * Sends the friendly inactivity warning to every beta user who has gone
 * `warning_after_days` without logging in and hasn't been warned for THIS
 * idle spell (beta_warning_sent_at is cleared on every login).
 *
 * Claim-then-send: each row is claimed atomically (beta_warning_sent_at set)
 * before emailing; on a send failure the claim is reverted so tomorrow's run
 * retries. Locked accounts are skipped — they already lost access.
 */
async function sendInactiveWarnings() {
  const settings = await getBetaSettings();
  const { rows: claimed } = await db.query(
    `UPDATE users u
        SET beta_warning_sent_at = NOW()
       FROM (SELECT u2.user_id
               FROM users u2
               LEFT JOIN subscriptions s ON s.user_id = u2.user_id
              WHERE u2.is_beta = TRUE
                AND u2.role = 'user'
                AND u2.beta_warning_sent_at IS NULL
                AND COALESCE(s.is_locked, FALSE) = FALSE
                AND COALESCE(u2.last_login_at, u2.created_at)
                    < NOW() - make_interval(days => $1)
              FOR UPDATE OF u2 SKIP LOCKED) due
      WHERE u.user_id = due.user_id
      RETURNING u.user_id, u.email, u.business_name, u.first_name`,
    [settings.warning_after_days]
  );

  let sent = 0;
  for (const user of claimed) {
    try {
      await sendEmail({
        to: user.email,
        subject: "Your EchoAI beta spot — quick heads up",
        html: warningEmailHtml(user.first_name || user.business_name || ""),
      });
      sent += 1;
    } catch (err) {
      console.error(`Beta inactivity warning failed for ${user.email}:`, err.message);
      // Revert the claim so the next daily run retries this user.
      await db
        .query(
          `UPDATE users SET beta_warning_sent_at = NULL
            WHERE user_id = $1 AND beta_warning_sent_at IS NOT NULL`,
          [user.user_id]
        )
        .catch((e) => console.error("Warning claim revert failed:", e.message));
    }
  }
  return { warned: sent, due: claimed.length };
}

/**
 * When slots are open, notifies the oldest un-notified waitlist emails (one
 * per open slot). Claim-then-send with revert-on-failure, same as above.
 */
async function notifyWaitlist() {
  const settings = await getBetaSettings();
  const used = await countUsedSlots();
  const open = Math.max(settings.max_slots - used, 0);
  if (open === 0) return { notified: 0, open: 0 };

  const { rows: claimed } = await db.query(
    `UPDATE beta_waitlist w
        SET notified_at = NOW()
       FROM (SELECT waitlist_id
               FROM beta_waitlist
              WHERE notified_at IS NULL
              ORDER BY created_at ASC
              LIMIT $1
              FOR UPDATE SKIP LOCKED) due
      WHERE w.waitlist_id = due.waitlist_id
      RETURNING w.waitlist_id, w.email`,
    [open]
  );

  let notified = 0;
  for (const entry of claimed) {
    try {
      await sendEmail({
        to: entry.email,
        subject: "An EchoAI beta spot just opened up",
        html: waitlistEmailHtml(),
      });
      notified += 1;
    } catch (err) {
      console.error(`Waitlist notification failed for ${entry.email}:`, err.message);
      await db
        .query(
          `UPDATE beta_waitlist SET notified_at = NULL WHERE waitlist_id = $1`,
          [entry.waitlist_id]
        )
        .catch((e) => console.error("Waitlist claim revert failed:", e.message));
    }
  }
  return { notified, open };
}

/**
 * Daily beta program sweep: inactivity warnings, then waitlist notifications.
 * Each half is guarded so one failure never stops the other.
 */
async function runBetaProgramSweep() {
  let warned = 0;
  let notified = 0;
  try {
    const w = await module.exports.sendInactiveWarnings();
    warned = w.warned;
  } catch (err) {
    console.error("Beta inactivity warning sweep failed:", err.message);
  }
  try {
    const n = await module.exports.notifyWaitlist();
    notified = n.notified;
  } catch (err) {
    console.error("Beta waitlist notification sweep failed:", err.message);
  }
  console.log(`Beta program sweep complete: ${warned} warning(s), ${notified} waitlist notification(s).`);
  return { warned, notified };
}

module.exports = {
  getBetaSettings,
  countUsedSlots,
  trackFeatureUse,
  featureFromBaseUrl,
  sendInactiveWarnings,
  notifyWaitlist,
  runBetaProgramSweep,
  _recentWrites: recentWrites,
};
