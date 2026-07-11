// Step 4 — Brand discovery introduction.
// Explains the three-part brand discovery conversation, then launches the user
// directly into the conversation with the AI agent. Completing it advances the
// wizard.

import { useState } from "react";
import BrandDiscovery from "../../sections/BrandDiscovery.jsx";

const primaryBtn =
  "rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60";
const backBtn =
  "rounded-lg border border-gray-700 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:bg-gray-800";

export default function StepBrandDiscovery({ onNext, onBack }) {
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold text-gray-100">
        Let's get to know your brand
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-gray-400">
        For Zorecho to represent you authentically, it needs to understand who you
        are — your voice, your values, and the customers you serve. Next you'll
        have a short <span className="font-semibold">three-part conversation</span>{" "}
        with our AI brand agent.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-gray-400">
        There are no wrong answers — just answer naturally and honestly, the way
        you'd describe your business to a friend. The more real you are, the
        better Zorecho will sound like you.
      </p>

      {done ? (
        <div className="mt-6 rounded-lg bg-green-50 p-4 text-sm font-medium text-green-700">
          ✓ Brand profile complete. Zorecho now knows your voice.
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setStarted(true)}
          className={`${primaryBtn} mt-6`}
        >
          Begin brand discovery
        </button>
      )}

      <div className="mt-8 flex items-center justify-between">
        <button type="button" onClick={onBack} className={backBtn}>
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!done}
          className={primaryBtn}
        >
          Continue
        </button>
      </div>

      {started && !done && (
        <BrandDiscovery
          onClose={() => setStarted(false)}
          onComplete={() => {
            setStarted(false);
            setDone(true);
          }}
        />
      )}
    </div>
  );
}
