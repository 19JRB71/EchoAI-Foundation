const { stripe, getPriceIdForTier, getSeatPriceId } = require("../config/stripe");
const {
  getPlan,
  listPlans,
  ADDITIONAL_SEAT_PRICE,
  additionalSeats,
  computeMonthlyTotal,
  seatLimitFor,
} = require("../config/plans");
const { tierRank } = require("../config/tiers");
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

/**
 * Syncs the per-seat add-on line item on a Stripe subscription to match the
 * number of chargeable seats (team size beyond the tier's included seats).
 * No-op when seat billing isn't configured (STRIPE_PRICE_SEAT unset) or there's
 * no Stripe subscription — the local computed total still reflects the change.
 */
async function syncSeatItem(stripeSubscriptionId, tier, teamSize) {
  const seatPriceId = getSeatPriceId();
  if (!seatPriceId || !stripeSubscriptionId) return;

  const qty = additionalSeats(tier, teamSize);
  const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const seatItem = sub.items.data.find(
    (it) => it.price && it.price.id === seatPriceId
  );

  if (qty > 0) {
    if (seatItem) {
      await stripe.subscriptionItems.update(seatItem.id, {
        quantity: qty,
        proration_behavior: "create_prorations",
      });
    } else {
      await stripe.subscriptionItems.create({
        subscription: stripeSubscriptionId,
        price: seatPriceId,
        quantity: qty,
        proration_behavior: "create_prorations",
      });
    }
  } else if (seatItem) {
    await stripe.subscriptionItems.del(seatItem.id, {
      proration_behavior: "create_prorations",
    });
  }
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
      "SELECT user_id, email, stripe_customer_id, COALESCE(team_size, 1) AS team_size FROM users WHERE user_id = $1",
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

    // Bill any seats beyond the tier's included count from the first cycle.
    await syncSeatItem(subscription.id, tier, user.team_size);

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

        // Apply any scheduled downgrade now that the new cycle has been paid:
        // flip to the pending tier (locking higher-tier features) and clear it.
        const downgraded = await db.query(
          `UPDATE subscriptions
             SET subscription_tier = pending_tier,
                 pending_tier = NULL,
                 pending_tier_effective_at = NULL
           FROM users
           WHERE subscriptions.user_id = users.user_id
             AND users.stripe_customer_id = $1
             AND subscriptions.pending_tier IS NOT NULL
             AND (subscriptions.pending_tier_effective_at IS NULL
                  OR subscriptions.pending_tier_effective_at <= NOW())
           RETURNING subscriptions.user_id, subscriptions.subscription_tier,
                     subscriptions.stripe_subscription_id, users.team_size`,
          [customerId]
        );
        for (const row of downgraded.rows) {
          await db.query("UPDATE users SET subscription_tier = $1 WHERE user_id = $2", [
            row.subscription_tier,
            row.user_id,
          ]);
          // Resize the seat add-on to the (now smaller) tier's included seats.
          // Best-effort — never fail the webhook over seat math.
          try {
            await syncSeatItem(row.stripe_subscription_id, row.subscription_tier, row.team_size);
          } catch (seatErr) {
            console.error("Seat resync after downgrade failed:", seatErr.message);
          }
        }

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
      `SELECT s.subscription_tier, s.payment_status, s.renewal_date, s.is_locked,
              s.locked_at, s.failed_payment_at, s.lockout_threshold_days,
              s.pending_tier, s.pending_tier_effective_at,
              COALESCE(u.team_size, 1) AS team_size
       FROM subscriptions s
       JOIN users u ON u.user_id = s.user_id
       WHERE s.user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No subscription found" });
    }

    const sub = result.rows[0];
    const tier = sub.subscription_tier;
    const teamSize = sub.team_size;

    return res.json({
      subscriptionTier: tier,
      paymentStatus: sub.payment_status,
      renewalDate: sub.renewal_date,
      isLocked: sub.is_locked,
      lockedAt: sub.locked_at,
      failedPaymentAt: sub.failed_payment_at,
      // Seat / billing breakdown for the billing UI.
      teamSize,
      includedSeats: seatLimitFor(tier),
      additionalSeats: additionalSeats(tier, teamSize),
      additionalSeatPrice: ADDITIONAL_SEAT_PRICE,
      monthlyTotal: computeMonthlyTotal(tier, teamSize),
      // A scheduled downgrade that takes effect at the next cycle (or null).
      pendingTier: sub.pending_tier,
      pendingTierEffectiveAt: sub.pending_tier_effective_at,
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
 * GET /api/subscriptions/config
 * Public (no auth): returns the Stripe PUBLISHABLE key for the current
 * environment so the SPA can initialize Stripe Elements at runtime. The
 * publishable key is public by design (it is always visible in the browser);
 * the secret key is never exposed here. Runtime delivery — instead of baking
 * the key into the client bundle at build time — lets ONE prebuilt bundle
 * serve every environment (staging uses pk_test, production pk_live).
 */
async function getPublicConfig(req, res) {
  return res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
  });
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

    const currentTier = result.rows[0].subscription_tier;
    const stripeSubscriptionId = result.rows[0].stripe_subscription_id;
    const isUpgrade = tierRank(tier) > tierRank(currentTier);

    // Current team size drives the per-seat add-on when the tier changes.
    const userRow = await db.query(
      "SELECT team_size FROM users WHERE user_id = $1",
      [userId]
    );
    const teamSize = userRow.rows[0] ? userRow.rows[0].team_size : 1;

    // Swap the base subscription item to the new price. Upgrades prorate
    // immediately; downgrades take effect next cycle (no proration now).
    const current = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    // The base plan item is the one that isn't the per-seat add-on.
    const seatPriceId = getSeatPriceId();
    const baseItem =
      current.items.data.find((it) => !seatPriceId || (it.price && it.price.id !== seatPriceId)) ||
      current.items.data[0];
    const updated = await stripe.subscriptions.update(stripeSubscriptionId, {
      items: [{ id: baseItem.id, price: priceId }],
      proration_behavior: isUpgrade ? "create_prorations" : "none",
    });

    const renewalDate = updated.current_period_end
      ? new Date(updated.current_period_end * 1000)
      : null;

    if (isUpgrade) {
      // Unlock immediately: reflect the new tier now and clear any previously
      // scheduled downgrade. Resize the seat add-on to the new tier's included
      // seats.
      await db.query(
        `UPDATE subscriptions
           SET subscription_tier = $1,
               renewal_date = $2,
               pending_tier = NULL,
               pending_tier_effective_at = NULL
         WHERE user_id = $3`,
        [tier, renewalDate, userId]
      );
      await db.query("UPDATE users SET subscription_tier = $1 WHERE user_id = $2", [tier, userId]);
      await syncSeatItem(stripeSubscriptionId, tier, teamSize);

      return res.json({ tier, status: updated.status, renewalDate, pendingTier: null });
    }

    // Downgrade: keep the higher-tier features unlocked until the next billing
    // cycle. Record the scheduled tier; the invoice.payment_succeeded webhook
    // applies it at the cycle boundary.
    await db.query(
      `UPDATE subscriptions
         SET renewal_date = $1,
             pending_tier = $2,
             pending_tier_effective_at = $1
       WHERE user_id = $3`,
      [renewalDate, tier, userId]
    );

    return res.json({
      tier: currentTier,
      pendingTier: tier,
      pendingTierEffectiveAt: renewalDate,
      status: updated.status,
      renewalDate,
    });
  } catch (err) {
    return fail(res, err, "Change subscription error:", "Failed to update your plan. Please try again.");
  }
}

/**
 * POST /api/subscriptions/team
 * Sets the account's team size (seat count) and re-syncs the per-seat add-on on
 * the Stripe subscription. Returns the new seat breakdown + computed monthly
 * total. Auth-only (NOT lockout-gated) — consistent with the other billing
 * management routes so a past-due account can still adjust seats.
 */
async function updateTeamSize(req, res) {
  const userId = req.user.userId;
  const size = Number(req.body.teamSize);

  if (!Number.isInteger(size) || size < 1) {
    return res.status(400).json({ error: "teamSize must be an integer of at least 1" });
  }

  try {
    const { rows } = await db.query(
      "SELECT subscription_tier, stripe_subscription_id FROM subscriptions WHERE user_id = $1",
      [userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "No subscription found" });
    }

    const tier = rows[0].subscription_tier;
    const stripeSubscriptionId = rows[0].stripe_subscription_id;

    await db.query("UPDATE users SET team_size = $1 WHERE user_id = $2", [size, userId]);

    if (stripeSubscriptionId) {
      await syncSeatItem(stripeSubscriptionId, tier, size);
    }

    return res.json({
      teamSize: size,
      tier,
      includedSeats: seatLimitFor(tier),
      additionalSeats: additionalSeats(tier, size),
      additionalSeatPrice: ADDITIONAL_SEAT_PRICE,
      monthlyTotal: computeMonthlyTotal(tier, size),
    });
  } catch (err) {
    return fail(res, err, "Update team size error:", "Failed to update your team size. Please try again.");
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
  syncSeatItem,
  createSubscription,
  handleWebhook,
  cancelSubscription,
  getSubscriptionStatus,
  getPlans,
  getPublicConfig,
  changeSubscription,
  updateTeamSize,
  updatePaymentMethod,
  getPaymentMethod,
  getBillingHistory,
  getUpcomingInvoice,
};
