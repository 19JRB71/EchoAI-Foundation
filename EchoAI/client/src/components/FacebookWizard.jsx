import { useState } from "react";
import { api } from "../api";

// Guided Facebook connection wizard. Walks the owner through what will happen
// before handing off to the real Facebook OAuth dialog (api.startFacebookOAuth →
// redirect). Illustrative step art keeps a non-technical owner oriented; the
// actual permission grant happens on Facebook.

const STEPS = [
  {
    title: "Log in to Facebook",
    body: "You'll be sent to Facebook to sign in securely. EchoAI never sees your password.",
    art: "login",
  },
  {
    title: "Choose your ad account",
    body: "Pick the ad account (and page) EchoAI's Atlas should manage for your ads.",
    art: "account",
  },
  {
    title: "Grant permissions",
    body: "Approve the permissions so Atlas can create and optimize campaigns on your behalf.",
    art: "permissions",
  },
  {
    title: "You're connected",
    body: "Atlas can now launch and manage Facebook ads. You approve anything that spends money.",
    art: "done",
  },
];

function StepArt({ art, color }) {
  const common = { className: "h-16 w-16", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.6, stroke: color };
  if (art === "login") {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l3 3m0 0l-3 3m3-3H2.25" />
      </svg>
    );
  }
  if (art === "account") {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    );
  }
  if (art === "permissions") {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

export default function FacebookWizard({ onClose }) {
  const [step, setStep] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const FB = "#1877f2";
  const isLast = step === STEPS.length - 1;
  const pct = Math.round(((step + 1) / STEPS.length) * 100);

  async function handleConnect() {
    setConnecting(true);
    setError("");
    try {
      const { authUrl } = await api.startFacebookOAuth();
      if (authUrl) {
        window.location.href = authUrl;
      } else {
        throw new Error("Couldn't start the Facebook connection.");
      }
    } catch (e) {
      setError(e.message || "Couldn't start the Facebook connection.");
      setConnecting(false);
    }
  }

  const s = STEPS[step];

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-700 bg-gray-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div className="h-1.5 w-full bg-gray-800">
          <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: FB }} />
        </div>

        <div className="p-6">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: FB }}>
              Connect Facebook · Step {step + 1} of {STEPS.length}
            </span>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300" aria-label="Close">
              ✕
            </button>
          </div>

          <div className="mt-6 flex flex-col items-center text-center">
            <div className="rounded-2xl bg-gray-900 p-4">
              <StepArt art={s.art} color={FB} />
            </div>
            <h3 className="mt-4 text-lg font-bold text-gray-100">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-400">{s.body}</p>
          </div>

          {/* Step dots */}
          <div className="mt-6 flex justify-center gap-2">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className="h-2 w-2 rounded-full transition"
                style={{ backgroundColor: i <= step ? FB : "#374151" }}
              />
            ))}
          </div>

          {error && (
            <div className="mt-4 rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</div>
          )}

          <div className="mt-6 flex items-center gap-3">
            {step > 0 && (
              <button
                onClick={() => setStep((n) => n - 1)}
                className="rounded-lg border border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800"
              >
                Back
              </button>
            )}
            {!isLast ? (
              <button
                onClick={() => setStep((n) => n + 1)}
                className="flex-1 rounded-lg py-2.5 text-sm font-bold text-white"
                style={{ backgroundColor: FB }}
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="flex-1 rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-60"
                style={{ backgroundColor: FB }}
              >
                {connecting ? "Opening Facebook…" : "Connect Facebook"}
              </button>
            )}
          </div>

          <p className="mt-4 text-center text-xs text-gray-500">
            Need a hand? Ask Echo — the assistant in the bottom-right corner.
          </p>
        </div>
      </div>
    </div>
  );
}
