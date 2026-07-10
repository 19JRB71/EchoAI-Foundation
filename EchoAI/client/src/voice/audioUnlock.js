/**
 * Audio autoplay unlock for Echo's voice.
 *
 * Browsers block programmatic audio playback until the user has interacted with
 * the page. However, once an HTMLAudioElement has *successfully played* under a
 * real user gesture, that SAME element is allowed to play again later with no
 * further gesture — indefinitely, in Chrome and Safari.
 *
 * So we keep ONE warm <audio> element:
 *  - `unlockAudio()` is called synchronously inside a genuine user gesture (the
 *    login button click) and plays a short silent clip on the warm element,
 *    "unlocking" it for the session.
 *  - The voice engine then reuses this same warm element for every spoken chunk,
 *    so the morning briefing auto-plays right after login with no extra click.
 *
 * Everything is defensive: no-ops when there is no DOM/Audio, and swallows the
 * inevitable autoplay rejections so it never throws into the app.
 */

let warm = null;
let unlocked = false;
let silentUri = null;

/** Build a tiny (~50ms) silent WAV data URI once, for the priming play. */
function getSilentUri() {
  if (silentUri) return silentUri;
  const sampleRate = 8000;
  const ms = 50;
  const numSamples = Math.floor((sampleRate * ms) / 1000);
  const dataSize = numSamples; // 8-bit mono
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < numSamples; i++) bytes[44 + i] = 128; // 8-bit silence
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  silentUri = "data:audio/wav;base64," + btoa(binary);
  return silentUri;
}

/** The single reusable audio element (lazily created). */
export function getWarmAudio() {
  if (typeof Audio === "undefined") return null;
  if (!warm) {
    warm = new Audio();
    warm.preload = "auto";
  }
  return warm;
}

/**
 * Hard-stop the warm element (logout kill switch). Pauses playback and clears
 * the source so any in-flight TTS chunk goes silent immediately. The element
 * itself is kept — it stays "unlocked" for the next login in the same tab.
 */
export function killWarmAudio() {
  if (!warm) return;
  try {
    warm.pause();
    warm.oncanplay = null;
    warm.onended = null;
    warm.onerror = null;
    warm.removeAttribute("src");
    warm.load();
  } catch {
    /* noop */
  }
}

export function isAudioUnlocked() {
  return unlocked;
}

let autoInstalled = false;
/**
 * Unlock the warm audio element on the FIRST real user gesture anywhere in the
 * app — not just the login button. This matters for an already-authenticated
 * page reload (no login click happens): without it the warm element stays
 * locked, so voice-triggered replies hit the browser autoplay block and Echo
 * is silent (speaking into the mic is NOT a browser "user gesture"). Idempotent
 * and self-removing once unlocked.
 */
export function installAutoUnlock() {
  if (autoInstalled || typeof window === "undefined") return;
  autoInstalled = true;
  const handler = () => {
    unlockAudio();
    if (unlocked) {
      window.removeEventListener("pointerdown", handler, true);
      window.removeEventListener("keydown", handler, true);
      window.removeEventListener("touchstart", handler, true);
    }
  };
  window.addEventListener("pointerdown", handler, true);
  window.addEventListener("keydown", handler, true);
  window.addEventListener("touchstart", handler, true);
}

/**
 * Prime audio playback. MUST be called from within a user gesture (e.g. a click
 * handler) to be effective. Idempotent and safe to call repeatedly.
 */
export function unlockAudio() {
  const el = getWarmAudio();
  if (!el || unlocked) return;
  try {
    el.muted = true;
    el.src = getSilentUri();
    const p = el.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        unlocked = true;
        try {
          el.pause();
          el.currentTime = 0;
        } catch {
          /* noop */
        }
        el.muted = false;
      }).catch(() => {
        el.muted = false;
      });
    } else {
      unlocked = true;
    }
  } catch {
    /* noop */
  }
}
