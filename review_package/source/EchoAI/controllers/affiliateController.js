const db = require("../config/db");
const { generateReferralCode } = require("../utils/referralTracking");
const { isValidEmail } = require("../config/whiteLabel");

// Affiliates earn 20% of the referred user's first month's payment.
const COMMISSION_RATE = 0.2;

/** Shapes a DB affiliate row into the camelCase object the client expects. */
function serializeAffiliate(row) {
  return {
    affiliateId: row.affiliate_id,
    referralCode: row.referral_code,
    paypalEmail: row.paypal_email,
    totalEarned: Number(row.total_earned),
    totalPaid: Number(row.total_paid),
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * Builds the absolute referral link an affiliate shares. Uses the request's own
 * origin so it works in dev and prod without hard-coding a domain. The code is
 * appended as `?ref=` on the public landing page, which stores it before signup.
 */
function buildReferralLink(req, code) {
  const proto = String(
    req.headers["x-forwarded-proto"] || req.protocol || "https"
  ).split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}/?ref=${code}`;
}

/**
 * POST /api/affiliates/register
 * Enrolls the authenticated user in the affiliate program, generating a unique
 * referral code. 409 if the user is already an affiliate.
 */
async function registerAffiliate(req, res) {
  const userId = req.user.userId;
  try {
    const existing = await db.query(
      "SELECT affiliate_id FROM affiliates WHERE user_id = $1",
      [userId]
    );
    if (existing.rows.length > 0) {
      return res
        .status(409)
        .json({ error: "You are already enrolled in the affiliate program" });
    }

    // Generate a unique code, retrying on the (very unlikely) code collision.
    let created = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const code = generateReferralCode();
      try {
        const { rows } = await db.query(
          `INSERT INTO affiliates (user_id, referral_code)
           VALUES ($1, $2)
           RETURNING *`,
          [userId, code]
        );
        created = rows[0];
      } catch (err) {
        if (err.code === "23505" && /referral_code/.test(err.detail || "")) {
          continue; // code collided — try another
        }
        if (err.code === "23505") {
          // user_id unique violation — enrolled concurrently in another request.
          return res
            .status(409)
            .json({ error: "You are already enrolled in the affiliate program" });
        }
        throw err;
      }
    }

    if (!created) {
      return res.status(500).json({
        error: "Could not generate a unique referral code. Please try again.",
      });
    }

    return res.status(201).json({
      affiliate: serializeAffiliate(created),
      referralLink: buildReferralLink(req, created.referral_code),
    });
  } catch (err) {
    console.error("Register affiliate error:", err.message);
    return res.status(500).json({ error: "Failed to join the affiliate program" });
  }
}

/**
 * GET /api/affiliates/profile
 * Returns the authenticated user's affiliate record plus aggregate stats.
 * 404 if the user is not an affiliate (the client treats this as "not joined").
 */
async function getAffiliateProfile(req, res) {
  try {
    const { rows } = await db.query(
      "SELECT * FROM affiliates WHERE user_id = $1",
      [req.user.userId]
    );
    const affiliate = rows[0];
    if (!affiliate) {
      return res.status(404).json({ error: "You are not an affiliate yet" });
    }

    const { rows: statRows } = await db.query(
      `SELECT
         COUNT(*)::int AS total_referrals,
         COUNT(*) FILTER (WHERE commission_amount > 0)::int AS converted_referrals,
         COALESCE(SUM(commission_amount), 0)::float AS lifetime_commission,
         COALESCE(SUM(commission_amount) FILTER (WHERE status = 'pending'), 0)::float AS pending_amount,
         COALESCE(SUM(commission_amount) FILTER (WHERE status = 'approved'), 0)::float AS approved_amount,
         COALESCE(SUM(commission_amount) FILTER (WHERE status = 'paid'), 0)::float AS paid_amount
       FROM referrals
       WHERE affiliate_id = $1`,
      [affiliate.affiliate_id]
    );
    const s = statRows[0];

    return res.json({
      affiliate: serializeAffiliate(affiliate),
      referralLink: buildReferralLink(req, affiliate.referral_code),
      stats: {
        totalReferrals: s.total_referrals,
        convertedReferrals: s.converted_referrals,
        lifetimeCommission: s.lifetime_commission,
        pendingAmount: s.pending_amount,
        approvedAmount: s.approved_amount,
        paidAmount: s.paid_amount,
        commissionRate: COMMISSION_RATE,
      },
    });
  } catch (err) {
    console.error("Get affiliate profile error:", err.message);
    return res.status(500).json({ error: "Failed to load affiliate profile" });
  }
}

/**
 * GET /api/affiliates/commissions
 * Lists the authenticated affiliate's referrals (one row per referred user)
 * with the referred user's email, plan tier, commission, and status.
 */
async function getCommissions(req, res) {
  try {
    const { rows: aff } = await db.query(
      "SELECT affiliate_id FROM affiliates WHERE user_id = $1",
      [req.user.userId]
    );
    if (!aff.length) {
      return res.status(404).json({ error: "You are not an affiliate yet" });
    }

    const { rows } = await db.query(
      `SELECT r.referral_id, r.commission_amount, r.status, r.created_at,
              u.email AS referred_email, u.subscription_tier
       FROM referrals r
       JOIN users u ON u.user_id = r.referred_user_id
       WHERE r.affiliate_id = $1
       ORDER BY r.created_at DESC`,
      [aff[0].affiliate_id]
    );

    const commissions = rows.map((r) => ({
      referralId: r.referral_id,
      referredEmail: r.referred_email,
      subscriptionTier: r.subscription_tier,
      commissionAmount: Number(r.commission_amount),
      status: r.status,
      createdAt: r.created_at,
    }));
    return res.json({ commissions });
  } catch (err) {
    console.error("Get commissions error:", err.message);
    return res.status(500).json({ error: "Failed to load commissions" });
  }
}

/**
 * POST /api/affiliates/payout
 * Records a payout request: saves the affiliate's PayPal email and confirms the
 * approved balance available to be paid. No money moves here — payouts are
 * reconciled manually by the platform owner, who then marks them paid.
 */
async function requestPayout(req, res) {
  const { paypalEmail } = req.body || {};
  if (!paypalEmail || !isValidEmail(paypalEmail)) {
    return res.status(400).json({ error: "A valid PayPal email is required" });
  }

  try {
    const { rows } = await db.query(
      "SELECT * FROM affiliates WHERE user_id = $1",
      [req.user.userId]
    );
    const affiliate = rows[0];
    if (!affiliate) {
      return res.status(404).json({ error: "You are not an affiliate yet" });
    }

    const { rows: sums } = await db.query(
      `SELECT COALESCE(SUM(commission_amount), 0)::float AS approved_amount
       FROM referrals
       WHERE affiliate_id = $1 AND status = 'approved'`,
      [affiliate.affiliate_id]
    );
    const approvedAmount = sums[0].approved_amount;
    if (approvedAmount <= 0) {
      return res.status(400).json({
        error: "You have no approved commissions available to pay out yet",
      });
    }

    await db.query(
      "UPDATE affiliates SET paypal_email = $1 WHERE affiliate_id = $2",
      [String(paypalEmail).trim(), affiliate.affiliate_id]
    );

    return res.json({
      requested: true,
      amount: approvedAmount,
      paypalEmail: String(paypalEmail).trim(),
      message:
        "Payout requested. Your approved commissions will be sent to this PayPal email.",
    });
  } catch (err) {
    console.error("Request payout error:", err.message);
    return res.status(500).json({ error: "Failed to request payout" });
  }
}

/**
 * POST /api/affiliates/track/:code  (public, no auth)
 * Stores the referral code in a cookie so a subsequent signup is attributed to
 * the referring affiliate. Returns 400 on a malformed code.
 */
function trackReferral(req, res) {
  const {
    normalizeReferralCode,
    isValidReferralCode,
    setReferralCookie,
  } = require("../utils/referralTracking");

  const code = normalizeReferralCode(req.params.code);
  if (!isValidReferralCode(code)) {
    return res.status(400).json({ error: "Invalid referral code" });
  }
  setReferralCookie(res, code);
  return res.json({ tracked: true });
}

/**
 * Converts a referral on the referred user's FIRST successful payment, crediting
 * the affiliate 20% of that first month. Called (not awaited-critical) from the
 * Stripe `invoice.payment_succeeded` webhook — NOT an HTTP route.
 *
 * Idempotent + renewal-safe: only an un-converted pending referral
 * (commission_amount = 0) is matched, so renewals and duplicate webhook
 * deliveries are no-ops. Row is locked FOR UPDATE to serialize concurrent ticks.
 * Returns the credited commission, or null when there's nothing to convert.
 */
async function convertReferral(referredUserId, firstPaymentAmountCents) {
  const amountCents = Number(firstPaymentAmountCents);
  if (!referredUserId || !Number.isFinite(amountCents) || amountCents <= 0) {
    return null;
  }

  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT referral_id, affiliate_id
       FROM referrals
       WHERE referred_user_id = $1 AND status = 'pending' AND commission_amount = 0
       FOR UPDATE`,
      [referredUserId]
    );
    if (!rows.length) {
      await client.query("COMMIT");
      return null; // not referred, or already converted
    }

    const referral = rows[0];
    // 20% of the first payment, rounded to whole cents then expressed in dollars.
    const commission = Math.round(amountCents * COMMISSION_RATE) / 100;

    await client.query(
      "UPDATE referrals SET commission_amount = $1 WHERE referral_id = $2",
      [commission, referral.referral_id]
    );
    await client.query(
      "UPDATE affiliates SET total_earned = total_earned + $1 WHERE affiliate_id = $2",
      [commission, referral.affiliate_id]
    );

    await client.query("COMMIT");
    return { referralId: referral.referral_id, commission };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Convert referral error:", err.message);
    return null;
  } finally {
    client.release();
  }
}

/**
 * GET /api/affiliates/all  (admin only)
 * Platform-owner overview: every affiliate with referral counts and commission
 * sums by lifecycle status.
 */
async function adminListAffiliates(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT a.*, u.email AS owner_email,
              COUNT(r.referral_id)::int AS referral_count,
              COUNT(r.referral_id) FILTER (WHERE r.commission_amount > 0)::int AS converted_count,
              COALESCE(SUM(r.commission_amount) FILTER (WHERE r.status = 'pending'), 0)::float AS pending_amount,
              COALESCE(SUM(r.commission_amount) FILTER (WHERE r.status = 'approved'), 0)::float AS approved_amount,
              COALESCE(SUM(r.commission_amount) FILTER (WHERE r.status = 'paid'), 0)::float AS paid_amount
       FROM affiliates a
       JOIN users u ON u.user_id = a.user_id
       LEFT JOIN referrals r ON r.affiliate_id = a.affiliate_id
       GROUP BY a.affiliate_id, u.email
       ORDER BY a.created_at DESC`
    );

    const affiliates = rows.map((r) => ({
      affiliateId: r.affiliate_id,
      email: r.owner_email,
      referralCode: r.referral_code,
      paypalEmail: r.paypal_email,
      status: r.status,
      totalEarned: Number(r.total_earned),
      totalPaid: Number(r.total_paid),
      referralCount: r.referral_count,
      convertedCount: r.converted_count,
      pendingAmount: r.pending_amount,
      approvedAmount: r.approved_amount,
      paidAmount: r.paid_amount,
    }));
    return res.json({ affiliates });
  } catch (err) {
    console.error("List affiliates error:", err.message);
    return res.status(500).json({ error: "Failed to list affiliates" });
  }
}

/**
 * POST /api/affiliates/approve  (admin only)
 * Advances an affiliate's commissions along the lifecycle:
 *   - action 'approve': converted pending commissions -> approved
 *   - action 'pay':     approved commissions -> paid, bumping total_paid
 */
async function adminUpdateCommissions(req, res) {
  const { affiliateId, action } = req.body || {};
  if (!affiliateId) {
    return res.status(400).json({ error: "affiliateId is required" });
  }
  if (action !== "approve" && action !== "pay") {
    return res.status(400).json({ error: "action must be 'approve' or 'pay'" });
  }

  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    const { rows: aff } = await client.query(
      "SELECT affiliate_id FROM affiliates WHERE affiliate_id = $1 FOR UPDATE",
      [affiliateId]
    );
    if (!aff.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Affiliate not found" });
    }

    let updated;
    if (action === "approve") {
      updated = await client.query(
        `UPDATE referrals
           SET status = 'approved'
         WHERE affiliate_id = $1 AND status = 'pending' AND commission_amount > 0
         RETURNING commission_amount`,
        [affiliateId]
      );
    } else {
      updated = await client.query(
        `UPDATE referrals
           SET status = 'paid'
         WHERE affiliate_id = $1 AND status = 'approved'
         RETURNING commission_amount`,
        [affiliateId]
      );
      const paid = updated.rows.reduce(
        (sum, r) => sum + Number(r.commission_amount),
        0
      );
      if (paid > 0) {
        await client.query(
          "UPDATE affiliates SET total_paid = total_paid + $1 WHERE affiliate_id = $2",
          [paid, affiliateId]
        );
      }
    }

    await client.query("COMMIT");
    return res.json({ updated: updated.rows.length, action });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Update commissions error:", err.message);
    return res.status(500).json({ error: "Failed to update commissions" });
  } finally {
    client.release();
  }
}

/**
 * POST /api/affiliates/suspend  (admin only)
 * Sets an affiliate's status. Suspended affiliates earn nothing on new signups
 * (attribution skips inactive affiliates).
 */
async function adminSetAffiliateStatus(req, res) {
  const { affiliateId, status } = req.body || {};
  if (!affiliateId) {
    return res.status(400).json({ error: "affiliateId is required" });
  }
  if (status !== "active" && status !== "suspended") {
    return res.status(400).json({ error: "status must be 'active' or 'suspended'" });
  }

  try {
    const { rows } = await db.query(
      `UPDATE affiliates SET status = $1 WHERE affiliate_id = $2
       RETURNING affiliate_id, status`,
      [status, affiliateId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Affiliate not found" });
    }
    return res.json({ affiliateId: rows[0].affiliate_id, status: rows[0].status });
  } catch (err) {
    console.error("Set affiliate status error:", err.message);
    return res.status(500).json({ error: "Failed to update affiliate status" });
  }
}

module.exports = {
  registerAffiliate,
  getAffiliateProfile,
  getCommissions,
  requestPayout,
  trackReferral,
  convertReferral,
  adminListAffiliates,
  adminUpdateCommissions,
  adminSetAffiliateStatus,
};
