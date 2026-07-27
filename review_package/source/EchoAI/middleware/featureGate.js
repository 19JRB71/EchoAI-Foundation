/**
 * Feature-gate middleware — enforces subscription-tier access to protected
 * features. Mount AFTER `auth` (so `req.user` is set) and, for data routes,
 * after `lockout`.
 *
 *   router.use(auth, lockout, featureGate("phone_agent"));
 *
 * The argument is a feature key from `config/tiers.js` FEATURES (preferred — it
 * carries the human-readable feature name + required tier) or a raw tier string
 * ("pro" / "enterprise").
 *
 * The user's tier is read live from the `subscriptions` table (the source of
 * truth), so an in-session upgrade unlocks features immediately without a
 * re-login. Admins bypass all gates.
 *
 * On a denied request it returns 403 with everything the client needs to render
 * an upgrade prompt: the feature name, the user's current tier, the required
 * tier (+ display name), and the required tier's monthly price.
 */

const db = require("../config/db");
const { meetsTier, resolveRequirement } = require("../config/tiers");
const { getPlan } = require("../config/plans");

/**
 * Returns { tier, role } for a user — tier from `subscriptions` (source of
 * truth), role from `users`. Defaults the tier to "free" when no subscription
 * row exists yet.
 */
async function getUserTier(userId) {
  const { rows } = await db.query(
    `SELECT u.role AS role, s.subscription_tier AS tier
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.user_id
      WHERE u.user_id = $1`,
    [userId]
  );
  const row = rows[0] || {};
  return { tier: row.tier || "free", role: row.role || "user" };
}

function featureGate(featureKeyOrTier) {
  const { name, tier: requiredTier } = resolveRequirement(featureKeyOrTier);

  return async function gate(req, res, next) {
    try {
      if (!req.user || !req.user.userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { tier: currentTier, role } = await getUserTier(req.user.userId);

      // Admins manage every part of the platform regardless of plan.
      if (role === "admin") return next();

      if (meetsTier(currentTier, requiredTier)) return next();

      const plan = getPlan(requiredTier);
      return res.status(403).json({
        error: `${name} requires the ${plan ? plan.name : requiredTier} plan. Upgrade to unlock it.`,
        upgradeRequired: true,
        feature: name,
        currentTier,
        requiredTier,
        requiredTierName: plan ? plan.name : requiredTier,
        requiredMonthlyPrice: plan ? plan.monthlyPrice : null,
      });
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = featureGate;
module.exports.featureGate = featureGate;
module.exports.getUserTier = getUserTier;
