require("dotenv").config();

/**
 * Staging external-proof runner (Prompt 006).
 *
 * Admin-only endpoints that record real provider actions into the
 * external_proofs evidence substrate. Design (owner terms 9–14, binding):
 *
 *   - PREFLIGHT IS READ-ONLY (term 9): GET /preflight performs no provider
 *     mutation — it reports the exact Page id + name (Graph read), tenant,
 *     SMTP configuration state, the proposed public post text, and any
 *     existing proof rows for the run key, then the operator STOPS for
 *     owner approval.
 *   - PARTIAL-PROOF HONESTY (term 11): publish, read-back and deletion are
 *     separate proof rows; a stage that fails writes NO row and the response
 *     reports exactly which stages completed. A published-but-not-deleted
 *     post is reported with its real id, never claimed complete.
 *   - IDEMPOTENCY (term 12): all writes go through recordExternalProof's
 *     (run_key, provider, action) uniqueness; re-running a stage that
 *     already has a row is a no-op that returns the existing row. The
 *     publish stage records an ALREADY-published social_posts row (written
 *     by the real publishPostNow machinery from the Graph response) — it
 *     never publishes anything itself, so a retry can never double-post.
 *   - REDACTION (term 10): evidence passes through redactEvidence before
 *     persisting; responses from these endpoints carry the same redacted
 *     payloads.
 */

const db = require("../config/db");
const {
  recordExternalProof,
  getRunProofs,
  redactEvidence,
  currentEnvironment,
} = require("../utils/externalProofs");
const { loadConnectedAccount } = require("./socialController");
// Required as a module object (not destructured) so tests can stub sendEmail.
const emailTransport = require("../utils/email");

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

// Owner-approved public test copy (term 14). The runner may override it only
// with text the owner approved at preflight.
const DEFAULT_PROOF_POST_TEXT =
  "South Dixie Storage is testing an internal publishing connection. This post will be removed shortly.";

/** Fetch + JSON-parse a Graph call, throwing the raw error body on failure. */
async function graphJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_e) {
    data = { raw: text };
  }
  if (!response.ok) {
    const err = new Error(
      (data && data.error && data.error.message) ||
        `Graph request failed with HTTP ${response.status}`
    );
    err.providerResponse = data;
    err.statusCode = response.status;
    throw err;
  }
  return data;
}

/**
 * GET /api/staging-proof/preflight?brandId=&runKey=&to=
 * Read-only. No provider mutation of any kind.
 */
async function preflight(req, res) {
  const { brandId, runKey, to } = req.query;
  if (!brandId) return res.status(400).json({ error: "brandId is required" });
  try {
    const brandResult = await db.query(
      `SELECT b.brand_id, b.brand_name, b.is_demo, b.user_id, u.email AS owner_email
         FROM brands b JOIN users u ON u.user_id = b.user_id
        WHERE b.brand_id = $1`,
      [brandId]
    );
    if (brandResult.rows.length === 0) {
      return res.status(404).json({ error: "Brand not found" });
    }
    const brand = brandResult.rows[0];
    if (brand.is_demo) {
      return res.status(409).json({ error: "Demo brands cannot carry external proofs" });
    }

    // Facebook: resolve the brand's connected Page and read its name back
    // from Graph (a GET — read-only). Failures are reported honestly.
    let facebook;
    try {
      const account = await loadConnectedAccount(brandId, "facebook");
      const pageId = account.credentials.pageId;
      const hasPageToken = Boolean(account.credentials.accessToken);
      let page = null;
      let pageReadError = null;
      if (pageId && hasPageToken) {
        try {
          page = await graphJson(
            `${GRAPH_BASE}/${pageId}?fields=id,name,link&access_token=${encodeURIComponent(account.credentials.accessToken)}`
          );
        } catch (err) {
          pageReadError = redactEvidence(err.providerResponse || { message: err.message });
        }
      }
      facebook = {
        connected: true,
        connectionStatus: account.status,
        pageId: pageId || null,
        pageTokenPresent: hasPageToken,
        page: page ? redactEvidence(page) : null,
        pageReadError,
      };
    } catch (err) {
      facebook = { connected: false, error: err.message };
    }

    const proposedRunKey = runKey || null;
    return res.json({
      readOnly: true,
      environment: currentEnvironment(),
      brand: {
        brandId: brand.brand_id,
        brandName: brand.brand_name,
        ownerEmail: brand.owner_email,
        userId: brand.user_id,
      },
      facebook,
      email: {
        smtpConfigured: Boolean(process.env.SMTP_HOST),
        smtpHost: process.env.SMTP_HOST || null,
        fromAddress: process.env.EMAIL_FROM || null,
        proposedRecipient: to || null,
      },
      proposedPostText: DEFAULT_PROOF_POST_TEXT,
      runKey: proposedRunKey,
      existingProofs: proposedRunKey ? await getRunProofs(proposedRunKey) : [],
    });
  } catch (err) {
    console.error("Staging-proof preflight error:", err.message);
    return res.status(500).json({ error: "Preflight failed", detail: err.message });
  }
}

/**
 * Guards run/tenant consistency: every proof row already written under this
 * run key must carry the same brand. Prevents cross-brand run-key collisions
 * from mixing evidence (architect finding).
 */
async function assertRunBrandConsistent(runKey, brandId) {
  const rows = await getRunProofs(runKey);
  const conflicting = rows.find((r) => r.brand_id && brandId && r.brand_id !== brandId);
  if (conflicting) {
    const err = new Error(
      `Run key '${runKey}' already carries evidence for a different brand — one run key, one tenant`
    );
    err.statusCode = 409;
    throw err;
  }
}

/**
 * POST /api/staging-proof/post  { runKey, brandId, text? }
 *
 * Claims (or returns) THE one social_posts row for this run — the atomic
 * claim that makes retries double-post-proof (owner term 12): the row is
 * bound to the run key via a unique partial index BEFORE any publish, so
 * even a crash between publish and proof-row write cannot lead a retry to
 * schedule a second post. Creates a 'scheduled' row only; publishing still
 * goes through the real POST /api/social/posts/:id/publish-now machinery.
 */
async function createProofPost(req, res) {
  const { runKey, brandId, text } = req.body || {};
  if (!runKey || !brandId) {
    return res.status(400).json({ error: "runKey and brandId are required" });
  }
  try {
    const brandResult = await db.query(
      `SELECT brand_id, is_demo, user_id FROM brands WHERE brand_id = $1`,
      [brandId]
    );
    if (brandResult.rows.length === 0) {
      return res.status(404).json({ error: "Brand not found" });
    }
    if (brandResult.rows[0].is_demo) {
      return res.status(409).json({ error: "Demo brands cannot carry external proofs" });
    }
    await assertRunBrandConsistent(runKey, brandId);

    // Atomic claim: the unique partial index on proof_run_key makes this a
    // get-or-create — concurrent/retried runners converge on one row.
    await db.query(
      `INSERT INTO social_posts
         (brand_id, platform, post_content, scheduled_time, status, proof_run_key)
       VALUES ($1, 'facebook', $2, NOW(), 'scheduled', $3)
       ON CONFLICT (proof_run_key) WHERE proof_run_key IS NOT NULL DO NOTHING`,
      [brandId, text || DEFAULT_PROOF_POST_TEXT, runKey]
    );
    const existing = await db.query(
      `SELECT post_id, brand_id, status, post_content, external_post_id
         FROM social_posts WHERE proof_run_key = $1`,
      [runKey]
    );
    const post = existing.rows[0];
    if (!post) {
      return res.status(500).json({ error: "Proof post claim failed" });
    }
    if (post.brand_id !== brandId) {
      return res.status(409).json({
        error: `Run key '${runKey}' is already bound to a different brand's post`,
      });
    }
    return res.json({ runKey, post, reused: post.status !== "scheduled" || undefined });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Staging-proof post claim error:", err.message);
    return res.status(status).json({ error: err.message });
  }
}

/**
 * POST /api/staging-proof/facebook  { runKey, postId }
 *
 * Records the three Facebook evidence stages for a post that the REAL
 * publish machinery (POST /api/social/posts/:id/publish-now) has already
 * published:
 *   1. publish  — proof row from the social_posts row (external_post_id was
 *                 written by publishStoredPost from the Graph response; if
 *                 the post never published there is nothing to record — 409).
 *   2. readback — live Graph GET of the post, verbatim body.
 *   3. delete   — live Graph DELETE, verbatim body.
 * Stops at the first failing stage; completed stages keep their rows.
 */
async function runFacebook(req, res) {
  const { runKey, postId } = req.body || {};
  if (!runKey || !postId) {
    return res.status(400).json({ error: "runKey and postId are required" });
  }
  const environment = currentEnvironment();
  const stages = [];
  try {
    const postResult = await db.query(
      `SELECT sp.post_id, sp.brand_id, sp.status, sp.post_content,
              sp.external_post_id, sp.published_time, sp.proof_run_key, b.user_id
         FROM social_posts sp JOIN brands b ON b.brand_id = sp.brand_id
        WHERE sp.post_id = $1 AND b.is_demo = false`,
      [postId]
    );
    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }
    const post = postResult.rows[0];
    // Run binding: evidence may only be filed under the run the post was
    // claimed for (architect finding — no cross-run/cross-tenant mixing).
    if (post.proof_run_key !== runKey) {
      return res.status(409).json({
        error: "Post is not bound to this run key — claim it via /api/staging-proof/post first",
      });
    }
    await assertRunBrandConsistent(runKey, post.brand_id);
    if (post.status !== "published" || !post.external_post_id) {
      // Never write a proof row before the provider accepted the action.
      return res.status(409).json({
        error: `Post is '${post.status}' without an external id — publish it via the real publish machinery first; no proof row written`,
      });
    }

    // Stage 1: publish evidence (from the machinery-written provider id).
    const publishProof = await recordExternalProof({
      runKey,
      provider: "facebook",
      action: "publish",
      externalId: post.external_post_id,
      brandId: post.brand_id,
      userId: post.user_id,
      environment,
      evidence: {
        source:
          "social_posts row written by publishStoredPost from the Graph publish response",
        post_id: post.post_id,
        external_post_id: post.external_post_id,
        published_time: post.published_time,
        post_content: post.post_content,
      },
    });
    stages.push({ stage: "publish", created: publishProof.created, proof: publishProof.row });

    // Page token for the read-only + delete Graph calls.
    const account = await loadConnectedAccount(post.brand_id, "facebook");
    const token = account.credentials.accessToken;
    if (!token) {
      return res.status(502).json({
        error: "No Facebook page token available for read-back",
        stages,
      });
    }

    // If deletion already proven for this run, don't touch Graph again.
    const existing = await getRunProofs(runKey);
    const alreadyDeleted = existing.some(
      (r) => r.provider === "facebook" && r.action === "delete"
    );

    // Stage 2: read-back (skipped only when the run already proved deletion —
    // the post no longer exists on the Page).
    if (!alreadyDeleted) {
      let readback;
      try {
        readback = await graphJson(
          `${GRAPH_BASE}/${post.external_post_id}?fields=id,message,created_time,permalink_url&access_token=${encodeURIComponent(token)}`
        );
      } catch (err) {
        return res.status(502).json({
          error: `Graph read-back failed: ${err.message}`,
          providerResponse: redactEvidence(err.providerResponse || null),
          stages,
          livePostId: post.external_post_id,
          cleanupIncomplete: true,
        });
      }
      const readbackProof = await recordExternalProof({
        runKey,
        provider: "facebook",
        action: "readback",
        externalId: post.external_post_id,
        brandId: post.brand_id,
        userId: post.user_id,
        environment,
        evidence: readback,
      });
      stages.push({ stage: "readback", created: readbackProof.created, proof: readbackProof.row });

      // Stage 3: delete.
      let deletion;
      try {
        deletion = await graphJson(`${GRAPH_BASE}/${post.external_post_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (err) {
        return res.status(502).json({
          error: `Graph delete failed: ${err.message}`,
          providerResponse: redactEvidence(err.providerResponse || null),
          stages,
          livePostId: post.external_post_id,
          cleanupIncomplete: true,
        });
      }
      const deleteProof = await recordExternalProof({
        runKey,
        provider: "facebook",
        action: "delete",
        externalId: post.external_post_id,
        brandId: post.brand_id,
        userId: post.user_id,
        environment,
        evidence: deletion,
      });
      stages.push({ stage: "delete", created: deleteProof.created, proof: deleteProof.row });
    } else {
      stages.push({ stage: "readback", skipped: "deletion already proven for this run" });
      stages.push({ stage: "delete", skipped: "already proven for this run" });
    }

    return res.json({ runKey, environment, stages, complete: true });
  } catch (err) {
    console.error("Staging-proof facebook error:", err.message);
    return res.status(500).json({ error: err.message, stages });
  }
}

/**
 * POST /api/staging-proof/email  { runKey, to, brandId }
 * Sends ONE email through utils/email.sendEmail (the app's real transport)
 * and records the proof row from the SMTP response. Failure writes no row.
 */
async function runEmail(req, res) {
  const { runKey, to, brandId } = req.body || {};
  if (!runKey || !to) {
    return res.status(400).json({ error: "runKey and to are required" });
  }
  const environment = currentEnvironment();
  try {
    if (brandId) await assertRunBrandConsistent(runKey, brandId);
    let result;
    try {
      result = await emailTransport.sendEmail({
        to,
        subject: `Zorecho external proof ${runKey}`,
        html:
          `<p>This is a one-off staging proof email for run <strong>${runKey}</strong>.</p>` +
          `<p>Sent from the ${environment} environment via the application's own email transport.</p>`,
      });
    } catch (err) {
      // No provider acceptance -> no proof row.
      return res.status(502).json({
        error: `Email send failed: ${err.message}`,
        proofWritten: false,
      });
    }
    const proof = await recordExternalProof({
      runKey,
      provider: "email",
      action: "send",
      externalId: result.messageId || null,
      brandId: brandId || null,
      userId: req.user ? req.user.userId : null,
      environment,
      evidence: {
        source: "utils/email.sendEmail SMTP response",
        messageId: result.messageId || null,
        to: result.to,
        success: result.success === true,
      },
    });
    return res.json({ runKey, environment, created: proof.created, proof: proof.row });
  } catch (err) {
    console.error("Staging-proof email error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Prompt 007 — Stripe test-mode checkout round trip.
// The checkout itself goes through the REAL direct-subscribe path
// (POST /api/subscriptions); these endpoints only (a) report Stripe config
// state read-only and (b) record proof rows from real Stripe API objects
// AFTER the checkout happened. No pricing logic, no live mode, ever.
// ---------------------------------------------------------------------------

// Module object (not destructured) so tests can stub the Stripe client.
const stripeConfig = require("../config/stripe");

function keyMode(value, testPrefix, livePrefix) {
  if (!value) return "missing";
  if (value.startsWith(testPrefix)) return "test";
  if (value.startsWith(livePrefix)) return "LIVE";
  return "unrecognized";
}

/**
 * GET /api/staging-proof/stripe-preflight
 * Read-only. Reports key modes (prefixes only — never values), webhook-secret
 * presence, the STRIPE_PRICE_* env price ids, the registered Stripe webhook
 * endpoints, the live Starter price, and whether STRIPE_PRICE_STARTER matches
 * it exactly. Price IDs are identifiers, not credentials.
 */
async function stripePreflight(req, res) {
  try {
    const secretKeyMode = keyMode(process.env.STRIPE_SECRET_KEY, "sk_test_", "sk_live_");
    const publishableKeyMode = keyMode(
      process.env.STRIPE_PUBLISHABLE_KEY,
      "pk_test_",
      "pk_live_"
    );
    const whsec = process.env.STRIPE_WEBHOOK_SECRET;
    const priceEnv = {
      STRIPE_PRICE_STARTER: process.env.STRIPE_PRICE_STARTER || null,
      STRIPE_PRICE_GROWTH: process.env.STRIPE_PRICE_GROWTH || null,
      STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO || null,
      STRIPE_PRICE_ENTERPRISE: process.env.STRIPE_PRICE_ENTERPRISE || null,
      STRIPE_PRICE_SEAT: process.env.STRIPE_PRICE_SEAT || null,
    };

    let webhookEndpoints = null;
    let starter = null;
    let stripeReadError = null;
    try {
      const endpoints = await stripeConfig.stripe.webhookEndpoints.list({ limit: 20 });
      webhookEndpoints = endpoints.data.map((e) => ({
        id: e.id,
        url: e.url,
        status: e.status,
        livemode: e.livemode,
        enabledEvents: e.enabled_events,
      }));
      const prices = await stripeConfig.stripe.prices.list({
        limit: 50,
        active: true,
        expand: ["data.product"],
      });
      const starterPrice = prices.data.find(
        (p) => p.product && typeof p.product === "object" && /starter/i.test(p.product.name)
      );
      if (starterPrice) {
        starter = {
          productId: starterPrice.product.id,
          productName: starterPrice.product.name,
          priceId: starterPrice.id,
          unitAmount: starterPrice.unit_amount,
          currency: starterPrice.currency,
          interval: starterPrice.recurring ? starterPrice.recurring.interval : null,
          livemode: starterPrice.livemode,
        };
      }
    } catch (err) {
      stripeReadError = err.message;
    }

    return res.json({
      readOnly: true,
      environment: currentEnvironment(),
      secretKeyMode,
      publishableKeyMode,
      webhookSecret: {
        present: Boolean(whsec),
        looksValid: Boolean(whsec && whsec.startsWith("whsec_")),
      },
      priceEnv,
      webhookEndpoints,
      starter,
      starterPriceMatchesEnv: Boolean(
        starter && priceEnv.STRIPE_PRICE_STARTER === starter.priceId
      ),
      stripeReadError,
    });
  } catch (err) {
    console.error("Stripe preflight error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/staging-proof/stripe-proof { runKey, userId }
 * Records the Prompt 007 evidence for a checkout that ALREADY happened via the
 * real direct-subscribe path. Every row is written only from a real Stripe API
 * object fetched here (term 4); stages are sequential and stop-on-fail (term
 * 11); rows are idempotent by (run_key, provider, action) (term 12).
 *
 * Stages / rows (provider 'stripe'):
 *   1. customer        — the Stripe customer object
 *   2. subscription    — the Stripe subscription incl. latest invoice + payment
 *   3. webhook_event   — the delivered invoice.payment_succeeded event (id +
 *                        type from Stripe) + the resulting tenant-scoped
 *                        subscriptions row snapshot
 *
 * Live-mode stop condition: any Stripe object with livemode=true aborts with
 * 409 and writes nothing further.
 */
async function stripeProof(req, res) {
  const { runKey, userId } = req.body || {};
  if (!runKey || !userId) {
    return res.status(400).json({ error: "runKey and userId are required" });
  }
  const environment = currentEnvironment();
  const stripe = stripeConfig.stripe;
  const completed = [];
  try {
    const userResult = await db.query(
      `SELECT u.user_id, u.email, u.stripe_customer_id,
              s.subscription_id, s.subscription_tier, s.payment_status,
              s.stripe_subscription_id, s.renewal_date, s.billing_cycle
         FROM users u
         LEFT JOIN subscriptions s ON s.user_id = u.user_id
        WHERE u.user_id = $1`,
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const tenant = userResult.rows[0];
    if (!tenant.stripe_customer_id) {
      return res.status(409).json({
        error: "User has no stripe_customer_id — checkout has not happened",
        completed,
      });
    }
    if (!tenant.stripe_subscription_id) {
      return res.status(409).json({
        error: "User has no stripe_subscription_id — checkout has not happened",
        completed,
      });
    }

    // Run-key ↔ tenant binding (mirror of assertRunBrandConsistent): a run key
    // that already carries proof rows for a DIFFERENT user cannot be reused —
    // idempotent resume would otherwise return another tenant's evidence.
    const existingRun = await db.query(
      `SELECT DISTINCT user_id FROM external_proofs
        WHERE run_key = $1 AND user_id IS NOT NULL`,
      [runKey]
    );
    if (existingRun.rows.some((r) => r.user_id !== userId)) {
      return res.status(409).json({
        error: "runKey is already bound to a different user",
        completed,
      });
    }

    // Stage 1: customer.
    const customer = await stripe.customers.retrieve(tenant.stripe_customer_id);
    if (customer.livemode) {
      return res.status(409).json({ error: "LIVE-MODE customer — aborting", completed });
    }
    const customerProof = await recordExternalProof({
      runKey,
      provider: "stripe",
      action: "customer",
      externalId: customer.id,
      userId,
      environment,
      evidence: {
        source: "Stripe API customers.retrieve",
        id: customer.id,
        email: customer.email,
        livemode: customer.livemode,
        created: customer.created,
      },
    });
    completed.push({ action: "customer", created: customerProof.created });

    // Stage 2: subscription + latest invoice + payment result.
    const subscription = await stripe.subscriptions.retrieve(
      tenant.stripe_subscription_id,
      { expand: ["latest_invoice.payment_intent"] }
    );
    if (subscription.livemode) {
      return res.status(409).json({ error: "LIVE-MODE subscription — aborting", completed });
    }
    // Tenant linkage: the subscription must belong to this tenant's customer,
    // or we would record another tenant's Stripe objects under this user_id.
    const subCustomerId =
      typeof subscription.customer === "object" && subscription.customer
        ? subscription.customer.id
        : subscription.customer;
    if (subCustomerId !== customer.id) {
      return res.status(409).json({
        error: "Subscription does not belong to this user's Stripe customer — aborting",
        completed,
      });
    }
    const invoice = subscription.latest_invoice || null;
    const paymentIntent = invoice && invoice.payment_intent ? invoice.payment_intent : null;
    const subscriptionProof = await recordExternalProof({
      runKey,
      provider: "stripe",
      action: "subscription",
      externalId: subscription.id,
      userId,
      environment,
      evidence: {
        source: "Stripe API subscriptions.retrieve (expand latest_invoice.payment_intent)",
        id: subscription.id,
        status: subscription.status,
        livemode: subscription.livemode,
        customer: subscription.customer,
        priceIds: subscription.items.data.map((i) => i.price && i.price.id),
        invoice: invoice
          ? {
              id: invoice.id,
              amountDue: invoice.amount_due,
              amountPaid: invoice.amount_paid,
              currency: invoice.currency,
              status: invoice.status,
              paymentResult: paymentIntent
                ? { id: paymentIntent.id, status: paymentIntent.status }
                : null,
            }
          : null,
      },
    });
    completed.push({ action: "subscription", created: subscriptionProof.created });

    // Stage 3: the delivered webhook event. The event object (id + type) comes
    // from Stripe's Events API; delivery + 200 on our verified endpoint is
    // shown by the Stripe dashboard (owner screenshot). We do not fabricate a
    // "verified" claim beyond what these two facts prove.
    const events = await stripe.events.list({
      type: "invoice.payment_succeeded",
      limit: 50,
    });
    // Strict correlation: the event must reference THIS subscription (or this
    // exact invoice). A customer-only match could pick up an older, unrelated
    // payment event and "prove" the wrong checkout.
    const event = events.data.find((e) => {
      const obj = e.data && e.data.object;
      return (
        obj &&
        (obj.subscription === subscription.id || (invoice && obj.id === invoice.id))
      );
    });
    if (!event) {
      return res.status(409).json({
        error:
          "No invoice.payment_succeeded event found for this subscription yet — webhook stage not recorded",
        completed,
      });
    }
    if (event.livemode) {
      return res.status(409).json({ error: "LIVE-MODE event — aborting", completed });
    }
    const rowSnapshot = await db.query(
      `SELECT s.subscription_id, s.user_id, s.subscription_tier, s.payment_status,
              s.billing_cycle, s.renewal_date, s.stripe_subscription_id
         FROM subscriptions s WHERE s.user_id = $1`,
      [userId]
    );
    const eventProof = await recordExternalProof({
      runKey,
      provider: "stripe",
      action: "webhook_event",
      externalId: event.id,
      userId,
      environment,
      evidence: {
        source: "Stripe API events.list (event object) + tenant subscriptions row",
        eventId: event.id,
        eventType: event.type,
        livemode: event.livemode,
        eventCreated: event.created,
        invoiceId: invoice ? invoice.id : null,
        resultingSubscriptionRow: rowSnapshot.rows[0] || null,
      },
    });
    completed.push({ action: "webhook_event", created: eventProof.created });

    return res.json({
      runKey,
      environment,
      completed,
      proofs: (await getRunProofs(runKey)).filter((r) => r.provider === "stripe"),
    });
  } catch (err) {
    console.error("Stripe proof error:", err.message);
    return res.status(502).json({ error: `Stripe proof failed: ${err.message}`, completed });
  }
}

/** GET /api/staging-proof/runs/:runKey — all proof rows for a run. */
async function getRun(req, res) {
  try {
    const rows = await getRunProofs(req.params.runKey);
    return res.json({ runKey: req.params.runKey, proofs: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = {
  preflight,
  createProofPost,
  runFacebook,
  runEmail,
  getRun,
  stripePreflight,
  stripeProof,
  DEFAULT_PROOF_POST_TEXT,
};
