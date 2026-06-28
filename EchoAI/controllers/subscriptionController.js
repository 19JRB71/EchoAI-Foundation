const { stripe, getPriceIdForTier } = require("../config/stripe");
const { getPlan, listPlans } = require("../config/plans");
const db = require("../config/db");
const emailController = require("./emailController");
const affiliateController = require("./affiliateController");
const mobilePushController = require("./mobilePushController");

/**
 * Stripe SDK errors carry a `type` like "StripeCardError" /
 * "StripeInvalidRequestError". Treat those as upstream failures (502) rather
 * than masking them as a generic 500.
 */
function isStripeError(err) {
  return Boolean(err && typeof err.type === "string" && err.type.startsWith("Stripe"));
}

function fail(res, err, logLabel, friendly) {
  console.error(logLabel, err.message);
  if (isStripeError(err)) {
    return res.status(502).json({ error: friendly || "Payment provider error. Please try again." });
  }
  return res.status(500).json({ error: logLabel });
}

/** Returns the user's Stripe customer id (or null if they don't have one yet). */
async function getCustomerId(userId) {
  const result = await db.query(
    "SELECT stripe_customer_id FROM users WHERE user_id = $1",
    [userId]
  );
  return result.rows[0] ? result.rows[0].stripe_customer_id : null;
}

/** Normalizes a Stripe PaymentMethod's card into the shape the client expects. */
function cardFromPaymentMethod(pm) {
  if (!pm || !pm.card) return null;
  return {
    brand: pm.card.brand,
    last4: pm.card.last4,
    expMonth: pm.card.exp_month,
    expYear: pm.card.exp_year,
  };
}

/**
 * Looks up the account owner (and lockout state) for a Stripe customer so the
 * webhook can send the right payment email.
 */
async function getOwnerByCustomer(customerId) {
  const result = await db.query(
    `SELECT u.user_id, u.email, u.business_name,
            s.is_locked, s.failed_payment_at, s.lockout_threshold_days
     FROM users u
     JOIN subscriptions s ON s.user_id = u.user_id
     WHERE u.stripe_customer_id = $1`,
    [customerId]
  );
  return result.rows[0] || null;
}

/**
 * Days remaining before a failed-payment account is locked, based on the first
 * failure timestamp and the configured lockout threshold.
 */
function daysUntilLock(owner) {
  if (!owner.failed_payment_at) return owner.lockout_threshold_days;
  const lockAt =
    new Date(owner.failed_payment_at).getTime() +
    owner.lockout_threshold_days * 86400000;
  return Math.max(0, Math.ceil((lockAt - Date.now()) / 86400000));
}

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

        // Affiliate attribution: on the customer's FIRST successful payment,
        // credit the referring affiliate 20% of the amount paid. convertReferral
        // is a no-op for non-referred users and for renewals (only the first
        // payment converts). Best-effort — never fail the webhook over it.
        try {
          const amountPaid = object.amount_paid; // cents
          if (amountPaid > 0) {
            const { rows } = await db.query(
              "SELECT user_id FROM users WHERE stripe_customer_id = $1",
              [customerId]
            );
            if (rows.length) {
              await affiliateController.convertReferral(rows[0].user_id, amountPaid);
            }
          }
        } catch (err) {
          console.error("Affiliate conversion error:", err.message);
        }
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

        // Email the owner: an account-locked notice if this failure tripped the
        // lock, otherwise a payment reminder with the lockout countdown.
        const failedOwner = await getOwnerByCustomer(customerId);
        if (failedOwner) {
          const action = failedOwner.is_locked
            ? emailController.sendAccountLockedEmail({
                email: failedOwner.email,
                businessName: failedOwner.business_name,
              })
            : emailController.sendPaymentReminderEmail({
                email: failedOwner.email,
                businessName: failedOwner.business_name,
                reason: "failed",
                daysUntilLock: daysUntilLock(failedOwner),
              });
          action.catch((err) =>
            console.error("Payment failed email error:", err.message)
          );

          // Push the payment-failed alert to the owner's native mobile devices
          // via FCM. Best-effort — never throws into the webhook handler.
          if (failedOwner.user_id) {
            mobilePushController
              .sendToUser(failedOwner.user_id, {
                title: "⚠️ Payment failed",
                body: failedOwner.is_locked
                  ? "Your account is locked due to a failed payment. Update your billing to restore access."
                  : "We couldn't process your latest payment. Please update your billing details.",
                data: { type: "payment_failed" },
              })
              .catch((err) =>
                console.error("Payment failed mobile push failed:", err.message)
              );
          }
        }
        break;
      }

      case "invoice.upcoming": {
        // Stripe fires this ahead of a renewal (configurable, e.g. 3 days out).
        const upcomingOwner = await getOwnerByCustomer(customerId);
        if (upcomingOwner) {
          emailController
            .sendPaymentReminderEmail({
              email: upcomingOwner.email,
              businessName: upcomingOwner.business_name,
              reason: "upcoming",
            })
            .catch((err) =>
              console.error("Renewal reminder email error:", err.message)
            );
        }
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
      `SELECT subscription_tier, payment_status, renewal_date, is_locked, locked_at,
              failed_payment_at, lockout_threshold_days
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
      failedPaymentAt: sub.failed_payment_at,
      // Drives the dashboard "locked in X days" banner.
      daysUntilLock:
        sub.failed_payment_at != null
          ? daysUntilLock({
              failed_payment_at: sub.failed_payment_at,
              lockout_threshold_days: sub.lockout_threshold_days,
            })
          : null,
    });
  } catch (err) {
    console.error("Get subscription status error:", err);
    return res.status(500).json({ error: "Failed to fetch subscription status" });
  }
}

/**
 * GET /api/subscriptions/plans
 * Returns the catalog of subscription tiers (name, price, features) used by the
 * billing plan selector. Auth only — visible even while locked so a past-due
 * customer can pick a plan to recover.
 */
async function getPlans(req, res) {
  return res.json({ plans: listPlans() });
}

/**
 * POST /api/subscriptions/change
 * Upgrades or downgrades the active subscription to a new tier. Updates the
 * Stripe subscription item (with prorations) and immediately reflects the new
 * tier in the local database so account access changes right away.
 */
async function changeSubscription(req, res) {
  const userId = req.user.userId;
  const { tier } = req.body;

  const plan = getPlan(tier);
  if (!plan) {
    return res.status(400).json({ error: `Unknown subscription tier "${tier}"` });
  }

  const priceId = getPriceIdForTier(tier);
  if (!priceId) {
    return res.status(400).json({ error: `No Stripe price configured for tier "${tier}"` });
  }

  try {
    const result = await db.query(
      "SELECT subscription_tier, stripe_subscription_id FROM subscriptions WHERE user_id = $1",
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].stripe_subscription_id) {
      return res
        .status(404)
        .json({ error: "No active subscription to change. Start a subscription first." });
    }

    if (result.rows[0].subscription_tier === tier) {
      return res.status(400).json({ error: `You are already on the ${plan.name} plan.` });
    }

    const stripeSubscriptionId = result.rows[0].stripe_subscription_id;

    // Swap the single subscription item to the new price, prorating the change.
    const current = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const itemId = current.items.data[0].id;
    const updated = await stripe.subscriptions.update(stripeSubscriptionId, {
      items: [{ id: itemId, price: priceId }],
      proration_behavior: "create_prorations",
    });

    const renewalDate = updated.current_period_end
      ? new Date(updated.current_period_end * 1000)
      : null;

    await db.query(
      `UPDATE subscriptions
         SET subscription_tier = $1,
             renewal_date = $2
       WHERE user_id = $3`,
      [tier, renewalDate, userId]
    );
    await db.query("UPDATE users SET subscription_tier = $1 WHERE user_id = $2", [tier, userId]);

    return res.json({
      tier,
      status: updated.status,
      renewalDate,
    });
  } catch (err) {
    return fail(res, err, "Change subscription error:", "Failed to update your plan. Please try again.");
  }
}

/**
 * POST /api/subscriptions/payment-method
 * Attaches a new payment method (from Stripe Elements) to the customer, makes it
 * the default for invoices and the active subscription, and records it locally.
 * Auth only (NOT lockout-gated) so a past-due customer can fix their card.
 */
async function updatePaymentMethod(req, res) {
  const userId = req.user.userId;
  const { paymentMethodId } = req.body;

  if (!paymentMethodId) {
    return res.status(400).json({ error: "paymentMethodId is required" });
  }

  try {
    const userResult = await db.query(
      "SELECT email, stripe_customer_id FROM users WHERE user_id = $1",
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    let customerId = userResult.rows[0].stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userResult.rows[0].email,
        metadata: { userId },
      });
      customerId = customer.id;
      await db.query("UPDATE users SET stripe_customer_id = $1 WHERE user_id = $2", [
        customerId,
        userId,
      ]);
    }

    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Also point the active subscription at the new default card, if there is one.
    const subResult = await db.query(
      "SELECT stripe_subscription_id FROM subscriptions WHERE user_id = $1",
      [userId]
    );
    const stripeSubscriptionId = subResult.rows[0] && subResult.rows[0].stripe_subscription_id;
    if (stripeSubscriptionId) {
      await stripe.subscriptions.update(stripeSubscriptionId, {
        default_payment_method: paymentMethodId,
      });
    }

    await db.query("UPDATE subscriptions SET payment_method = $1 WHERE user_id = $2", [
      paymentMethodId,
      userId,
    ]);

    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    return res.json({ message: "Payment method updated", card: cardFromPaymentMethod(pm) });
  } catch (err) {
    return fail(
      res,
      err,
      "Update payment method error:",
      "Failed to update your payment method. Please check the card details and try again."
    );
  }
}

/**
 * GET /api/subscriptions/payment-method
 * Returns the customer's current default card (brand / last4 / expiry) or null.
 */
async function getPaymentMethod(req, res) {
  const userId = req.user.userId;

  try {
    const customerId = await getCustomerId(userId);
    if (!customerId) return res.json({ card: null });

    const customer = await stripe.customers.retrieve(customerId);
    const defaultPmId =
      customer.invoice_settings && customer.invoice_settings.default_payment_method;
    if (!defaultPmId) return res.json({ card: null });

    const pm = await stripe.paymentMethods.retrieve(defaultPmId);
    return res.json({ card: cardFromPaymentMethod(pm) });
  } catch (err) {
    return fail(res, err, "Get payment method error:", "Failed to load your payment method.");
  }
}

/**
 * GET /api/subscriptions/invoices
 * Returns the last 12 invoices for the customer with date, amount, status, and a
 * download link for the PDF.
 */
async function getBillingHistory(req, res) {
  const userId = req.user.userId;

  try {
    const customerId = await getCustomerId(userId);
    if (!customerId) return res.json({ invoices: [] });

    const list = await stripe.invoices.list({ customer: customerId, limit: 12 });
    const invoices = list.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      date: inv.created ? new Date(inv.created * 1000) : null,
      amount: (inv.amount_paid || inv.amount_due || inv.total || 0) / 100,
      currency: inv.currency,
      status: inv.status, // paid | open | void | uncollectible | draft
      paid: inv.status === "paid",
      pdfUrl: inv.invoice_pdf || null,
      hostedUrl: inv.hosted_invoice_url || null,
    }));

    return res.json({ invoices });
  } catch (err) {
    return fail(res, err, "Get billing history error:", "Failed to load your billing history.");
  }
}

/**
 * GET /api/subscriptions/upcoming-invoice
 * Returns what the customer will be charged on their next billing date based on
 * their current plan and seat count. Returns null when there's no active
 * subscription to bill.
 */
async function getUpcomingInvoice(req, res) {
  const userId = req.user.userId;

  try {
    const subResult = await db.query(
      "SELECT stripe_subscription_id FROM subscriptions WHERE user_id = $1",
      [userId]
    );
    const customerId = await getCustomerId(userId);
    const hasSubscription =
      subResult.rows[0] && subResult.rows[0].stripe_subscription_id;

    if (!customerId || !hasSubscription) {
      return res.json({ upcoming: null });
    }

    const upcoming = await stripe.invoices.retrieveUpcoming({ customer: customerId });
    return res.json({
      upcoming: {
        amount: (upcoming.amount_due || upcoming.total || 0) / 100,
        currency: upcoming.currency,
        date: upcoming.next_payment_attempt
          ? new Date(upcoming.next_payment_attempt * 1000)
          : upcoming.period_end
            ? new Date(upcoming.period_end * 1000)
            : null,
        lineItems: (upcoming.lines && upcoming.lines.data ? upcoming.lines.data : []).map((line) => ({
          description: line.description,
          amount: (line.amount || 0) / 100,
        })),
      },
    });
  } catch (err) {
    // Stripe returns an error when there is genuinely no upcoming invoice;
    // surface that as an empty (not failed) result.
    if (err && err.code === "invoice_upcoming_none") {
      return res.json({ upcoming: null });
    }
    return fail(res, err, "Get upcoming invoice error:", "Failed to load your upcoming invoice.");
  }
}

module.exports = {
  createSubscription,
  handleWebhook,
  cancelSubscription,
  getSubscriptionStatus,
  getPlans,
  changeSubscription,
  updatePaymentMethod,
  getPaymentMethod,
  getBillingHistory,
  getUpcomingInvoice,
};
