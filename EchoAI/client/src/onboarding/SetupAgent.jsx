import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import { classifyExecuteError } from "./executeError.js";
import { useVoiceInput, detectIsMobile } from "./useVoiceInput.js";
import VoiceCalibration from "./VoiceCalibration.jsx";

const VOICE_MODE_KEY = "echoai_setup_voice_mode";
// Set once the user completes OR skips voice calibration, so we never re-offer
// it on a resumed/re-opened setup session.
const CALIBRATION_OFFERED_KEY = "echoai_calibration_offered";

function MicIcon({ className = "h-8 w-8" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z"
        fill="currentColor"
      />
      <path
        d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 1 0 2 0v-3.08A7 7 0 0 0 19 11Z"
        fill="currentColor"
      />
    </svg>
  );
}

// Full-screen AI Setup Agent. Runs a short conversational interview, then — with
// explicit consent — configures the user's account server-side by orchestrating
// the existing controllers, streaming each step's progress in a live panel.
//
// Phases: loading → interview → consent → running → done (with an inline
// needs-connection handoff for user-driven Google OAuth, and an error state).

function StatusDot({ status }) {
  const base = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold";
  if (status === "done") {
    return (
      <span className={`${base} bg-emerald-500/20 text-emerald-400`} aria-label="done">
        ✓
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className={`${base} bg-amber-500/20 text-amber-400`} aria-label="skipped">
        –
      </span>
    );
  }
  if (status === "needs_connection") {
    return (
      <span className={`${base} bg-sky-500/20 text-sky-400`} aria-label="needs connection">
        !
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className={`${base} bg-teal-500/20`} aria-label="running">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
      </span>
    );
  }
  return <span className={`${base} border border-white/15 text-white/30`} aria-label="pending">•</span>;
}

function Avatar() {
  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-600 text-xl font-black text-black shadow-lg">
      AI
    </div>
  );
}

// The interview questions come back from the AI with light markdown emphasis
// (**business**). Strip it for both display and speech — the interview card
// renders plain text.
export function stripEmphasis(text) {
  return String(text || "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*\*/g, "");
}

// Normalize the server's needs_connection `connect` payload into a single kind:
// a bare string ("google"/"facebook"), a `{ type: "social", ... }` object, or the
// legacy `{ provider: "google" }` shape all map to one comparable value.
function connectKind(connect) {
  if (!connect) return null;
  if (typeof connect === "string") return connect;
  if (connect.type) return connect.type;
  if (connect.provider) return connect.provider;
  return null;
}

export default function SetupAgent({ onClose, onExitToSection, embedded = false, doneLabel }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);
  const [question, setQuestion] = useState(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  // Voice input: default to voice on mobile (typing is harder) and text on
  // desktop, but honor a stored preference. Persisted so it survives reloads.
  const [isMobile] = useState(detectIsMobile);
  const [voiceMode, setVoiceMode] = useState(() => {
    try {
      const stored = localStorage.getItem(VOICE_MODE_KEY);
      if (stored === "voice") return true;
      if (stored === "text") return false;
    } catch {
      /* localStorage unavailable — fall back to device default */
    }
    return detectIsMobile();
  });
  useEffect(() => {
    try {
      localStorage.setItem(VOICE_MODE_KEY, voiceMode ? "voice" : "text");
    } catch {
      /* ignore */
    }
  }, [voiceMode]);

  const [steps, setSteps] = useState([]);
  const [results, setResults] = useState({}); // key -> { status, detail }
  const [runningKey, setRunningKey] = useState(null);
  const [needsConnection, setNeedsConnection] = useState(null);

  const resultsRef = useRef({});
  resultsRef.current = results;
  const stepsRef = useRef([]);
  stepsRef.current = steps;

  const sessionId = session && session.sessionId;

  // Track the latest phase + sessionId so the unmount handler can decide whether
  // to pause without re-subscribing on every change.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // If the user leaves mid-flow (still interviewing / consenting), mark the
  // session paused so the lifecycle timestamps stay accurate and it can be
  // resumed later. Best-effort, fire-and-forget on unmount.
  //
  // Two complementary paths, guarded so we pause at most once:
  //   1. React unmount effect — fires on in-app navigation (SPA route changes,
  //      closing the agent), where a normal authenticated fetch works.
  //   2. `pagehide` sendBeacon — fires on a hard tab/window close, where the
  //      unmount effect and a normal fetch are both unreliable. The Beacon API
  //      can't set an Authorization header, so it hits the no-auth /pause-beacon
  //      endpoint with the JWT in the body.
  //   3. `visibilitychange` → hidden sendBeacon — fires when the tab is merely
  //      backgrounded (switching tab/app) without closing, the most common
  //      "I'll come back later" exit. On mobile the OS can silently discard a
  //      backgrounded tab and `pagehide` may never fire, so this closes the gap.
  //      When the tab becomes visible again we re-arm the guard so a later real
  //      close still pauses — without ever double-pausing while hidden.
  const pausedRef = useRef(false);
  useEffect(() => {
    const shouldPause = () => {
      const p = phaseRef.current;
      const sid = sessionIdRef.current;
      return Boolean(sid) && (p === "interview" || p === "consent");
    };

    const pauseViaBeacon = () => {
      if (pausedRef.current || !shouldPause()) return;
      pausedRef.current = true;
      api.pauseSetupSessionBeacon(sessionIdRef.current);
    };

    const onPageHide = pauseViaBeacon;
    const onVisibilityChange = () => {
      if (document.hidden) {
        pauseViaBeacon();
      } else if (shouldPause()) {
        // Returned to the tab and still mid-flow. If the hidden-tab beacon
        // paused the session server-side, silently flip it back to
        // in_progress — otherwise the very next answer/step hits a 409
        // "paused" and the user (who never left the flow) is dumped onto the
        // "Setup paused" panel. Then re-arm so a later background/close
        // pauses again. Best-effort: if the resume fails, the resumable
        // paused panel still works as the fallback.
        if (pausedRef.current) {
          api.startSetupSession().catch(() => {});
        }
        pausedRef.current = false;
      }
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (pausedRef.current || !shouldPause()) return;
      pausedRef.current = true;
      api.pauseSetupSession(sessionIdRef.current).catch(() => {});
    };
  }, []);

  // ---- Action execution loop -------------------------------------------------

  const runLoop = useCallback(
    async (sid) => {
      setPhase("running");
      setNeedsConnection(null);
      setError("");
      const done = new Set(Object.keys(resultsRef.current));
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const pending = stepsRef.current.find((s) => !done.has(s.key));
        setRunningKey(pending ? pending.key : null);
        let res;
        try {
          res = await api.runSetupAction(sid);
        } catch (err) {
          setRunningKey(null);
          // A 409 carrying the real session means a user-initiated pause/dismiss
          // raced this step and won — the cancellation was honored server-side,
          // so reflect the true state instead of a scary error screen.
          const outcome = classifyExecuteError(err);
          if (outcome.type === "dismissed") {
            onClose();
            return;
          }
          if (outcome.type === "paused") {
            setSession(outcome.session);
            setPhase("paused");
            return;
          }
          setError(outcome.message);
          return;
        }
        if (res.allComplete) {
          setRunningKey(null);
          setPhase("done");
          return;
        }
        const { step, status, detail } = res;
        setResults((prev) => ({ ...prev, [step.key]: { status, detail, label: step.label } }));
        if (status === "needs_connection") {
          setRunningKey(null);
          setNeedsConnection({ key: step.key, connect: res.connect, detail, label: step.label });
          return; // wait for the user to connect or skip
        }
        done.add(step.key);
      }
    },
    [onClose],
  );

  // ---- Bootstrap / resume ----------------------------------------------------

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api.startSetupSession();
        if (!active) return;
        const s = data.session;
        setSession(s);
        setSteps(s.steps || []);
        // Pre-seed already-completed steps so a resumed run shows prior progress.
        if (Array.isArray(s.completedSteps) && s.completedSteps.length > 0) {
          const seeded = {};
          for (const key of s.completedSteps) seeded[key] = { status: "done", detail: "Done." };
          setResults(seeded);
        }

        if (!s.interviewComplete) {
          setQuestion(data.question || null);
          // Voice Calibration runs ONCE, before the business interview, so
          // Echo learns the user's speech rhythm before any real conversation.
          // Never re-offered on resume (localStorage flag) or if a profile
          // already exists from a prior calibration.
          let offerCalibration = false;
          try {
            if (!localStorage.getItem(CALIBRATION_OFFERED_KEY)) {
              const vs = await api.echoVoiceGetSettings().catch(() => null);
              offerCalibration = !(vs && vs.settings && vs.settings.voiceProfile);
            }
          } catch {
            offerCalibration = false;
          }
          if (!active) return;
          setPhase(offerCalibration ? "calibration" : "interview");
        } else if (!s.consentGranted) {
          setPhase("consent");
        } else {
          // Consent already granted (e.g. returning from Google OAuth) — resume.
          await runLoop(s.sessionId);
        }
      } catch (err) {
        if (!active) return;
        setError(err.message || "Could not start the setup agent.");
        setPhase("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [runLoop]);

  // ---- Interview -------------------------------------------------------------

  // Submit the given text (or the current answer field). Accepting an explicit
  // value lets voice auto-submit pass its transcript directly, avoiding a race
  // with the async `answer` state update.
  const doSubmit = useCallback(
    async (raw) => {
      const value = (raw != null ? raw : answer).trim();
      if (!value || busy) return;
      setBusy(true);
      setError("");
      try {
        const data = await api.submitSetupAnswer(sessionId, value);
        setSession(data.session);
        setAnswer("");
        if (data.question && data.question.complete) {
          setQuestion(data.question);
          setPhase("consent");
        } else {
          setQuestion(data.question);
        }
      } catch (err) {
        setError(err.message || "Could not send your answer.");
      } finally {
        setBusy(false);
      }
    },
    [answer, busy, sessionId],
  );

  function submitAnswer(e) {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    doSubmit();
  }

  // Voice engine: transcript populates the answer field for review/edit; on
  // mobile a natural pause auto-submits so users don't have to tap twice.
  const voice = useVoiceInput({
    onTranscript: (text) => setAnswer(text),
    onAutoSubmit: (text) => doSubmit(text),
    isMobile,
  });

  // Stop any live capture when the user switches to text mode or leaves the
  // interview, so the mic never keeps recording out of view.
  const stopVoice = voice.stop;
  useEffect(() => {
    if (!voiceMode || phase !== "interview") stopVoice();
  }, [voiceMode, phase, stopVoice]);

  // ---- Speak each interview question aloud (voice mode) ----------------------
  // Voice mode without speech made the agent feel broken ("he didn't speak at
  // all"): read each new question in Echo's voice. Playback is best-effort —
  // the on-screen text always carries the step — and never overlaps the mic:
  // it's cut the moment the user starts recording.
  const questionAudioRef = useRef(null);
  const spokenQuestionRef = useRef("");
  const stopQuestionAudio = useCallback(() => {
    const el = questionAudioRef.current;
    if (el) {
      try {
        el.pause();
        el.src = "";
      } catch {
        /* already stopped */
      }
      questionAudioRef.current = null;
    }
  }, []);
  useEffect(() => {
    const text = question && !question.complete ? stripEmphasis(question.message) : "";
    if (phase !== "interview" || !voiceMode || !text) return undefined;
    if (spokenQuestionRef.current === text) return undefined;
    spokenQuestionRef.current = text;
    let cancelled = false;
    (async () => {
      try {
        const blob = await api.echoVoiceSpeak(text);
        if (cancelled) return;
        stopQuestionAudio();
        const url = URL.createObjectURL(blob);
        const el = new Audio(url);
        el.onended = () => URL.revokeObjectURL(url);
        questionAudioRef.current = el;
        el.play().catch(() => {
          /* autoplay blocked — the on-screen text carries the question */
        });
      } catch {
        /* TTS unavailable — text on screen carries the step */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, voiceMode, question, stopQuestionAudio]);
  // Never talk over the user: cut playback when recording starts, when the
  // interview phase ends, and on unmount.
  useEffect(() => {
    if (voice.recording) stopQuestionAudio();
  }, [voice.recording, stopQuestionAudio]);
  useEffect(() => {
    if (phase !== "interview") stopQuestionAudio();
  }, [phase, stopQuestionAudio]);
  useEffect(() => stopQuestionAudio, [stopQuestionAudio]);

  // ---- Consent ---------------------------------------------------------------

  async function grantConsent() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.grantSetupConsent(sessionId);
      await runLoop(sessionId);
    } catch (err) {
      setError(err.message || "Could not start account setup.");
    } finally {
      setBusy(false);
    }
  }

  // ---- Connection handoff (user-driven OAuth) --------------------------------

  async function connectGoogle() {
    setBusy(true);
    setError("");
    try {
      const { authUrl } = await api.startGoogleOAuth();
      // Full-page handoff to Google's own consent screen. The setup session
      // persists; the agent resumes automatically when the user returns.
      window.location.href = authUrl;
    } catch (err) {
      setBusy(false);
      setError(err.message || "Could not start Google connection.");
    }
  }

  async function connectFacebook() {
    setBusy(true);
    setError("");
    try {
      const { authUrl } = await api.startFacebookOAuth();
      // Full-page handoff to Facebook's own consent screen. The setup session
      // persists; the agent resumes automatically when the user returns.
      window.location.href = authUrl;
    } catch (err) {
      setBusy(false);
      setError(err.message || "Could not start Facebook connection.");
    }
  }

  function goConnectSocial() {
    if (busy) return;
    // Social posting uses per-brand credentials (no one-click OAuth), so we hand
    // off to the existing Social Accounts screen. The session stays in_progress
    // (the running phase never auto-pauses on unmount), so setup resumes and
    // re-checks the connection when the user returns via "Finish setup".
    if (typeof onExitToSection === "function") onExitToSection("social");
  }

  async function skipConnection() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      // Mark the current needs-connection step as skipped, then continue.
      await api.runSetupAction(sessionId, true);
      setResults((prev) => ({
        ...prev,
        [needsConnection.key]: {
          status: "skipped",
          detail: "Skipped — you can connect later in Settings.",
          label: needsConnection.label,
        },
      }));
      setNeedsConnection(null);
      await runLoop(sessionId);
    } catch (err) {
      setError(err.message || "Could not skip this step.");
    } finally {
      setBusy(false);
    }
  }

  async function continueAfterConnect() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setNeedsConnection(null);
      await runLoop(sessionId);
    } finally {
      setBusy(false);
    }
  }

  // ---- Resume (after a mid-step pause) ---------------------------------------

  async function resumeSetup() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      // startSetupSession flips a paused session back to in_progress and returns
      // its current state (including already-completed steps); the server resumes
      // idempotently, so we just re-seed progress and continue the run.
      const data = await api.startSetupSession();
      const s = data.session;
      setSession(s);
      setSteps(s.steps || []);
      if (Array.isArray(s.completedSteps) && s.completedSteps.length > 0) {
        const seeded = {};
        for (const key of s.completedSteps) seeded[key] = { status: "done", detail: "Done." };
        setResults(seeded);
      }
      await runLoop(s.sessionId);
    } catch (err) {
      setError(err.message || "Could not resume setup.");
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }

  // ---- Dismiss ---------------------------------------------------------------

  async function skipSetup() {
    if (busy) return;
    setBusy(true);
    try {
      if (sessionId) await api.dismissSetupSession(sessionId);
    } catch {
      /* best-effort */
    } finally {
      setBusy(false);
      onClose();
    }
  }

  // ---- Render ----------------------------------------------------------------

  // Embedded mode renders inside a host layout (the Guided Setup wizard's
  // Business Profile step) instead of taking over the whole screen.
  const shell = (children) =>
    embedded ? (
      <div className="overflow-y-auto rounded-2xl border border-gray-800 bg-black text-white">
        <div className="mx-auto flex min-h-[60vh] max-w-5xl flex-col px-4 py-8 md:px-8">
          {children}
        </div>
      </div>
    ) : (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-black text-white">
        <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-8 md:px-8">
          {children}
        </div>
      </div>
    );

  if (phase === "loading") {
    return shell(
      <div className="flex flex-1 items-center justify-center">
        <Spinner label="Starting your setup agent…" />
      </div>,
    );
  }

  if (phase === "error") {
    return shell(
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="max-w-md text-white/80">{error || "Something went wrong."}</p>
        <button
          onClick={onClose}
          className="rounded-lg bg-white/10 px-5 py-2.5 font-semibold hover:bg-white/20"
        >
          Close
        </button>
      </div>,
    );
  }

  if (phase === "calibration") {
    const finishCalibration = () => {
      try {
        localStorage.setItem(CALIBRATION_OFFERED_KEY, "1");
      } catch {
        /* localStorage unavailable — worst case we offer again next time */
      }
      setPhase("interview");
    };
    return shell(
      <div className="flex flex-1 items-center justify-center py-6">
        <VoiceCalibration onComplete={finishCalibration} onSkip={finishCalibration} />
      </div>,
    );
  }

  if (phase === "paused") {
    return shell(
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <Avatar />
        <div>
          <h2 className="text-2xl font-bold">Setup paused</h2>
          <p className="mx-auto mt-2 max-w-md text-white/70">
            No problem — nothing was lost. Your progress is saved and you can pick up right where you
            left off whenever you&apos;re ready.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            onClick={resumeSetup}
            disabled={busy}
            className="rounded-lg bg-teal-500 px-6 py-2.5 font-semibold text-black hover:bg-teal-400 disabled:opacity-50"
          >
            {busy ? "Resuming…" : "Resume setup"}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg bg-white/10 px-6 py-2.5 font-semibold hover:bg-white/20 disabled:opacity-50"
          >
            Not now
          </button>
        </div>
      </div>,
    );
  }

  const header = (
    <div className="mb-8 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Avatar />
        <div>
          <h1 className="text-xl font-bold md:text-2xl">Zorecho Setup Agent</h1>
          <p className="text-sm text-white/60">I&apos;ll set up your account for you.</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {phase === "interview" && voice.supported ? (
          <div
            role="group"
            aria-label="Answer input mode"
            className="flex items-center rounded-full border border-white/15 bg-white/5 p-0.5 text-xs font-semibold"
          >
            <button
              type="button"
              onClick={() => setVoiceMode(true)}
              aria-pressed={voiceMode}
              className={`rounded-full px-3 py-1.5 transition ${
                voiceMode ? "bg-teal-500 text-black" : "text-white/60 hover:text-white"
              }`}
            >
              🎤 Voice
            </button>
            <button
              type="button"
              onClick={() => setVoiceMode(false)}
              aria-pressed={!voiceMode}
              className={`rounded-full px-3 py-1.5 transition ${
                !voiceMode ? "bg-teal-500 text-black" : "text-white/60 hover:text-white"
              }`}
            >
              ⌨️ Text
            </button>
          </div>
        ) : null}
        {phase !== "done" && (
          <button
            onClick={skipSetup}
            disabled={busy}
            className="text-sm text-white/50 hover:text-white/80 disabled:opacity-50"
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );

  if (phase === "interview") {
    return shell(
      <>
        {header}
        <div className="flex flex-1 flex-col justify-center">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-10">
            <p className="text-2xl font-semibold leading-snug md:text-3xl">
              {question ? stripEmphasis(question.message) : "…"}
            </p>
            {question && question.suggestion ? (
              <p className="mt-3 text-sm text-teal-300/80">{question.suggestion}</p>
            ) : null}
            {voice.supported ? (
              <p className="mt-3 text-sm text-white/50">
                You can speak your answers or type them — whichever feels more natural.
              </p>
            ) : null}
            <form onSubmit={submitAnswer} className="mt-8">
              <textarea
                autoFocus
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) submitAnswer(e);
                }}
                rows={3}
                placeholder={
                  voiceMode && voice.supported ? "Speak your answer, or type it here…" : "Type your answer…"
                }
                className="w-full resize-none rounded-xl border border-white/15 bg-black/40 p-4 text-lg text-white outline-none focus:border-teal-400"
              />

              {voiceMode && voice.supported ? (
                <div className="mt-6 flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={voice.toggle}
                    disabled={busy || voice.transcribing}
                    aria-pressed={voice.recording}
                    aria-label={voice.recording ? "Stop recording" : "Start voice input"}
                    className={`relative flex h-20 w-20 items-center justify-center rounded-full text-white shadow-lg transition disabled:opacity-50 ${
                      voice.recording
                        ? "bg-red-500 hover:bg-red-400"
                        : "bg-teal-500 text-black hover:bg-teal-400"
                    }`}
                  >
                    {voice.recording ? (
                      <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" />
                    ) : null}
                    <MicIcon className="relative h-8 w-8" />
                  </button>

                  {voice.recording ? (
                    <div className="flex items-center gap-2 text-red-400">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                      <span className="font-semibold">Listening…</span>
                    </div>
                  ) : voice.transcribing ? (
                    <span className="text-sm text-white/60">Transcribing…</span>
                  ) : (
                    <span className="text-sm text-white/50">
                      {isMobile ? "Tap to speak" : "Click to speak"}
                    </span>
                  )}

                  <span className="text-xs text-white/40">
                    {voice.method === "webspeech"
                      ? "⚡ Instant voice recognition"
                      : "Voice transcription"}
                  </span>

                  {voice.error ? (
                    <p className="max-w-sm text-center text-sm text-red-400">{voice.error}</p>
                  ) : null}
                </div>
              ) : null}

              {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
              <div className="mt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={busy || !answer.trim()}
                  className="rounded-lg bg-teal-500 px-6 py-2.5 font-semibold text-black hover:bg-teal-400 disabled:opacity-50"
                >
                  {busy ? "Sending…" : "Next"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </>,
    );
  }

  if (phase === "consent") {
    return shell(
      <>
        {header}
        <div className="flex flex-1 flex-col justify-center">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-10">
            <h2 className="text-2xl font-bold">Ready to set up your account</h2>
            <p className="mt-3 text-white/70">
              {question && question.message
                ? question.message
                : "I have everything I need. With your permission, I'll configure your account for you now."}
            </p>
            <ul className="mt-6 space-y-2 text-sm text-white/70">
              {steps.map((s) => (
                <li key={s.key} className="flex items-center gap-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
                  {s.label}
                </li>
              ))}
            </ul>
            <div className="mt-6 rounded-xl border border-white/10 bg-black/30 p-4 text-xs text-white/50">
              I&apos;ll configure these for you automatically. Anything that needs your sign-in —
              like connecting Google Calendar — will always ask for your approval on the provider&apos;s
              own screen. Features not on your plan are skipped. This permission ends the moment setup
              finishes.
              {voiceMode && voice.supported ? (
                <>
                  {" "}
                  If you answered by voice, your spoken answers were processed only to set up your
                  account. You can switch to text mode any time from the toggle at the top of the
                  screen.
                </>
              ) : null}
            </div>
            {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={grantConsent}
                disabled={busy}
                className="rounded-lg bg-teal-500 px-6 py-2.5 font-semibold text-black hover:bg-teal-400 disabled:opacity-50"
              >
                {busy ? "Starting…" : "Yes, set up my account"}
              </button>
              <button
                onClick={skipSetup}
                disabled={busy}
                className="rounded-lg bg-white/10 px-6 py-2.5 font-semibold hover:bg-white/20 disabled:opacity-50"
              >
                I&apos;ll do it myself
              </button>
            </div>
          </div>
        </div>
      </>,
    );
  }

  // running | done
  const total = steps.length;
  const finished = Object.values(results).filter((r) => r.status !== "running").length;
  const pct = total ? Math.round((finished / total) * 100) : 0;

  return shell(
    <>
      {header}
      <div className="flex flex-1 flex-col">
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between text-sm text-white/60">
            <span>{phase === "done" ? "Setup complete" : "Setting up your account…"}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-500 transition-all"
              style={{ width: `${phase === "done" ? 100 : pct}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          {steps.map((s) => {
            const r = results[s.key];
            const status = r ? r.status : runningKey === s.key ? "running" : "pending";
            const detail = r ? r.detail : runningKey === s.key ? "Working on it…" : "";
            return (
              <div
                key={s.key}
                className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4"
              >
                <StatusDot status={status} />
                <div className="min-w-0">
                  <p className="font-medium">{s.label}</p>
                  {detail ? <p className="mt-0.5 text-sm text-white/50">{detail}</p> : null}
                </div>
              </div>
            );
          })}
        </div>

        {needsConnection
          ? (() => {
              const kind = connectKind(needsConnection.connect);
              const isSocial = kind === "social";
              const platforms =
                isSocial && Array.isArray(needsConnection.connect?.platforms)
                  ? needsConnection.connect.platforms
                  : [];
              const alreadyConnected =
                isSocial && Array.isArray(needsConnection.connect?.connected)
                  ? needsConnection.connect.connected
                  : [];
              const primaryBtn =
                "rounded-lg bg-sky-500 px-5 py-2.5 font-semibold text-black hover:bg-sky-400 disabled:opacity-50";
              return (
                <div className="mt-6 rounded-2xl border border-sky-500/30 bg-sky-500/5 p-6">
                  <h3 className="font-semibold text-sky-200">
                    {isSocial ? "Connect your social accounts" : "One quick approval needed"}
                  </h3>
                  <p className="mt-1 text-sm text-white/70">{needsConnection.detail}</p>
                  {isSocial ? (
                    <p className="mt-2 text-xs text-white/40">
                      We&apos;ll take you to the Social Accounts screen — connect an account there,
                      then come back to finish setup.
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-white/40">
                      You&apos;ll approve this on {kind === "facebook" ? "Facebook" : "Google"}
                      &apos;s own secure page — Zorecho never sees your password.
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-3">
                    {kind === "google" ? (
                      <button onClick={connectGoogle} disabled={busy} className={primaryBtn}>
                        Connect Google Calendar
                      </button>
                    ) : null}
                    {kind === "facebook" ? (
                      <button onClick={connectFacebook} disabled={busy} className={primaryBtn}>
                        Connect Facebook
                      </button>
                    ) : null}
                    {isSocial
                      ? platforms.map((p) => {
                          const done = alreadyConnected.includes(p);
                          return (
                            <button
                              key={p}
                              onClick={goConnectSocial}
                              disabled={busy || done}
                              className={`${primaryBtn} capitalize`}
                            >
                              {done ? `${p} connected ✓` : `Connect ${p}`}
                            </button>
                          );
                        })
                      : null}
                    <button
                      onClick={continueAfterConnect}
                      disabled={busy}
                      className="rounded-lg bg-white/10 px-5 py-2.5 font-semibold hover:bg-white/20 disabled:opacity-50"
                    >
                      I&apos;ve connected — continue
                    </button>
                    <button
                      onClick={skipConnection}
                      disabled={busy}
                      className="rounded-lg px-5 py-2.5 font-semibold text-white/60 hover:text-white/90 disabled:opacity-50"
                    >
                      Skip this step
                    </button>
                  </div>
                </div>
              );
            })()
          : null}

        {error && phase === "running" ? (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
            <p className="text-sm text-red-300">{error}</p>
            <button
              onClick={() => runLoop(sessionId)}
              disabled={busy}
              className="mt-3 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"
            >
              Retry
            </button>
          </div>
        ) : null}

        {phase === "done" ? (
          <div className="mt-8 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
            <h3 className="text-xl font-bold text-emerald-200">Your account is ready</h3>
            <p className="mt-2 text-white/70">
              Everything that could be set up automatically is done. You can fine-tune anything from
              your dashboard.
            </p>
            <button
              onClick={onClose}
              className="mt-5 rounded-lg bg-teal-500 px-6 py-2.5 font-semibold text-black hover:bg-teal-400"
            >
              {doneLabel || "Go to my dashboard"}
            </button>
          </div>
        ) : null}
      </div>
    </>,
  );
}
