/**
 * Voice Calibration profile persistence (config/echoVoice.js).
 *
 * The profile carries the user's measured turn-taking timings. The server
 * must clamp everything on save (a corrupt/malicious blob must never wedge
 * the voice engine with an absurd wait), keep stats honest (no fabricated
 * zeros for unmeasured values), and treat an ABSENT key as "delete the
 * profile" so recalibrate/delete round-trips work.
 */
const test = require("node:test");
const assert = require("node:assert");

const { normalizeVoiceProfile, normalizeSettings } = require("../config/echoVoice");

test("normalizeVoiceProfile: junk in → null (not calibrated)", () => {
  assert.strictEqual(normalizeVoiceProfile(null), null);
  assert.strictEqual(normalizeVoiceProfile("patient"), null);
  assert.strictEqual(normalizeVoiceProfile(42), null);
});

test("normalizeVoiceProfile: clamps out-of-range timings", () => {
  const p = normalizeVoiceProfile({
    style: "patient",
    activePauseMs: 999999,
    finalPauseMs: 1,
    continuationExtraMs: -50,
  });
  assert.strictEqual(p.activePauseMs, 2500);
  assert.strictEqual(p.finalPauseMs, 300);
  assert.strictEqual(p.continuationExtraMs, 0);
  assert.strictEqual(p.style, "patient");
});

test("normalizeVoiceProfile: unknown style / NaN timings fall back to balanced preset", () => {
  const p = normalizeVoiceProfile({ style: "turbo", activePauseMs: "abc" });
  assert.strictEqual(p.style, "balanced");
  assert.strictEqual(p.activePauseMs, 900);
  assert.strictEqual(p.finalPauseMs, 450);
  assert.strictEqual(p.continuationExtraMs, 900);
});

test("normalizeVoiceProfile: stats keep only real finite measurements (no null→0 fabrication)", () => {
  const p = normalizeVoiceProfile({
    style: "fast",
    stats: {
      avgPauseMs: null,
      maxPauseMs: 1800.6,
      wordsPerMin: NaN,
      thinkingPauses: 3,
      continuationResumes: -2, // negative measurement is not a measurement
      stopTest: "banana",
      injected: "evil",
    },
  });
  assert.ok(!("avgPauseMs" in p.stats));
  assert.strictEqual(p.stats.maxPauseMs, 1801);
  assert.ok(!("wordsPerMin" in p.stats));
  assert.strictEqual(p.stats.thinkingPauses, 3);
  assert.ok(!("continuationResumes" in p.stats));
  assert.strictEqual(p.stats.stopTest, "skipped");
  assert.ok(!("injected" in p.stats));
});

test("normalizeVoiceProfile: stopTest enum passes through passed/failed only", () => {
  assert.strictEqual(
    normalizeVoiceProfile({ style: "fast", stats: { stopTest: "passed" } }).stats.stopTest,
    "passed",
  );
  assert.strictEqual(
    normalizeVoiceProfile({ style: "fast", stats: { stopTest: "failed" } }).stats.stopTest,
    "failed",
  );
});

test("normalizeSettings: persists voiceProfile only when set", () => {
  const withProfile = normalizeSettings({
    voiceProfile: { style: "patient", activePauseMs: 1600 },
  });
  assert.strictEqual(withProfile.voiceProfile.style, "patient");
  assert.strictEqual(withProfile.voiceProfile.activePauseMs, 1600);

  // Absent key = not calibrated / delete on save. JSON round-trip must not
  // resurrect it (undefined keys are dropped by JSON.stringify).
  const without = normalizeSettings({ enabled: true });
  assert.ok(!("voiceProfile" in without));
  assert.ok(!JSON.stringify(without).includes("voiceProfile"));
});

test("normalizeSettings: saving WITHOUT the key deletes a previously saved profile", () => {
  // Simulates the round-trip: saved-with-profile → user deletes → new save blob
  // (spread of prior settings minus voiceProfile) → normalized result carries none.
  const prior = normalizeSettings({ voiceProfile: { style: "fast" } });
  const { voiceProfile, ...withoutKey } = prior;
  assert.ok(voiceProfile); // sanity: it was there
  const next = normalizeSettings(withoutKey);
  assert.ok(!("voiceProfile" in next));
});

test("normalizeSettings: calibratedAt is length-limited string or null", () => {
  const p = normalizeSettings({
    voiceProfile: { style: "fast", calibratedAt: "2026-07-11T00:00:00.000Z" },
  }).voiceProfile;
  assert.strictEqual(p.calibratedAt, "2026-07-11T00:00:00.000Z");
  const p2 = normalizeSettings({
    voiceProfile: { style: "fast", calibratedAt: { evil: true } },
  }).voiceProfile;
  assert.strictEqual(p2.calibratedAt, null);
});
