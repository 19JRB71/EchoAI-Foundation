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
import FirstWinStep from "./FirstWinStep.jsx";
import OnlineLinksPanel from "./OnlineLinksPanel.jsx";
import { CONNECTION_CATALOG } from "./connectionCatalog.jsx";
import { translateConnectionError } from "./connectionErrors.js";
import { useEchoSpeak } from "./useEchoSpeak.js";

// Tracker steps (welcome is the front door, not a tracked step).
const TRACKED_STEPS = [
  { key: "plan", title: "Your plan" },
  { key: "profile", title: "Business profile" },
  { key: "firstwin", title: "Your first win" },
  { key: "connections", title: "Unlock automation" },
  { key: "team", title: "Your team" },
  { key: "done", title: "Business ready" },
];

const STEP_LABELS = {
  welcome: "getting started",
  plan: "choosing your plan",
  profile: "telling Echo about your business",
  firstwin: "getting your first win",
  connections: "unlocking automation",
  team: "setting up your team",
  done: "finishing up",
};

// What Echo says when each step appears (spoken if voice is available; the
// on-screen copy always carries the same message). Each step has a small pool
// of executive-assistant variants so repeat visits don't sound canned.
const STEP_VOICE_LINES = {
  plan: [
    "First things first, Sir — pick the plan that fits. You can change it any time.",
    "Let's start with your plan, Sir. Nothing here is set in stone — you can change it whenever you like.",
  ],
  profile: [
    "Excellent. Now tell me about your business, Sir — just answer naturally, and I'll do the heavy lifting.",
    "Wonderful choice, Sir. Now, tell me about your business — a few easy questions, and I'll handle everything from there.",
  ],
  firstwin: [
    "Now for the good part, Sir — let's get something working immediately. Pick one, and I'll do real work for your business right now.",
    "Before we connect anything, Sir, let's put a win on the board. Choose one, and I'll take care of it right now.",
  ],
  connections: [
    "To automate this, I need Facebook, Sir. Each account you connect unlocks another ability — and before each one, I'll show you exactly what you'll see.",
    "Very good, Sir. Now let's unlock automation — each account you connect lets me do more for you, and I'll walk you through every screen.",
  ],
  team: [
    "Nearly there, Sir. Would you like to bring in teammates? Entirely optional.",
    "Almost done, Sir. If you'd like your team on board, I can send the invitations — or we can skip this for now.",
  ],
  done: [
    // CEO-approved final copy (July 2026) — spoken as written, then the tour
    // offer follows once Echo finishes.
    "Congratulations, Sir. Your AI company is now online. Echo, Scout, Atlas, Nova, Pulse, Voice, Forge, Sentinel, and Sage are standing by. While you focus on running your business, we'll focus on growing it. Welcome to Zorecho. Welcome to your AI company. … Would you like a two-minute guided tour of your headquarters?",
  ],
};

function pickLine(pool) {
  if (!pool) return "";
  if (typeof pool === "string") return pool;
  return pool[Math.floor(Math.random() * pool.length)];
}

// CEO-approved warm success lines, spoken and shown when an OAuth connection
// lands — Echo reports it like an executive assistant, not system software.
const CONNECTION_SUCCESS_LINE = {
  facebook:
    "Excellent, Sir. Facebook is connected. Nova now has everything she needs to begin working for you.",
  google:
    "Beautiful. Google is online. Your calendar, Gmail, and scheduling tools are now available to your AI team.",
};

export default function GuidedSetupWizard({ onComplete }) {
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState("welcome");
  const [flags, setFlags] = useState({});
  const [statuses, setStatuses] = useState({});
  // Server-side provider readiness ("no green button without a green backend").
  const [readiness, setReadiness] = useState(null);
  // Provider verification: has a full OAuth round trip ever succeeded here?
  const [verification, setVerification] = useState(null);
  const [resume, setResume] = useState(null); // saved step to offer "continue"
  const [oauthNotice, setOauthNotice] = useState(null); // { tone, text } after an OAuth return
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
      setReadiness(state.providerReadiness || null);
      setVerification(state.providerVerification || null);

      if (oauth && savedStep === "connections") {
        // We just came back from a provider while on the connections step.
        // Echo greets the result out loud AND in text — the browser usually
        // blocks autoplay right after a redirect, so the text carries it.
        const entry = { ...(nextFlags[oauth.key] || {}) };
        delete entry.connecting;
        if (oauth.status === "connected") {
          delete entry.errorKey;
          entry.skipped = false;
          const text =
            CONNECTION_SUCCESS_LINE[oauth.key] ||
            `Welcome back, Sir — ${oauth.name} is connected.`;
          setOauthNotice({ tone: "success", text });
        } else {
          const translated = translateConnectionError(oauth.key, oauth.message);
          entry.errorKey = translated.key;
          setOauthNotice({
            tone: "reassure",
            text: `Welcome back, Sir. The ${oauth.name} connection didn't go through this time — no harm done. The card below explains what happened, and we can try again whenever you're ready.`,
          });
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
      // OAuth return but the saved step drifted — still surface the outcome.
      if (oauth) {
        setOauthNotice(
          oauth.status === "connected"
            ? {
                tone: "success",
                text:
                  CONNECTION_SUCCESS_LINE[oauth.key] ||
                  `Welcome back, Sir — ${oauth.name} is connected.`,
              }
            : {
                tone: "reassure",
                text: `Welcome back, Sir. The ${oauth.name} connection didn't go through this time — no harm done. We can try again whenever you're ready.`,
              },
        );
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
    (next, { resumed = false } = {}) => {
      setStep(next);
      persist(next, flagsRef.current);
      // A resume must NOT replay the step's first-time intro line — e.g.
      // returning mid-execution to the profile step would say "Now tell me
      // about your business" as if starting over. Echo instead says a short
      // pick-up line and lets the step's own UI carry the state.
      const line = resumed
        ? "Picking up right where we left off, Sir."
        : pickLine(STEP_VOICE_LINES[next]);
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

  // Best-effort spoken version of the OAuth-return greeting. Autoplay is
  // usually blocked right after a full-page redirect, so the on-screen banner
  // is the reliable channel — this only adds voice when the browser allows it.
  const spokeNoticeRef = useRef(false);
  useEffect(() => {
    if (!oauthNotice || spokeNoticeRef.current) return;
    spokeNoticeRef.current = true;
    speak(oauthNotice.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthNotice]);

  // Refresh live probes when the connections step (or the summary) appears.
  useEffect(() => {
    if (step !== "connections" && step !== "done") return;
    let active = true;
    api
      .getGuidedSetupState()
      .then((state) => {
        if (active) {
          setStatuses(state.connectionStatus || {});
          setReadiness(state.providerReadiness || null);
          setVerification(state.providerVerification || null);
        }
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
                gotoStep(target, { resumed: true });
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
                  onClose={() => gotoStep("firstwin")}
                  onExitToSection={() => gotoStep("firstwin")}
                />
              </div>
              <OnlineLinksPanel />
            </div>
          )}

          {step === "firstwin" && (
            <FirstWinStep
              flags={flags}
              updateFlags={updateFlags}
              speak={speak}
              onNext={() => gotoStep("connections")}
              onBack={() => gotoStep("profile")}
            />
          )}

          {step === "connections" && (
            <ConnectionsStep
              statuses={statuses}
              readiness={readiness}
              verification={verification}
              flags={flags}
              updateFlags={updateFlags}
              speak={speak}
              notice={oauthNotice}
              onDismissNotice={() => setOauthNotice(null)}
              onNext={() => gotoStep("team")}
              onBack={() => gotoStep("firstwin")}
            />
          )}

          {step === "team" && (
            <StepTeam onNext={() => gotoStep("done")} onBack={() => gotoStep("connections")} />
          )}

          {step === "done" && (
            <DoneScreen
              statuses={statuses}
              flags={flags}
              finishing={finishing}
              onEnter={finish}
              onEnterWithTour={() => {
                // The dashboard's TourProvider consumes this flag once and
                // auto-starts the two-minute tour (suppressing the welcome
                // modal so the tour isn't offered twice).
                try {
                  localStorage.setItem("echoai_tour_autostart", "1");
                } catch {
                  /* private mode — the tour offer simply falls back to the modal */
                }
                finish();
              }}
            />
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

// Milestone 5 — "Business Ready". Recaps the first win and everything the
// customer unlocked, and points at the one big ability still waiting (the AI
// phone agent lives in the Phone department — too involved for the wizard).
const FIRST_WIN_RECAP = {
  post: "Your first social post is written and on the calendar.",
  lead: "Your first lead is in your CRM, with Echo watching over it.",
  ad: "Your first ad creatives are drafted in the Ad Studio.",
  email: "Your first campaign email is written and waiting in Email Marketing.",
};

function DoneScreen({ statuses, flags, finishing, onEnter, onEnterWithTour }) {
  const connected = CONNECTION_CATALOG.filter((c) => statuses?.[c.key] === "connected");
  const notConnected = CONNECTION_CATALOG.filter((c) => statuses?.[c.key] !== "connected");
  const emailConnected = statuses?.email === "connected";
  const firstWin = flags?.firstwin?.done ? FIRST_WIN_RECAP[flags.firstwin.choice] : null;

  return (
    <div className="mx-auto max-w-xl pt-8 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 text-4xl">
        🎉
      </div>
      <p className="mt-6 text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">
        Milestone 5 · Business ready — Congratulations, Sir.
      </p>
      <h1 className="mt-2 text-3xl font-extrabold text-gray-100">
        Your AI company is now online.
      </h1>
      <p className="mt-4 text-base leading-relaxed text-gray-300">
        Echo, Scout, Atlas, Nova, Pulse, Voice, Forge, Sentinel, and Sage are standing by.
      </p>
      <p className="mt-3 text-base leading-relaxed text-gray-300">
        While you focus on running your business,
        <br />
        we&apos;ll focus on growing it.
      </p>
      <p className="mt-3 text-base font-semibold leading-relaxed text-gray-200">
        Welcome to Zorecho.
        <br />
        Welcome to your AI company.
      </p>

      <div className="mt-6 space-y-2 text-left">
        {firstWin && (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
            <span className="text-xl" aria-hidden="true">🏆</span>
            <span className="text-sm font-semibold text-emerald-200">{firstWin}</span>
          </div>
        )}
        {connected.map((c) => (
          <div
            key={c.key}
            className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3"
          >
            <c.Logo className="h-8 w-8" />
            <span className="text-sm font-semibold text-emerald-200">{c.name} connected ✓</span>
          </div>
        ))}
        {emailConnected && (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
            <span className="text-xl" aria-hidden="true">✉️</span>
            <span className="text-sm font-semibold text-emerald-200">
              Business email connected ✓ — Echo is watching your inbox.
            </span>
          </div>
        )}
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
        <div className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900 px-4 py-3">
          <span className="text-xl" aria-hidden="true">📞</span>
          <span className="text-sm text-gray-400">
            One more ability is waiting: the AI phone agent — &quot;I&apos;ll answer when you
            can&apos;t.&quot; Set it up any time in the Phone department, and I&apos;ll walk you
            through it.
          </span>
        </div>
      </div>

      <p className="mt-8 text-base font-semibold text-gray-200">
        Would you like a two-minute guided tour of your headquarters?
      </p>
      <div className="mt-4 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onEnterWithTour}
          disabled={finishing}
          className="w-full max-w-xs rounded-xl bg-amber-500 px-6 py-3 text-base font-bold text-gray-900 hover:bg-amber-600 disabled:opacity-50"
        >
          {finishing ? "Opening your dashboard…" : "Yes — show me around"}
        </button>
        <button
          type="button"
          onClick={onEnter}
          disabled={finishing}
          className="w-full max-w-xs rounded-xl border border-gray-700 px-6 py-3 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
        >
          {finishing ? "One moment…" : "No thanks — take me straight to my dashboard"}
        </button>
      </div>
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
