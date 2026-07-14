// Echo Guided Setup — the warm front door every new customer walks through.
//
// Welcome → Plan → Business Profile (the AI Setup Agent, embedded) → Connect
// Accounts → Team → Done. Progress is saved server-side after every move
// (guided_setup_progress), so closing the tab — or being bounced through a
// full-page OAuth redirect — always resumes exactly where the customer left
// off. Connection card states come from LIVE server probes, never local
// assumptions. Echo speaks each step when voice is available and always shows
// the same words as text.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import SetupAgent from "../SetupAgent.jsx";
import StepSubscription from "../steps/StepSubscription.jsx";
import StepTeam from "../steps/StepTeam.jsx";
import ConnectionsStep from "./ConnectionsStep.jsx";
import { CONNECTION_CATALOG } from "./connectionCatalog.jsx";
import { translateConnectionError } from "./connectionErrors.js";
import { useEchoSpeak } from "./useEchoSpeak.js";

// Tracker steps (welcome is the front door, not a tracked step).
const TRACKED_STEPS = [
  { key: "plan", title: "Your plan" },
  { key: "profile", title: "Business profile" },
  { key: "connections", title: "Connect accounts" },
  { key: "team", title: "Your team" },
  { key: "done", title: "Ready" },
];

const STEP_LABELS = {
  welcome: "getting started",
  plan: "choosing your plan",
  profile: "telling Echo about your business",
  connections: "connecting your accounts",
  team: "setting up your team",
  done: "finishing up",
};

// What Echo says when each step appears (spoken if voice is available;
// the on-screen copy always carries the same message).
const STEP_VOICE_LINES = {
  plan: "First, pick the plan that fits. You can change it any time.",
  profile: "Now tell me about your business. Just answer naturally — I'll do the heavy lifting.",
  connections: "Let's link your accounts. Before each one, I'll show you exactly what you'll see.",
  team: "Want to bring in teammates? Totally optional.",
  done: "That's everything. Echo is ready to work for you.",
};

export default function GuidedSetupWizard({ onComplete }) {
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState("welcome");
  const [flags, setFlags] = useState({});
  const [statuses, setStatuses] = useState({});
  const [resume, setResume] = useState(null); // saved step to offer "continue"
  const [error, setError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const { speak, stop } = useEchoSpeak();

  const stepRef = useRef(step);
  stepRef.current = step;
  const flagsRef = useRef(flags);
  flagsRef.current = flags;

  const persist = useCallback((nextStep, nextFlags) => {
    return api.saveGuidedSetupProgress(nextStep, nextFlags).catch(() => {
      /* progress saving is best-effort; the wizard keeps working locally */
    });
  }, []);

  // ---- Initial load: OAuth-return params + saved progress + live probes ----
  useEffect(() => {
    let active = true;
    (async () => {
      // Detect a return from a full-page OAuth redirect and strip the params
      // immediately so a reload doesn't replay the result.
      const params = new URLSearchParams(window.location.search);
      let oauth = null;
      for (const c of CONNECTION_CATALOG) {
        const status = params.get(c.paramKey);
        if (status) {
          oauth = { key: c.key, name: c.name, status, message: params.get(c.messageKey) || "" };
        }
        params.delete(c.paramKey);
        params.delete(c.messageKey);
      }
      if (oauth) {
        const rest = params.toString();
        window.history.replaceState(
          {},
          "",
          window.location.pathname + (rest ? `?${rest}` : ""),
        );
      }

      let state = null;
      try {
        state = await api.getGuidedSetupState();
      } catch (err) {
        if (active) {
          setError(err.message || "Couldn't load your setup progress.");
          setLoading(false);
        }
        return;
      }
      if (!active) return;

      const savedStep = state.progress?.currentStep || "welcome";
      let nextFlags = state.progress?.connections || {};
      setStatuses(state.connectionStatus || {});

      if (oauth && savedStep === "connections") {
        // We just came back from a provider while on the connections step.
        const entry = { ...(nextFlags[oauth.key] || {}) };
        delete entry.connecting;
        if (oauth.status === "connected") {
          delete entry.errorKey;
          entry.skipped = false;
        } else {
          const translated = translateConnectionError(oauth.key, oauth.message);
          entry.errorKey = translated.key;
          // Raw provider detail goes to the server log only — never on screen.
          api.reportGuidedSetupConnectionError(oauth.key, oauth.message).catch(() => {});
        }
        nextFlags = { ...nextFlags, [oauth.key]: entry };
        setFlags(nextFlags);
        setStep("connections");
        persist("connections", nextFlags);
        setLoading(false);
        return;
      }

      setFlags(nextFlags);
      if (savedStep !== "welcome" && savedStep !== "done") {
        // Mid-flow: greet them back instead of dropping them in cold.
        setResume(savedStep);
      }
      setStep("welcome");
      setLoading(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gotoStep = useCallback(
    (next) => {
      setStep(next);
      persist(next, flagsRef.current);
      const line = STEP_VOICE_LINES[next];
      if (line) speak(line);
    },
    [persist, speak],
  );

  // Merge + persist per-connection flags (awaited by ConnectionsStep before
  // it leaves the page for an OAuth redirect).
  const updateFlags = useCallback(
    (key, patch) => {
      const current = flagsRef.current;
      const entry = { ...(current[key] || {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined) delete entry[k];
        else entry[k] = v;
      }
      const merged = { ...current, [key]: entry };
      setFlags(merged);
      return api.saveGuidedSetupProgress(stepRef.current, merged).catch(() => {});
    },
    [],
  );

  // Refresh live probes when the connections step (or the summary) appears.
  useEffect(() => {
    if (step !== "connections" && step !== "done") return;
    let active = true;
    api
      .getGuidedSetupState()
      .then((state) => {
        if (active) setStatuses(state.connectionStatus || {});
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [step]);

  async function finish() {
    if (finishing) return;
    setFinishing(true);
    setError("");
    try {
      await api.updateOnboarding({ onboardingStep: 5, onboardingCompleted: true });
      persist("done", flagsRef.current);
      stop();
      onComplete();
    } catch (err) {
      setError(err.message || "Couldn't finish setup — please try again.");
      setFinishing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <Spinner label="Loading your setup…" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <header className="border-b border-gray-800 bg-gray-900/70 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-4">
          <span className="text-lg font-extrabold tracking-tight text-amber-300">Zorecho</span>
          <span className="text-sm text-gray-400">Guided setup</span>
        </div>
        {step !== "welcome" && <Stepper current={step} />}
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-8">
        <div className={`w-full ${step === "profile" ? "max-w-4xl" : "max-w-2xl"}`}>
          <ErrorBanner message={error} />

          {step === "welcome" && (
            <WelcomeScreen
              resume={resume}
              finishing={finishing}
              onStart={() => {
                setResume(null);
                gotoStep("plan");
              }}
              onResume={() => {
                const target = resume;
                setResume(null);
                gotoStep(target);
              }}
              onLater={finish}
              speak={speak}
            />
          )}

          {step === "plan" && (
            <StepSubscription
              onNext={() => gotoStep("profile")}
              onBack={() => setStep("welcome")}
              onSelectTier={() => {}}
            />
          )}

          {step === "profile" && (
            <div>
              <h2 className="text-2xl font-extrabold text-gray-100">Tell Echo about your business</h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">
                Echo will ask a few easy questions — no forms, no jargon — and set everything up
                from your answers. If Echo suggests connecting an account here, go right ahead;
                otherwise the next step covers it.
              </p>
              <div className="mt-4">
                <SetupAgent
                  embedded
                  doneLabel="Continue setup"
                  onClose={() => gotoStep("connections")}
                  onExitToSection={() => gotoStep("connections")}
                />
              </div>
            </div>
          )}

          {step === "connections" && (
            <ConnectionsStep
              statuses={statuses}
              flags={flags}
              updateFlags={updateFlags}
              speak={speak}
              onNext={() => gotoStep("team")}
              onBack={() => gotoStep("profile")}
            />
          )}

          {step === "team" && (
            <StepTeam onNext={() => gotoStep("done")} onBack={() => gotoStep("connections")} />
          )}

          {step === "done" && (
            <DoneScreen statuses={statuses} finishing={finishing} onEnter={finish} />
          )}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

function WelcomeScreen({ resume, finishing, onStart, onResume, onLater, speak }) {
  const freshLine =
    "Hi, I'm Echo — your new marketing team. I'll take care of the setup; you just answer a few easy questions. It takes about ten minutes, and you can stop any time.";
  const resumeLine = resume
    ? `Welcome back! Last time you were ${STEP_LABELS[resume] || "mid-setup"}. Want to pick up where you left off?`
    : "";

  // Best-effort spoken greeting — if autoplay is blocked, the text says it all.
  useEffect(() => {
    speak(resume ? resumeLine : freshLine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-xl pt-8 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-amber-500/15 text-4xl">
        👋
      </div>
      <h1 className="mt-6 text-3xl font-extrabold text-gray-100">
        {resume ? "Welcome back!" : "Hi, I'm Echo — your new marketing team."}
      </h1>
      <p className="mt-4 text-base leading-relaxed text-gray-300">
        {resume ? resumeLine : freshLine}
      </p>

      <div className="mt-8 flex flex-col items-center gap-3">
        {resume ? (
          <>
            <button
              type="button"
              onClick={onResume}
              className="w-full max-w-xs rounded-xl bg-amber-500 px-6 py-3 text-base font-bold text-gray-900 hover:bg-amber-600"
            >
              Continue where I left off
            </button>
            <button
              type="button"
              onClick={onStart}
              className="w-full max-w-xs rounded-xl border border-gray-700 px-6 py-3 text-sm font-semibold text-gray-300 hover:bg-gray-800"
            >
              Start over from the top
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onStart}
            className="w-full max-w-xs rounded-xl bg-amber-500 px-6 py-3 text-base font-bold text-gray-900 hover:bg-amber-600"
          >
            Let&apos;s get started
          </button>
        )}
        <button
          type="button"
          onClick={onLater}
          disabled={finishing}
          className="text-sm font-medium text-gray-500 underline-offset-2 hover:text-gray-300 hover:underline disabled:opacity-50"
        >
          {finishing ? "One moment…" : "Do this later — take me to my dashboard"}
        </button>
      </div>
    </div>
  );
}

function DoneScreen({ statuses, finishing, onEnter }) {
  const connected = CONNECTION_CATALOG.filter((c) => statuses?.[c.key] === "connected");
  const notConnected = CONNECTION_CATALOG.filter((c) => statuses?.[c.key] !== "connected");

  return (
    <div className="mx-auto max-w-xl pt-8 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 text-4xl">
        🎉
      </div>
      <h1 className="mt-6 text-3xl font-extrabold text-gray-100">You&apos;re all set!</h1>
      <p className="mt-4 text-base leading-relaxed text-gray-300">
        That&apos;s everything — Echo is ready to work for you. Here&apos;s where things stand:
      </p>

      <div className="mt-6 space-y-2 text-left">
        {connected.map((c) => (
          <div
            key={c.key}
            className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3"
          >
            <c.Logo className="h-8 w-8" />
            <span className="text-sm font-semibold text-emerald-200">{c.name} connected ✓</span>
          </div>
        ))}
        {notConnected.map((c) => (
          <div
            key={c.key}
            className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900 px-4 py-3"
          >
            <c.Logo className="h-8 w-8" />
            <span className="text-sm text-gray-400">
              {c.name} not connected yet — you can do it any time from Settings, and I&apos;ll
              remind you when it would help.
            </span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onEnter}
        disabled={finishing}
        className="mt-8 w-full max-w-xs rounded-xl bg-amber-500 px-6 py-3 text-base font-bold text-gray-900 hover:bg-amber-600 disabled:opacity-50"
      >
        {finishing ? "Opening your dashboard…" : "Take me to my dashboard"}
      </button>
    </div>
  );
}

function Stepper({ current }) {
  const currentIndex = TRACKED_STEPS.findIndex((s) => s.key === current);
  return (
    <div className="mx-auto max-w-3xl px-4 pb-4">
      <ol className="flex items-center gap-2">
        {TRACKED_STEPS.map((s, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <li key={s.key} className="flex flex-1 items-center gap-2">
              <span
                className={[
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  done
                    ? "bg-amber-500 text-gray-900"
                    : active
                      ? "border-2 border-amber-500 text-amber-300"
                      : "border border-gray-700 text-gray-400",
                ].join(" ")}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className={[
                  "hidden text-xs font-medium sm:inline",
                  active ? "text-amber-300" : "text-gray-400",
                ].join(" ")}
              >
                {s.title}
              </span>
              {i < TRACKED_STEPS.length - 1 && (
                <span className={["h-px flex-1", done ? "bg-amber-500" : "bg-gray-700"].join(" ")} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
