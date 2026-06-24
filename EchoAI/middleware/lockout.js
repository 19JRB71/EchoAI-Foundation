const db = require("../config/db");

/**
 * Lockout check middleware. Runs on protected routes AFTER the auth middleware
 * (so req.user is available).
 *
 * It also enforces the time-based lockout rule: if a payment has failed and the
 * configured threshold (default 7 days) has elapsed without a successful payment,
 * the account is locked here as well — webhooks alone can't fire once the
 * subscription stops billing, so the elapsed-time check happens on each request.
 *
 * If the account is locked, returns 403. Otherwise calls next().
 */
async function lockoutCheck(req, res, next) {
  try {
    const result = await db.query(
      `SELECT subscription_id, payment_status, failed_payment_at,
              lockout_threshold_days, is_locked
       FROM subscriptions
       WHERE user_id = $1`,
      [req.user.userId]
    );

    // No subscription record yet -> nothing to lock.
    if (result.rows.length === 0) {
      return next();
    }

    const sub = result.rows[0];
    let locked = sub.is_locked;

    // Evaluate the elapsed-time lockout if a payment has failed.
    if (!locked && sub.failed_payment_at) {
      const failedAt = new Date(sub.failed_payment_at).getTime();
      const thresholdMs = (sub.lockout_threshold_days || 7) * 24 * 60 * 60 * 1000;

      if (Date.now() - failedAt >= thresholdMs) {
        locked = true;
        await db.query(
          `UPDATE subscriptions
             SET is_locked = TRUE, locked_at = NOW()
           WHERE subscription_id = $1`,
          [sub.subscription_id]
        );
      }
    }

    if (locked) {
      return res.status(403).json({
        error:
          "Your account is locked due to non-payment. Please update your payment method to restore access.",
      });
    }

    return next();
  } catch (err) {
    console.error("Lockout check error:", err);
    return res.status(500).json({ error: "Failed to verify account status" });
  }
}

module.exports = lockoutCheck;
