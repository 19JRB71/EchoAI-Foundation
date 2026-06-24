const { stripe, getPriceIdForTier } = require("../config/stripe");
const db = require("../config/db");

/**
 * POST /api/subscriptions
 * Accepts a payment method ID and subscription tier. Creates a Stripe customer
 * if one doesn't exist, attaches the payment method, creates a recurring monthly
 * subscription, and updates the user's local subscription record.
 */
async function createSubscription(req, res) {
  const { paymentMethodId, tier } = req.body;
  const userId = req.user.userId;

  if (!paymentMethodId || !tier) {
    return res.status(400).json({ error: "paymentMethodId and tier are required" });
  }

  const priceId = getPriceIdForTier(tier);
  if (!priceId) {
    return res.status(400).json({ error: `No Stripe price configured for tier "${tier}"` });
  }

  try {
    const userResult = await db.query(
      "SELECT user_id, email, stripe_customer_id FROM users WHERE user_id = $1",
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userResult.rows[0];
    let customerId = user.stripe_customer_id;

    // Create the Stripe customer if the user doesn't have one yet.
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.user_id },
      });
      customerId = customer.id;
      await db.query("UPDATE users SET stripe_customer_id = $1 WHERE user_id = $2", [
        customerId,
        userId,
      ]);
    }

    // Attach the payment method and make it the default for invoices.
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Create the recurring monthly subscription.
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      default_payment_method: paymentMethodId,
      expand: ["latest_invoice.payment_intent"],
    });

    const renewalDate = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null;

    await db.query(
      `UPDATE subscriptions
         SET subscription_tier = $1,
             billing_cycle = 'monthly',
             payment_method = $2,
             payment_status = 'active',
             renewal_date = $3,
             stripe_subscription_id = $4,
             failed_payment_at = NULL,
             is_locked = FALSE,
             locked_at = NULL
       WHERE user_id = $5`,
      [tier, paymentMethodId, renewalDate, subscription.id, userId]
    );

    // Keep the user's denormalized tier in sync.
    await db.query("UPDATE users SET subscription_tier = $1 WHERE user_id = $2", [tier, userId]);

    return res.status(201).json({
      subscriptionId: subscription.id,
      tier,
      status: subscription.status,
      renewalDate,
    });
  } catch (err) {
    console.error("Create subscription error:", err);
    return res.status(500).json({ error: "Failed to create subscription" });
  }
}

/**
 * POST /api/subscriptions/webhook
 * Handles Stripe webhook events. This route must receive the raw request body
 * (configured in the router) so the signature can be verified.
 *
 * Handled events:
 *  - invoice.payment_succeeded     -> mark active, unlock the account
 *  - invoice.payment_failed        -> record failed timestamp, start lockout countdown
 *  - customer.subscription.deleted -> mark canceled
 */
async function handleWebhook(req, res) {
  const signature = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const object = event.data.object;
    const customerId = object.customer;

    switch (event.type) {
      case "invoice.payment_succeeded": {
        // Payment succeeded: reactivate and fully unlock the account.
        await db.query(
          `UPDATE subscriptions
             SET payment_status = 'active',
                 failed_payment_at = NULL,
                 is_locked = FALSE,
                 locked_at = NULL
           FROM users
           WHERE subscriptions.user_id = users.user_id
             AND users.stripe_customer_id = $1`,
          [customerId]
        );
        break;
      }

      case "invoice.payment_failed": {
        // Record the failed payment timestamp (only the first failure starts the
        // countdown) and immediately lock if the threshold has already elapsed.
        await db.query(
          `UPDATE subscriptions
             SET payment_status = 'failed',
                 failed_payment_at = COALESCE(subscriptions.failed_payment_at, NOW()),
                 is_locked = CASE
                   WHEN COALESCE(subscriptions.failed_payment_at, NOW())
                        + (subscriptions.lockout_threshold_days * INTERVAL '1 day') <= NOW()
                   THEN TRUE ELSE subscriptions.is_locked END,
                 locked_at = CASE
                   WHEN COALESCE(subscriptions.failed_payment_at, NOW())
                        + (subscriptions.lockout_threshold_days * INTERVAL '1 day') <= NOW()
                        AND subscriptions.locked_at IS NULL
                   THEN NOW() ELSE subscriptions.locked_at END
           FROM users
           WHERE subscriptions.user_id = users.user_id
             AND users.stripe_customer_id = $1`,
          [customerId]
        );
        break;
      }

      case "customer.subscription.deleted": {
        await db.query(
          `UPDATE subscriptions
             SET payment_status = 'canceled',
                 stripe_subscription_id = NULL
           FROM users
           WHERE subscriptions.user_id = users.user_id
             AND users.stripe_customer_id = $1`,
          [customerId]
        );
        break;
      }

      default:
        // Unhandled event types are acknowledged but ignored.
        break;
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}

/**
 * POST /api/subscriptions/cancel
 * Cancels the Stripe subscription and updates the local record.
 */
async function cancelSubscription(req, res) {
  const userId = req.user.userId;

  try {
    const result = await db.query(
      "SELECT stripe_subscription_id FROM subscriptions WHERE user_id = $1",
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].stripe_subscription_id) {
      return res.status(404).json({ error: "No active subscription found" });
    }

    const stripeSubscriptionId = result.rows[0].stripe_subscription_id;

    await stripe.subscriptions.cancel(stripeSubscriptionId);

    await db.query(
      `UPDATE subscriptions
         SET payment_status = 'canceled',
             subscription_tier = 'free',
             stripe_subscription_id = NULL
       WHERE user_id = $1`,
      [userId]
    );

    await db.query("UPDATE users SET subscription_tier = 'free' WHERE user_id = $1", [userId]);

    return res.json({ message: "Subscription canceled" });
  } catch (err) {
    console.error("Cancel subscription error:", err);
    return res.status(500).json({ error: "Failed to cancel subscription" });
  }
}

/**
 * GET /api/subscriptions/status
 * Returns the current subscription tier, payment status, renewal date, and
 * whether the account is locked.
 */
async function getSubscriptionStatus(req, res) {
  const userId = req.user.userId;

  try {
    const result = await db.query(
      `SELECT subscription_tier, payment_status, renewal_date, is_locked, locked_at
       FROM subscriptions
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No subscription found" });
    }

    const sub = result.rows[0];

    return res.json({
      subscriptionTier: sub.subscription_tier,
      paymentStatus: sub.payment_status,
      renewalDate: sub.renewal_date,
      isLocked: sub.is_locked,
      lockedAt: sub.locked_at,
    });
  } catch (err) {
    console.error("Get subscription status error:", err);
    return res.status(500).json({ error: "Failed to fetch subscription status" });
  }
}

module.exports = {
  createSubscription,
  handleWebhook,
  cancelSubscription,
  getSubscriptionStatus,
};
