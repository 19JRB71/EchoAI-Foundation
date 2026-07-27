const test = require("node:test");
const assert = require("node:assert");

const {
  sanitizeMusicFavorites,
  resolveMusicFavorites,
  normalizeSettings,
  DEFAULT_ADMIN_MUSIC_FAVORITES,
  MAX_MUSIC_FAVORITES,
} = require("../config/echoVoice");

test("sanitizeMusicFavorites trims, drops blanks, caps at 5", () => {
  assert.deepStrictEqual(
    sanitizeMusicFavorites(["  AC/DC Thunderstruck  ", "", "   ", 42, "Happy"]),
    ["AC/DC Thunderstruck", "Happy"]
  );
  assert.deepStrictEqual(
    sanitizeMusicFavorites(["a", "b", "c", "d", "e", "f", "g"]).length,
    MAX_MUSIC_FAVORITES
  );
  assert.deepStrictEqual(sanitizeMusicFavorites("not an array"), []);
});

test("resolveMusicFavorites: admin gets defaults only when never set", () => {
  assert.deepStrictEqual(
    resolveMusicFavorites(null, "admin"),
    DEFAULT_ADMIN_MUSIC_FAVORITES
  );
  assert.deepStrictEqual(resolveMusicFavorites({}, "admin"), DEFAULT_ADMIN_MUSIC_FAVORITES);
  // An explicitly saved list wins — even when emptied on purpose.
  assert.deepStrictEqual(resolveMusicFavorites({ musicFavorites: [] }, "admin"), []);
  assert.deepStrictEqual(
    resolveMusicFavorites({ musicFavorites: ["My Song"] }, "admin"),
    ["My Song"]
  );
});

test("resolveMusicFavorites: non-admin gets no defaults", () => {
  assert.deepStrictEqual(resolveMusicFavorites(null, "owner"), []);
  assert.deepStrictEqual(resolveMusicFavorites({}, undefined), []);
  assert.deepStrictEqual(
    resolveMusicFavorites({ musicFavorites: ["Jazz FM"] }, "owner"),
    ["Jazz FM"]
  );
});

test("resolveMusicFavorites returns a copy of the admin defaults", () => {
  const a = resolveMusicFavorites(null, "admin");
  a.push("mutated");
  assert.deepStrictEqual(resolveMusicFavorites(null, "admin"), DEFAULT_ADMIN_MUSIC_FAVORITES);
});

test("normalizeSettings preserves the never-set vs saved distinction", () => {
  // Never set → key absent, so a re-save can't accidentally lock in defaults.
  assert.strictEqual("musicFavorites" in normalizeSettings({}), false);
  // Saved (even empty) → key present and sanitized.
  assert.deepStrictEqual(normalizeSettings({ musicFavorites: [] }).musicFavorites, []);
  assert.deepStrictEqual(
    normalizeSettings({ musicFavorites: [" Eye of the Tiger "] }).musicFavorites,
    ["Eye of the Tiger"]
  );
});
