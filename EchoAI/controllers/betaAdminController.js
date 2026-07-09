const db = require("../config/db");
const { getBetaSettings, countUsedSlots } = require("../utils/betaProgram");

// Tiers an admin can convert a beta tester onto (sellable plans only).
const CONVERT_TIERS = ["starter", "pro", "enterprise"];

/**
 * GET /api/admin/beta
 * Full beta program overview: settings, slot counter, every beta user (with
 * activity status + feature usage), and the waitlist.
 */
async function getBetaOverview(req, res) {
  try {
    const settings = await getBetaSettings();

    const [users, waitlist] = await Promise.all([
      db.query(
        `SELECT u.user_id, u.business_name, u.first_name, u.email, u.industry,
                u.created_at, u.last_login_at, u.login_count, u.subscription_tier,
                u.beta_warning_sent_at,
                COALESCE(s.is_locked, FALSE) AS is_locked,
                COALESCE(fu.features, '[]'::json) AS features
           FROM users u
           LEFT JOIN subscriptions s ON s.user_id = u.user_id
           LEFT JOIN LATERAL (
             SELECT json_agg(json_build_object(
                      'feature', f.feature,
                      'uses', f.uses,
                      'lastUsedAt', f.last_used_at)
                    ORDER BY f.last_used_at DESC) AS features
               FROM beta_feature_usage f
              WHERE f.user_id = u.user_id
           ) fu ON TRUE
          WHERE u.is_beta = TRUE AND u.role = 'user'
          ORDER BY u.created_at ASC`
      ),
      db.query(
        `SELECT waitlist_id, email, created_at, notified_at
           FROM beta_waitlist
          ORDER BY created_at ASC`
      ),
    ]);

    const thresholdMs = settings.active_threshold_days * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const betaUsers = users.rows.map((u) => {
      const lastActivity = u.last_login_at || u.created_at;
      const isActive =
        !u.is_locked && lastActivity && now - new Date(lastActivity).getTime() <= thresholdMs;
      return {
        userId: u.user_id,
        name: u.business_name || u.first_name || null,
        email: u.email,
        businessType: u.industry || null,
        signupDate: u.created_at,
        lastLoginAt: u.last_login_at,
        totalLogins: u.login_count,
        subscriptionTier: u.subscription_tier,
        featuresUsed: u.features,
        isLocked: u.is_locked,
        isActive,
        warningSentAt: u.beta_warning_sent_at,
      };
    });

    const used = betaUsers.filter((u) => !u.isLocked).length;

    return res.json({
      settings: {
        maxSlots: settings.max_slots,
        activeThresholdDays: settings.active_threshold_days,
        warningAfterDays: settings.warning_after_days,
      },
      slots: {
        max: settings.max_slots,
        used,
        remaining: Math.max(settings.max_slots - used, 0),
      },
      users: betaUsers,
      waitlist: waitlist.rows.map((w) => ({
        waitlistId: w.waitlist_id,
        email: w.email,
        joinedAt: w.created_at,
        notifiedAt: w.notified_at,
      })),
    });
  } catch (err) {
    console.error("Admin getBetaOverview error:", err);
    return res.status(500).json({ error: "Failed to fetch beta program overview" });
  }
}

/**
 * PUT /api/admin/beta/settings
 * Updates the beta limit and activity thresholds. Only provided fields change.
 */
async function updateBetaSettings(req, res) {
  const { maxSlots, activeThresholdDays, warningAfterDays } = req.body;

  const fields = [];
  const values = [];
  let idx = 1;

  function addInt(name, column, value, min) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min) {
      throw Object.assign(new Error(`${name} must be an integer >= ${min}`), { badInput: true });
    }
    fields.push(`${column} = $${idx++}`);
    values.push(n);
  }

  try {
    if (maxSlots !== undefined) addInt("maxSlots", "max_slots", maxSlots, 0);
    if (activeThresholdDays !== undefined)
      addInt("activeThresholdDays", "active_threshold_days", activeThresholdDays, 1);
    if (warningAfterDays !== undefined)
      addInt("warningAfterDays", "warning_after_days", warningAfterDays, 1);
  } catch (err) {
    if (err.badInput) return res.status(400).json({ error: err.message });
    throw err;
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: "No settings provided to update" });
  }

  try {
    const { rows } = await db.query(
      `UPDATE beta_settings
          SET ${fields.join(", ")}, updated_at = NOW()
        WHERE id = 1
        RETURNING max_slots, active_threshold_days, warning_after_days`,
      values
    );
    const s = rows[0];
    return res.json({
      message: "Beta settings updated",
      settings: {
        maxSlots: s.max_slots,
        activeThresholdDays: s.active_threshold_days,
        warningAfterDays: s.warning_after_days,
      },
    });
  } catch (err) {
    console.error("Admin updateBetaSettings error:", err);
    return res.status(500).json({ error: "Failed to update beta settings" });
  }
}

/**
 * POST /api/admin/beta/users/:userId/convert
 * One-click convert a beta tester to a paying customer on the chosen tier.
 * Clears the beta flag (freeing the slot) and unlocks the account if locked.
 */
async function convertToPaid(req, res) {
  const { userId } = req.params;
  const { tier } = req.body;

  if (!tier || !CONVERT_TIERS.includes(tier)) {
    return res
      .status(400)
      .json({ error: `tier must be one of: ${CONVERT_TIERS.join(", ")}` });
  }

  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      "SELECT user_id, is_beta FROM users WHERE user_id = $1 AND role = 'user'",
      [userId]
    );
    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }
    if (!userResult.rows[0].is_beta) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "That user is not a beta tester" });
    }

    await client.query(
      `UPDATE users
          SET subscription_tier = $1, is_beta = FALSE
        WHERE user_id = $2`,
      [tier, userId]
    );
    await client.query(
      `UPDATE subscriptions
          SET subscription_tier = $1,
              payment_status = 'active',
              is_locked = FALSE,
              locked_at = NULL,
              failed_payment_at = NULL
        WHERE user_id = $2`,
      [tier, userId]
    );

    await client.query("COMMIT");
    return res.json({ message: "Beta user converted to paid", userId, tier });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Admin convertToPaid error:", err);
    return res.status(500).json({ error: "Failed to convert beta user" });
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/admin/beta/waitlist/:waitlistId
 * Removes a waitlist entry (e.g. after inviting them manually).
 */
async function removeWaitlistEntry(req, res) {
  const { waitlistId } = req.params;
  try {
    const { rowCount } = await db.query(
      "DELETE FROM beta_waitlist WHERE waitlist_id = $1",
      [waitlistId]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Waitlist entry not found" });
    }
    return res.json({ message: "Waitlist entry removed", waitlistId });
  } catch (err) {
    console.error("Admin removeWaitlistEntry error:", err);
    return res.status(500).json({ error: "Failed to remove waitlist entry" });
  }
}

module.exports = {
  getBetaOverview,
  updateBetaSettings,
  convertToPaid,
  removeWaitlistEntry,
  CONVERT_TIERS,
};
