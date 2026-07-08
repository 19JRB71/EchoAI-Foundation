/**
 * Real-estate automations for real_estate brands (Property CRM powered).
 *
 * Four recurring jobs, all idempotent via database markers and all excluding
 * demo brands at the query layer:
 *
 *  - runListingPromotionSweep (hourly): Atlas drafts a listing-promotion ad
 *    creative package within 24h of a new active listing being added
 *    (marker: property_listings.ad_promoted_at, claimed atomically).
 *  - runSellerLeadAdSweep (daily): Atlas keeps one fresh seller-lead-generation
 *    ad creative draft per brand per 30 days (dedup via the ad_creatives
 *    library itself — productFocus marker).
 *  - runOpenHouseSweep (daily): promotes an open house one week out (scheduled
 *    social posts on connected platforms), emails interested buyer leads the
 *    day before, and emails attendees a follow-up the day after
 *    (markers: promoted_at / reminded_at / followed_up_at, claimed atomically).
 *  - runRealEstateContentRun (3x/day): Nova generates one on-brand real-estate
 *    post per connected platform and schedules it for the brand.
 *
 * Every per-row unit is guarded so one brand's failure never stops the sweep.
 * AI failures release the claimed marker so a later tick retries (drafting a
 * creative has no external side effect, so retrying is safe — unlike posting).
 */

const db = require("../config/db");
const { generateCreativePackagesForBrand } = require("../controllers/adCreativeStudioController");
const { generateSocialPosts } = require("../prompts/socialContentPrompt");
const { sageContextForBrand } = require("./sageContext");
const { sendEmail } = require("./email");
const pushController = require("../controllers/pushController");

// Rotating Nova content topics — no consecutive repeats within a day because
// the slot index advances through the list.
const CONTENT_TOPICS = [
  "A spotlight on one of the neighborhoods you serve — what makes it a great place to live",
  "A practical tip for home buyers in your market",
  "A practical tip for home sellers preparing to list",
  "A current-listing style post inviting buyers to reach out about available homes",
  "Why working with a local agent matters when buying or selling",
  "What to expect at an open house and how to make the most of visiting one",
];

// A variation object from generateSocialPosts → ready-to-post text.
function postTextFrom(variation) {
  if (typeof variation === "string") return variation;
  const text = variation.postText || variation.content || "";
  const tags = Array.isArray(variation.hashtags) ? variation.hashtags.join(" ") : "";
  return [text, tags].filter(Boolean).join("\n\n").trim();
}

async function realEstateBrands() {
  const { rows } = await db.query(
    `SELECT brand_id, brand_name, user_id, brand_type, brand_personality,
            voice_description AS brand_voice, target_audience, real_estate_profile
       FROM brands
      WHERE brand_type = 'real_estate' AND is_demo = false`
  );
  return rows;
}

function notifyOwner(userId, title, body, url) {
  return pushController
    .sendPushToUser(userId, { title, body, url: url || "/dashboard?section=adstudio" })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// 1) Listing promotion — Atlas drafts an ad within 24h of a new listing
// ---------------------------------------------------------------------------

async function promoteListing(listing, brand) {
  // Atomic claim: only one tick ever drafts the ad for a listing.
  const claim = await db.query(
    `UPDATE property_listings SET ad_promoted_at = NOW(), updated_at = NOW()
      WHERE listing_id = $1 AND ad_promoted_at IS NULL
      RETURNING listing_id`,
    [listing.listing_id]
  );
  if (claim.rowCount === 0) return false;

  const focusBits = [listing.address];
  if (listing.city) focusBits.push(listing.city);
  if (listing.price != null) focusBits.push(`listed at $${Number(listing.price).toLocaleString()}`);
  const details = [
    listing.beds != null ? `${listing.beds} bed` : null,
    listing.baths != null ? `${listing.baths} bath` : null,
    listing.sqft != null ? `${Number(listing.sqft).toLocaleString()} sqft` : null,
    listing.key_features,
  ]
    .filter(Boolean)
    .join(", ");
  const productFocus = `New listing promotion: ${focusBits.join(", ")}${details ? ` — ${details}` : ""}`;

  try {
    const packages = await generateCreativePackagesForBrand(brand, {
      campaignGoal: "brand_awareness",
      productFocus,
    });
    await db.query(
      `INSERT INTO ad_creatives (brand_id, campaign_goal, creative_concept, status)
       VALUES ($1, 'brand_awareness', $2, 'draft')`,
      [
        brand.brand_id,
        JSON.stringify({ packages, budgetRange: null, productFocus, autoSource: "listing_promotion" }),
      ]
    );
    await notifyOwner(
      brand.user_id,
      "Atlas drafted ads for your new listing",
      `Ad creatives for ${listing.address} are ready to review in the Ad Creative Studio.`
    );
    return true;
  } catch (err) {
    // Release the claim so a later tick retries — drafting has no external
    // side effect, so a retry can never double-act.
    await db
      .query(
        "UPDATE property_listings SET ad_promoted_at = NULL WHERE listing_id = $1",
        [listing.listing_id]
      )
      .catch(() => {});
    throw err;
  }
}

async function runListingPromotionSweep() {
  const brands = await realEstateBrands();
  let drafted = 0;
  for (const brand of brands) {
    try {
      const { rows: listings } = await db.query(
        `SELECT * FROM property_listings
          WHERE brand_id = $1 AND status = 'active' AND ad_promoted_at IS NULL
          ORDER BY created_at ASC LIMIT 3`,
        [brand.brand_id]
      );
      for (const listing of listings) {
        try {
          if (await module.exports.promoteListing(listing, brand)) drafted += 1;
        } catch (err) {
          console.error(
            `Listing promotion failed for ${listing.address} (${brand.brand_name}):`,
            err.message
          );
        }
      }
    } catch (err) {
      console.error(`Listing promotion sweep failed for brand ${brand.brand_id}:`, err.message);
    }
  }
  if (drafted > 0) console.log(`Listing promotion sweep: ${drafted} ad draft(s) created.`);
  return drafted;
}

// ---------------------------------------------------------------------------
// 2) Seller-lead ads — one fresh lead-gen draft per brand per 30 days
// ---------------------------------------------------------------------------

/**
 * Atomically claim the one-per-30-days seller-lead slot for a brand by
 * inserting a placeholder draft row under a per-brand advisory lock (the same
 * xact-lock pattern the booking/chatbot paths use). Two overlapping ticks (or
 * two deployed instances) serialize on the lock, so only one can pass the
 * 30-day check and insert the claim. Returns the claimed creative_id, or null
 * when a recent auto draft already exists.
 */
async function claimSellerLeadSlot(brandId) {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `re_seller_lead:${brandId}`,
    ]);
    const { rows: existing } = await client.query(
      `SELECT 1 FROM ad_creatives
        WHERE brand_id = $1
          AND creative_concept->>'autoSource' = 'seller_lead'
          AND created_at >= NOW() - INTERVAL '30 days'
        LIMIT 1`,
      [brandId]
    );
    if (existing.length > 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const { rows } = await client.query(
      `INSERT INTO ad_creatives (brand_id, campaign_goal, creative_concept, status)
       VALUES ($1, 'lead_generation', $2, 'draft')
       RETURNING creative_id`,
      [brandId, JSON.stringify({ autoSource: "seller_lead", generating: true })]
    );
    await client.query("COMMIT");
    return rows[0].creative_id;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function runSellerLeadAdSweep() {
  const brands = await realEstateBrands();
  let drafted = 0;
  for (const brand of brands) {
    try {
      const creativeId = await module.exports.claimSellerLeadSlot(brand.brand_id);
      if (!creativeId) continue;

      const productFocus =
        "Seller lead generation: reach homeowners in the markets served who are thinking about selling — offer a free home-value consultation with the agent.";
      let packages;
      try {
        packages = await generateCreativePackagesForBrand(brand, {
          campaignGoal: "lead_generation",
          productFocus,
        });
      } catch (err) {
        // Release the claim so a later daily run retries — never leave an
        // empty placeholder draft in the owner's creative library.
        await db.query(
          "DELETE FROM ad_creatives WHERE creative_id = $1 AND creative_concept->>'generating' = 'true'",
          [creativeId]
        );
        throw err;
      }
      await db.query(
        `UPDATE ad_creatives SET creative_concept = $2 WHERE creative_id = $1`,
        [
          creativeId,
          JSON.stringify({ packages, budgetRange: null, productFocus, autoSource: "seller_lead" }),
        ]
      );
      await notifyOwner(
        brand.user_id,
        "Atlas drafted seller lead ads",
        "Fresh seller-lead-generation ad creatives are ready to review in the Ad Creative Studio."
      );
      drafted += 1;
    } catch (err) {
      console.error(`Seller-lead ad sweep failed for brand ${brand.brand_id}:`, err.message);
    }
  }
  if (drafted > 0) console.log(`Seller-lead ad sweep: ${drafted} draft(s) created.`);
  return drafted;
}

// ---------------------------------------------------------------------------
// 3) Open house automation — promote / remind / follow up
// ---------------------------------------------------------------------------

async function connectedPlatforms(brandId) {
  const { rows } = await db.query(
    `SELECT platform FROM social_accounts
      WHERE brand_id = $1 AND connection_status = 'connected'`,
    [brandId]
  );
  return rows.map((r) => r.platform);
}

function openHouseWhen(oh) {
  const time = oh.start_time ? ` at ${oh.start_time}` : "";
  return `${oh.event_date instanceof Date ? oh.event_date.toISOString().slice(0, 10) : oh.event_date}${time}`;
}

async function promoteOpenHouse(oh, brand) {
  const claim = await db.query(
    `UPDATE open_houses SET promoted_at = NOW(), updated_at = NOW()
      WHERE open_house_id = $1 AND promoted_at IS NULL RETURNING open_house_id`,
    [oh.open_house_id]
  );
  if (claim.rowCount === 0) return false;
  try {
    const platforms = await connectedPlatforms(brand.brand_id);
    if (platforms.length === 0) {
      await notifyOwner(
        brand.user_id,
        "Open house coming up",
        `Your open house at ${oh.address} is on ${openHouseWhen(oh)}. Connect a social account so Nova can promote it automatically.`,
        "/dashboard?section=social"
      );
      return true;
    }
    brand._sageContext = await sageContextForBrand(brand.brand_id).catch(() => null);
    const topic = `Open house announcement: invite buyers to the open house at ${oh.address} on ${openHouseWhen(oh)}${oh.end_time ? ` until ${oh.end_time}` : ""}. Encourage them to come see the home in person.`;
    for (const platform of platforms) {
      const variations = await generateSocialPosts(brand, topic, platform, 5);
      const content = variations[0];
      // Schedule for the next morning window so it publishes promptly.
      await db.query(
        `INSERT INTO social_posts (brand_id, platform, post_content, scheduled_time, status)
         VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes', 'scheduled')`,
        [brand.brand_id, platform, postTextFrom(content)]
      );
    }
    await notifyOwner(
      brand.user_id,
      "Nova is promoting your open house",
      `Promotion posts for the open house at ${oh.address} were scheduled on: ${platforms.join(", ")}.`,
      "/dashboard?section=social"
    );
    return true;
  } catch (err) {
    await db
      .query("UPDATE open_houses SET promoted_at = NULL WHERE open_house_id = $1", [oh.open_house_id])
      .catch(() => {});
    throw err;
  }
}

async function remindInterestedBuyers(oh, brand) {
  const claim = await db.query(
    `UPDATE open_houses SET reminded_at = NOW(), updated_at = NOW()
      WHERE open_house_id = $1 AND reminded_at IS NULL RETURNING open_house_id`,
    [oh.open_house_id]
  );
  if (claim.rowCount === 0) return false;
  const { rows: buyers } = await db.query(
    `SELECT name, email FROM property_leads
      WHERE brand_id = $1 AND lead_kind = 'buyer' AND email IS NOT NULL
        AND status <> 'converted'
        AND (category IS NULL OR category IN ('actively_looking', 'casually_browsing'))
      LIMIT 200`,
    [brand.brand_id]
  );
  let sent = 0;
  for (const buyer of buyers) {
    try {
      await sendEmail({
        to: buyer.email,
        subject: `Open house tomorrow: ${oh.address}`,
        html: `<p>Hi ${buyer.name},</p>
<p>Just a friendly reminder — there's an open house tomorrow at <strong>${oh.address}</strong> (${openHouseWhen(oh)}${oh.end_time ? ` – ${oh.end_time}` : ""}).</p>
<p>We'd love to see you there. Reply to this email with any questions.</p>
<p>— ${brand.brand_name}</p>`,
      });
      sent += 1;
    } catch (err) {
      console.error(`Open house reminder email failed (${buyer.email}):`, err.message);
    }
  }
  await notifyOwner(
    brand.user_id,
    "Open house reminders sent",
    `Reminded ${sent} interested buyer(s) about tomorrow's open house at ${oh.address}.`,
    "/dashboard?section=properties"
  );
  return true;
}

async function followUpAttendees(oh, brand) {
  const claim = await db.query(
    `UPDATE open_houses SET followed_up_at = NOW(), updated_at = NOW()
      WHERE open_house_id = $1 AND followed_up_at IS NULL RETURNING open_house_id`,
    [oh.open_house_id]
  );
  if (claim.rowCount === 0) return false;
  const { rows: attendees } = await db.query(
    `SELECT name, email, interested FROM open_house_attendees
      WHERE open_house_id = $1 AND email IS NOT NULL LIMIT 500`,
    [oh.open_house_id]
  );
  let sent = 0;
  for (const a of attendees) {
    try {
      await sendEmail({
        to: a.email,
        subject: `Thanks for visiting ${oh.address}`,
        html: `<p>Hi ${a.name},</p>
<p>Thank you for stopping by the open house at <strong>${oh.address}</strong>!</p>
${
  a.interested
    ? "<p>You mentioned you were interested — reply to this email and we can talk next steps, answer questions, or set up a private showing.</p>"
    : "<p>If this home wasn't quite the right fit, reply and tell us what you're looking for — we'll keep an eye out for you.</p>"
}
<p>— ${brand.brand_name}</p>`,
      });
      sent += 1;
    } catch (err) {
      console.error(`Open house follow-up email failed (${a.email}):`, err.message);
    }
  }
  await notifyOwner(
    brand.user_id,
    "Open house follow-ups sent",
    `Followed up with ${sent} attendee(s) from the open house at ${oh.address}.`,
    "/dashboard?section=properties"
  );
  return true;
}

async function runOpenHouseSweep() {
  const brands = await realEstateBrands();
  for (const brand of brands) {
    try {
      // Promote: within 7 days out and not yet promoted.
      const { rows: toPromote } = await db.query(
        `SELECT * FROM open_houses
          WHERE brand_id = $1 AND promoted_at IS NULL
            AND event_date >= NOW()::date
            AND event_date <= NOW()::date + INTERVAL '7 days'`,
        [brand.brand_id]
      );
      for (const oh of toPromote) {
        try {
          await module.exports.promoteOpenHouse(oh, brand);
        } catch (err) {
          console.error(`Open house promotion failed (${oh.address}):`, err.message);
        }
      }
      // Remind: happening tomorrow, not yet reminded.
      const { rows: toRemind } = await db.query(
        `SELECT * FROM open_houses
          WHERE brand_id = $1 AND reminded_at IS NULL
            AND event_date = NOW()::date + INTERVAL '1 day'`,
        [brand.brand_id]
      );
      for (const oh of toRemind) {
        try {
          await module.exports.remindInterestedBuyers(oh, brand);
        } catch (err) {
          console.error(`Open house reminder failed (${oh.address}):`, err.message);
        }
      }
      // Follow up: happened yesterday (or earlier), not yet followed up.
      const { rows: toFollowUp } = await db.query(
        `SELECT * FROM open_houses
          WHERE brand_id = $1 AND followed_up_at IS NULL
            AND event_date < NOW()::date
            AND event_date >= NOW()::date - INTERVAL '7 days'`,
        [brand.brand_id]
      );
      for (const oh of toFollowUp) {
        try {
          await module.exports.followUpAttendees(oh, brand);
        } catch (err) {
          console.error(`Open house follow-up failed (${oh.address}):`, err.message);
        }
      }
    } catch (err) {
      console.error(`Open house sweep failed for brand ${brand.brand_id}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// 4) Nova real-estate content — 3x/day on connected platforms
// ---------------------------------------------------------------------------

async function runRealEstateContentRun(slot) {
  const brands = await realEstateBrands();
  let scheduled = 0;
  for (const brand of brands) {
    try {
      const platforms = await connectedPlatforms(brand.brand_id);
      if (platforms.length === 0) continue;

      const dayIndex = Math.floor(Date.now() / 86400000);
      // Dedup per brand/platform/slot/day via the source slot key + the
      // partial unique index on social_posts (brand_id, platform, source):
      // manual and other automated posts never suppress an RE run, and
      // overlapping ticks/restarts can't double-schedule the same slot.
      const slotKey = `re_auto:${new Date().toISOString().slice(0, 10)}:${Number(slot || 0)}`;
      const { rows: already } = await db.query(
        `SELECT 1 FROM social_posts WHERE brand_id = $1 AND source = $2 LIMIT 1`,
        [brand.brand_id, slotKey]
      );
      if (already.length > 0) continue;

      const topic =
        CONTENT_TOPICS[(dayIndex * 3 + Number(slot || 0)) % CONTENT_TOPICS.length];
      brand._sageContext = await sageContextForBrand(brand.brand_id).catch(() => null);
      for (const platform of platforms) {
        try {
          const variations = await generateSocialPosts(brand, topic, platform, 5);
          const content = variations[0];
          const { rowCount } = await db.query(
            `INSERT INTO social_posts (brand_id, platform, post_content, scheduled_time, status, source)
             VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes', 'scheduled', $4)
             ON CONFLICT (brand_id, platform, source) WHERE source IS NOT NULL
             DO NOTHING`,
            [brand.brand_id, platform, postTextFrom(content), slotKey]
          );
          if (rowCount > 0) scheduled += 1;
        } catch (err) {
          console.error(
            `Nova RE content failed (${brand.brand_name} / ${platform}):`,
            err.message
          );
        }
      }
    } catch (err) {
      console.error(`Nova RE content run failed for brand ${brand.brand_id}:`, err.message);
    }
  }
  if (scheduled > 0) console.log(`Nova real-estate content: ${scheduled} post(s) scheduled.`);
  return scheduled;
}

module.exports = {
  CONTENT_TOPICS,
  postTextFrom,
  realEstateBrands,
  promoteListing,
  runListingPromotionSweep,
  claimSellerLeadSlot,
  runSellerLeadAdSweep,
  promoteOpenHouse,
  remindInterestedBuyers,
  followUpAttendees,
  runOpenHouseSweep,
  runRealEstateContentRun,
};
