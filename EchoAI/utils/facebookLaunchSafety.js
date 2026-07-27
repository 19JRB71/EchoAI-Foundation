// Shared safety helpers for the two Facebook launch paths (campaignController
// and adCreativeStudioController). Prompt 003: a partial Facebook chain must
// never be silent — it is logged, recorded locally for cleanup, and surfaced
// to the UI through the thrown error.
const db = require("../config/db");

/**
 * Records a partial (non-deliverable) Facebook launch after a mid-chain
 * failure. Whatever object ids Facebook DID return are stored on a campaigns
 * row with status 'launch_failed' so the owner/admin can find and clean up the
 * orphaned objects. Never throws — recording must not mask the original error.
 *
 * @returns {string|null} the recorded campaign_id (null if recording failed)
 */
async function recordFailedLaunch({ brandId, userId, campaignName, budget, variations, ids, error }) {
  try {
    const inserted = await db.query(
      `INSERT INTO campaigns
         (brand_id, user_id, campaign_name, budget, ad_creative_variations,
          launch_date, facebook_campaign_id, facebook_adset_id,
          facebook_creative_id, facebook_ad_id, status)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8, $9, 'launch_failed')
       RETURNING campaign_id`,
      [
        brandId,
        userId,
        campaignName,
        budget,
        JSON.stringify(variations || []),
        ids.campaignId || null,
        ids.adSetId || null,
        ids.creativeId || null,
        ids.adId || null,
      ],
    );
    console.error(
      `Facebook launch FAILED mid-chain for brand ${brandId}: ${error.message}. ` +
        `Partial objects recorded for cleanup (campaigns row ${inserted.rows[0].campaign_id}): ` +
        `campaign=${ids.campaignId || "-"} adset=${ids.adSetId || "-"} ` +
        `creative=${ids.creativeId || "-"} ad=${ids.adId || "-"}`,
    );
    return inserted.rows[0].campaign_id;
  } catch (recordErr) {
    console.error(
      `Facebook launch failed AND the partial chain could not be recorded: ` +
        `${error.message} / recording error: ${recordErr.message} — ` +
        `orphaned ids: campaign=${ids.campaignId || "-"} adset=${ids.adSetId || "-"} ` +
        `creative=${ids.creativeId || "-"}`,
    );
    return null;
  }
}

/**
 * Duplicate-ad guard: returns the already-created facebook_ad_id for a
 * Facebook campaign id, if any local row has one. Used before POST /ads so a
 * retry can never create a second ad for the same campaign.
 */
async function findExistingAdId(facebookCampaignId) {
  if (!facebookCampaignId) return null;
  const r = await db.query(
    `SELECT facebook_ad_id FROM campaigns
     WHERE facebook_campaign_id = $1 AND facebook_ad_id IS NOT NULL
     LIMIT 1`,
    [facebookCampaignId],
  );
  return r.rows.length ? r.rows[0].facebook_ad_id : null;
}

module.exports = { recordFailedLaunch, findExistingAdId };
