/**
 * Prompt 035 Section L — client half of the onboarding timing instrumentation.
 *
 * Emits append-only events while an onboarding surface is mounted:
 *   surface_shown / surface_hidden  (mount/unmount + document visibility)
 *   focus / blur                    (window focus)
 *   activity                        (pointer/keys/touch, throttled 1/15s)
 *   heartbeat                       (every 30s while visible)
 *
 * Events are batched and flushed every 20s (and on hide/unmount via the
 * batch flush). Everything is best-effort: instrumentation must NEVER break
 * or slow onboarding — all failures are swallowed.
 */

import { useEffect, useRef } from "react";
import { api } from "../api";

const FLUSH_MS = 20_000;
const HEARTBEAT_MS = 30_000;
const ACTIVITY_THROTTLE_MS = 15_000;

export default function useOnboardingTiming(phase, enabled = true) {
  const queueRef = useRef([]);
  const lastActivityRef = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;

    const push = (kind, meta) => {
      queueRef.current.push({ kind, phase, at: new Date().toISOString(), meta });
    };
    const flush = () => {
      if (disposed && queueRef.current.length === 0) return;
      const events = queueRef.current.splice(0, 100);
      if (!events.length) return;
      // Best-effort by contract: even a missing/broken api function must
      // never throw into React lifecycle code.
      try {
        const p = api.recordOnboardingTiming && api.recordOnboardingTiming(events);
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch (err) {
        /* swallowed — instrumentation must never break onboarding */
      }
    };

    push("surface_shown");
    if (document.hasFocus && document.hasFocus()) push("focus");

    const onVisibility = () => {
      push(document.hidden ? "surface_hidden" : "surface_shown");
      if (document.hidden) flush();
    };
    const onFocus = () => push("focus");
    const onBlur = () => push("blur");
    const onActivity = () => {
      const now = Date.now();
      if (now - lastActivityRef.current < ACTIVITY_THROTTLE_MS) return;
      lastActivityRef.current = now;
      push("activity");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("touchstart", onActivity, { passive: true });

    const heartbeat = setInterval(() => {
      if (!document.hidden) push("heartbeat");
    }, HEARTBEAT_MS);
    const flusher = setInterval(flush, FLUSH_MS);

    return () => {
      push("surface_hidden");
      disposed = true;
      clearInterval(heartbeat);
      clearInterval(flusher);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("touchstart", onActivity);
      flush();
    };
  }, [phase, enabled]);
}
