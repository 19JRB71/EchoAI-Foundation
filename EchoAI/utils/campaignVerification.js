/**
 * Prompt 005 — the Single Verification Authority.
 *
 * verifyCampaignStatus(campaignId) is the ONLY code allowed to move a
 * campaign between 'created_paused' and 'live' (either direction). It does so
 * exclusively from a successful Facebook Graph READ-back (GET only — this
 * module performs no mutating Graph call whatsoever):
 *
 *   live  ⇔  campaign.status == ACTIVE AND campaign.effective_status == ACTIVE
 *        AND ad set status == ACTIVE AND ad set effective_status == ACTIVE
 *        AND the chain has at least one ad AND EVERY ad has
 *            status == ACTIVE AND effective_status == ACTIVE
 *
 * Anything else — PAUSED, PENDING_REVIEW, IN_PROCESS, WITH_ISSUES,
 * DISAPPROVED, ARCHIVED, DELETED, UNKNOWN, missing objects, unreadable
 * objects, mixed statuses — verifies to created_paused ("not delivering").
 *
 * Failed / incomplete read-back (Graph error, missing token, missing ids):
 *   - the domain state is left UNCHANGED (never upgraded, never downgraded,
 *     never converted to failed/launch_failed)
 *   - last_verify_error records the reason
 *
 * Successful read-back:
 *   - records last_verified_at, clears last_verify_error
 *   - transitions created_paused ⇔ live when the read-back disagrees with
 *     the stored state (honest in BOTH directions)
 *
 * Tenant isolation: the read-back uses the campaign row's OWN user's
 * Facebook integration token — never the caller's.
 */
const db = require("../config/db");
const { graphGet } = require("./facebookApi");
const { decrypt } = require("./encryption");
const {
  transitionCampaignStatus,
  _VERIFICATION_AUTHORITY,
} = require("./campaignState");

const VERIFIABLE_STATES = ["created_paused", "live"];

function fullyActive(obj) {
  return Boolean(obj) && obj.status === "ACTIVE" && obj.effective_status === "ACTIVE";
}

async function recordFailure(campaignId, message) {
  await db.query(
    `UPDATE campaigns SET last_verify_error = $1 WHERE campaign_id = $2`,
    [String(message).slice(0, 1000), campaignId]
  );
}

/** Loads the row's own user's decrypted Facebook token (tenant isolation). */
async function tokenForRow(row) {
  const r = await db.query(
    `SELECT api_token_encrypted, connection_status
       FROM api_integrations
      WHERE user_id = $1 AND platform = 'facebook'`,
    [row.user_id]
  );
  if (r.rows.length === 0 || r.rows[0].connection_status !== "connected") {
    throw new Error("The campaign owner's Facebook account is not connected — read-back impossible.");
  }
  return decrypt(r.rows[0].api_token_encrypted);
}

/**
 * Verifies one campaign against Facebook and reconciles the domain state.
 *
 * Returns:
 *   { verified: true,  state: 'live' | 'created_paused', changed: boolean }
 *   { verified: false, state: <unchanged current state>, error: string }
 *
 * Throws only on programmer error (unknown campaign, non-verifiable state).
 */
async function verifyCampaignStatus(campaignId) {
  const { rows } = await db.query(
    `SELECT campaign_id, user_id, brand_id, status,
            facebook_campaign_id, facebook_adset_id, facebook_ad_id
       FROM campaigns WHERE campaign_id = $1`,
    [campaignId]
  );
  if (rows.length === 0) throw new Error(`Campaign ${campaignId} not found`);
  const row = rows[0];

  if (!VERIFIABLE_STATES.includes(row.status)) {
    throw new Error(
      `Campaign ${campaignId} is '${row.status}' — only created_paused/live rows can be verified against Facebook.`
    );
  }

  let allActive;
  let readBack = null;
  try {
    if (!row.facebook_campaign_id || !row.facebook_adset_id) {
      throw new Error("Campaign row is missing Facebook object ids — read-back impossible.");
    }
    const accessToken = await tokenForRow(row);
    const fields = { fields: "status,effective_status" };
    const [campaign, adset, ads] = await Promise.all([
      graphGet(row.facebook_campaign_id, fields, accessToken),
      graphGet(row.facebook_adset_id, fields, accessToken),
      graphGet(`${row.facebook_campaign_id}/ads`, { fields: "status,effective_status", limit: 100 }, accessToken),
    ]);
    const adList = ads && Array.isArray(ads.data) ? ads.data : null;
    if (!adList) throw new Error("Ad list read-back returned no data — read-back incomplete.");
    // Verbatim (id/status only) read-back payload — returned so adopters can
    // record it as external proof (Prompt 018). Additive; nothing else changes.
    readBack = { campaign, adset, ads: adList };
    allActive =
      fullyActive(campaign) &&
      fullyActive(adset) &&
      adList.length > 0 &&
      adList.every(fullyActive);
  } catch (err) {
    // Failed read-back: state unchanged, record the reason, nothing else.
    await recordFailure(campaignId, err.message);
    return { verified: false, state: row.status, error: err.message };
  }

  const target = allActive ? "live" : "created_paused";
  let changed = false;
  if (target !== row.status) {
    await transitionCampaignStatus(row.campaign_id, row.status, target, _VERIFICATION_AUTHORITY);
    changed = true;
  }
  await db.query(
    `UPDATE campaigns SET last_verified_at = NOW(), last_verify_error = NULL
      WHERE campaign_id = $1`,
    [campaignId]
  );
  return { verified: true, state: target, changed, readBack };
}

module.exports = { verifyCampaignStatus };
