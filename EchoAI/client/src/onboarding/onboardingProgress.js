// Onboarding progress tracker.
//
// Loads the user's saved onboarding position from the backend on mount and
// persists every step change, so a customer who closes the browser mid-setup
// resumes exactly where they left off. The `onboarding_step` /
// `onboarding_completed` columns on the users table are the source of truth.

import { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";

// The five wizard steps, in order. The 1-based index of each entry is the value
// stored in users.onboarding_step.
export const ONBOARDING_STEPS = [
  { key: "welcome", title: "Welcome" },
  { key: "facebook", title: "Connect Facebook" },
  { key: "subscription", title: "Choose your plan" },
  { key: "brand", title: "Brand discovery" },
  { key: "launch", title: "Launch" },
];

export const TOTAL_STEPS = ONBOARDING_STEPS.length;

function clampStep(step) {
  const n = Number(step);
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(Math.trunc(n), 1), TOTAL_STEPS);
}

export function useOnboardingProgress() {
  const [step, setStep] = useState(1);
  const [completed, setCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Resume from the saved position.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const profile = await api.getProfile();
        if (!active) return;
        setStep(clampStep(profile.onboardingStep));
        setCompleted(Boolean(profile.onboardingCompleted));
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Advance to the next step and persist it to the backend.
  const goNext = useCallback(() => {
    setStep((current) => {
      const next = clampStep(current + 1);
      if (next !== current) {
        api.updateOnboarding({ onboardingStep: next }).catch((err) => {
          setError(err.message);
        });
      }
      return next;
    });
  }, []);

  // Go back a step (local only — the saved step never moves backwards).
  const goBack = useCallback(() => {
    setStep((current) => clampStep(current - 1));
  }, []);

  // Mark onboarding fully complete so the wizard never shows again.
  const finish = useCallback(async () => {
    await api.updateOnboarding({
      onboardingStep: TOTAL_STEPS,
      onboardingCompleted: true,
    });
    setCompleted(true);
  }, []);

  return { step, completed, loading, error, goNext, goBack, finish };
}
