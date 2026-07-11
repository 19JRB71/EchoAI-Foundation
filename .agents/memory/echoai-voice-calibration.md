---
name: EchoAI voice calibration profile
description: Per-user listening-rhythm profile (voiceProfile) — persistence, engine wiring, and the traps around it
---

# EchoAI voice calibration profile

- The calibrated profile lives inside echo voice settings as an OPTIONAL `voiceProfile` key. Absent key = not calibrated / deleted. **Every** settings normalizer (server `config/echoVoice.js` AND the client mirror `lib/voiceSettings.js`) must spread it in only-if-set — a mirror that drops unknown keys makes any ordinary settings save silently wipe the calibration.
  - **Why:** settings saves send the full normalized blob; the profile is only safe if both normalizers round-trip it.
  - **How to apply:** adding any new optional settings key → add it to BOTH normalizers in the same change, plus a "absent key stays absent" test.
- Stats sanitizers must gate on `typeof raw === "number"` BEFORE `Number.isFinite` — `Number(null)` and `Number("")` coerce to 0 and fabricate a measurement that was never taken (same trap as the API quota monitor).
- The calibration UI runs its own SpeechRecognition instance; it holds the master mic by broadcasting an `echoai:calibration-state` window event that the engine folds into its master-listen effect (and its deps). Any future modal that needs exclusive mic access should reuse this hold pattern, and must always broadcast `active:false` on unmount/skip or the master mic stays dead.
- Engine timings (active/final pause, continuation extension) come from a ref synced from `voice.settings.voiceProfile` — never from constants; clamps are duplicated client (`voice/calibration.js`) and server and must stay identical.
