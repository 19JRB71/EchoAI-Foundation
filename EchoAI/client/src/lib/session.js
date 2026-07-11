// Session freshness tracking for Echo's "welcome back" ritual.
//
// Permanent login means the owner can open Zorecho days later without re-entering
// a password. When they return after being away for more than 8 hours we treat
// it as a brand-new session: Echo plays the morning wake-up music and delivers
// the morning briefing automatically — no fresh login required. This module
// tracks the last-active timestamp in localStorage and answers "were they away
// long enough to count as a new session?".

const LAST_ACTIVE_KEY = "echoai_last_active";
export const SESSION_GAP_MS = 8 * 60 * 60 * 1000; // 8 hours

/** Record that the user is active right now. */
export function markActive() {
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
  } catch {
    /* storage unavailable (private mode) — the ritual simply won't trigger */
  }
}

/** Millisecond timestamp of the last recorded activity, or null if unknown. */
export function getLastActive() {
  try {
    const raw = localStorage.getItem(LAST_ACTIVE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * True when the user is returning after >8h away (a "new session"). A first-ever
 * visit with no stored timestamp also counts as a fresh return.
 */
export function wasAwayLong() {
  const last = getLastActive();
  if (last === null) return true;
  return Date.now() - last > SESSION_GAP_MS;
}

/**
 * Wires up activity tracking: stamps "now" immediately and then on an interval,
 * on visibility changes, and before the page unloads. Returns a cleanup fn.
 */
export function startSessionTracking() {
  markActive();
  const onVisible = () => {
    if (document.visibilityState === "visible") markActive();
  };
  const id = setInterval(markActive, 5 * 60 * 1000); // every 5 min
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("beforeunload", markActive);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("beforeunload", markActive);
  };
}
