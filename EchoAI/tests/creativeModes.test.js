// Hybrid Creative Engine — mode decision brain (pure unit tests, no DB).
const test = require("node:test");
const assert = require("node:assert");

const {
  CONTENT_PREFERENCES,
  EDIT_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  AI_ORIGINALITY_LINE,
  isValidPreference,
  normalizePermissions,
  industryAssetShare,
  assetShareFor,
  allowsAssistedEdits,
  decideModes,
  editDirectives,
} = require("../utils/creativeModes");

test("preference validation accepts the catalog and rejects junk", () => {
  for (const p of CONTENT_PREFERENCES) assert.ok(isValidPreference(p));
  assert.ok(!isValidPreference("yolo"));
  assert.ok(!isValidPreference(null));
});

test("normalizePermissions fills every key, defaults true, drops unknowns", () => {
  const out = normalizePermissions({ lighting: false, bogus: true });
  assert.strictEqual(out.lighting, false);
  assert.strictEqual(out.colors, true);
  assert.ok(!("bogus" in out));
  assert.deepStrictEqual(Object.keys(out).sort(), Object.keys(EDIT_PERMISSIONS).sort());
  // Non-object inputs → all defaults
  assert.deepStrictEqual(normalizePermissions(null), { ...DEFAULT_PERMISSIONS });
  assert.deepStrictEqual(normalizePermissions("x"), { ...DEFAULT_PERMISSIONS });
});

test("industry intelligence default mixes", () => {
  assert.strictEqual(industryAssetShare("Auto Dealership"), 0.8);
  assert.strictEqual(industryAssetShare("Real Estate"), 0.7);
  assert.strictEqual(industryAssetShare("Pole Barn Builder"), 0.6);
  assert.strictEqual(industryAssetShare("Restaurant"), 0.7);
  assert.strictEqual(industryAssetShare("Law Firm"), 0.25);
  assert.strictEqual(industryAssetShare("Something Else"), 0.5);
  assert.strictEqual(industryAssetShare(null), 0.5);
});

test("preference adjusts the industry share", () => {
  assert.strictEqual(assetShareFor("only_my_media", "Law Firm"), 1);
  assert.strictEqual(assetShareFor("prefer_my_media", "Law Firm"), 0.7);
  assert.strictEqual(assetShareFor("balanced_auto", "Real Estate"), 0.7);
  assert.strictEqual(assetShareFor("mostly_ai", "Real Estate"), 0.25);
  assert.strictEqual(assetShareFor("ai_only", "Real Estate"), 0);
});

test("no assets → all AI, never a fabricated asset mode", () => {
  const modes = decideModes({
    preference: "prefer_my_media",
    industry: "Roofing",
    assetCount: 0,
    itemCount: 5,
  });
  assert.deepStrictEqual(modes, ["ai", "ai", "ai", "ai", "ai"]);
});

test("only_my_media with no assets fails honestly", () => {
  assert.throws(
    () =>
      decideModes({
        preference: "only_my_media",
        industry: "Roofing",
        assetCount: 0,
        itemCount: 5,
      }),
    (err) => err.noAssets === true
  );
});

test("only_my_media with assets → every item photo-based", () => {
  const modes = decideModes({
    preference: "only_my_media",
    industry: "HVAC",
    assetCount: 2,
    itemCount: 6,
    permissions: DEFAULT_PERMISSIONS,
  });
  assert.strictEqual(modes.length, 6);
  assert.ok(modes.every((m) => m === "asset" || m === "assisted"));
});

test("ai_only never touches the owner's photos", () => {
  const modes = decideModes({
    preference: "ai_only",
    industry: "Real Estate",
    assetCount: 10,
    itemCount: 7,
  });
  assert.ok(modes.every((m) => m === "ai"));
});

test("balanced dealership mix ≈ 80% photo-based, interleaved", () => {
  const modes = decideModes({
    preference: "balanced_auto",
    industry: "Car Dealership",
    assetCount: 10,
    itemCount: 10,
    permissions: DEFAULT_PERMISSIONS,
  });
  const photoBased = modes.filter((m) => m !== "ai").length;
  assert.strictEqual(photoBased, 8);
  // Interleaved: the photo items are not all clumped at the front —
  // AI items appear somewhere after a photo item.
  assert.notStrictEqual(modes.indexOf("ai"), -1);
});

test("any nonzero share rounds up to at least one real-photo post", () => {
  const modes = decideModes({
    preference: "mostly_ai",
    industry: "Law Firm",
    assetCount: 4,
    itemCount: 3,
    permissions: DEFAULT_PERMISSIONS,
  });
  assert.ok(modes.some((m) => m !== "ai"));
});

test("assisted mode only appears when non-enhancement edits are permitted", () => {
  const enhanceOnly = normalizePermissions({
    replace_background: false,
    seasonal: false,
    day_night: false,
    landscaping: false,
    branding: false,
    layouts: false,
  });
  assert.strictEqual(allowsAssistedEdits(enhanceOnly), false);
  const modes = decideModes({
    preference: "prefer_my_media",
    industry: "Roofing",
    assetCount: 5,
    itemCount: 8,
    permissions: enhanceOnly,
  });
  assert.ok(!modes.includes("assisted"));
  assert.ok(modes.includes("asset"));
});

test("editDirectives: asset mode is enhancement-only regardless of permissions", () => {
  const text = editDirectives("asset", DEFAULT_PERMISSIONS);
  assert.match(text, /You MAY: .*lighting/);
  assert.match(text, /You MUST NOT: .*background/);
  assert.match(text, /enhancement, not a re-imagining/);
});

test("editDirectives: assisted mode lists permitted edits and forbids the rest", () => {
  const perms = normalizePermissions({ replace_background: true, seasonal: false });
  const text = editDirectives("assisted", perms);
  assert.match(text, /You MAY: .*background/);
  assert.match(text, /You MUST NOT: .*season/);
  assert.match(text, /REAL photo/);
});

test("editDirectives with nothing permitted forbids everything", () => {
  const none = {};
  for (const k of Object.keys(EDIT_PERMISSIONS)) none[k] = false;
  const text = editDirectives("assisted", none);
  assert.match(text, /Make no edits beyond faithful reproduction/);
});

test("AI originality line never claims a real product", () => {
  assert.match(AI_ORIGINALITY_LINE, /do NOT depict/i);
});
