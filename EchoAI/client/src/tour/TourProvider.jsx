// Ties the tour system together: fetches the user's saved progress, auto-launches
// the welcome modal for brand-new users, renders the floating help button, and
// runs the TourEngine. Listens for a window "echoai:start-tour" event so other
// surfaces (e.g. Settings → Tour & Help) can restart the tour.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { buildTour, tourTypeForTier } from "./tourSteps.js";
import TourEngine from "./TourEngine.jsx";
import WelcomeModal from "./WelcomeModal.jsx";
import HelpButton from "./HelpButton.jsx";

const TOUR_LABELS = {
  starter: "Starter",
  pro: "Professional",
  enterprise: "Enterprise",
  admin: "Admin",
};

export default function TourProvider({ tier, isAdmin, businessName, onNavigate }) {
  const tourType = isAdmin ? "admin" : tourTypeForTier(tier);
  const steps = useMemo(() => buildTour(tourType), [tourType]);

  const [running, setRunning] = useState(false);
  const [startIndex, setStartIndex] = useState(0);
  const [showWelcome, setShowWelcome] = useState(false);
  const [status, setStatus] = useState(null); // saved row for this tourType, or null

  const tierKnown = isAdmin || Boolean(tier);

  // Load saved progress once the tier is known. Brand-new users (no saved row)
  // get the welcome modal automatically.
  useEffect(() => {
    if (!tierKnown) return;
    let active = true;
    (async () => {
      try {
        const res = await api.getTourStatus();
        if (!active) return;
        const saved = (res.tours && res.tours[tourType]) || null;
        setStatus(saved);
        if (!saved) setShowWelcome(true);
      } catch {
        /* tour status is non-critical — fail silently */
      }
    })();
    return () => {
      active = false;
    };
  }, [tierKnown, tourType]);

  // Resume an in-progress tour where the user left off (persists across devices);
  // a completed tour or a fresh start begins at step 0.
  const startTour = useCallback(() => {
    setShowWelcome(false);
    const canResume =
      status && !status.completed && Number.isInteger(status.currentStep);
    const resumeIndex = canResume
      ? Math.min(Math.max(status.currentStep, 0), steps.length - 1)
      : 0;
    setStartIndex(resumeIndex);
    setRunning(true);
  }, [status, steps.length]);

  // Allow other components to trigger the tour (Settings restart button).
  useEffect(() => {
    window.addEventListener("echoai:start-tour", startTour);
    return () => window.removeEventListener("echoai:start-tour", startTour);
  }, [startTour]);

  // Create the saved row when a new user dismisses the welcome, so it doesn't
  // auto-appear again on the next visit.
  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    api
      .saveTourProgress({ tourType, currentStep: 0, completed: false })
      .then((row) => setStatus(row))
      .catch(() => {});
  }, [tourType]);

  const handleStepChange = useCallback(
    (index) => {
      api
        .saveTourProgress({ tourType, currentStep: index, completed: false })
        .catch(() => {});
    },
    [tourType],
  );

  const handleComplete = useCallback(() => {
    setRunning(false);
    api
      .completeTour(tourType)
      .then((row) => setStatus(row))
      .catch(() => {});
  }, [tourType]);

  const handleClose = useCallback(() => {
    setRunning(false);
  }, []);

  return (
    <>
      {showWelcome && (
        <WelcomeModal
          businessName={businessName}
          tourLabel={TOUR_LABELS[tourType]}
          onStart={startTour}
          onSkip={dismissWelcome}
        />
      )}

      {running && steps.length > 0 && (
        <TourEngine
          steps={steps}
          startIndex={startIndex}
          onNavigate={onNavigate}
          onStepChange={handleStepChange}
          onComplete={handleComplete}
          onClose={handleClose}
        />
      )}

      <HelpButton onClick={startTour} />
    </>
  );
}
