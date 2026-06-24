// EchoAI customer onboarding wizard.
//
// Shown automatically to any authenticated user who has not yet completed
// onboarding. Walks them through five sequential steps, persisting progress to
// the backend after each one so the flow is fully resumable. When the final
// step launches them into the app, `onComplete` is fired and the wizard never
// shows again.

import { useState } from "react";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import {
  useOnboardingProgress,
  ONBOARDING_STEPS,
  TOTAL_STEPS,
} from "./onboardingProgress.js";
import StepWelcome from "./steps/StepWelcome.jsx";
import StepFacebook from "./steps/StepFacebook.jsx";
import StepSubscription from "./steps/StepSubscription.jsx";
import StepBrandDiscovery from "./steps/StepBrandDiscovery.jsx";
import StepConfirmation from "./steps/StepConfirmation.jsx";

export default function OnboardingWizard({ onComplete }) {
  const { step, loading, error, goNext, goBack, finish } =
    useOnboardingProgress();

  // Track what the customer set up so the final summary is accurate.
  const [facebookConnected, setFacebookConnected] = useState(false);
  const [selectedTier, setSelectedTier] = useState(null);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Spinner label="Loading your setup…" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-indigo-50 to-white">
      <header className="border-b border-gray-100 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-4">
          <span className="text-lg font-extrabold tracking-tight text-indigo-600">
            EchoAI
          </span>
          <span className="text-sm text-gray-400">Setup</span>
        </div>
        <Stepper current={step} />
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-8">
        <div className="w-full max-w-2xl">
          <ErrorBanner message={error} />
          {step === 1 && <StepWelcome onNext={goNext} />}
          {step === 2 && (
            <StepFacebook
              onNext={goNext}
              onBack={goBack}
              onConnected={() => setFacebookConnected(true)}
            />
          )}
          {step === 3 && (
            <StepSubscription
              onNext={goNext}
              onBack={goBack}
              onSelectTier={setSelectedTier}
            />
          )}
          {step === 4 && <StepBrandDiscovery onNext={goNext} onBack={goBack} />}
          {step === 5 && (
            <StepConfirmation
              facebookConnected={facebookConnected}
              selectedTier={selectedTier}
              onLaunch={async () => {
                await finish();
                onComplete();
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function Stepper({ current }) {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-4">
      <ol className="flex items-center gap-2">
        {ONBOARDING_STEPS.map((s, i) => {
          const index = i + 1;
          const done = index < current;
          const active = index === current;
          return (
            <li key={s.key} className="flex flex-1 items-center gap-2">
              <span
                className={[
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  done
                    ? "bg-indigo-600 text-white"
                    : active
                    ? "border-2 border-indigo-600 text-indigo-600"
                    : "border border-gray-300 text-gray-400",
                ].join(" ")}
              >
                {done ? "✓" : index}
              </span>
              <span
                className={[
                  "hidden text-xs font-medium sm:inline",
                  active ? "text-indigo-600" : "text-gray-400",
                ].join(" ")}
              >
                {s.title}
              </span>
              {index < TOTAL_STEPS && (
                <span
                  className={[
                    "h-px flex-1",
                    done ? "bg-indigo-600" : "bg-gray-200",
                  ].join(" ")}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
