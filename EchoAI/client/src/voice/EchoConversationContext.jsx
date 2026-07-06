/**
 * Echo Always-On Voice Conversation engine (owner-only).
 *
 * Makes Echo hands-free: it listens passively for the wake phrase "Hey Echo",
 * then runs a natural back-and-forth conversation with no button pressing.
 *
 * State machine (`convState`):
 *   passive    → listening for the wake word (background, low effort)
 *   active     → wake word heard; capturing the user's spoken message
 *   processing → thinking / calling Echo
 *   speaking   → Echo is replying (mic capture suspended to avoid feedback)
 *   (after speaking) → 30s follow-up window (still active) OR indefinite when
 *                       Echo asked a question; times out to a soft close → passive.
 *
 * Privacy: wake-word detection runs entirely in the browser via the Web Speech
 * API — no audio leaves the device for wake detection. A persisted mic-mute
 * (`echoai_mic_muted`) fully stops listening. Hands-free is opt-in
 * (`echoai_mic_optin`); we fall back to the existing push-to-talk button when
 * the browser can't do continuous listening or permission is denied.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVoice } from "./VoiceContext.jsx";
import { preloadEffects, playEffect } from "./sfx.js";
import {
  parseWakeWord,
  isQuestion,
  matchLocalIntent,
  matchNavIntent,
  matchMusicIntent,
} from "./conversationHelpers.js";

const EchoConversationContext = createContext(null);

// Short spoken acknowledgement for a music voice command.
function musicReply(music) {
  switch (music.action) {
    case "play":
      return music.value ? `Playing ${music.value}.` : "Starting some music.";
    case "pause":
      return "Paused.";
    case "resume":
      return "Back on.";
    case "skip":
      return "Skipping ahead.";
    case "stop":
      return "Music off.";
    case "volume":
      return music.value === "down" ? "Turning it down." : "Turning it up.";
    default:
      return "Done.";
  }
}

const MIC_MUTE_KEY = "echoai_mic_muted";
const MIC_OPTIN_KEY = "echoai_mic_optin";
// Finalize a spoken command after this much silence.
const ACTIVE_PAUSE_MS = 1600;
// How long Echo stays listening for a follow-up after a (non-question) reply.
const FOLLOWUP_MS = 30000;
// Safety cap so a muted/blocked TTS can never hang the conversation.
const SPEAK_SAFETY_MS = 90000;

function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function readBool(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeBool(key, val) {
  try {
    localStorage.setItem(key, val ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function EchoConversationProvider({ active, onNavigate, children }) {
  const voice = useVoice();
  const supported = useMemo(() => !!getSpeechRecognition(), []);

  const [micEnabled, setMicEnabled] = useState(() => readBool(MIC_OPTIN_KEY));
  const [muted, setMuted] = useState(() => readBool(MIC_MUTE_KEY));
  const [denied, setDenied] = useState(false);
  const [micLost, setMicLost] = useState(false);
  const [convState, setConvState] = useState("passive"); // passive|active|processing|speaking
  const [listeningText, setListeningText] = useState("");
  const [followupSeconds, setFollowupSeconds] = useState(null);
  // Show the warm permission prompt once, when an owner who hasn't opted in yet
  // and hasn't been asked this session lands in a browser that supports it.
  const [showPermission, setShowPermission] = useState(false);

  // ---- refs (avoid stale closures inside recognition callbacks) -----------
  const recognitionRef = useRef(null);
  const modeRef = useRef("passive"); // passive | active
  const suspendRef = useRef(false); // ignore results while processing/speaking
  const finalRef = useRef(""); // accumulated final transcript for active capture
  const pauseTimerRef = useRef(null);
  const followupTimerRef = useRef(null);
  const countdownRef = useRef(null);
  const restartTimerRef = useRef(null);
  const patienceRef = useRef(false); // user asked for a moment → no auto-close
  const commandHandlerRef = useRef(null);
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const runningRef = useRef(false); // is a recognition instance live?
  const enabledRef = useRef(micEnabled);
  const mutedRef = useRef(muted);
  const activeRef = useRef(active);
  const wantListeningRef = useRef(false); // should we be listening at all?
  useEffect(() => {
    enabledRef.current = micEnabled;
  }, [micEnabled]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const clearTimers = useCallback(() => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    if (followupTimerRef.current) clearTimeout(followupTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    pauseTimerRef.current = null;
    followupTimerRef.current = null;
    countdownRef.current = null;
    setFollowupSeconds(null);
  }, []);

  // ---- speaking ------------------------------------------------------------
  // Speak a line through the shared voice engine and resolve when it finishes.
  // If the speaker is muted / voice inactive, resolve immediately (skip audio).
  const speakAndWait = useCallback(
    (text) =>
      new Promise((resolve) => {
        if (!text) {
          resolve();
          return;
        }
        if (voice.muted || !active) {
          resolve();
          return;
        }
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        const safety = setTimeout(finish, SPEAK_SAFETY_MS);
        voice.enqueue({
          type: "echo_conversation",
          title: "Echo",
          text,
          onPlayed: () => {
            clearTimeout(safety);
            finish();
          },
        });
      }),
    [voice, active],
  );

  // ---- listening lifecycle -------------------------------------------------
  const stopRecognition = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    const rec = recognitionRef.current;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
      recognitionRef.current = null;
    }
    runningRef.current = false;
  }, []);

  // Forward declaration holder so callbacks can reference the latest starter.
  const startRecognitionRef = useRef(null);

  const scheduleRestart = useCallback(() => {
    if (restartTimerRef.current) return;
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      if (
        wantListeningRef.current &&
        enabledRef.current &&
        !mutedRef.current &&
        activeRef.current &&
        !runningRef.current
      ) {
        startRecognitionRef.current && startRecognitionRef.current();
      }
    }, 250);
  }, []);

  const processCommand = useCallback(
    async (raw) => {
      const text = (raw || "").trim();
      clearTimers();
      patienceRef.current = false;
      if (!text) {
        // Nothing captured — quietly reopen the follow-up window.
        modeRef.current = "active";
        suspendRef.current = false;
        setConvState("active");
        return;
      }
      setListeningText("");

      // Local intents handled without a server round-trip.
      const intent = matchLocalIntent(text);
      if (intent === "mute") {
        suspendRef.current = true;
        setConvState("speaking");
        await speakAndWait("Going quiet. Say Hey Echo whenever you need me.");
        playEffect("goodbye");
        // eslint-disable-next-line no-use-before-define
        muteMic();
        return;
      }
      if (intent === "patience") {
        patienceRef.current = true;
        suspendRef.current = true;
        setConvState("speaking");
        await speakAndWait("Take your time. I'm here when you're ready.");
        // Reopen active listening indefinitely (no countdown) for a moment.
        finalRef.current = "";
        modeRef.current = "active";
        suspendRef.current = false;
        setConvState("active");
        return;
      }

      // Music playback ("play some lofi", "pause the music", "skip", "louder").
      // Handled locally by nudging the MusicProvider via a window event.
      const music = matchMusicIntent(text);
      if (music) {
        window.dispatchEvent(
          new CustomEvent("echoai:music-command", { detail: music }),
        );
        suspendRef.current = true;
        setConvState("speaking");
        await speakAndWait(musicReply(music));
        // eslint-disable-next-line no-use-before-define
        openFollowupWindow();
        return;
      }

      // Client-side navigation ("take me to my leads").
      const navKey = matchNavIntent(text);
      if (navKey && onNavigateRef.current) {
        suspendRef.current = true;
        setConvState("speaking");
        onNavigateRef.current(navKey);
        await speakAndWait("Here you go.");
        // eslint-disable-next-line no-use-before-define
        openFollowupWindow();
        return;
      }

      // Everything else → Echo's existing message pipeline.
      suspendRef.current = true;
      setConvState("processing");
      playEffect("thinking", { volume: 0.35 });
      let reply = "";
      let asked = false;
      try {
        const handler = commandHandlerRef.current;
        const result = handler
          ? await handler(text)
          : { reply: "", isQuestion: false };
        reply = (result && result.reply) || "";
        asked = !!(result && result.isQuestion);
      } catch {
        reply = "I hit a snag on that one. Could you try again?";
      }
      if (!reply) {
        reply =
          "I want to make sure I understand you correctly. Could you rephrase that?";
        asked = true;
      }
      setConvState("speaking");
      await speakAndWait(reply);
      asked = asked || isQuestion(reply);
      // eslint-disable-next-line no-use-before-define
      openFollowupWindow(asked);
    },
    [clearTimers, speakAndWait],
  );

  // Reopen active listening after Echo speaks. When Echo asked a question we stay
  // open indefinitely; otherwise we run a 30s countdown then softly close.
  const openFollowupWindow = useCallback(
    (indefinite = false) => {
      clearTimers();
      finalRef.current = "";
      setListeningText("");
      modeRef.current = "active";
      suspendRef.current = false;
      setConvState("active");
      scheduleRestart();
      if (indefinite || patienceRef.current) return;
      let remaining = Math.round(FOLLOWUP_MS / 1000);
      setFollowupSeconds(remaining);
      countdownRef.current = setInterval(() => {
        remaining -= 1;
        setFollowupSeconds(remaining > 0 ? remaining : 0);
      }, 1000);
      followupTimerRef.current = setTimeout(async () => {
        clearTimers();
        // Soft close → back to passive wake-word listening.
        modeRef.current = "passive";
        suspendRef.current = false;
        setConvState("passive");
        playEffect("goodbye");
      }, FOLLOWUP_MS);
    },
    [clearTimers, scheduleRestart],
  );

  // Transition into active listening after the wake word (or a follow-up).
  const goActive = useCallback(
    async (initialCommand) => {
      clearTimers();
      finalRef.current = initialCommand || "";
      setListeningText(initialCommand || "");
      modeRef.current = "active";
      suspendRef.current = false;
      setConvState("active");
      playEffect("wake");
      // If the wake utterance already carried a command, give the user a beat to
      // keep talking, then finalize.
      if (initialCommand) {
        pauseTimerRef.current = setTimeout(() => {
          const captured = finalRef.current.trim();
          processCommand(captured);
        }, ACTIVE_PAUSE_MS);
      }
    },
    [clearTimers, processCommand],
  );

  const handleResult = useCallback(
    (event) => {
      if (suspendRef.current) return;
      let interim = "";
      let addedFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalRef.current = `${finalRef.current} ${chunk}`.trim();
          addedFinal = true;
        } else {
          interim += chunk;
        }
      }

      if (modeRef.current === "passive") {
        const combined = `${finalRef.current} ${interim}`.trim();
        const { matched, command } = parseWakeWord(combined);
        if (matched) {
          finalRef.current = "";
          goActive(command);
        }
        return;
      }

      // Active capture: show interim text and finalize after a natural pause.
      const shown = `${finalRef.current} ${interim}`.trim();
      setListeningText(shown);
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = setTimeout(() => {
        const captured = finalRef.current.trim();
        if (captured) processCommand(captured);
      }, ACTIVE_PAUSE_MS);
      // If nothing final has landed yet, keep waiting for the pause on interim.
      if (!addedFinal && !finalRef.current) {
        finalRef.current = "";
      }
    },
    [goActive, processCommand],
  );

  const startRecognition = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR || runningRef.current) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    rec.onresult = handleResult;
    rec.onerror = (e) => {
      const code = e && e.error;
      if (code === "not-allowed" || code === "service-not-allowed") {
        setDenied(true);
        wantListeningRef.current = false;
        stopRecognition();
        return;
      }
      if (code === "audio-capture") {
        // Mic disappeared mid-session — ask the user to re-grant.
        setMicLost(true);
      }
      // no-speech / aborted / network → let onend restart.
    };
    rec.onend = () => {
      runningRef.current = false;
      scheduleRestart();
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      runningRef.current = true;
      setDenied(false);
      setMicLost(false);
    } catch {
      runningRef.current = false;
      scheduleRestart();
    }
  }, [handleResult, scheduleRestart, stopRecognition]);
  startRecognitionRef.current = startRecognition;

  // Master listening controller: run recognition whenever we should be
  // listening (opted in, supported, not muted, provider active), else stop.
  useEffect(() => {
    const shouldListen = supported && micEnabled && !muted && active;
    wantListeningRef.current = shouldListen;
    if (shouldListen) {
      if (!runningRef.current) startRecognition();
    } else {
      // Not listening (muted, opted out, unsupported, or provider inactive):
      // tear down and reset to the passive baseline.
      clearTimers();
      stopRecognition();
      modeRef.current = "passive";
      suspendRef.current = false;
      setConvState("passive");
      setListeningText("");
    }
    return undefined;
  }, [supported, micEnabled, muted, active, startRecognition, stopRecognition, clearTimers]);

  // Preload the personality stings once we're active & opted in.
  useEffect(() => {
    if (micEnabled && active) {
      preloadEffects(["wake", "goodbye", "thinking"]);
    }
  }, [micEnabled, active]);

  // Full teardown on unmount.
  useEffect(
    () => () => {
      clearTimers();
      stopRecognition();
    },
    [clearTimers, stopRecognition],
  );

  // ---- public actions ------------------------------------------------------
  const muteMic = useCallback(() => {
    setMuted(true);
    writeBool(MIC_MUTE_KEY, true);
    clearTimers();
    modeRef.current = "passive";
    suspendRef.current = false;
    setListeningText("");
  }, [clearTimers]);

  const unmuteMic = useCallback(() => {
    setMuted(false);
    writeBool(MIC_MUTE_KEY, false);
    setConvState("passive");
  }, []);

  const enableHandsFree = useCallback(() => {
    setShowPermission(false);
    setMicEnabled(true);
    writeBool(MIC_OPTIN_KEY, true);
    setMuted(false);
    writeBool(MIC_MUTE_KEY, false);
  }, []);

  const declineHandsFree = useCallback(() => {
    setShowPermission(false);
    // Remember the choice so we don't nag on every login; the push-to-talk
    // button in the companion remains available.
    writeBool(MIC_OPTIN_KEY, false);
  }, []);

  // Toggle used by the TopBar mic button.
  const toggleMic = useCallback(() => {
    if (!supported) return;
    if (denied) {
      setShowPermission(true);
      return;
    }
    if (!micEnabled) {
      setShowPermission(true);
      return;
    }
    if (muted) unmuteMic();
    else muteMic();
  }, [supported, denied, micEnabled, muted, muteMic, unmuteMic]);

  const registerCommandHandler = useCallback((fn) => {
    commandHandlerRef.current = fn;
    return () => {
      if (commandHandlerRef.current === fn) commandHandlerRef.current = null;
    };
  }, []);

  // Offer the warm permission prompt on first eligible login.
  useEffect(() => {
    if (!supported || !active) return;
    let asked = false;
    try {
      asked = sessionStorage.getItem("echoai_mic_asked") === "1";
    } catch {
      /* ignore */
    }
    let optedInBefore = false;
    try {
      optedInBefore = localStorage.getItem(MIC_OPTIN_KEY) !== null;
    } catch {
      /* ignore */
    }
    if (!micEnabled && !asked && !optedInBefore) {
      setShowPermission(true);
      try {
        sessionStorage.setItem("echoai_mic_asked", "1");
      } catch {
        /* ignore */
      }
    }
  }, [supported, active, micEnabled]);

  // Morning flow: after the briefing finishes, Echo asks what to tackle first and
  // enters active listening — wired via a window event dispatched by VoiceContext.
  useEffect(() => {
    if (!active) return undefined;
    const onBriefingDone = async () => {
      if (!supported || !enabledRef.current || mutedRef.current) return;
      suspendRef.current = true;
      setConvState("speaking");
      await speakAndWait("What would you like to tackle first today?");
      openFollowupWindow(true); // treat as a question → stay open
    };
    window.addEventListener("echo:briefing-done", onBriefingDone);
    return () => window.removeEventListener("echo:briefing-done", onBriefingDone);
  }, [active, supported, speakAndWait, openFollowupWindow]);

  // Derived surface state for the UI.
  const micState = !supported
    ? "unsupported"
    : denied
      ? "denied"
      : !micEnabled
        ? "off"
        : muted
          ? "muted"
          : convState; // passive | active | processing | speaking

  const value = useMemo(
    () => ({
      supported,
      micEnabled,
      muted,
      denied,
      micLost,
      micState,
      convState,
      listeningText,
      followupSeconds,
      showPermission,
      toggleMic,
      enableHandsFree,
      declineHandsFree,
      dismissPermission: declineHandsFree,
      registerCommandHandler,
      isConversing: micEnabled && !muted && convState !== "passive",
    }),
    [
      supported,
      micEnabled,
      muted,
      denied,
      micLost,
      micState,
      convState,
      listeningText,
      followupSeconds,
      showPermission,
      toggleMic,
      enableHandsFree,
      declineHandsFree,
      registerCommandHandler,
    ],
  );

  return (
    <EchoConversationContext.Provider value={value}>
      {children}
    </EchoConversationContext.Provider>
  );
}

export function useEchoConversation() {
  return useContext(EchoConversationContext) || null;
}
