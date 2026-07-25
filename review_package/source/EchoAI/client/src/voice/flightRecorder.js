/**
 * Voice flight recorder — an always-on, in-memory event log of everything the
 * voice pipeline hears and decides, so a live-site voice bug can be diagnosed
 * from ONE pasted report instead of guesswork.
 *
 * What it captures (via recordVoiceEvent calls inside the voice engine):
 *   - every line Echo speaks (tts-start / tts-end)
 *   - every FINAL transcript the mic delivered, with the decision made about
 *     it (accepted, dropped as Echo's own echo, matched as a barge-in, ...)
 *   - wake-word activations, commands sent for processing, mic errors and
 *     recognizer restarts
 *
 * Design constraints:
 *   - In-memory ring buffer only (last MAX_EVENTS). Nothing is persisted or
 *     sent anywhere — the owner explicitly copies the report and shares it.
 *   - Never throws: a broken recorder must never break the voice engine, so
 *     every entry point is wrapped defensively.
 */

const MAX_EVENTS = 400;

const events = [];

/** Append one event to the ring buffer. Detail must be a small plain object. */
export function recordVoiceEvent(type, detail) {
  try {
    events.push({
      at: Date.now(),
      type: String(type || "event"),
      // Shallow-copy so later mutation by the caller can't rewrite history.
      detail: detail && typeof detail === "object" ? { ...detail } : undefined,
    });
    if (events.length > MAX_EVENTS) {
      events.splice(0, events.length - MAX_EVENTS);
    }
  } catch {
    /* never let diagnostics break the voice engine */
  }
}

export function getVoiceEvents() {
  return events.slice();
}

export function clearVoiceEvents() {
  events.length = 0;
}

function pad(n, w) {
  return String(n).padStart(w, "0");
}

/** "14:03:07.482" — wall-clock with millis, in the owner's local time. */
function clock(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(
    d.getSeconds(),
    2,
  )}.${pad(d.getMilliseconds(), 3)}`;
}

function describeDetail(detail) {
  if (!detail) return "";
  const parts = [];
  for (const [key, value] of Object.entries(detail)) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "boolean") {
      if (value) parts.push(key);
      continue;
    }
    if (key === "text" || key === "heard") {
      parts.push(`${key}="${String(value)}"`);
      continue;
    }
    parts.push(`${key}=${String(value)}`);
  }
  return parts.join(" ");
}

/**
 * Human-readable report of the recorded session, newest last. Includes the
 * environment header (browser + platform) because self-echo behavior differs
 * by device — the same build can behave differently on a phone vs a laptop.
 */
export function buildVoiceReport() {
  const lines = [];
  lines.push("=== Echo voice diagnostic report ===");
  try {
    lines.push(`Generated: ${new Date().toString()}`);
    if (typeof navigator !== "undefined") {
      lines.push(`Browser: ${navigator.userAgent || "unknown"}`);
      if (navigator.platform) lines.push(`Platform: ${navigator.platform}`);
    }
  } catch {
    /* header is best-effort */
  }
  lines.push(`Events: ${events.length} (newest last, ring buffer of ${MAX_EVENTS})`);
  lines.push("");
  let prev = null;
  for (const ev of events) {
    // Gap marker: silence between events is often the clue (e.g. a transcript
    // finalized 5s after Echo stopped talking).
    const gapMs = prev === null ? 0 : ev.at - prev;
    const gap = prev !== null && gapMs >= 1500 ? `  (+${(gapMs / 1000).toFixed(1)}s)` : "";
    prev = ev.at;
    const detail = describeDetail(ev.detail);
    lines.push(`${clock(ev.at)}  ${ev.type}${detail ? `  ${detail}` : ""}${gap}`);
  }
  if (!events.length) {
    lines.push("(no voice activity recorded yet)");
  }
  return lines.join("\n");
}
