// Echo personality sound effects. Fetches named ElevenLabs stings from the
// server (cached there on disk) and plays them through a dedicated Audio element,
// separate from the TTS pipeline so they never fight over one element. Every
// operation is best-effort: a missing/blocked sound resolves quietly and never
// throws, so it can never break the conversation flow.
import { api } from "../api.js";

const blobUrls = new Map(); // name -> object URL (or null when unavailable)
const inFlight = new Map(); // name -> Promise<string|null>
let sfxEl = null;

function getEl() {
  if (typeof Audio === "undefined") return null;
  if (!sfxEl) sfxEl = new Audio();
  return sfxEl;
}

// Resolve a name to a cached object URL, fetching once. Returns null when the
// sound isn't available (unconfigured server / error) so callers just skip it.
async function urlFor(name) {
  if (blobUrls.has(name)) return blobUrls.get(name);
  if (inFlight.has(name)) return inFlight.get(name);
  const p = (async () => {
    let url = null;
    try {
      const blob = await api.echoVoiceSound(name);
      if (blob) url = URL.createObjectURL(blob);
    } catch {
      url = null;
    }
    blobUrls.set(name, url);
    inFlight.delete(name);
    return url;
  })();
  inFlight.set(name, p);
  return p;
}

/** Warm the cache for the given effect names (best-effort, fire-and-forget). */
export function preloadEffects(names) {
  for (const n of names) urlFor(n).catch(() => {});
}

/**
 * Play a named effect. Resolves when it finishes (or immediately if unavailable
 * / blocked). Never rejects. `volume` defaults to a subtle 0.5.
 */
export function playEffect(name, { volume = 0.5 } = {}) {
  return new Promise((resolve) => {
    urlFor(name)
      .then((url) => {
        const el = getEl();
        if (!url || !el) {
          resolve(false);
          return;
        }
        try {
          el.pause();
        } catch {
          /* noop */
        }
        el.onended = () => resolve(true);
        el.onerror = () => resolve(false);
        el.src = url;
        el.volume = volume;
        el.play().catch(() => resolve(false));
      })
      .catch(() => resolve(false));
  });
}

/** Stop any effect currently playing (best-effort). */
export function stopEffect() {
  const el = sfxEl;
  if (!el) return;
  try {
    el.pause();
  } catch {
    /* noop */
  }
}
