/**
 * Political-campaign helpers, shared by every agent that adapts to the
 * "political" brand type.
 *
 * A political brand stores its campaign details in brands.campaign_profile
 * (JSONB): { candidate_name, office_sought, district, key_issues,
 * voter_demographics, campaign_budget, opponent_name, website_socials,
 * paid_for_by }. All values are free text captured during setup or edited in
 * Settings. Fields may be missing — every helper here degrades gracefully.
 */

/** True when this brand row is a political campaign. */
function isPolitical(brand) {
  return !!brand && brand.brand_type === "political";
}

/** Coerce a campaign_profile value (string / object / array) to plain text. */
function asText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return Object.values(value).map(asText).filter(Boolean).join(", ");
  }
  return String(value);
}

/** The parsed campaign profile for a brand ({} for non-political brands). */
function campaignProfile(brand) {
  if (!isPolitical(brand)) return {};
  const raw = brand.campaign_profile;
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
 * The legally required political advertising disclosure line for this brand.
 * Uses the explicit "paid for by" committee name when provided, otherwise
 * falls back to the candidate's campaign ("Paid for by <candidate> for
 * <office>"), then the candidate name, then the brand name.
 */
function requiredDisclaimer(brand) {
  const p = campaignProfile(brand);
  const paidForBy = asText(p.paid_for_by);
  if (paidForBy) {
    return /^paid for by/i.test(paidForBy) ? paidForBy : `Paid for by ${paidForBy}`;
  }
  const candidate = asText(p.candidate_name);
  const office = asText(p.office_sought);
  if (candidate && office) return `Paid for by ${candidate} for ${office}`;
  if (candidate) return `Paid for by ${candidate}`;
  return `Paid for by ${asText(brand && brand.brand_name) || "the campaign"}`;
}

/**
 * Deterministically guarantee the disclosure appears in a piece of ad copy.
 * If the text already contains a "Paid for by" line it is left alone;
 * otherwise the required disclaimer is appended on its own line. Never relies
 * on the AI having remembered to include it.
 */
function ensureDisclaimer(text, brand) {
  const body = typeof text === "string" ? text : "";
  if (/paid for by/i.test(body)) return body;
  const disclaimer = requiredDisclaimer(brand);
  return body ? `${body}\n\n${disclaimer}` : disclaimer;
}

/**
 * A plain-text context block describing the campaign, for injection into any
 * agent prompt. Empty string for non-political brands.
 */
function campaignContextBlock(brand) {
  if (!isPolitical(brand)) return "";
  const p = campaignProfile(brand);
  const lines = [
    "POLITICAL CAMPAIGN CONTEXT — this brand is a political campaign, not a business. Adapt all language accordingly: supporters/voters instead of customers, the campaign instead of the business, volunteering/donating/voting instead of buying.",
  ];
  const add = (label, v) => {
    const t = asText(v);
    if (t) lines.push(`- ${label}: ${t}`);
  };
  add("Candidate", p.candidate_name);
  add("Office sought", p.office_sought);
  add("District / area", p.district);
  add("Key issues & platform", p.key_issues);
  add("Target voter demographics", p.voter_demographics);
  add("Opponent", p.opponent_name);
  add("Website & social media", p.website_socials);
  lines.push(
    "Rules: stay positive and issue-focused; never fabricate endorsements, statistics, or quotes; never make false claims about the opponent; all advertising must carry the required disclosure line."
  );
  return lines.join("\n");
}

module.exports = {
  isPolitical,
  campaignProfile,
  requiredDisclaimer,
  ensureDisclaimer,
  campaignContextBlock,
};
