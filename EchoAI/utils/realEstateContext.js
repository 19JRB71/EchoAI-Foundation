/**
 * Real-estate helpers, shared by every agent that adapts to the
 * "real_estate" brand type.
 *
 * A real-estate brand stores its details in brands.real_estate_profile
 * (JSONB): { agent_name, brokerage, markets_served, client_focus,
 * price_range, target_clients, active_listings_note }. All values are free
 * text captured during setup or edited in Settings. Fields may be missing —
 * every helper here degrades gracefully.
 */

/** True when this brand row is a real-estate agent/team. */
function isRealEstate(brand) {
  return !!brand && brand.brand_type === "real_estate";
}

/** Coerce a profile value (string / object / array) to plain text. */
function asText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return Object.values(value).map(asText).filter(Boolean).join(", ");
  }
  return String(value);
}

/** The parsed real-estate profile for a brand ({} for other brand types). */
function realEstateProfile(brand) {
  if (!isRealEstate(brand)) return {};
  const raw = brand.real_estate_profile;
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) || {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? raw : {};
}

/**
 * A plain-text context block describing the real-estate practice, for
 * injection into any agent prompt. Empty string for other brand types.
 */
function realEstateContextBlock(brand) {
  if (!isRealEstate(brand)) return "";
  const p = realEstateProfile(brand);
  const lines = [
    "REAL ESTATE CONTEXT — this brand is a real estate agent or team, not a generic business. Adapt all language accordingly: buyers and sellers instead of customers, listings and showings instead of products, the market they serve instead of a storefront.",
  ];
  const add = (label, v) => {
    const t = asText(v);
    if (t) lines.push(`- ${label}: ${t}`);
  };
  add("Agent / team", p.agent_name);
  add("Brokerage", p.brokerage);
  add("Markets served (cities, counties, zip codes)", p.markets_served);
  add("Focus (buyers, sellers, or both)", p.client_focus);
  add("Typical price range", p.price_range);
  add("Target clients", p.target_clients);
  add("Current active listings", p.active_listings_note);
  lines.push(
    "Rules: comply with fair-housing law — never target, describe, or exclude audiences by protected class (race, religion, family status, disability, national origin); describe properties and locations, never the 'kind of people' who should live there; never fabricate market statistics, sale prices, or testimonials; keep all claims about properties factual."
  );
  return lines.join("\n");
}

module.exports = {
  isRealEstate,
  realEstateProfile,
  realEstateContextBlock,
};
