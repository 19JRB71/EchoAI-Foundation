import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";

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

export default function SetupAgent({ onClose }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);
  const [question, setQuestion] = useState(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  const [steps, setSteps] = useState([]);
  const [results, setResults] = useState({}); // key -> { status, detail }
  const [runningKey, setRunningKey] = useState(null);
  const [needsConnection, setNeedsConnection] = useState(null);

  const resultsRef = useRef({});
  resultsRef.current = results;
  const stepsRef = useRef([]);
  stepsRef.current = steps;

  const sessionId = session && session.sessionId;

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
          setError(err.message || "A setup step failed. You can retry.");
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
    [],
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
          setPhase("interview");
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

  async function submitAnswer(e) {
    e.preventDefault();
    if (!answer.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api.submitSetupAnswer(sessionId, answer.trim());
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
  }

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

  const shell = (children) => (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black text-white">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-8 md:px-8">{children}</div>
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

  const header = (
    <div className="mb-8 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Avatar />
        <div>
          <h1 className="text-xl font-bold md:text-2xl">EchoAI Setup Agent</h1>
          <p className="text-sm text-white/60">I&apos;ll set up your account for you.</p>
        </div>
      </div>
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
  );

  if (phase === "interview") {
    return shell(
      <>
        {header}
        <div className="flex flex-1 flex-col justify-center">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-10">
            <p className="text-2xl font-semibold leading-snug md:text-3xl">
              {question ? question.message : "…"}
            </p>
            {question && question.suggestion ? (
              <p className="mt-3 text-sm text-teal-300/80">{question.suggestion}</p>
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
                placeholder="Type your answer…"
                className="w-full resize-none rounded-xl border border-white/15 bg-black/40 p-4 text-lg text-white outline-none focus:border-teal-400"
              />
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

        {needsConnection ? (
          <div className="mt-6 rounded-2xl border border-sky-500/30 bg-sky-500/5 p-6">
            <h3 className="font-semibold text-sky-200">One quick approval needed</h3>
            <p className="mt-1 text-sm text-white/70">{needsConnection.detail}</p>
            <p className="mt-2 text-xs text-white/40">
              You&apos;ll approve this on Google&apos;s own secure page — EchoAI never sees your password.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={connectGoogle}
                disabled={busy}
                className="rounded-lg bg-sky-500 px-5 py-2.5 font-semibold text-black hover:bg-sky-400 disabled:opacity-50"
              >
                Connect Google Calendar
              </button>
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
        ) : null}

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
              Go to my dashboard
            </button>
          </div>
        ) : null}
      </div>
    </>,
  );
}
