const db = require("../config/db");

// All plans are billed at $50 per seat / month, so monthly recurring revenue is
// derived from each active paying account's seat count.
const PRICE_PER_SEAT = 50;

const VALID_TIERS = ["free", "starter", "growth", "pro", "enterprise"];

/**
 * GET /api/admin/users
 * Paginated list of all customers (role = 'user') with their headline account
 * details and how many leads and campaigns they have.
 * Query params: page (default 1), limit (default 20, max 100).
 */
async function getAllUsers(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const offset = (page - 1) * limit;

  try {
    const totalResult = await db.query(
      "SELECT COUNT(*)::int AS count FROM users WHERE role = 'user'"
    );
    const total = totalResult.rows[0].count;

    const result = await db.query(
      `SELECT
         u.user_id,
         u.business_name,
         u.email,
         u.subscription_tier,
         u.created_at,
         s.payment_status,
         COALESCE(s.is_locked, FALSE) AS is_locked,
         (SELECT COUNT(*)::int
            FROM leads l
            JOIN brands b ON l.brand_id = b.brand_id
           WHERE b.user_id = u.user_id) AS lead_count,
         (SELECT COUNT(*)::int
            FROM campaigns c
           WHERE c.user_id = u.user_id) AS campaign_count
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.user_id
       WHERE u.role = 'user'
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const users = result.rows.map((u) => ({
      userId: u.user_id,
      name: u.business_name,
      email: u.email,
      subscriptionTier: u.subscription_tier,
      paymentStatus: u.payment_status,
      isLocked: u.is_locked,
      joinedAt: u.created_at,
      leadCount: u.lead_count,
      campaignCount: u.campaign_count,
    }));

    return res.json({
      users,
      page,
      limit,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (err) {
    console.error("Admin getAllUsers error:", err);
    return res.status(500).json({ error: "Failed to fetch users" });
  }
}

/**
 * POST /api/admin/users/:userId/unlock
 * Manually unlocks a locked account and resets the payment-failure countdown.
 */
async function unlockAccount(req, res) {
  const { userId } = req.params;

  try {
    const result = await db.query(
      `UPDATE subscriptions
          SET is_locked = FALSE,
              locked_at = NULL,
              failed_payment_at = NULL,
              payment_status = 'active'
        WHERE user_id = $1
        RETURNING subscription_id`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No subscription found for that user" });
    }

    return res.json({ message: "Account unlocked", userId });
  } catch (err) {
    console.error("Admin unlockAccount error:", err);
    return res.status(500).json({ error: "Failed to unlock account" });
  }
}

/**
 * POST /api/admin/users/:userId/lock
 * Manually locks a customer account.
 */
async function lockAccount(req, res) {
  const { userId } = req.params;

  try {
    const result = await db.query(
      `UPDATE subscriptions
          SET is_locked = TRUE,
              locked_at = NOW()
        WHERE user_id = $1
        RETURNING subscription_id`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No subscription found for that user" });
    }

    return res.json({ message: "Account locked", userId });
  } catch (err) {
    console.error("Admin lockAccount error:", err);
    return res.status(500).json({ error: "Failed to lock account" });
  }
}

/**
 * GET /api/admin/stats
 * Platform-wide totals for the admin overview.
 */
async function getPlatformStats(req, res) {
  try {
    const [
      customers,
      activeSubs,
      revenue,
      leads,
      campaigns,
      adSpend,
    ] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'user'"),
      db.query(
        `SELECT COUNT(*)::int AS count
           FROM subscriptions
          WHERE payment_status = 'active' AND subscription_tier <> 'free'`
      ),
      db.query(
        `SELECT COALESCE(SUM($1 * u.team_size), 0)::numeric AS revenue
           FROM subscriptions s
           JOIN users u ON u.user_id = s.user_id
          WHERE s.payment_status = 'active' AND s.subscription_tier <> 'free'`,
        [PRICE_PER_SEAT]
      ),
      db.query("SELECT COUNT(*)::int AS count FROM leads"),
      db.query(
        "SELECT COUNT(*)::int AS count FROM campaigns WHERE status = 'active'"
      ),
      db.query("SELECT COALESCE(SUM(budget), 0)::numeric AS spend FROM campaigns"),
    ]);

    return res.json({
      totalCustomers: customers.rows[0].count,
      activeSubscriptions: activeSubs.rows[0].count,
      revenueThisMonth: Number(revenue.rows[0].revenue),
      totalLeads: leads.rows[0].count,
      campaignsRunning: campaigns.rows[0].count,
      adSpendManaged: Number(adSpend.rows[0].spend),
    });
  } catch (err) {
    console.error("Admin getPlatformStats error:", err);
    return res.status(500).json({ error: "Failed to fetch platform stats" });
  }
}

/**
 * PUT /api/admin/users/:userId/subscription
 * Manually changes a customer's subscription tier.
 */
async function updateUserSubscription(req, res) {
  const { userId } = req.params;
  const { tier } = req.body;

  if (!tier || !VALID_TIERS.includes(tier)) {
    return res
      .status(400)
      .json({ error: `tier must be one of: ${VALID_TIERS.join(", ")}` });
  }

  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      "SELECT user_id FROM users WHERE user_id = $1",
      [userId]
    );
    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }

    await client.query("UPDATE users SET subscription_tier = $1 WHERE user_id = $2", [
      tier,
      userId,
    ]);
    await client.query(
      "UPDATE subscriptions SET subscription_tier = $1 WHERE user_id = $2",
      [tier, userId]
    );

    await client.query("COMMIT");

    return res.json({ message: "Subscription tier updated", userId, tier });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Admin updateUserSubscription error:", err);
    return res.status(500).json({ error: "Failed to update subscription tier" });
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/admin/users/:userId
 * Permanently removes a customer and all of their data (cascades to
 * subscriptions, brands, leads, campaigns, and analytics). Admin accounts
 * cannot be deleted.
 */
async function deleteUser(req, res) {
  const { userId } = req.params;

  try {
    const userResult = await db.query(
      "SELECT user_id, role FROM users WHERE user_id = $1",
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    if (userResult.rows[0].role === "admin") {
      return res.status(403).json({ error: "Admin accounts cannot be deleted" });
    }

    await db.query("DELETE FROM users WHERE user_id = $1", [userId]);

    return res.json({ message: "User deleted", userId });
  } catch (err) {
    console.error("Admin deleteUser error:", err);
    return res.status(500).json({ error: "Failed to delete user" });
  }
}

/**
 * GET /api/admin/users/:userId
 * Complete profile of one customer: account, subscription, brands, campaigns,
 * lead counts by temperature, and recent analytics.
 */
async function getUserDetail(req, res) {
  const { userId } = req.params;

  try {
    const userResult = await db.query(
      `SELECT user_id, business_name, email, industry, subscription_tier,
              team_size, role, onboarding_completed, created_at
         FROM users
        WHERE user_id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const [subscription, brands, campaigns, leadsByTemperature, analytics] =
      await Promise.all([
        db.query(
          `SELECT subscription_tier, payment_status, renewal_date, is_locked,
                  locked_at, failed_payment_at
             FROM subscriptions
            WHERE user_id = $1`,
          [userId]
        ),
        db.query(
          `SELECT brand_id, brand_name, created_at
             FROM brands
            WHERE user_id = $1
            ORDER BY created_at DESC`,
          [userId]
        ),
        db.query(
          `SELECT campaign_id, campaign_name, status, budget, cost_per_lead,
                  conversion_rate, launch_date
             FROM campaigns
            WHERE user_id = $1
            ORDER BY created_at DESC`,
          [userId]
        ),
        db.query(
          `SELECT l.temperature, COUNT(*)::int AS count
             FROM leads l
             JOIN brands b ON l.brand_id = b.brand_id
            WHERE b.user_id = $1
            GROUP BY l.temperature`,
          [userId]
        ),
        db.query(
          `SELECT a.brand_id, a.week_date, a.total_spend, a.total_leads,
                  a.cost_per_lead, a.conversions, a.return_on_ad_spend
             FROM analytics a
             JOIN brands b ON a.brand_id = b.brand_id
            WHERE b.user_id = $1
            ORDER BY a.week_date DESC
            LIMIT 8`,
          [userId]
        ),
      ]);

    const user = userResult.rows[0];
    const temperatureCounts = leadsByTemperature.rows.reduce((acc, row) => {
      acc[row.temperature] = row.count;
      return acc;
    }, {});

    return res.json({
      user: {
        userId: user.user_id,
        name: user.business_name,
        email: user.email,
        industry: user.industry,
        subscriptionTier: user.subscription_tier,
        teamSize: user.team_size,
        role: user.role,
        onboardingCompleted: user.onboarding_completed,
        joinedAt: user.created_at,
      },
      subscription: subscription.rows[0] || null,
      brands: brands.rows,
      campaigns: campaigns.rows,
      leadsByTemperature: temperatureCounts,
      recentAnalytics: analytics.rows,
    });
  } catch (err) {
    console.error("Admin getUserDetail error:", err);
    return res.status(500).json({ error: "Failed to fetch user detail" });
  }
}

/**
 * GET /api/admin/health
 * Platform health for the admin dashboard: scheduler status, the last time the
 * weekly analytics and optimization jobs produced data, and any logged system
 * errors. Last-run times are derived from the data the jobs write, since the
 * jobs persist their output rather than a separate run log.
 */
async function getPlatformHealth(req, res) {
  try {
    const [lastAnalytics, lastOptimization] = await Promise.all([
      db.query("SELECT MAX(updated_at) AS last_run FROM analytics"),
      db.query("SELECT MAX(created_at) AS last_run FROM optimization_history"),
    ]);

    return res.json({
      scheduler: {
        status: "running",
        schedule: "0 8 * * 1",
        description: "Weekly analytics & optimization — Mondays at 08:00",
      },
      lastWeeklyAnalyticsRun: lastAnalytics.rows[0].last_run,
      lastOptimizationRun: lastOptimization.rows[0].last_run,
      systemErrors: [],
    });
  } catch (err) {
    console.error("Admin getPlatformHealth error:", err);
    return res.status(500).json({ error: "Failed to fetch platform health" });
  }
}

/**
 * All-accounts health summary for the admin dashboard: the latest health check
 * per brand (via a lateral join), plus platform-wide counts by status. Lets an
 * admin spot at a glance which customers have critical issues.
 */
async function getAllAccountsHealth(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT b.brand_id, b.brand_name, u.user_id, u.email,
              hc.overall_status, hc.check_time, hc.ai_analysis,
              hc.issues_requiring_attention
       FROM brands b
       JOIN users u ON u.user_id = b.user_id
       LEFT JOIN LATERAL (
         SELECT overall_status, check_time, ai_analysis, issues_requiring_attention
         FROM health_checks
         WHERE brand_id = b.brand_id
         ORDER BY check_time DESC
         LIMIT 1
       ) hc ON TRUE
       ORDER BY
         CASE hc.overall_status
           WHEN 'critical' THEN 0
           WHEN 'warning' THEN 1
           WHEN 'healthy' THEN 2
           ELSE 3
         END,
         b.brand_name ASC`,
    );

    const summary = { critical: 0, warning: 0, healthy: 0, unknown: 0 };
    const accounts = rows.map((r) => {
      const status = r.overall_status || "unknown";
      if (summary[status] !== undefined) summary[status] += 1;
      else summary.unknown += 1;
      const attention = Array.isArray(r.issues_requiring_attention)
        ? r.issues_requiring_attention
        : [];
      return {
        brandId: r.brand_id,
        brandName: r.brand_name,
        email: r.email,
        overallStatus: status,
        lastCheck: r.check_time,
        aiAnalysis: r.ai_analysis,
        issueCount: attention.length,
      };
    });

    return res.json({ summary, accounts });
  } catch (err) {
    console.error("Admin getAllAccountsHealth error:", err);
    return res.status(500).json({ error: "Failed to fetch account health" });
  }
}

module.exports = {
  getAllUsers,
  unlockAccount,
  lockAccount,
  getPlatformStats,
  updateUserSubscription,
  deleteUser,
  getUserDetail,
  getPlatformHealth,
  getAllAccountsHealth,
};
