import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useVoice } from "../voice/VoiceContext.jsx";

// Floating presenter toolbar shown (admin-only) while Sales Presentation Mode is
// live. Each step navigates the dashboard to the relevant section/department and
// has Echo speak the matching demo line. Reuses the existing Echo voice engine
// via useVoice().enqueue — no new audio pipeline.
export default function PresenterOverlay({ onNavigate, onOpenDepartment, onEnd }) {
  const voice = useVoice();
  const [script, setScript] = useState(null);
  const [error, setError] = useState("");
  const [activeStep, setActiveStep] = useState(null);
  const [minimized, setMinimized] = useState(false);

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

  function runStep(step) {
    setActiveStep(step.key);
    // Navigate straight to the section so the real demo data is on screen
    // (hot leads, live campaigns, ROI). Department-only steps open the hub.
    if (step.section && onNavigate) {
      onNavigate(step.section);
    } else if (step.department && onOpenDepartment) {
      onOpenDepartment(step.department);
    }
    const line = script && script.lines ? script.lines[step.speak] : null;
    if (line && voice && voice.enqueue) {
      voice.enqueue(
        { type: "demo", title: step.label, text: line },
        { front: true },
      );
    }
  }

  async function handleEnd() {
    try {
      await api.demoDeactivate();
    } catch {
      /* best-effort; overlay closes regardless */
    }
    if (voice && voice.stopAll) voice.stopAll();
    if (onEnd) onEnd();
  }

  const steps = (script && script.steps) || [];

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
          {script && script.businessName && (
            <span className="text-xs text-gray-400">{script.businessName}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {voice && voice.playing && (
            <button
              onClick={() => voice.skip && voice.skip()}
              className="rounded-md border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
            >
              Skip voice
            </button>
          )}
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
        <div className="flex flex-wrap gap-2">
          {steps.map((step, i) => (
            <button
              key={step.key}
              onClick={() => runStep(step)}
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
      )}
    </div>
  );
}
