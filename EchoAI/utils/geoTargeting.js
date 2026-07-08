/**
 * Geographic targeting + exclusion zones (compliance).
 *
 * Every brand can define WHERE to market (areas) and WHERE NEVER to market
 * (exclusions). Exclusions are a HARD BLOCK across every channel — ads, content,
 * research, follow-ups — regardless of any other targeting settings.
 *
 * Shape stored in brands.geo_targeting (JSONB):
 *   {
 *     areas:      [{ type: 'state'|'county'|'city'|'zip'|'radius',
 *                    value, state?, radiusMiles? }],
 *     exclusions: [{ type: 'state'|'county'|'city'|'zip',
 *                    value, state?, reason?, addedBy: 'owner'|'sage', addedAt }]
 *   }
 * NULL / missing = no geographic restriction configured.
 */

const US_STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// Facebook Marketing API region keys for US states (stable public mapping).
const FB_REGION_KEYS = {
  AL: 3843, AK: 3844, AZ: 3845, AR: 3846, CA: 3847, CO: 3848, CT: 3849,
  DE: 3850, DC: 3851, FL: 3852, GA: 3853, HI: 3854, ID: 3855, IL: 3856,
  IN: 3857, IA: 3858, KS: 3859, KY: 3860, LA: 3861, ME: 3862, MD: 3863,
  MA: 3864, MI: 3865, MN: 3866, MS: 3867, MO: 3868, MT: 3869, NE: 3870,
  NV: 3871, NH: 3872, NJ: 3873, NM: 3874, NY: 3875, NC: 3876, ND: 3877,
  OH: 3878, OK: 3879, OR: 3880, PA: 3881, RI: 3882, SC: 3883, SD: 3884,
  TN: 3885, TX: 3886, UT: 3887, VT: 3888, VA: 3889, WA: 3890, WV: 3891,
  WI: 3892, WY: 3893,
};

const NAME_TO_CODE = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code])
);

const AREA_TYPES = new Set(["state", "county", "city", "zip", "radius"]);
const EXCLUSION_TYPES = new Set(["state", "county", "city", "zip"]);
const MAX_ENTRIES = 200;

/** Resolve any state input ('FL', 'Florida', ' florida ') → 2-letter code or null. */
function stateCode(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (US_STATES[upper]) return upper;
  return NAME_TO_CODE[raw.toLowerCase()] || null;
}

function cleanText(value, max = 120) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function normZip(value) {
  const z = String(value || "").trim();
  return /^\d{5}$/.test(z) ? z : null;
}

/**
 * Validate + normalize one targeting/exclusion entry. Returns the normalized
 * entry or throws with a plain-language message (surfaces as a 400).
 */
function normalizeEntry(entry, { allowRadius }) {
  if (!entry || typeof entry !== "object") throw new Error("Each area must be an object");
  const type = String(entry.type || "").toLowerCase();
  const validTypes = allowRadius ? AREA_TYPES : EXCLUSION_TYPES;
  if (!validTypes.has(type)) {
    throw new Error(`Unknown area type "${entry.type}". Use: ${[...validTypes].join(", ")}`);
  }

  if (type === "state") {
    const code = stateCode(entry.value);
    if (!code) throw new Error(`"${entry.value}" is not a US state`);
    return { type, value: code, label: US_STATES[code] };
  }
  if (type === "zip") {
    const zip = normZip(entry.value);
    if (!zip) throw new Error(`"${entry.value}" is not a 5-digit zip code`);
    const st = entry.state ? stateCode(entry.state) : null;
    return { type, value: zip, ...(st ? { state: st } : {}), label: zip };
  }
  if (type === "city" || type === "county") {
    const name = cleanText(entry.value);
    if (!name) throw new Error(`A ${type} name is required`);
    const st = stateCode(entry.state);
    if (!st) throw new Error(`A US state is required for ${type} "${name}"`);
    const label = `${name}, ${st}${type === "county" ? " (county)" : ""}`;
    return { type, value: name, state: st, label };
  }
  // radius
  const address = cleanText(entry.value, 200);
  if (!address) throw new Error("A radius area needs an address or place");
  const miles = Math.round(Number(entry.radiusMiles));
  if (!Number.isFinite(miles) || miles < 1 || miles > 500) {
    throw new Error("Radius must be between 1 and 500 miles");
  }
  const st = entry.state ? stateCode(entry.state) : null;
  return {
    type, value: address, radiusMiles: miles, ...(st ? { state: st } : {}),
    label: `${miles} miles around ${address}`,
  };
}

function entryKey(e) {
  return `${e.type}:${String(e.value).toLowerCase()}:${e.state || ""}`;
}

/**
 * Normalize a full geo config from client input. Throws on invalid entries.
 * Preserves exclusion provenance (addedBy/addedAt/reason) when supplied.
 */
function normalizeGeo(input = {}) {
  const areasIn = Array.isArray(input.areas) ? input.areas : [];
  const exclIn = Array.isArray(input.exclusions) ? input.exclusions : [];
  if (areasIn.length > MAX_ENTRIES || exclIn.length > MAX_ENTRIES) {
    throw new Error(`Too many entries (max ${MAX_ENTRIES})`);
  }

  const seenA = new Set();
  const areas = [];
  for (const raw of areasIn) {
    const e = normalizeEntry(raw, { allowRadius: true });
    const key = entryKey(e);
    if (seenA.has(key)) continue;
    seenA.add(key);
    areas.push(e);
  }

  const seenX = new Set();
  const exclusions = [];
  for (const raw of exclIn) {
    const e = normalizeEntry(raw, { allowRadius: false });
    const key = entryKey(e);
    if (seenX.has(key)) continue;
    seenX.add(key);
    exclusions.push({
      ...e,
      reason: cleanText(raw.reason, 300) || undefined,
      addedBy: raw.addedBy === "sage" ? "sage" : "owner",
      addedAt: typeof raw.addedAt === "string" && raw.addedAt ? raw.addedAt : new Date().toISOString(),
    });
  }

  return { areas, exclusions };
}

/** Parse the stored JSONB (object or string) into a safe geo config or null. */
function parseGeo(stored) {
  if (!stored) return null;
  let geo = stored;
  if (typeof geo === "string") {
    try { geo = JSON.parse(geo); } catch { return null; }
  }
  if (!geo || typeof geo !== "object") return null;
  const areas = Array.isArray(geo.areas) ? geo.areas : [];
  const exclusions = Array.isArray(geo.exclusions) ? geo.exclusions : [];
  if (!areas.length && !exclusions.length) return null;
  return { areas, exclusions };
}

/**
 * HARD-BLOCK check: is this location inside an exclusion zone?
 * Matches on state (code or name), city+state, county+state, or zip.
 * Unknown fields simply don't match — never guesses.
 */
function isExcludedLocation(geo, location = {}) {
  const parsed = parseGeo(geo);
  if (!parsed || !parsed.exclusions.length) return false;
  const st = stateCode(location.state);
  const city = cleanText(location.city).toLowerCase();
  const county = cleanText(location.county).toLowerCase();
  const zip = normZip(location.zip);

  return parsed.exclusions.some((e) => {
    if (e.type === "state") return st && e.value === st;
    if (e.type === "zip") return zip && e.value === zip;
    if (e.type === "city") {
      return city && String(e.value).toLowerCase() === city && (!e.state || !st || e.state === st);
    }
    if (e.type === "county") {
      return county && String(e.value).toLowerCase() === county && (!e.state || !st || e.state === st);
    }
    return false;
  });
}

/** Is the location inside any configured target area? (false when unknown) */
function isInTargetArea(geo, location = {}) {
  const parsed = parseGeo(geo);
  if (!parsed || !parsed.areas.length) return true; // no restriction configured
  const st = stateCode(location.state);
  const city = cleanText(location.city).toLowerCase();
  const zip = normZip(location.zip);

  return parsed.areas.some((a) => {
    if (a.type === "state") return st && a.value === st;
    if (a.type === "zip") return zip && a.value === zip;
    if (a.type === "city") {
      return city && String(a.value).toLowerCase() === city && (!st || !a.state || a.state === st);
    }
    if (a.type === "county") {
      // Leads rarely carry a county — count the county's state as in-area.
      return st && a.state === st;
    }
    if (a.type === "radius") {
      // No geocoding — a radius area counts its state (when known) as in-area.
      return a.state && st && a.state === st;
    }
    return false;
  });
}

/**
 * Classify a lead's location against the brand's geo config.
 * Returns 'excluded' | 'out_of_area' | 'in_area' | null (location unknown or
 * no geo configured).
 */
function classifyLeadGeo(geo, location = {}) {
  const parsed = parseGeo(geo);
  if (!parsed) return null;
  const hasLocation = Boolean(stateCode(location.state) || normZip(location.zip) || cleanText(location.city));
  if (!hasLocation) return null;
  if (isExcludedLocation(parsed, location)) return "excluded";
  if (!parsed.areas.length) return "in_area";
  return isInTargetArea(parsed, location) ? "in_area" : "out_of_area";
}

/**
 * Build the Facebook targeting geo payload with the exclusion HARD BLOCK.
 * States → regions (static key map), zips → US:zip keys. City/county/radius
 * areas can't be resolved to FB keys without the FB search API, so they are
 * enforced at the state level here and refined in ad copy/content.
 */
function fbGeoLocations(geo) {
  const parsed = parseGeo(geo);
  if (!parsed) return null;

  const geoLocations = {};
  const regionKeys = new Set();
  const zips = new Set();
  for (const a of parsed.areas) {
    if (a.type === "state" && FB_REGION_KEYS[a.value]) regionKeys.add(FB_REGION_KEYS[a.value]);
    if ((a.type === "city" || a.type === "county" || a.type === "radius") && a.state && FB_REGION_KEYS[a.state]) {
      regionKeys.add(FB_REGION_KEYS[a.state]);
    }
    if (a.type === "zip") zips.add(a.value);
  }
  if (regionKeys.size) geoLocations.regions = [...regionKeys].map((key) => ({ key: String(key) }));
  if (zips.size) geoLocations.zips = [...zips].map((z) => ({ key: `US:${z}` }));
  if (!regionKeys.size && !zips.size) geoLocations.countries = ["US"];

  const exRegionKeys = new Set();
  const exZips = new Set();
  for (const e of parsed.exclusions) {
    if (e.type === "state" && FB_REGION_KEYS[e.value]) exRegionKeys.add(FB_REGION_KEYS[e.value]);
    if ((e.type === "city" || e.type === "county") && e.state && FB_REGION_KEYS[e.state]) {
      // City/county exclusions can't be FB-keyed without the search API.
      // Fail closed: hard-exclude the whole state at the FB level UNLESS the
      // brand also targets an area inside that same state (excluding the whole
      // state would then wipe out the legitimate service area — in that case
      // the exclusion is enforced by ad copy, content, and lead handling).
      const stateHasTargetedArea = parsed.areas.some(
        (a) =>
          (a.type === "state" && a.value === e.state) ||
          (a.state && a.state === e.state),
      );
      if (!stateHasTargetedArea) exRegionKeys.add(FB_REGION_KEYS[e.state]);
    }
    if (e.type === "zip") exZips.add(e.value);
  }
  const excluded = {};
  if (exRegionKeys.size) excluded.regions = [...exRegionKeys].map((key) => ({ key: String(key) }));
  if (exZips.size) excluded.zips = [...exZips].map((z) => ({ key: `US:${z}` }));

  return {
    geo_locations: geoLocations,
    ...(Object.keys(excluded).length ? { excluded_geo_locations: excluded } : {}),
  };
}

/**
 * Scan free text (a proposed geo description, AI suggestion, etc.) for any
 * mention of an excluded area. Returns the matched exclusion labels (empty
 * array = clean). Used as a hard block on autonomous targeting changes.
 */
function textMentionsExcluded(geo, text) {
  const parsed = parseGeo(geo);
  if (!parsed || !parsed.exclusions.length) return [];
  const hay = ` ${String(text || "").toLowerCase()} `;
  if (!hay.trim()) return [];
  const hits = [];
  for (const e of parsed.exclusions) {
    let needles = [];
    if (e.type === "state") {
      needles = [US_STATES[e.value] ? US_STATES[e.value].toLowerCase() : null];
    } else if (e.type === "zip") {
      needles = [e.value];
    } else {
      needles = [String(e.value).toLowerCase()];
    }
    if (needles.some((n) => n && hay.includes(n))) hits.push(labelOf(e));
  }
  return hits;
}

function labelOf(e) {
  return e.label || (e.type === "state" ? US_STATES[e.value] || e.value : e.value);
}

/** Plain-language coverage summary ("Targeting: … Never marketing in: …"). */
function geoSummaryText(geo) {
  const parsed = parseGeo(geo);
  if (!parsed) return "";
  const parts = [];
  if (parsed.areas.length) {
    parts.push(`Targeting: ${parsed.areas.map(labelOf).join("; ")}`);
  } else {
    parts.push("Targeting: United States (no specific area set)");
  }
  if (parsed.exclusions.length) {
    parts.push(`Never marketing in: ${parsed.exclusions.map(labelOf).join("; ")}`);
  }
  return parts.join(". ");
}

/**
 * Prompt context block injected into AI prompt builders (ads, social, email,
 * follow-ups, research). Empty string when no geo is configured.
 */
function geoContextBlock(brand) {
  const parsed = parseGeo(brand && brand.geo_targeting);
  if (!parsed) return "";
  const lines = ["GEOGRAPHIC TARGETING (STRICT):"];
  if (parsed.areas.length) {
    lines.push(`- Service area: ${parsed.areas.map(labelOf).join("; ")}.`);
    lines.push("- Keep all content, offers, references and location tags focused on this exact service area (local landmarks, city/region names, local market conditions).");
  }
  if (parsed.exclusions.length) {
    lines.push(`- EXCLUSION ZONE (legal/compliance — HARD RULE): never target, mention marketing availability in, or invite business from: ${parsed.exclusions.map(labelOf).join("; ")}.`);
  }
  return lines.join("\n");
}

module.exports = {
  US_STATES,
  FB_REGION_KEYS,
  stateCode,
  normalizeGeo,
  parseGeo,
  isExcludedLocation,
  isInTargetArea,
  classifyLeadGeo,
  fbGeoLocations,
  textMentionsExcluded,
  geoSummaryText,
  geoContextBlock,
};
