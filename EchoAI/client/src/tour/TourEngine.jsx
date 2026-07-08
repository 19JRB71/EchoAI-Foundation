// The tour overlay engine: dark backdrop with a spotlight "hole" over the target
// element, a pulsing ring, a tooltip card (title + explanation + Back/Next/Skip),
// and a spring-y progress bar. Fires confetti on the final celebration step.
//
// Targets are resolved from `data-tour="<value>"` attributes. When a step has a
// `section`, we ask the host to navigate there first; when the target element
// can't be found, the card is shown centered so the tour never breaks.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { useVoice } from "../voice/VoiceContext.jsx";
import {
  tourGreeting,
  narrationForStep,
  readyPrompt,
  stopAck,
} from "./tourNarration.js";

const SPOTLIGHT_PADDING = 8;
const CARD_WIDTH = 360;
const CARD_GAP = 16;

// Poll briefly for a target element — the section it lives in may have just been
// navigated to and need a tick or two to render.
function findTarget(targetKey, cb) {
  if (!targetKey) {
    cb(null);
    return () => {};
  }
  let cancelled = false;
  let attempts = 0;
  const maxAttempts = 20; // ~1s at 50ms

  function attempt() {
    if (cancelled) return;
    const el = document.querySelector(`[data-tour="${targetKey}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      cb(el);
      return;
    }
    attempts += 1;
    if (attempts >= maxAttempts) {
      cb(null);
      return;
    }
    setTimeout(attempt, 50);
  }
  attempt();
  return () => {
    cancelled = true;
  };
}

function rectOf(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return {
    top: r.top - SPOTLIGHT_PADDING,
    left: r.left - SPOTLIGHT_PADDING,
    width: r.width + SPOTLIGHT_PADDING * 2,
    height: r.height + SPOTLIGHT_PADDING * 2,
  };
}

function computeCardPosition(rect, placement, cardH) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!rect || placement === "center") {
    return {
      top: Math.max(16, vh / 2 - cardH / 2),
      left: vw / 2 - CARD_WIDTH / 2,
      centered: true,
    };
  }
  let top;
  let left;
  switch (placement) {
    case "left":
      top = rect.top + rect.height / 2 - cardH / 2;
      left = rect.left - CARD_GAP - CARD_WIDTH;
      break;
    case "top":
      top = rect.top - CARD_GAP - cardH;
      left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
      break;
    case "bottom":
      top = rect.top + rect.height + CARD_GAP;
      left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
      break;
    case "right":
    default:
      top = rect.top + rect.height / 2 - cardH / 2;
      left = rect.left + rect.width + CARD_GAP;
      break;
  }
  // If the card would overflow horizontally past the target, flip to the other side.
  if (left + CARD_WIDTH > vw - 12 && placement === "right") {
    left = rect.left - CARD_GAP - CARD_WIDTH;
  }
  if (left < 12 && placement === "left") {
    left = rect.left + rect.width + CARD_GAP;
  }
  left = Math.max(12, Math.min(left, vw - CARD_WIDTH - 12));
  top = Math.max(12, Math.min(top, vh - cardH - 12));
  return { top, left, centered: false };
}

export default function TourEngine({
  steps,
  startIndex = 0,
  onNavigate,
  onStepChange,
  onComplete,
  onClose,
}) {
  const [index, setIndex] = useState(startIndex);
  const [rect, setRect] = useState(null);
  const cardRef = useRef(null);
  const [cardHeight, setCardHeight] = useState(220);
  const [pos, setPos] = useState({ top: 0, left: 0, centered: true });

  // Echo narrates the tour out loud (owner accounts with voice available).
  // Everything voice-related degrades silently: muted/inactive voice, a failed
  // synthesis, or a team-member account all leave the visual tour untouched.
  const voice = useVoice();
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const greetedRef = useRef(false);

  const speakNow = useCallback((text, onPlayed) => {
    const v = voiceRef.current;
    if (!v || !v.active || v.muted || !text) return false;
    v.enqueue({ type: "tour", title: "Guided tour", text, onPlayed });
    return true;
  }, []);

  const total = steps.length;
  // Clamp defensively so a stale/out-of-range startIndex can never yield an
  // undefined step (which would throw and blank the whole app).
  const safeIndex = Math.min(Math.max(index, 0), Math.max(total - 1, 0));
  const step = steps[safeIndex];
  const isLast = safeIndex === total - 1;
  const isFirst = safeIndex === 0;

  // Resolve the spotlight target whenever the step changes (navigating first).
  useEffect(() => {
    let cleanupFind = () => {};
    setRect(null);
    if (step.section && onNavigate) onNavigate(step.section);
    // Give the section switch a tick before searching for the element.
    const t = setTimeout(() => {
      cleanupFind = findTarget(step.target, (el) => setRect(rectOf(el)));
    }, step.section ? 120 : 0);
    return () => {
      clearTimeout(t);
      cleanupFind();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Persist progress as the user advances.
  useEffect(() => {
    if (onStepChange) onStepChange(safeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Keep the spotlight aligned on scroll / resize.
  useEffect(() => {
    function reposition() {
      if (!step.target) return;
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      setRect(rectOf(el));
    }
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Measure the card and (re)compute its position.
  useLayoutEffect(() => {
    const h = cardRef.current ? cardRef.current.offsetHeight : cardHeight;
    if (h && h !== cardHeight) setCardHeight(h);
    setPos(computeCardPosition(rect, step.placement, h || cardHeight));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect, index, cardHeight]);

  const finish = useCallback(() => {
    // Cut any in-flight narration so Echo doesn't keep talking after the
    // tour card is gone (the last step has no ready-prompt, but its own
    // narration may still be playing when the user clicks Finish).
    const v = voiceRef.current;
    if (v && v.active && !v.muted) v.stopAll();
    if (onComplete) onComplete();
  }, [onComplete]);

  const next = useCallback(() => {
    if (isLast) {
      finish();
    } else {
      setIndex((i) => Math.min(i + 1, total - 1));
    }
  }, [isLast, finish, total]);

  const back = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0));
  }, []);

  // Stop the tour early: cut any narration, say a warm goodbye, close.
  const stopTour = useCallback(() => {
    const v = voiceRef.current;
    if (v && v.active && !v.muted) {
      v.stopAll();
      speakNow(stopAck());
    }
    if (onClose) onClose();
  }, [onClose, speakNow]);

  // Narrate each step: cut the previous line, speak the intro (greeting first
  // time) and — after the narration ACTUALLY finishes playing — ask whether
  // to continue. Advancing still requires the user (spoken "yes" or Next);
  // the tour never auto-advances.
  useEffect(() => {
    const v = voiceRef.current;
    if (!v || !v.active || v.muted) return;
    v.stopAll();
    let text = narrationForStep(step, safeIndex);
    if (!greetedRef.current) {
      greetedRef.current = true;
      text = `${tourGreeting()} ${text}`;
    }
    const last = safeIndex === total - 1;
    speakNow(text, () => {
      if (!last) speakNow(readyPrompt());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Let the hands-free voice engine drive the tour: spoken "yes"/"next"
  // advances, "back" goes back, "stop" ends it. The tour announces itself so
  // the conversation engine routes those words here instead of treating them
  // as ordinary commands.
  const nextRef = useRef(next);
  const backRef = useRef(back);
  const stopRef = useRef(stopTour);
  nextRef.current = next;
  backRef.current = back;
  stopRef.current = stopTour;
  useEffect(() => {
    try {
      window.dispatchEvent(
        new CustomEvent("echoai:tour-state", { detail: { active: true } }),
      );
    } catch {
      /* noop */
    }
    const onCmd = (e) => {
      const cmd = e && e.detail && e.detail.command;
      if (cmd === "next" || cmd === "yes") nextRef.current();
      else if (cmd === "back") backRef.current();
      else if (cmd === "stop") stopRef.current();
    };
    window.addEventListener("echoai:tour-command", onCmd);
    return () => {
      window.removeEventListener("echoai:tour-command", onCmd);
      try {
        window.dispatchEvent(
          new CustomEvent("echoai:tour-state", { detail: { active: false } }),
        );
      } catch {
        /* noop */
      }
    };
  }, []);

  // Fire confetti when the final celebration step appears.
  useEffect(() => {
    if (!isLast) return;
    const duration = 1200;
    const end = Date.now() + duration;
    const colors = ["#14B8A6", "#3B82F6", "#8B5CF6", "#F59E0B"];
    (function frame() {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 70,
        origin: { x: 0 },
        colors,
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 70,
        origin: { x: 1 },
        colors,
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLast]);

  // Keyboard navigation.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      } else if (e.key === "Escape") {
        e.preventDefault();
        stopTour();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, stopTour]);

  const progressPct = Math.round(((safeIndex + 1) / total) * 100);

  return (
    <div className="fixed inset-0 z-[1000]" aria-live="polite" role="dialog">
      {/* Backdrop: a dark layer with a transparent spotlight hole, or full dark. */}
      {rect ? (
        <div
          className="pointer-events-auto absolute rounded-xl transition-all duration-300 ease-out"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.78)",
          }}
        />
      ) : (
        <div className="pointer-events-auto absolute inset-0 bg-slate-950/80" />
      )}

      {/* Pulsing ring around the target. */}
      {rect && (
        <div
          className="pointer-events-none absolute z-[1001] rounded-xl transition-all duration-300 ease-out"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        >
          <span className="absolute inset-0 rounded-xl ring-2 ring-teal-400" />
          <span className="absolute inset-0 animate-ping rounded-xl ring-2 ring-teal-400/70" />
        </div>
      )}

      {/* Tooltip card. */}
      <div
        ref={cardRef}
        className="pointer-events-auto absolute z-[1002] w-[360px] max-w-[calc(100vw-24px)] rounded-2xl border border-gray-700 bg-gray-900 p-5 shadow-2xl transition-all duration-300 ease-out"
        style={{ top: pos.top, left: pos.left }}
      >
        {/* Progress bar */}
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal-400 to-blue-500"
            style={{
              width: `${progressPct}%`,
              transition: "width 500ms cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          />
        </div>

        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-teal-400">
            Step {safeIndex + 1} of {total}
          </span>
          <button
            onClick={stopTour}
            className="text-xs font-medium text-gray-500 hover:text-gray-300"
          >
            Stop tour
          </button>
        </div>

        <h3 className="text-base font-bold text-gray-100">{step.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-400">{step.body}</p>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            onClick={back}
            disabled={isFirst}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-40"
          >
            Back
          </button>
          <button
            onClick={next}
            className="rounded-lg bg-teal-500 px-5 py-1.5 text-sm font-semibold text-gray-900 hover:bg-teal-400"
          >
            {isLast ? "Finish 🎉" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
