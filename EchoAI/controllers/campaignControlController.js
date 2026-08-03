// Prompt 015: owner-only pause/unpause controls + spending caps.
//
// This module lives OUTSIDE the launch paths (addendum D): nothing here
// creates Facebook objects, and the launch paths keep their PAUSED-only
// assertions untouched. This is the only place the platform ever sends a
// status update to an existing Facebook chain.
//
// Hard rules implemented here:
//  * Deny-by-default (E): no brand cap → deny; no platform cap → deny; either
//    sum exceeded → deny. Every denial writes an audit row and makes ZERO
//    Graph calls (enforced in utils/spendCaps.evaluateUnpause, called first).
//  * Atomicity (C.1): unpause activates ad → ad set → campaign (campaign
//    LAST — any partial combination with the campaign still PAUSED delivers
//    nothing). Any Graph failure ⇒ best-effort compensating re-pause of
//    whatever was activated, an audit row (result='failed'), an owner push
//    alert, and NO local state change. Pause is symmetric: campaign FIRST
//    (delivery stops on step one).
//  * No second writer of 'live' (C): after Graph acceptance we only invoke
//    the Prompt 005 verification helper; the row shows live exclusively when
//    the read-back says so. result='success' in the audit trail means
//    "Facebook accepted the provider change", NOT "verified live".
//  * Activation-pending marker (term 7): campaigns.activation_requested_at is
//    set ONLY after Facebook accepts the activation, and cleared on verified
//    live, on pause, or on definitive activation failure. It lets the UI
//    honestly distinguish "activation pending at Facebook" from
//    "intentionally paused", and makes pending rows count toward committed
//    spend (term 6, utils/spendCaps).
//  * Idempotency (E.1): every pause/unpause runs under a per-campaign
//    advisory lock; already-in-target-state requests are state-gated no-ops
//    that write no audit row and send no Graph request. Exactly one audit
//    row per state-changing attempt.
//
// Money units: campaigns.budget is DOLLARS/day (NUMERIC → string, coerced);
// caps and audit columns are CENTS; Graph daily_budget is CENTS. Conversion
// happens only in utils/spendCaps helpers and at the UI edge.

const db = require("../config/db");
const { graphPost } = require("../utils/facebookApi");
const { decrypt } = require("../utils/encryption");
const { verifyCampaignStatus } = require("../utils/campaignVerification");
const spendCaps = require("../utils/spendCaps");
const adLaunchSpine = require("../utils/adLaunchSpine");
const pushController = require("./pushController");

// Advisory-lock namespace for campaign control (distinct from other locks).
const LOCK_NAMESPACE = 15;

function notifyOwner(userId, title, body) {
  return pushController
    .sendPushToUser(userId, { title, body, url: "/dashboard?section=campaigns" })
    .catch(() => {});
}

/** Loads a campaign row IFF it belongs to a brand owned by this user. */
async function loadOwnedCampaign(runner, userId, campaignId) {
  const { rows } = await runner.query(
    `SELECT c.campaign_id, c.brand_id, c.user_id, c.campaign_name, c.budget,
            c.status, c.activation_requested_at,
            c.facebook_campaign_id, c.facebook_adset_id, c.facebook_ad_id
       FROM campaigns c
       JOIN brands b ON b.brand_id = c.brand_id AND b.user_id = $1
      WHERE c.campaign_id = $2`,
    [userId, campaignId]
  );
  return rows[0] || null;
}

/** Decrypted Facebook token for the campaign owner's connection. */
async function tokenForUser(userId) {
  const r = await db.query(
    `SELECT api_token_encrypted, connection_status
       FROM api_integrations
      WHERE user_id = $1 AND platform = 'facebook'`,
    [userId]
  );
  if (r.rows.length === 0 || r.rows[0].connection_status !== "connected") {
    const err = new Error("Facebook is not connected — reconnect it before changing campaign delivery.");
    err.statusCode = 503;
    return Promise.reject(err);
  }
  return decrypt(r.rows[0].api_token_encrypted);
}

/** Append-only audit writer — one row per state-changing attempt or denial. */
async function writeAudit(a) {
  const inserted = await db.query(
    `INSERT INTO ad_spend_audit
       (campaign_id, brand_id, actor_user_id, action, result,
        brand_cap_cents_at_time, platform_cap_cents_at_time,
        campaign_budget_cents, committed_live_cents_at_time,
        denial_reason, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING audit_id`,
    [
      a.campaignId,
      a.brandId,
      a.actorUserId,
      a.action,
      a.result,
      a.brandCapCents ?? null,
      a.platformCapCents ?? null,
      a.campaignBudgetCents,
      a.committedCents,
      a.denialReason ? String(a.denialReason).slice(0, 1000) : null,
      a.errorMessage ? String(a.errorMessage).slice(0, 1000) : null,
    ]
  );
  const auditId = inserted.rows[0] ? inserted.rows[0].audit_id : null;
  // Prompt 018 §4 — wiring only: the pause/unpause outcome is recorded as an
  // evidence event on the SAME canonical ad_launch task (no new task per
  // unpause), referencing this audit row so 015's audit and the task trail
  // point at each other. safeSpine'd inside — never affects the control flow.
  await adLaunchSpine.attachLifecycleEvidence({
    campaignId: a.campaignId,
    actor: `owner:${a.actorUserId}`,
    meta: {
      event: a.action,
      result: a.result,
      auditId,
      ...(a.denialReason ? { denialReason: String(a.denialReason).slice(0, 300) } : {}),
      ...(a.errorMessage ? { error: String(a.errorMessage).slice(0, 300) } : {}),
    },
  });
  return auditId;
}

/**
 * Runs `fn` while holding the per-campaign advisory lock on a dedicated
 * session (Graph calls are too slow for a transaction-scoped lock).
 */
async function withCampaignLock(campaignId, fn) {
  const client = await db.pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, $2))", [
      String(campaignId),
      LOCK_NAMESPACE,
    ]);
    try {
      return await fn(client);
    } finally {
      await client
        .query("SELECT pg_advisory_unlock(hashtextextended($1, $2))", [
          String(campaignId),
          LOCK_NAMESPACE,
        ])
        .catch(() => {});
    }
  } finally {
    client.release();
  }
}

/** Full FB chain present? (a chain launched before Prompt 003 may be partial) */
function chainComplete(row) {
  return Boolean(row.facebook_campaign_id && row.facebook_adset_id && row.facebook_ad_id);
}

// ---------------------------------------------------------------------------
// POST /api/campaigns/:campaignId/unpause  (owner only)
// ---------------------------------------------------------------------------
async function unpauseCampaign(req, res) {
  const userId = req.user.userId;
  const { campaignId } = req.params;
  try {
    const out = await withCampaignLock(campaignId, async (client) => {
      const row = await loadOwnedCampaign(client, userId, campaignId);
      if (!row) return { http: 404, body: { error: "Campaign not found." } };

      // Idempotent no-ops (E.1): no Graph call, no audit row.
      if (row.status === "live") {
        return { http: 200, body: { state: "live", noop: true, message: "Already live." } };
      }
      if (row.status === "created_paused" && row.activation_requested_at) {
        return {
          http: 200,
          body: {
            state: "created_paused",
            activationPending: true,
            noop: true,
            message:
              "Activation was already requested and accepted by Facebook — use Refresh status to check whether it is live yet.",
          },
        };
      }
      if (row.status !== "created_paused") {
        return {
          http: 409,
          body: { error: `Only a created (paused) campaign can be unpaused — this one is '${row.status}'.` },
        };
      }
      if (!chainComplete(row)) {
        return {
          http: 409,
          body: { error: "This campaign's Facebook chain is incomplete — it cannot be enabled." },
        };
      }

      const campaignBudgetCents = spendCaps.dollarsToCents(row.budget || 0);

      // Cap enforcement FIRST — a denial makes zero Graph calls (E).
      const verdict = await spendCaps.evaluateUnpause({
        brandId: row.brand_id,
        campaignBudgetCents,
      });
      const auditBase = {
        campaignId: row.campaign_id,
        brandId: row.brand_id,
        actorUserId: userId,
        action: "unpause",
        brandCapCents: verdict.brandCapCents,
        platformCapCents: verdict.platformCapCents,
        campaignBudgetCents,
        committedCents: verdict.brandCommittedCents,
      };
      if (!verdict.allowed) {
        await writeAudit({ ...auditBase, result: "denied", denialReason: verdict.reason });
        return { http: 403, body: { error: verdict.reason, denied: true } };
      }

      const accessToken = await tokenForUser(row.user_id);

      // Atomic activation (C.1): ad → ad set → campaign (campaign LAST).
      const steps = [
        { label: "ad", id: row.facebook_ad_id },
        { label: "ad set", id: row.facebook_adset_id },
        { label: "campaign", id: row.facebook_campaign_id },
      ];
      const activated = [];
      for (const step of steps) {
        try {
          await graphPost(step.id, { status: "ACTIVE" }, accessToken);
          activated.push(step);
        } catch (err) {
          // Compensating re-pause, deepest-first (best-effort — even if it
          // fails, the campaign object is still PAUSED, so nothing delivers).
          for (const done of activated.reverse()) {
            await graphPost(done.id, { status: "PAUSED" }, accessToken).catch(() => {});
          }
          const msg = `Facebook rejected the ${step.label} activation: ${err.fbUserMsg || err.message}`;
          await writeAudit({ ...auditBase, result: "failed", errorMessage: msg });
          // Definitive activation failure — marker stays clear (term 7).
          await notifyOwner(
            row.user_id,
            "Campaign activation failed",
            `"${row.campaign_name}" could not be enabled. ${msg} Everything was left paused — nothing is spending.`
          );
          return { http: 502, body: { error: msg } };
        }
      }

      // Facebook accepted the whole chain: record approval + pending marker.
      await writeAudit({ ...auditBase, result: "success" });
      await client.query(
        `UPDATE campaigns SET activation_requested_at = NOW(), updated_at = NOW()
          WHERE campaign_id = $1 AND status = 'created_paused'`,
        [row.campaign_id]
      );

      // Honest state: only the 005 read-back can show 'live'.
      const verify = await verifyCampaignStatus(row.campaign_id);
      if (verify.verified && verify.state === "live") {
        await client.query(
          `UPDATE campaigns SET activation_requested_at = NULL, updated_at = NOW()
            WHERE campaign_id = $1`,
          [row.campaign_id]
        );
        return { http: 200, body: { state: "live", verified: true } };
      }
      return {
        http: 200,
        body: {
          state: "created_paused",
          activationPending: true,
          verified: Boolean(verify.verified),
          message:
            "Facebook accepted the activation. It is not verified live yet — Facebook may still be processing or reviewing. Use Refresh status to re-check.",
        },
      };
    });
    return res.status(out.http).json(out.body);
  } catch (err) {
    console.error("unpauseCampaign error:", err.message);
    return res
      .status(err.statusCode || 500)
      .json({ error: err.statusCode ? err.message : "Failed to unpause the campaign." });
  }
}

// ---------------------------------------------------------------------------
// POST /api/campaigns/:campaignId/pause  (owner only)
// ---------------------------------------------------------------------------
async function pauseCampaign(req, res) {
  const userId = req.user.userId;
  const { campaignId } = req.params;
  try {
    const out = await withCampaignLock(campaignId, async (client) => {
      const row = await loadOwnedCampaign(client, userId, campaignId);
      if (!row) return { http: 404, body: { error: "Campaign not found." } };

      // Idempotent no-op (E.1): already intentionally paused.
      if (row.status === "created_paused" && !row.activation_requested_at) {
        return { http: 200, body: { state: "created_paused", noop: true, message: "Already paused." } };
      }
      if (row.status !== "live" && row.status !== "created_paused") {
        return {
          http: 409,
          body: { error: `Only a live or pending campaign can be paused — this one is '${row.status}'.` },
        };
      }
      if (!chainComplete(row)) {
        return { http: 409, body: { error: "This campaign's Facebook chain is incomplete." } };
      }

      const campaignBudgetCents = spendCaps.dollarsToCents(row.budget || 0);
      const [brandCapCents, platformCapCents, committedCents] = await Promise.all([
        spendCaps.getBrandCapCents(row.brand_id),
        spendCaps.getPlatformCapCents(),
        spendCaps.getBrandCommittedCents(row.brand_id),
      ]);
      const auditBase = {
        campaignId: row.campaign_id,
        brandId: row.brand_id,
        actorUserId: userId,
        action: "pause",
        brandCapCents,
        platformCapCents,
        campaignBudgetCents,
        committedCents,
      };

      const accessToken = await tokenForUser(row.user_id);

      // Pause order: campaign FIRST — delivery stops on step one (C.1).
      const steps = [
        { label: "campaign", id: row.facebook_campaign_id },
        { label: "ad set", id: row.facebook_adset_id },
        { label: "ad", id: row.facebook_ad_id },
      ];
      const errors = [];
      let campaignPaused = false;
      for (const step of steps) {
        try {
          await graphPost(step.id, { status: "PAUSED" }, accessToken);
          if (step.label === "campaign") campaignPaused = true;
        } catch (err) {
          errors.push(`${step.label}: ${err.fbUserMsg || err.message}`);
        }
      }

      if (errors.length > 0) {
        const msg = `Facebook rejected part of the pause request — ${errors.join("; ")}`;
        await writeAudit({ ...auditBase, result: "failed", errorMessage: msg });
        // The campaign OBJECT is what gates delivery. If Facebook accepted
        // pausing it, the pending activation is definitively over — the
        // marker must clear (term 7) even though deeper steps failed, or a
        // stale marker inflates committed spend and traps unpause in its
        // "already pending" no-op forever.
        if (campaignPaused) {
          await client.query(
            `UPDATE campaigns SET activation_requested_at = NULL, updated_at = NOW()
              WHERE campaign_id = $1`,
            [row.campaign_id]
          );
        }
        await notifyOwner(
          row.user_id,
          campaignPaused ? "Campaign partially paused" : "Campaign pause failed",
          `"${row.campaign_name}": ${msg}. Check Facebook Ads Manager directly.`
        );
        // Still reconcile local state honestly against Facebook.
        if (row.status === "live") await verifyCampaignStatus(row.campaign_id).catch(() => {});
        return { http: 502, body: { error: msg } };
      }

      // Full acceptance: audit + clear the pending marker (term 7).
      await writeAudit({ ...auditBase, result: "success" });
      await client.query(
        `UPDATE campaigns SET activation_requested_at = NULL, updated_at = NOW()
          WHERE campaign_id = $1`,
        [row.campaign_id]
      );
      // Read-back demotes live → created_paused honestly (helper is the sole
      // writer of that transition).
      let state = row.status;
      if (row.status === "live") {
        const verify = await verifyCampaignStatus(row.campaign_id).catch(() => null);
        state = verify && verify.verified ? verify.state : row.status;
      } else {
        state = "created_paused";
      }
      return { http: 200, body: { state, paused: true } };
    });
    return res.status(out.http).json(out.body);
  } catch (err) {
    console.error("pauseCampaign error:", err.message);
    return res
      .status(err.statusCode || 500)
      .json({ error: err.statusCode ? err.message : "Failed to pause the campaign." });
  }
}

// ---------------------------------------------------------------------------
// POST /api/campaigns/:campaignId/refresh-status  (owner only)
// Recognition-only (owner term 4): invokes the EXISTING 005 read-back helper.
// No Graph writes, no new verification logic.
// ---------------------------------------------------------------------------
async function refreshStatus(req, res) {
  const userId = req.user.userId;
  const { campaignId } = req.params;
  try {
    const out = await withCampaignLock(campaignId, async (client) => {
      const row = await loadOwnedCampaign(client, userId, campaignId);
      if (!row) return { http: 404, body: { error: "Campaign not found." } };
      if (row.status !== "created_paused" && row.status !== "live") {
        return { http: 200, body: { state: row.status, verified: false, message: "This campaign has no Facebook delivery state to verify." } };
      }
      const verify = await verifyCampaignStatus(row.campaign_id);
      if (verify.verified && verify.state === "live" && row.activation_requested_at) {
        await client.query(
          `UPDATE campaigns SET activation_requested_at = NULL, updated_at = NOW()
            WHERE campaign_id = $1`,
          [row.campaign_id]
        );
      }
      return {
        http: 200,
        body: {
          state: verify.state,
          verified: Boolean(verify.verified),
          error: verify.error || null,
        },
      };
    });
    return res.status(out.http).json(out.body);
  } catch (err) {
    console.error("refreshStatus error:", err.message);
    return res.status(500).json({ error: "Failed to refresh the campaign status." });
  }
}

// ---------------------------------------------------------------------------
// GET /api/campaigns/spend-cap?brandId=...   (owner only)
// PUT /api/campaigns/spend-cap  { brandId, dailyCapDollars }  (owner only)
// ---------------------------------------------------------------------------
async function getSpendCap(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.query;
  if (!brandId) return res.status(400).json({ error: "brandId is required." });
  try {
    const owned = await db.query(
      `SELECT 1 FROM brands WHERE brand_id = $1 AND user_id = $2`,
      [brandId, userId]
    );
    if (owned.rows.length === 0) return res.status(404).json({ error: "Brand not found." });
    const [brandCapCents, platformCapCents, committedCents] = await Promise.all([
      spendCaps.getBrandCapCents(brandId),
      spendCaps.getPlatformCapCents(),
      spendCaps.getBrandCommittedCents(brandId),
    ]);
    return res.json({
      brandCapDollars: brandCapCents == null ? null : spendCaps.centsToDollars(brandCapCents),
      platformCapDollars: platformCapCents == null ? null : spendCaps.centsToDollars(platformCapCents),
      committedDollars: spendCaps.centsToDollars(committedCents),
    });
  } catch (err) {
    console.error("getSpendCap error:", err.message);
    return res.status(500).json({ error: "Failed to load the spending cap." });
  }
}

async function setSpendCap(req, res) {
  const userId = req.user.userId;
  const { brandId, dailyCapDollars } = req.body || {};
  if (!brandId) return res.status(400).json({ error: "brandId is required." });
  const dollars = Number(dailyCapDollars);
  if (!Number.isFinite(dollars) || dollars <= 0 || dollars > 100000) {
    return res.status(400).json({ error: "dailyCapDollars must be a positive dollar amount." });
  }
  try {
    const owned = await db.query(
      `SELECT 1 FROM brands WHERE brand_id = $1 AND user_id = $2`,
      [brandId, userId]
    );
    if (owned.rows.length === 0) return res.status(404).json({ error: "Brand not found." });
    const capCents = spendCaps.dollarsToCents(dollars);
    await db.query(
      `INSERT INTO ad_spend_caps (brand_id, daily_cap_cents, set_by_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (brand_id) WHERE brand_id IS NOT NULL
       DO UPDATE SET daily_cap_cents = EXCLUDED.daily_cap_cents,
                     set_by_user_id = EXCLUDED.set_by_user_id,
                     updated_at = NOW()`,
      [brandId, capCents, userId]
    );
    return res.json({ brandCapDollars: spendCaps.centsToDollars(capCents) });
  } catch (err) {
    console.error("setSpendCap error:", err.message);
    return res.status(500).json({ error: "Failed to save the spending cap." });
  }
}

// GET /api/campaigns/:campaignId/audit  (owner only) — the approval trail.
async function getAuditTrail(req, res) {
  const userId = req.user.userId;
  const { campaignId } = req.params;
  try {
    const row = await loadOwnedCampaign(db, userId, campaignId);
    if (!row) return res.status(404).json({ error: "Campaign not found." });
    const { rows } = await db.query(
      `SELECT action, result, brand_cap_cents_at_time, platform_cap_cents_at_time,
              campaign_budget_cents, committed_live_cents_at_time,
              denial_reason, error_message, created_at
         FROM ad_spend_audit
        WHERE campaign_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [campaignId]
    );
    return res.json({ audit: rows });
  } catch (err) {
    console.error("getAuditTrail error:", err.message);
    return res.status(500).json({ error: "Failed to load the audit trail." });
  }
}

module.exports = {
  unpauseCampaign,
  pauseCampaign,
  refreshStatus,
  getSpendCap,
  setSpendCap,
  getAuditTrail,
  // exported for tests
  _internals: { withCampaignLock, loadOwnedCampaign },
};
