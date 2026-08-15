/**
 * Prompt 035 Section L — the "first campaign live" milestone probe.
 *
 * DEFINITION (Stage-2 authorization): approved Company Truth exists, working
 * Facebook connection with a selected Page, at least one scheduled post in
 * the future, at least one ad creative saved, and availability configured
 * (reflecting the owner's STATED hours when a deterministic parse of the
 * stated hours exists — a placeholder default does NOT count in that case).
 *
 * Read-only checks + one append-only milestone event (exactly once per
 * brand). Cheap enough to call opportunistically from CT approval, Facebook
 * page selection and the timing summary endpoint.
 */

const db = require("../config/db");
const timing = require("./onboardingTiming");
const { parseBusinessHours } = require("./hoursParser");

async function conditions(userId, brandId) {
  const [ct, fb, post, ad, avail, statedHours] = await Promise.all([
    db.query(
      `SELECT 1 FROM company_truth_reports WHERE brand_id = $1 AND status = 'approved' LIMIT 1`,
      [brandId],
    ),
    db.query(
      `SELECT 1 FROM api_integrations ai
        JOIN brands b ON b.user_id = ai.user_id
       WHERE ai.user_id = $1 AND ai.platform = 'facebook'
         AND b.brand_id = $2 AND b.facebook_page_id IS NOT NULL LIMIT 1`,
      [userId, brandId],
    ),
    db.query(
      `SELECT 1 FROM social_posts
        WHERE brand_id = $1 AND status = 'scheduled' AND scheduled_at > NOW() LIMIT 1`,
      [brandId],
    ),
    db.query(`SELECT 1 FROM ad_creatives WHERE brand_id = $1 LIMIT 1`, [brandId]),
    db.query(
      `SELECT weekly_hours FROM availability_schedules WHERE brand_id = $1 LIMIT 1`,
      [brandId],
    ),
    db.query(
      `SELECT value FROM brand_knowledge_versions
        WHERE brand_id = $1 AND field_key = 'hours' AND status = 'current' LIMIT 1`,
      [brandId],
    ),
  ]);

  let availabilityOk = avail.rows.length > 0;
  if (availabilityOk && statedHours.rows.length) {
    // Stated hours exist: when they parse deterministically, availability
    // must MATCH them (an untouched 9–5 placeholder is not "reflecting the
    // owner's stated hours"). Unparseable stated hours: existence suffices —
    // matching can't be verified mechanically and honesty beats guessing.
    const parsed = parseBusinessHours(statedHours.rows[0].value);
    if (parsed) {
      const actual = avail.rows[0].weekly_hours;
      const norm = (list) =>
        JSON.stringify(
          (Array.isArray(list) ? list : [])
            .map((h) => ({ day: h.day, start: h.start, end: h.end }))
            .sort((a, b) => a.day - b.day),
        );
      availabilityOk = norm(actual) === norm(parsed.weeklyHours);
    }
  }

  return {
    companyTruthApproved: ct.rows.length > 0,
    facebookConnected: fb.rows.length > 0,
    postScheduled: post.rows.length > 0,
    adCreativeSaved: ad.rows.length > 0,
    availabilityConfigured: availabilityOk,
  };
}

/** Check all conditions; record the milestone exactly once when all hold. */
async function maybeRecordCampaignReady(userId, brandId) {
  try {
    const c = await conditions(userId, brandId);
    if (!Object.values(c).every(Boolean)) return { ready: false, conditions: c };
    const recorded = await timing.recordMilestoneOnce(userId, brandId, "campaign_ready");
    return { ready: true, recorded, conditions: c };
  } catch (err) {
    console.error("campaignReady probe failed:", err.message);
    return { ready: false, error: err.message };
  }
}

module.exports = { maybeRecordCampaignReady, _conditions: conditions };
