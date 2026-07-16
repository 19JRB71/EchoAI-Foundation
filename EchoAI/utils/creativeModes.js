// Hybrid Creative Engine — the mode decision brain.
//
// Forge supports three ways to build a post graphic:
//   'asset'    — the owner's REAL photo, enhanced only (lighting/color/quality)
//   'assisted' — the owner's real photo + PERMITTED AI edits (sky, season, ...)
//   'ai'       — an original AI concept that never pretends to depict a
//                specific real project or product
//
// Which mode each batch item gets is decided here from three honest inputs:
// the owner's content preference, how many real photos the brand actually has
// in the Vision reference library, and the industry's default real-vs-AI mix.
// Deterministic + pure (no DB, no randomness beyond the injectable rand) so
// it is fully unit-testable.

const CONTENT_PREFERENCES = [
  "only_my_media", // Only use my uploaded media
  "prefer_my_media", // Use my media whenever possible
  "balanced_auto", // Let AI decide automatically (industry default mix)
  "mostly_ai", // Generate mostly AI content
  "ai_only", // Generate only AI content
];

// Edit-type permission keys → what each one allows the model to do to the
// owner's real photo. The prompt line is phrased as an ALLOWED action;
// disabled keys are listed as forbidden in the edit prompt.
const EDIT_PERMISSIONS = {
  lighting: "improve the lighting",
  colors: "improve and balance the colors",
  quality: "enhance sharpness and overall image quality",
  remove_distractions:
    "remove distracting clutter (cords, trash cans, stray objects)",
  replace_background: "replace or clean up the background or sky",
  seasonal: "change the season shown (e.g. summer to autumn)",
  day_night: "convert between day and night lighting",
  landscaping: "improve or add tasteful landscaping around the subject",
  branding: "add tasteful brand elements (logo placement, brand colors)",
  layouts: "compose the photo into a marketing layout with text space",
};

// Enhancement-only keys: the ONLY edits 'asset' mode may use. Everything
// else (backgrounds, seasons, added elements) upgrades the item to
// 'assisted' mode, which the owner may have disabled.
const ENHANCE_KEYS = ["lighting", "colors", "quality", "remove_distractions"];

const DEFAULT_PERMISSIONS = Object.freeze(
  Object.fromEntries(Object.keys(EDIT_PERMISSIONS).map((k) => [k, true]))
);

// Industry Intelligence: default share of a batch built from the owner's REAL
// photos (asset + assisted). Matched by keyword against the account industry
// string; first match wins, 0.5 when nothing matches.
const INDUSTRY_ASSET_SHARE = [
  { pattern: /(dealer|automotive|auto sales|car lot)/i, share: 0.8 },
  { pattern: /(real ?estate|realtor|realty|property)/i, share: 0.7 },
  { pattern: /(restaurant|food|cafe|bakery|catering)/i, share: 0.7 },
  { pattern: /(barn|construction|roof|hvac|landscap|plumb|contractor|builder|remodel|manufactur)/i, share: 0.6 },
  { pattern: /(law|legal|attorney|accounting|consult|insurance|finance)/i, share: 0.25 },
];

function isValidPreference(value) {
  return CONTENT_PREFERENCES.includes(value);
}

// Coerces any stored/user-supplied permissions value to a full boolean map.
// Unknown keys are dropped; missing keys default to allowed (the spec's
// recommended default is everything checked).
function normalizePermissions(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of Object.keys(EDIT_PERMISSIONS)) {
    out[key] = key in source ? source[key] === true : true;
  }
  return out;
}

function industryAssetShare(industry) {
  const text = typeof industry === "string" ? industry : "";
  for (const row of INDUSTRY_ASSET_SHARE) {
    if (row.pattern.test(text)) return row.share;
  }
  return 0.5;
}

// The share of items that should come from the owner's real photos, after the
// owner's preference adjusts the industry default.
function assetShareFor(preference, industry) {
  const base = industryAssetShare(industry);
  switch (preference) {
    case "only_my_media":
      return 1;
    case "prefer_my_media":
      return Math.max(base, 0.7);
    case "mostly_ai":
      return Math.min(base, 0.25);
    case "ai_only":
      return 0;
    default: // balanced_auto
      return base;
  }
}

// True when any edit beyond pure enhancement is permitted — the gate for
// producing 'assisted' items at all.
function allowsAssistedEdits(permissions) {
  const perms = normalizePermissions(permissions);
  return Object.keys(EDIT_PERMISSIONS).some(
    (k) => !ENHANCE_KEYS.includes(k) && perms[k]
  );
}

/**
 * Decides the creative mode for each of `itemCount` items.
 * Returns an array of 'asset' | 'assisted' | 'ai'.
 *
 * Honesty rules:
 * - No real photos → never an asset-based mode. With 'only_my_media' that is
 *   a hard, honest failure (err.noAssets = true) instead of quietly faking it
 *   with AI images.
 * - Asset-based items alternate between 'asset' and 'assisted' (when edits
 *   are permitted) and are interleaved across the schedule so the feed mixes
 *   real and AI content instead of clumping.
 */
function decideModes({ preference, industry, assetCount, itemCount, permissions }) {
  const pref = isValidPreference(preference) ? preference : "balanced_auto";
  const count = Math.max(0, Math.floor(itemCount) || 0);
  if (count === 0) return [];

  if ((Number(assetCount) || 0) <= 0) {
    if (pref === "only_my_media") {
      const err = new Error(
        "Your creative setting is \u201cOnly use my uploaded media\u201d, but this brand has no photos in the Vision reference library yet. Upload some real project photos (Vision \u2192 Reference Library) or relax the creative setting."
      );
      err.noAssets = true;
      throw err;
    }
    return Array.from({ length: count }, () => "ai");
  }

  const share = assetShareFor(pref, industry);
  let assetItems = Math.round(share * count);
  if (pref === "only_my_media") assetItems = count;
  if (share > 0 && assetItems === 0) assetItems = 1; // any real-photo share rounds up to at least one real post
  const assistedAllowed = allowsAssistedEdits(permissions);

  // Interleave: spread asset-based items evenly across the schedule.
  const modes = Array.from({ length: count }, () => "ai");
  if (assetItems > 0) {
    const step = count / assetItems;
    let assistedToggle = false;
    for (let i = 0; i < assetItems; i += 1) {
      const idx = Math.min(count - 1, Math.floor(i * step));
      const slot = modes[idx] === "ai" ? idx : modes.indexOf("ai");
      if (slot === -1) break;
      modes[slot] = assistedAllowed && assistedToggle ? "assisted" : "asset";
      assistedToggle = !assistedToggle;
    }
  }
  return modes;
}

/**
 * Builds the edit-instruction block appended to the image prompt when working
 * FROM a real photo. Lists exactly what the owner permitted; everything not
 * permitted is explicitly forbidden. 'asset' mode is always enhancement-only
 * regardless of broader permissions.
 */
function editDirectives(mode, permissions) {
  const perms = normalizePermissions(permissions);
  const keys =
    mode === "asset"
      ? ENHANCE_KEYS.filter((k) => perms[k])
      : Object.keys(EDIT_PERMISSIONS).filter((k) => perms[k]);
  const forbidden = Object.keys(EDIT_PERMISSIONS).filter((k) => !keys.includes(k));

  const lines = [
    "This is the customer's REAL photo of their actual work/product. It must remain the authentic centerpiece \u2014 never replace, redraw, or fabricate the main subject.",
  ];
  if (keys.length) {
    lines.push("You MAY: " + keys.map((k) => EDIT_PERMISSIONS[k]).join("; ") + ".");
  } else {
    lines.push("Make no edits beyond faithful reproduction.");
  }
  if (forbidden.length) {
    lines.push(
      "You MUST NOT: " + forbidden.map((k) => EDIT_PERMISSIONS[k]).join("; ") + "."
    );
  }
  if (mode === "asset") {
    lines.push(
      "Keep the scene, setting, and every real element exactly as photographed \u2014 this is an enhancement, not a re-imagining."
    );
  }
  return lines.join("\n");
}

// Appended to every pure-AI image prompt so original concepts stay honest.
const AI_ORIGINALITY_LINE =
  "This is an ORIGINAL brand concept image: do NOT depict or imply a specific real project, property, vehicle, or product of this business \u2014 keep it clearly conceptual/illustrative while reinforcing the brand.";

module.exports = {
  CONTENT_PREFERENCES,
  EDIT_PERMISSIONS,
  ENHANCE_KEYS,
  DEFAULT_PERMISSIONS,
  AI_ORIGINALITY_LINE,
  isValidPreference,
  normalizePermissions,
  industryAssetShare,
  assetShareFor,
  allowsAssistedEdits,
  decideModes,
  editDirectives,
};
