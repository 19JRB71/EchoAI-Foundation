/**
 * Lead geographic flagging.
 *
 * Whenever a lead arrives (manual, chatbot widget, SMS, public capture) with
 * any location info, classify it against the brand's geographic targeting and
 * store the result on the lead row. If the lead is OUTSIDE the service area —
 * or worse, inside a hard-excluded zone — Echo alerts the owner (voice + push)
 * so they can decide what to do. Everything here is best-effort: a failure
 * never breaks lead capture.
 */

const db = require("../config/db");
const { parseGeo, classifyLeadGeo } = require("./geoTargeting");
const { enqueueOwnerVoiceEvent } = require("./echoVoiceNotifications");

/**
 * Classify + persist a lead's geographic status. Returns the stored status
 * ('in_area' | 'out_of_area' | 'excluded' | null) or null on any failure.
 *
 * location: { city?, state?, zip? } — all optional strings. When no location
 * info is present, the lead's geo_status stays NULL (unknown — honest, never
 * guessed).
 */
async function applyLeadGeo(brandId, leadId, location) {
  try {
    const city = cleanLoc(location && location.city, 120);
    const state = cleanLoc(location && location.state, 60);
    const zip = cleanLoc(location && location.zip, 10);
    if (!city && !state && !zip) return null;

    const { rows } = await db.query(
      `SELECT b.brand_id, b.brand_name, b.user_id, b.geo_targeting
         FROM brands b WHERE b.brand_id = $1`,
      [brandId],
    );
    const brand = rows[0];
    if (!brand) return null;

    const geo = parseGeo(brand.geo_targeting);
    const status = classifyLeadGeo(geo, { city, state, zip });

    await db.query(
      `UPDATE leads
          SET lead_city = COALESCE($2, lead_city),
              lead_state = COALESCE($3, lead_state),
              lead_zip = COALESCE($4, lead_zip),
              geo_status = $5
        WHERE lead_id = $1 AND brand_id = $6`,
      [leadId, city, state, zip, status, brandId],
    );

    if (status === "excluded" || status === "out_of_area") {
      await notifyOwner(brand, leadId, status, { city, state, zip });
    }
    return status;
  } catch (err) {
    console.error(`Lead geo flag failed for lead ${leadId}:`, err.message);
    return null;
  }
}

function cleanLoc(v, max) {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

function placeText({ city, state, zip }) {
  return [city, state, zip].filter(Boolean).join(", ");
}

/** Echo pages the owner about a lead outside the service area (best-effort). */
async function notifyOwner(brand, leadId, status, location) {
  const where = placeText(location) || "an unknown location";
  const excluded = status === "excluded";
  const title = excluded
    ? "Echo: lead from an excluded area"
    : "Echo: lead outside your service area";
  const body = excluded
    ? `A new lead for ${brand.brand_name} is from ${where} — an area you've marked as off-limits. Review it in your Leads section.`
    : `A new lead for ${brand.brand_name} is from ${where}, outside your service area. Review it in your Leads section.`;
  try {
    await enqueueOwnerVoiceEvent(
      brand.user_id,
      "lead_geo_flag",
      (firstName) =>
        excluded
          ? `Sir, heads up. A new lead for ${brand.brand_name} came in from ${where}, which is one of your excluded areas. I've flagged it so you can decide how to handle it.`
          : `Sir, a quick flag. A new lead for ${brand.brand_name} came in from ${where}, which is outside your service area. It's marked in your leads list.`,
      {
        brandId: brand.brand_id,
        title,
        dedupKey: `lead_geo:${leadId}`,
        payload: { type: "lead_geo_flag", brandId: brand.brand_id, leadId },
      },
    );
  } catch (err) {
    console.error(`Lead geo voice alert failed for lead ${leadId}:`, err.message);
  }
  try {
    // Lazy require avoids a circular dependency (pushController → routes).
    const pushController = require("../controllers/pushController");
    pushController
      .sendPushToUser(brand.user_id, {
        title,
        body,
        data: { type: "lead_geo_flag", brandId: brand.brand_id, leadId },
      })
      .catch(() => {});
  } catch (_e) {
    /* best-effort */
  }
}

module.exports = { applyLeadGeo };
