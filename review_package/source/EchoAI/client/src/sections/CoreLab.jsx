/**
 * Conversational Core Lab — EXPERIMENTAL PROTOTYPE (admin/owner only).
 *
 * Private testing page for the Zorecho Conversational Core: speak or type
 * naturally to Echo, see the detected intent, confidence, route, tools called,
 * tool results, response time, approval flags and any errors/fallbacks — the
 * full flight-recorder trace for every turn.
 *
 * Fully isolated: the server keeps everything behind ENABLE_CONVERSATIONAL_CORE
 * (off by default) plus a one-click emergency disable. When disabled, this page
 * just shows the status — the normal Echo experience is never affected.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";

const TEST_PHRASES = [
  "Take me to Facebook setup.",
  "Open my calendar.",
  "Go to the leads page.",
  "Take me back to the dashboard.",
  "Did I get any important emails today?",
  "Which one should I answer first?",
  "What do I have tomorrow?",
  "How many leads came in today?",
  "Which leads still need follow-up?",
  "Write a Facebook post for tomorrow.",
  "Make it sound more professional.",
  "What should I focus on today?",
];

function fmtMs(ms) {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export default function CoreLab({ brandId, onNavigate }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState([]); // [{ me, trace }]
  const [speakReplies, setSpeakReplies] = useState(false);
  const [listening, setListening] = useState(false);
  const sessionIdRef = useRef(`corelab-${Date.now()}`);
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const logRef = useRef(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.coreLabStatus();
      setStatus(s);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load the Lab status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const sessionId = sessionIdRef.current;
    return () => {
      // Session memory is temporary by design — clear it when the Lab closes.
      api.coreLabEndSession(sessionId).catch(() => {});
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          /* noop */
        }
      }
    };
  }, [loadStatus]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [turns]);

  const playReply = useCallback(async (text) => {
    try {
      const blob = await api.echoVoiceSpeak(text);
      if (!audioRef.current) audioRef.current = new Audio();
      audioRef.current.src = URL.createObjectURL(blob);
      await audioRef.current.play();
    } catch {
      /* voice is best-effort in the Lab */
    }
  }, []);

  const send = useCallback(
    async (raw) => {
      const text = (raw != null ? raw : input).trim();
      if (!text || busy) return;
      setInput("");
      setBusy(true);
      setError("");
      try {
        const { trace } = await api.coreLabConverse(text, sessionIdRef.current, brandId);
        setTurns((t) => [...t, { me: text, trace }]);
        if (trace && trace.action && trace.action.type === "navigate" && onNavigate) {
          // Real navigation tool: the App executes and VERIFIES the section
          // change, reports the structured result to the server, and only the
          // verified result is spoken as completion. The reply here is only
          // "Opening … now." — in-progress language, never a completion claim.
          if (speakReplies && trace.reply) await playReply(trace.reply);
          onNavigate(trace.action, speakReplies);
          return;
        }
        if (speakReplies && trace && trace.reply) {
          if (trace.ack) await playReply(trace.ack);
          playReply(trace.reply);
        }
      } catch (err) {
        if (err.status === 503) {
          setError("The Conversational Core is disabled. Turn it on with ENABLE_CONVERSATIONAL_CORE=true (and re-enable below if it was emergency-stopped).");
          loadStatus();
        } else {
          setError(err.message || "That didn't go through.");
        }
      } finally {
        setBusy(false);
      }
    },
    [input, busy, brandId, speakReplies, playReply, loadStatus, onNavigate],
  );

  const startMic = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setError("This browser doesn't support microphone dictation — type instead.");
      return;
    }
    if (listening) {
      try {
        recognitionRef.current && recognitionRef.current.stop();
      } catch {
        /* noop */
      }
      setListening(false);
      return;
    }
    const rec = new SR();
    recognitionRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const said = e.results[0] && e.results[0][0] ? e.results[0][0].transcript : "";
      setListening(false);
      if (said) send(said);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }, [listening, send]);

  const emergencyDisable = useCallback(async () => {
    try {
      const s = await api.coreLabEmergencyDisable();
      setStatus(s);
    } catch (err) {
      setError(err.message || "Could not disable.");
    }
  }, []);

  const reEnable = useCallback(async () => {
    try {
      const s = await api.coreLabReEnable();
      setStatus(s);
    } catch (err) {
      setError(err.message || "Could not re-enable.");
    }
  }, []);

  if (loading) return <Spinner />;

  const enabled = status && status.enabled;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-300">
        Experimental Prototype — Not Production
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-900 p-4">
        <div>
          <h2 className="text-lg font-bold text-white">Conversational Core Lab</h2>
          <p className="text-sm text-gray-400">
            Speak naturally to Echo — intent, routing and tool calls are shown for every turn.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
            }`}
          >
            {enabled
              ? "Enabled"
              : status && !status.flagEnabled
                ? "Off (feature flag)"
                : "Emergency-disabled"}
          </span>
          {enabled ? (
            <button
              onClick={emergencyDisable}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
            >
              Emergency disable
            </button>
          ) : status && status.flagEnabled ? (
            <button
              onClick={reEnable}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              Re-enable
            </button>
          ) : null}
        </div>
      </div>

      {!enabled && status && !status.flagEnabled && (
        <div className="rounded-lg bg-gray-900 p-4 text-sm text-gray-300">
          The prototype is off by default. To turn it on, set the environment variable{" "}
          <code className="rounded bg-gray-800 px-1.5 py-0.5 text-teal-300">
            ENABLE_CONVERSATIONAL_CORE=true
          </code>{" "}
          and restart the server. The normal Echo experience is unchanged while this is off.
        </div>
      )}

      {status && !status.hermesConfigured && (
        <div className="rounded-lg bg-gray-900 p-3 text-xs text-amber-300">
          Hermes (the decision brain) isn't configured — every request will fall back to the
          existing command system.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div ref={logRef} className="max-h-[46vh] space-y-3 overflow-y-auto rounded-lg bg-gray-900 p-4">
        {turns.length === 0 && (
          <p className="text-sm text-gray-500">
            No turns yet. Try one of the test phrases below or use the microphone.
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="ml-auto max-w-[85%] rounded-lg bg-teal-600/20 px-3 py-2 text-sm text-teal-100">
              {t.me}
            </div>
            <div className="max-w-[92%] rounded-lg bg-gray-800 px-3 py-2">
              <p className="text-sm text-gray-100">{t.trace.reply}</p>
              {t.trace.requiresApproval && (
                <p className="mt-1 text-xs font-semibold text-amber-300">
                  Approval required — nothing was executed. {t.trace.approvalPreview}
                </p>
              )}
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 border-t border-gray-700 pt-2 text-[11px] text-gray-400 sm:grid-cols-3">
                <span>Intent: <b className="text-gray-300">{t.trace.intent || "—"}</b></span>
                <span>
                  Confidence:{" "}
                  <b className="text-gray-300">
                    {t.trace.confidence != null ? `${Math.round(t.trace.confidence * 100)}%` : "—"}
                  </b>
                </span>
                <span>Route: <b className="text-gray-300">{t.trace.route || "—"}</b></span>
                <span>Tool: <b className="text-gray-300">{t.trace.tool || "none"}</b></span>
                <span>Time: <b className="text-gray-300">{fmtMs(t.trace.totalMs)}</b></span>
                <span>
                  Fallback:{" "}
                  <b className={t.trace.fallback ? "text-amber-300" : "text-gray-300"}>
                    {t.trace.fallback ? "yes" : "no"}
                  </b>
                </span>
              </div>
              {t.trace.toolResult && (
                <details className="mt-1 text-[11px] text-gray-500">
                  <summary className="cursor-pointer">Tool result</summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-950 p-2">
                    {t.trace.toolResult}
                  </pre>
                </details>
              )}
              {t.trace.errors && t.trace.errors.length > 0 && (
                <p className="mt-1 text-[11px] text-red-400">{t.trace.errors.join(" · ")}</p>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <p className="text-xs text-gray-500">Echo is thinking…</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={startMic}
          disabled={!enabled || busy}
          title="Dictate with the microphone"
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            listening
              ? "bg-red-600 text-white"
              : "bg-gray-800 text-gray-300 hover:bg-gray-700"
          } disabled:opacity-40`}
        >
          {listening ? "Listening…" : "Mic"}
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={!enabled || busy}
          placeholder='Try: "Did I get any important emails today?"'
          className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-teal-500 focus:outline-none disabled:opacity-40"
        />
        <button
          onClick={() => send()}
          disabled={!enabled || busy || !input.trim()}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-40"
        >
          Send
        </button>
      </div>

      <label className="flex items-center gap-2 text-xs text-gray-400">
        <input
          type="checkbox"
          checked={speakReplies}
          onChange={(e) => setSpeakReplies(e.target.checked)}
        />
        Speak replies aloud (uses Echo's existing voice)
      </label>

      <div className="flex flex-wrap gap-2">
        {TEST_PHRASES.map((p) => (
          <button
            key={p}
            onClick={() => send(p)}
            disabled={!enabled || busy}
            className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs text-gray-300 hover:border-teal-500 hover:text-teal-300 disabled:opacity-40"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
