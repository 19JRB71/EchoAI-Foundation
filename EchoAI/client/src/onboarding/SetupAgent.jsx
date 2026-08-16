import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api.js";
import { openAuthUrl } from "../lib/oauthNav.js";
import Spinner from "../components/Spinner.jsx";
import { classifyExecuteError } from "./executeError.js";
import { useVoiceInput, detectIsMobile } from "./useVoiceInput.js";
import VoiceCalibration from "./VoiceCalibration.jsx";
import useOnboardingTiming from "./useOnboardingTiming.js";

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
  if (status === "failed") {
    return (
      <span className={`${base} bg-red-500/20 text-red-400`} aria-label="failed">
        ✕
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
  // Prompt 035 Section L — standalone timing only; when embedded, the wizard's
  // hook already covers this surface (interval merge would dedup anyway, but
  // there is no reason to double-post events).
  useOnboardingTiming(`setup:${phase}`, !embedded);
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
  // 026-C1: one-shot artifact-bound confirmation for the next execute call
  // ({ step, digest }); consumed and cleared on the loop's first iteration.
  const confirmRef = useRef(null);
  // 026-C1: the step key of the last needs_connection pause, to detect a
  // repeated pause on the same step ("nothing has been scheduled yet").
  const lastNeedsRef = useRef(null);
  // 026-C2: single-flight guard — only one runLoop may be in flight per mount.
  // The server's CAS lease stays authoritative; this stops the CLIENT from
  // racing itself (StrictMode double-invoke, Retry double-click, resume races).
  const loopActiveRef = useRef(false);
  // 026-C2: RECONCILING banner (a live lease conflict is being re-checked) and
  // the persistent STEP FAILED panel ({ key, label, outcome, message }).
  const [reconciling, setReconciling] = useState(false);
  const [failedStep, setFailedStep] = useState(null);

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

  // 026-C2: adopt server truth. Seeds the local results map from an
  // authoritative serialized session — completed/skipped steps from
  // completedSteps + stepOutcomes (026-C1 shape: string 'completed'|'skipped'),
  // failed steps from the C2 object shape ({ status:'failed', ... }) which are
  // NEVER in completedSteps. Used after EVERY session fetch, execute response,
  // 409 reconcile, retry, and mount so the panel can't drift from the server.
  const adoptSession = useCallback((s) => {
    if (!s) return;
    setSession(s);
    if (Array.isArray(s.steps) && s.steps.length > 0) setSteps(s.steps);
    const outcomes = s.stepOutcomes && typeof s.stepOutcomes === "object" ? s.stepOutcomes : {};
    const seeded = {};
    const completedSteps = Array.isArray(s.completedSteps) ? s.completedSteps : [];
    for (const key of completedSteps) {
      seeded[key] =
        outcomes[key] === "skipped"
          ? { status: "skipped", detail: "Skipped." }
          : { status: "done", detail: "Done." };
    }
    for (const [key, outcome] of Object.entries(outcomes)) {
      if (completedSteps.includes(key)) continue;
      if (outcome && typeof outcome === "object" && outcome.status === "failed") {
        seeded[key] = {
          status: "failed",
          detail: outcome.message || "This step couldn't finish. You can retry.",
          outcome,
        };
      }
    }
    if (completedSteps.length > 0 || Object.keys(seeded).length > 0) setResults(seeded);
  }, []);

  // 026-C2 / AM-C2-2: bounded lease-conflict reconcile. When /execute answers
  // 409 "another step is running", the loop adopts any server truth it carried
  // and re-attempts a FINITE number of times before surfacing an honest
  // timeout — never an unbounded poll, never a terminal "Please wait".
  const RECONCILE_MAX_ATTEMPTS = 5;
  const RECONCILE_DELAY_MS = 6000;

  const runLoop = useCallback(
    async (sid) => {
      // Single-flight: the server CAS lease is authoritative, but the client
      // must not race itself either (Retry double-click, StrictMode remount).
      if (loopActiveRef.current) return;
      loopActiveRef.current = true;
      setPhase("running");
      setNeedsConnection(null);
      setFailedStep(null);
      setError("");
      let reconcileAttempts = 0;
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          // A failed step is NOT done — it stays the current runnable step so
          // the next execute (a Retry) re-runs exactly it.
          const done = new Set(
            Object.entries(resultsRef.current)
              .filter(([, r]) => r && r.status !== "failed")
              .map(([k]) => k),
          );
          const pending = stepsRef.current.find((s) => !done.has(s.key));
          setRunningKey(pending ? pending.key : null);
          let res;
          try {
            // 026-C1: a one-shot artifact-bound confirmation (set by
            // approveActivation) rides on the FIRST execute of this loop only —
            // it approves exactly one artifact, never a category of actions.
            // AM-C2-4: it is cleared BEFORE the call, so no reconcile
            // re-attempt, Retry, refresh, or OAuth return can ever replay it.
            const confirmOnce = confirmRef.current;
            confirmRef.current = null;
            res = await api.runSetupAction(sid, false, confirmOnce);
          } catch (err) {
            const outcome = classifyExecuteError(err);
            if (outcome.type === "dismissed") {
              setRunningKey(null);
              onClose();
              return;
            }
            if (outcome.type === "paused") {
              setRunningKey(null);
              setSession(outcome.session);
              setPhase("paused");
              return;
            }
            if (outcome.type === "reconcile") {
              // Another execute holds the lease. Adopt whatever truth the 409
              // carried, then re-attempt — bounded (AM-C2-2), with an honest
              // timeout instead of an eternal "Please wait".
              if (outcome.session) adoptSession(outcome.session);
              reconcileAttempts += 1;
              if (reconcileAttempts >= RECONCILE_MAX_ATTEMPTS) {
                setReconciling(false);
                setRunningKey(null);
                setError(
                  "A setup step is still running from another window or a previous attempt. Nothing was lost — wait a moment, then press Retry.",
                );
                return;
              }
              setReconciling(true);
              await new Promise((r) => setTimeout(r, RECONCILE_DELAY_MS));
              continue;
            }
            setReconciling(false);
            setRunningKey(null);
            if (outcome.type === "failed") {
              // The server recorded a durable, owner-safe failed outcome.
              // Adopt its truth and show the persistent STEP FAILED panel.
              if (outcome.session) adoptSession(outcome.session);
              setResults((prev) => ({
                ...prev,
                [outcome.failedStep.key]: {
                  status: "failed",
                  detail: outcome.message,
                  label: outcome.failedStep.label,
                  outcome: outcome.outcome,
                },
              }));
              setFailedStep({
                key: outcome.failedStep.key,
                label: outcome.failedStep.label,
                outcome: outcome.outcome,
                message: outcome.message,
              });
              return;
            }
            setError(outcome.message);
            return;
          }
          reconcileAttempts = 0;
          setReconciling(false);
          if (res.allComplete) {
            if (res.session) setSession(res.session);
            setRunningKey(null);
            setPhase("done");
            return;
          }
          const { step, status, detail } = res;
          setResults((prev) => ({ ...prev, [step.key]: { status, detail, label: step.label } }));
          // Adopt the authoritative session riding every execute response
          // (026-C2) — but AFTER the richer local detail line is recorded, and
          // without clobbering it: session adoption here only updates the
          // session object; the seeded map is for fetch/reconcile paths.
          if (res.session) setSession(res.session);
          if (status === "needs_connection") {
            setRunningKey(null);
            // 026-C1: detect a REPEATED pause on the same step so the panel can
            // say plainly that nothing has been scheduled yet. A changed
            // artifact (connect.changed) is a fresh review, not a repeat.
            const repeated =
              lastNeedsRef.current === step.key && !(res.connect && res.connect.changed);
            lastNeedsRef.current = step.key;
            setNeedsConnection({
              key: step.key,
              connect: res.connect,
              detail,
              label: step.label,
              repeated,
            });
            return; // wait for the user to connect or skip
          }
          lastNeedsRef.current = null;
        }
      } finally {
        loopActiveRef.current = false;
        setReconciling(false);
      }
    },
    [onClose, adoptSession],
  );

  // 026-C2 Retry contract: reconcile FIRST (adopt fresh server truth so a step
  // that actually completed is never re-run and a lifted lease is seen), then
  // resume the loop, which re-runs the failed/current step exactly once per
  // pass. Single-flight + busy-guarded — a double-click cannot double-run.
  const retryStep = useCallback(async () => {
    if (busy || loopActiveRef.current) return;
    setBusy(true);
    setError("");
    try {
      const data = await api.startSetupSession();
      const s = data.session;
      adoptSession(s);
      setFailedStep(null);
      await runLoop(s.sessionId);
    } catch (err) {
      setError(err.message || "Could not retry this step.");
    } finally {
      setBusy(false);
    }
  }, [busy, adoptSession, runLoop]);

  // ---- Bootstrap / resume ----------------------------------------------------

  // Prompt 035 Section H — second-business entry choice. When the owner
  // already has a brand AND there is no open session to resume, the very
  // first thing they see is an explicit choice: continue setting up the
  // existing business, or set up a DIFFERENT business (fresh session, no
  // silent binding to the existing brand). The choice is persisted server-
  // side in the session's _interview bookkeeping and survives restarts.
  const [entryBrands, setEntryBrands] = useState([]);
  const activeRef = useRef(true);

  // Start (or resume) a session and route to the right phase. intent is null
  // (today's resume-or-start behavior) or "new_business" (Section H).
  const startWith = useCallback(
    async (intent) => {
      try {
        const data = await api.startSetupSession(intent ? { intent } : undefined);
        if (!activeRef.current) return;
        const s = data.session;
        // 026-C2: one adoption point for server truth — seeds completed,
        // skipped AND durably-failed step outcomes (a failed step renders as
        // its persistent failed state on every mount, incl. OAuth returns).
        adoptSession(s);
        setSteps(s.steps || []);

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
          if (!activeRef.current) return;
          setPhase(offerCalibration ? "calibration" : "interview");
        } else if (!s.consentGranted) {
          setPhase("consent");
        } else {
          // Consent already granted (e.g. returning from Google OAuth) — resume.
          await runLoop(s.sessionId);
        }
      } catch (err) {
        if (!activeRef.current) return;
        setError(err.message || "Could not start the setup agent.");
        setPhase("error");
      }
    },
    [runLoop],
  );

  useEffect(() => {
    activeRef.current = true;
    (async () => {
      // Offer the second-business choice only when a real (non-demo) brand
      // already exists AND there is no open session to resume (an owner
      // returning mid-setup — e.g. from OAuth — is never interrupted by the
      // choice). Any probe/read failure degrades to a plain start (setup is
      // never blocked on the choice surface).
      let brands = [];
      let openSession = true;
      try {
        const [list, probe] = await Promise.all([
          api.getBrands(),
          api.probeSetupSession(),
        ]);
        const arr = Array.isArray(list) ? list : list?.brands || [];
        brands = arr.filter((b) => b && b.is_demo !== true);
        openSession = Boolean(probe && probe.openSession);
      } catch {
        brands = [];
      }
      if (!activeRef.current) return;
      if (brands.length > 0 && !openSession) {
        setEntryBrands(brands);
        setPhase("entryChoice");
        return;
      }
      await startWith(null);
    })();
    return () => {
      activeRef.current = false;
    };
  }, [startWith]);

  // ---- Interview -------------------------------------------------------------

  // Submit the given text (or the current answer field). Accepting an explicit
  // value lets voice auto-submit pass its transcript directly, avoiding a race
  // with the async `answer` state update.
  const doSubmit = useCallback(
    async (raw, extras) => {
      const value = (raw != null ? raw : answer).trim();
      if (!value || busy) return;
      setBusy(true);
      setError("");
      try {
        // Only pass structured extras when a button supplied them, so plain
        // typed/voice answers keep the exact pre-023 call shape.
        const data = extras
          ? await api.submitSetupAnswer(sessionId, value, extras)
          : await api.submitSetupAnswer(sessionId, value);
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
      if (!openAuthUrl(authUrl)) setBusy(false);
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
      if (!openAuthUrl(authUrl)) setBusy(false);
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
    // Land directly on the Connected Accounts tab (not the section's default
    // Content Calendar tab) so the connect buttons are immediately visible.
    if (typeof onExitToSection === "function") onExitToSection("social", "accounts");
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

  // 026-C1 Ruling A: the owner approved the exact posting schedule shown in
  // the activate_calendar panel. The approval is bound to that artifact's
  // digest and consumed by exactly one execute call — if the calendar changed
  // meanwhile, the server refuses and pauses again with a fresh preview.
  async function approveActivation(digest) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      confirmRef.current = { step: "social_schedule", digest };
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
      // 026-C2: same single adoption point as bootstrap — completed, skipped
      // AND failed outcomes all resume truthfully.
      adoptSession(s);
      setSteps(s.steps || []);
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

  if (phase === "entryChoice") {
    const first = entryBrands[0];
    return shell(
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center" data-testid="entry-choice">
        <h2 className="text-xl font-bold text-white">What would you like to set up?</h2>
        <p className="max-w-md text-sm text-white/70">
          You already have {entryBrands.length === 1 ? `"${first.brand_name}"` : `${entryBrands.length} businesses`} here.
          Pick up where you left off, or start a brand-new business — your existing setup stays untouched.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            onClick={() => {
              setPhase("loading");
              startWith(null);
            }}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-500"
            data-testid="entry-choice-continue"
          >
            Continue setting up {first ? `"${first.brand_name}"` : "my business"}
          </button>
          <button
            onClick={() => {
              setPhase("loading");
              startWith("new_business");
            }}
            className="rounded-lg bg-white/10 px-5 py-2.5 font-semibold text-white hover:bg-white/20"
            data-testid="entry-choice-new"
          >
            Set up a different business
          </button>
        </div>
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
            {/* Prompt 023 — engine-selected confirm/arbitrate affordances. The
                candidate value is UNCONFIRMED until the owner acts; buttons send
                an explicit structured resolution so nothing is inferred. */}
            {question && question.action === "confirm" && question.candidate ? (
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    doSubmit("Yes, that's correct.", {
                      resolution: {
                        kind: "confirm",
                        revisionId: question.candidate.revisionId || undefined,
                      },
                    })
                  }
                  className="rounded-xl bg-teal-500 px-4 py-2 text-sm font-semibold text-black hover:bg-teal-400 disabled:opacity-50"
                >
                  Yes, that&apos;s right
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => doSubmit("Skip this one for now.", { resolution: { kind: "defer" } })}
                  className="rounded-xl border border-white/20 px-4 py-2 text-sm text-white/70 hover:border-white/40 disabled:opacity-50"
                >
                  Skip for now
                </button>
              </div>
            ) : null}
            {question && question.action === "arbitrate" && Array.isArray(question.candidates) ? (
              <div className="mt-5 flex flex-wrap gap-3">
                {question.candidates
                  .filter((c) => c && c.value !== null && c.value !== undefined && String(c.value).trim() !== "")
                  .map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        doSubmit(typeof c.value === "string" ? c.value : JSON.stringify(c.value), {
                          resolution: { kind: "choose" },
                        })
                      }
                      className="rounded-xl border border-teal-400/40 bg-teal-400/10 px-4 py-2 text-sm text-teal-200 hover:bg-teal-400/20 disabled:opacity-50"
                    >
                      {typeof c.value === "string" ? c.value : JSON.stringify(c.value)}
                    </button>
                  ))}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => doSubmit("Skip this one for now.", { resolution: { kind: "defer" } })}
                  className="rounded-xl border border-white/20 px-4 py-2 text-sm text-white/70 hover:border-white/40 disabled:opacity-50"
                >
                  Skip for now
                </button>
              </div>
            ) : null}
            {question && (question.action === "confirm" || question.action === "arbitrate" || question.action === "ask") ? (
              <p className="mt-4 text-xs text-white/40">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => doSubmit("Let's continue with setup anyway.", { continueAnyway: true })}
                  className="underline hover:text-white/70 disabled:opacity-50"
                >
                  Continue setup with what we have
                </button>{" "}
                — anything skipped stays honestly marked as unanswered.
              </p>
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
              const primaryBtnTeal =
                "rounded-lg bg-teal-500 px-5 py-2.5 font-semibold text-black hover:bg-teal-400 disabled:opacity-50";
              const ghostBtn =
                "rounded-lg px-5 py-2.5 font-semibold text-white/60 hover:text-white/90 disabled:opacity-50";
              // 026-C1 Ruling A: the posting-schedule approval panel. Shows the
              // exact artifact (count, window, destinations, exclusions) and
              // binds the approve action to its digest.
              if (kind === "activate_calendar") {
                const preview = needsConnection.connect?.preview || {};
                const fmt = (iso) =>
                  iso
                    ? new Date(iso).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : null;
                const destLines = Object.entries(preview.destinations || {});
                return (
                  <div className="mt-6 rounded-2xl border border-teal-500/30 bg-teal-500/5 p-6">
                    <h3 className="font-semibold text-teal-200">Approve your posting schedule</h3>
                    <p className="mt-1 text-sm text-white/70">{needsConnection.detail}</p>
                    <div className="mt-3 space-y-1 text-sm text-white/80">
                      <p>
                        <span className="font-semibold">{preview.eligibleCount ?? 0}</span> post
                        {(preview.eligibleCount ?? 0) === 1 ? "" : "s"} will be scheduled
                        {preview.firstScheduledTime
                          ? ` from ${fmt(preview.firstScheduledTime)} to ${fmt(preview.lastScheduledTime)}`
                          : ""}
                        .
                      </p>
                      {destLines.map(([platform, destination]) => (
                        <p key={platform} className="capitalize">
                          {platform} → <span className="normal-case">{destination || "connected account"}</span>
                        </p>
                      ))}
                      {preview.excludedStaleCount > 0 ? (
                        <p className="text-amber-300/90">
                          {preview.excludedStaleCount} post
                          {preview.excludedStaleCount === 1 ? "" : "s"} will stay as drafts — their
                          times have already passed.
                        </p>
                      ) : null}
                      {preview.excludedUnboundCount > 0 ? (
                        <p className="text-amber-300/90">
                          {preview.excludedUnboundCount} post
                          {preview.excludedUnboundCount === 1 ? "" : "s"} will stay as drafts — their
                          platform has no connected destination.
                        </p>
                      ) : null}
                      {needsConnection.repeated ? (
                        <p className="text-white/50">
                          This is the same approval as before — nothing has been scheduled yet.
                        </p>
                      ) : null}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        onClick={() => approveActivation(preview.digest)}
                        disabled={busy || !preview.digest}
                        className={primaryBtnTeal}
                      >
                        Approve &amp; schedule
                      </button>
                      <button onClick={skipConnection} disabled={busy} className={ghostBtn}>
                        Skip — keep everything as drafts
                      </button>
                    </div>
                  </div>
                );
              }
              // 026-C1 AM-C1-1 state B: Facebook login works but this business
              // has no Page selected — an explicit Page-picker handoff, never a
              // generic connect that looks already satisfied.
              if (kind === "social_select_page") {
                return (
                  <div className="mt-6 rounded-2xl border border-sky-500/30 bg-sky-500/5 p-6">
                    <h3 className="font-semibold text-sky-200">Choose your Facebook Page</h3>
                    <p className="mt-1 text-sm text-white/70">{needsConnection.detail}</p>
                    {needsConnection.repeated ? (
                      <p className="mt-2 text-sm text-white/50">
                        Still no Page selected for this business — nothing can publish until you
                        pick one.
                      </p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        onClick={goConnectSocial}
                        disabled={busy}
                        className="rounded-lg bg-sky-500 px-5 py-2.5 font-semibold text-black hover:bg-sky-400 disabled:opacity-50"
                      >
                        Choose a Page
                      </button>
                      <button
                        onClick={continueAfterConnect}
                        disabled={busy}
                        className="rounded-lg bg-white/10 px-5 py-2.5 font-semibold hover:bg-white/20 disabled:opacity-50"
                      >
                        I&apos;ve picked one — continue
                      </button>
                      <button onClick={skipConnection} disabled={busy} className={ghostBtn}>
                        Skip this step
                      </button>
                    </div>
                  </div>
                );
              }
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
                  {needsConnection.repeated ? (
                    <p className="mt-1 text-sm text-white/50">
                      This step is still waiting on the same connection as before.
                    </p>
                  ) : null}
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

        {reconciling && phase === "running" ? (
          <div
            className="mt-6 flex items-center gap-3 rounded-xl border border-teal-500/30 bg-teal-500/5 p-4"
            data-testid="reconciling-banner"
          >
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
            <p className="text-sm text-teal-200">
              A setup step is still finishing — checking on it now. Nothing is lost.
            </p>
          </div>
        ) : null}

        {failedStep && phase === "running" ? (
          <div
            className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/5 p-6"
            data-testid="failed-step-panel"
          >
            <h3 className="font-semibold text-red-200">
              {failedStep.outcome && failedStep.outcome.code === "provider_billing"
                ? "This step needs attention on our side"
                : "This step couldn't finish"}
            </h3>
            <p className="mt-1 text-sm text-white/70">{failedStep.message}</p>
            <p className="mt-2 text-xs text-white/40">
              Step: {failedStep.label}
              {failedStep.outcome && failedStep.outcome.ref
                ? ` · Reference: ${failedStep.outcome.ref}`
                : ""}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={retryStep}
                disabled={busy}
                className="rounded-lg bg-teal-500 px-5 py-2.5 font-semibold text-black hover:bg-teal-400 disabled:opacity-50"
                data-testid="failed-step-retry"
              >
                {busy ? "Retrying…" : "Retry this step"}
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
        ) : null}

        {error && phase === "running" ? (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
            <p className="text-sm text-red-300">{error}</p>
            <button
              onClick={retryStep}
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
