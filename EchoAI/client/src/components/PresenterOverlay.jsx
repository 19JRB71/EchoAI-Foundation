import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useVoice } from "../voice/VoiceContext.jsx";

// How long to wait after Echo finishes a step's line before auto-advancing to
// the next step. Gives the prospect a beat to absorb the current screen.
const INTER_STEP_DELAY_MS = 1500;
// Safety-net buffer added on top of the estimated speech time. If Echo's line
// never reaches natural completion (autoplay blocked, TTS error, etc.) the
// fallback timer still advances the demo this long after it should have ended.
const FALLBACK_BUFFER_MS = 12000;
// Per-step pace used when there's no spoken line (muted, or a step with no
// script line): read the screen, then move on.
const READING_MIN_MS = 4500;

// Rough spoken duration of a line so the fallback timer outlasts real speech.
// ~70ms/char ≈ a natural TTS reading rate, plus a small base.
function estimateSpeechMs(line) {
  if (!line) return 0;
  return line.length * 70 + 1500;
}

// Floating presenter toolbar shown (admin-only) while Sales Presentation Mode is
// live. The demo runs FULLY AUTOMATICALLY: on start it walks each step in order,
// navigating the dashboard to the relevant section/department, having Echo speak
// the matching line, and advancing on its own once the line finishes (plus a
// short beat). Pause/Play, Previous and Next let the presenter take manual
// control of the pace at any time. Reuses the existing Echo voice engine via
// useVoice().enqueue — no new audio pipeline.
export default function PresenterOverlay({ onNavigate, onOpenDepartment, onEnd }) {
  const voice = useVoice();
  const [script, setScript] = useState(null);
  const [error, setError] = useState("");
  const [activeStep, setActiveStep] = useState(null);
  const [index, setIndex] = useState(-1);
  const [paused, setPaused] = useState(false);
  const [minimized, setMinimized] = useState(false);

  // Refs so timers and the enqueue onPlayed callback always see the latest
  // values without capturing stale closures.
  const scriptRef = useRef(null);
  const stepsRef = useRef([]);
  const indexRef = useRef(-1);
  const pausedRef = useRef(false);
  const advanceTimerRef = useRef(null);
  // Bumped on every navigation so a superseded step's finished-line callback
  // (or a pending advance timer) can't advance the demo out from under a manual
  // jump the presenter just made.
  const runTokenRef = useRef(0);
  const startedRef = useRef(false);
  const goToStepRef = useRef(() => {});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.demoGetScript();
        if (alive) setScript(data);
      } catch (err) {
        if (alive) setError(err.message || "Couldn't load the demo script.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    scriptRef.current = script;
    stepsRef.current = (script && script.steps) || [];
  }, [script]);

  const clearAdvanceTimer = useCallback(() => {
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  }, []);

  // Arm a single timer that hops to the next step after `ms`. No-ops when paused
  // or already at the end. Only one advance timer is ever pending.
  const armAdvance = useCallback(
    (fromIndex, ms) => {
      clearAdvanceTimer();
      advanceTimerRef.current = setTimeout(() => {
        advanceTimerRef.current = null;
        if (pausedRef.current) return;
        if (fromIndex + 1 < stepsRef.current.length) {
          goToStepRef.current(fromIndex + 1);
        }
      }, ms);
    },
    [clearAdvanceTimer],
  );

  // Short hop used once a line has finished speaking naturally (onPlayed).
  const scheduleAdvance = useCallback(
    (fromIndex) => armAdvance(fromIndex, INTER_STEP_DELAY_MS),
    [armAdvance],
  );

  // Safety net armed for every step: guarantees the demo keeps moving even if
  // the line never reaches natural completion (muted, autoplay-blocked, TTS
  // error). When the line DOES finish, onPlayed replaces this with the shorter
  // inter-step hop, so this only fires in the degraded cases.
  const armFallback = useCallback(
    (fromIndex, line) => {
      const muted = !!(voice && voice.muted);
      const ms =
        !line || muted
          ? Math.max(READING_MIN_MS, estimateSpeechMs(line))
          : estimateSpeechMs(line) + FALLBACK_BUFFER_MS;
      armAdvance(fromIndex, ms);
    },
    [voice, armAdvance],
  );

  // Navigate to a step, speak its line, and (unless paused) queue the next hop
  // for when the line finishes. Interrupts any in-flight line so manual jumps
  // feel immediate.
  const goToStep = useCallback(
    (i) => {
      const steps = stepsRef.current;
      if (i < 0 || i >= steps.length) return;
      clearAdvanceTimer();
      const token = (runTokenRef.current += 1);
      indexRef.current = i;
      setIndex(i);
      const step = steps[i];
      setActiveStep(step.key);

      // Put the real demo data on screen (hot leads, live campaigns, ROI).
      if (step.section && onNavigate) {
        onNavigate(step.section);
      } else if (step.department && onOpenDepartment) {
        onOpenDepartment(step.department);
      }

      const lines = scriptRef.current && scriptRef.current.lines;
      const line = lines ? lines[step.speak] : null;
      const wasPlaying = !!(voice && voice.playing);

      if (line && voice && voice.enqueue) {
        voice.enqueue(
          {
            type: "demo",
            title: step.label,
            text: line,
            onPlayed: async () => {
              // Ignore if a newer step superseded this one, or we're paused.
              if (runTokenRef.current !== token) return;
              if (pausedRef.current) return;
              scheduleAdvance(i);
            },
          },
          { front: true },
        );
        // If a previous line was still speaking (a manual jump mid-sentence),
        // skip it so the new line starts right away instead of after the old one.
        if (wasPlaying && voice.skip) voice.skip();
      }

      // Always arm the safety-net timer (unless paused). In the normal case the
      // line finishes and onPlayed swaps in the shorter hop; if the line never
      // plays (muted/blocked/error) this guarantees the demo still advances.
      if (!pausedRef.current) armFallback(i, line);
    },
    [
      onNavigate,
      onOpenDepartment,
      voice,
      clearAdvanceTimer,
      armFallback,
      scheduleAdvance,
    ],
  );

  useEffect(() => {
    goToStepRef.current = goToStep;
  }, [goToStep]);

  // Kick the demo off automatically as soon as the script is loaded.
  useEffect(() => {
    if (startedRef.current) return;
    const steps = (script && script.steps) || [];
    if (!steps.length) return;
    startedRef.current = true;
    goToStep(0);
  }, [script, goToStep]);

  // Clean up the pending advance timer if the overlay unmounts (demo ended).
  useEffect(() => () => clearAdvanceTimer(), [clearAdvanceTimer]);

  const togglePause = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      pausedRef.current = next;
      if (next) {
        // Pausing: stop auto-advance. Any line already speaking finishes on its
        // own, but won't trigger the next hop while paused.
        clearAdvanceTimer();
      } else {
        // Resuming: if Echo isn't mid-line, hop to the next step after the beat;
        // otherwise the in-flight line's onPlayed handles the advance.
        if (!(voice && voice.playing)) scheduleAdvance(indexRef.current);
      }
      return next;
    });
  }, [voice, clearAdvanceTimer, scheduleAdvance]);

  const handleNext = useCallback(() => {
    const i = indexRef.current;
    if (i + 1 < stepsRef.current.length) goToStep(i + 1);
  }, [goToStep]);

  const handlePrev = useCallback(() => {
    const i = indexRef.current;
    if (i - 1 >= 0) goToStep(i - 1);
  }, [goToStep]);

  async function handleEnd() {
    clearAdvanceTimer();
    pausedRef.current = true;
    try {
      await api.demoDeactivate();
    } catch {
      /* best-effort; overlay closes regardless */
    }
    if (voice && voice.stopAll) voice.stopAll();
    if (onEnd) onEnd();
  }

  const steps = (script && script.steps) || [];
  const total = steps.length;
  const atFirst = index <= 0;
  const atLast = index >= 0 && index >= total - 1;

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-teal-500 px-5 py-2.5 text-sm font-semibold text-black shadow-lg shadow-teal-500/40 hover:bg-teal-400"
      >
        🎤 Show presenter
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[min(96vw,900px)] -translate-x-1/2 rounded-2xl border border-teal-500/40 bg-gray-950/95 p-3 shadow-2xl shadow-black/60 backdrop-blur">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-teal-500/20 px-2 py-0.5 text-xs font-semibold text-teal-300">
            PRESENTATION MODE
          </span>
          {total > 0 && index >= 0 && (
            <span className="text-xs text-gray-400">
              Step {index + 1} of {total}
            </span>
          )}
          {script && script.businessName && (
            <span className="hidden text-xs text-gray-500 sm:inline">
              · {script.businessName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMinimized(true)}
            className="rounded-md border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:bg-gray-800"
          >
            Hide
          </button>
          <button
            onClick={handleEnd}
            className="rounded-md bg-red-500/90 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500"
          >
            End demo
          </button>
        </div>
      </div>

      {error ? (
        <div className="px-1 pb-1 text-xs text-red-300">{error}</div>
      ) : (
        <>
          {/* Playback controls — the demo auto-advances; these let the presenter
              take the wheel. */}
          <div className="mb-2 flex items-center gap-2">
            <button
              onClick={handlePrev}
              disabled={atFirst}
              className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800 disabled:opacity-40"
            >
              ‹ Previous
            </button>
            <button
              onClick={togglePause}
              className="flex items-center gap-1.5 rounded-lg bg-teal-500 px-4 py-2 text-sm font-bold text-black hover:bg-teal-400"
            >
              {paused ? "▶ Play" : "⏸ Pause"}
            </button>
            <button
              onClick={handleNext}
              disabled={atLast}
              className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800 disabled:opacity-40"
            >
              Next ›
            </button>
            {voice && voice.playing && (
              <button
                onClick={() => voice.skip && voice.skip()}
                className="ml-auto rounded-md border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
              >
                Skip voice
              </button>
            )}
          </div>

          {/* Progress bar across the steps. */}
          {total > 0 && (
            <div className="mb-2 h-1 w-full overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-full bg-teal-500 transition-all duration-500"
                style={{
                  width: `${total ? ((index + 1) / total) * 100 : 0}%`,
                }}
              />
            </div>
          )}

          {/* Step chips — clickable to jump straight to any step. */}
          <div className="flex flex-wrap gap-2">
            {steps.map((step, i) => (
              <button
                key={step.key}
                onClick={() => goToStep(i)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  activeStep === step.key
                    ? "border-teal-400 bg-teal-500/15 text-teal-200"
                    : "border-gray-700 bg-gray-900 text-gray-200 hover:bg-gray-800"
                }`}
              >
                <span className="text-xs text-gray-500">{i + 1}</span>
                {step.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
