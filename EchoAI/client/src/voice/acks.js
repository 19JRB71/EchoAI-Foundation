// Instant spoken acknowledgements. Preloads short pre-cached ack phrases
// ("Got it, Sir.") from the server as blobs so one can play the INSTANT a
// command lands — while the real AI reply is still generating. Uses its own
// dedicated Audio element (never the TTS pipeline's) and every operation is
// best-effort: a missing/blocked ack resolves quietly so it can never break
// the conversation flow.
import { api } from "../api.js";

const ACK_NAMES = ["gotit", "onit", "rightaway", "understood", "onemoment", "letmecheck"];

const blobUrls = new Map(); // name -> object URL (or null when unavailable)
const inFlight = new Map(); // name -> Promise<string|null>
let ackEl = null;
let lastIndex = -1;

function getEl() {
  if (typeof Audio === "undefined") return null;
  if (!ackEl) ackEl = new Audio();
  return ackEl;
}

async function urlFor(name) {
  if (blobUrls.has(name)) return blobUrls.get(name);
  if (inFlight.has(name)) return inFlight.get(name);
  const p = (async () => {
    let url = null;
    try {
      const blob = await api.echoVoiceAck(name);
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

/** Warm every ack blob (best-effort, fire-and-forget). Call once at startup. */
export function preloadAcks() {
  for (const n of ACK_NAMES) urlFor(n).catch(() => {});
}

/**
 * Play a random preloaded ack IMMEDIATELY. Returns true if a cached ack blob
 * started playing, false when none was ready (caller can fall back to a sound
 * effect). Never waits on the network — an un-preloaded ack is a miss, not a
 * delay, because instant feedback is the whole point.
 */
export function playAckNow({ volume = 1 } = {}) {
  // Rotate so the same phrase never plays twice in a row.
  const ready = ACK_NAMES.filter((n) => blobUrls.get(n));
  if (ready.length === 0) {
    preloadAcks(); // warm for next time
    return false;
  }
  let idx = Math.floor(Math.random() * ready.length);
  if (ready.length > 1 && idx === lastIndex) idx = (idx + 1) % ready.length;
  lastIndex = idx;
  const url = blobUrls.get(ready[idx]);
  const el = getEl();
  if (!url || !el) return false;
  try {
    el.pause();
  } catch {
    /* noop */
  }
  el.src = url;
  el.volume = volume;
  el.play().catch(() => {});
  return true;
}

/** Stop any ack currently playing (best-effort). */
export function stopAck() {
  const el = ackEl;
  if (!el) return;
  try {
    el.pause();
  } catch {
    /* noop */
  }
}
