import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { useVoice } from "../voice/VoiceContext.jsx";

// Drives the live AI marketing suggestions shown during Sales Presentation Mode.
//
// The PresenterOverlay calls present(suggestion) as it walks the prospect through
// each demo section; the EchoCompanion renders the active suggestion as a card
// with Accept / Dismiss and auto-opens so the prospect always sees it. Echo
// speaks the suggestion (and the accept/dismiss response) through the shared
// voice queue.
//
// phase: "presenting" (card shown, awaiting choice)
//      | "executing"  (accepted — Echo confirming + running animation)
//      | "done"       (execution animation finished, brief success state)
//      | "dismissed"  (declined — fading out)

const DemoSuggestionContext = createContext(null);

export function DemoSuggestionProvider({ children }) {
  const voice = useVoice();
  const [active, setActive] = useState(null); // the suggestion object
  const [phase, setPhase] = useState("idle");
  const timersRef = useRef([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  }, []);

  const after = useCallback((ms, fn) => {
    const t = setTimeout(fn, ms);
    timersRef.current.push(t);
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const speak = useCallback(
    (text, onPlayed) => {
      if (!voice || !voice.enqueue || !text) {
        if (onPlayed) onPlayed();
        return;
      }
      voice.enqueue(
        { type: "demo-suggestion", title: "Echo", text, onPlayed },
        { front: true },
      );
    },
    [voice],
  );

  // Show a suggestion card and have Echo pitch it. Safe to call repeatedly; a new
  // suggestion replaces the current one.
  const present = useCallback(
    (suggestion) => {
      if (!suggestion) return;
      clearTimers();
      setActive(suggestion);
      setPhase("presenting");
      speak(suggestion.text);
    },
    [clearTimers, speak],
  );

  const clear = useCallback(() => {
    clearTimers();
    setActive(null);
    setPhase("idle");
  }, [clearTimers]);

  const accept = useCallback(() => {
    if (!active) return;
    clearTimers();
    setPhase("executing");
    speak(active.acceptLine);
    // Let the "executing" animation run, then show the success state briefly.
    after(3200, () => setPhase("done"));
    after(6000, () => {
      setActive(null);
      setPhase("idle");
    });
  }, [active, clearTimers, speak, after]);

  const dismiss = useCallback(() => {
    if (!active) return;
    clearTimers();
    setPhase("dismissed");
    speak(active.dismissLine);
    after(1600, () => {
      setActive(null);
      setPhase("idle");
    });
  }, [active, clearTimers, speak, after]);

  const value = {
    active,
    phase,
    present,
    accept,
    dismiss,
    clear,
  };

  return (
    <DemoSuggestionContext.Provider value={value}>
      {children}
    </DemoSuggestionContext.Provider>
  );
}

export function useDemoSuggestions() {
  return useContext(DemoSuggestionContext) || {
    active: null,
    phase: "idle",
    present: () => {},
    accept: () => {},
    dismiss: () => {},
    clear: () => {},
  };
}
