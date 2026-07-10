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
import { preloadEffects, playEffect, stopEffect } from "./sfx.js";
import { preloadAcks, playAckNow } from "./acks.js";
import {
  parseWakeWord,
  isQuestion,
  matchAssistantIntent,
  matchLocalIntent,
  matchNavIntent,
  navConfirmation,
  navOfferQuestion,
  navLabel,
  matchYesNo,
  matchPermissionRetrieve,
  matchTransferIntent,
  BRIEF_SECTIONS,
  matchMusicIntent,
  matchInterruptIntent,
  matchTourCommand,
  matchBriefingIntent,
  matchBriefingStart,
  matchBriefingChoice,
  matchStatusIntent,
  matchBrandSwitch,
  matchLearnedPhrase,
  normalizeSpeech,
  CONFIDENCE_THRESHOLD,
  withTimeout,
} from "./conversationHelpers.js";
import {
  interruptAck,
  wakeAck,
  goQuietLine,
  takeYourTimeLine,
  tackleFirstQuestion,
  clarifyQuestion,
  briefingChoiceQuestion,
  musicAck,
  maybeFlourish,
} from "./phraseVariety.js";
import { api } from "../api.js";

const EchoConversationContext = createContext(null);

// Live brand context published by App.jsx (window.__echoaiBrands). The voice
// engine reads it at command time so briefings/status are scoped to the brand
// the dashboard is actually showing. Demo brand (Presentation Mode) is never
// treated as the active brand for briefings.
function activeBrandCtx() {
  const b = (typeof window !== "undefined" && window.__echoaiBrands) || {};
  const demo = Boolean(b.activeIsDemo);
  return {
    id: demo ? null : b.activeId || null,
    name: demo ? null : b.activeName || null,
    brands: Array.isArray(b.brands) ? b.brands : [],
  };
}

// A learned phrase maps to one of these canonical utterances, which the normal
// intent matchers below understand — so a learned phrase behaves exactly like
// saying the standard command.
const LEARNED_CANON = {
  stop: "stop",
  yes: "yes",
  no: "no",
  briefing: "catch me up",
  briefing_quick: "catch me up",
  status: "status report",
};

// Music command acknowledgements now come from phraseVariety.musicAck (varied,
// never the same line twice in a row).

const MIC_MUTE_KEY = "echoai_mic_muted";
const MIC_OPTIN_KEY = "echoai_mic_optin";
// Finalize a spoken command after this much silence.
const ACTIVE_PAUSE_MS = 900;
// When the recognizer delivers a FINAL result (it detected end of speech
// itself), commit much faster — the browser already decided you stopped.
const FINAL_PAUSE_MS = 450;
// How long Echo stays listening for a follow-up after a (non-question) reply.
const FOLLOWUP_MS = 30000;
// Safety cap so a muted/blocked TTS can never hang the conversation.
const SPEAK_SAFETY_MS = 90000;
// Keep the mic fully gated for this long AFTER Echo's audio ends so trailing
// audio / speaker echo can't retrigger recognition (Echo answering itself).
// Kept SHORT on purpose: every extra millisecond here is a deaf window where
// the owner's immediate reply is silently dropped — which reads as "Echo is
// ignoring me". 800ms covers speaker tail-off without eating quick answers.
const SPEAK_COOLDOWN_MS = 800;
// After Echo asks a question, ignore ALL speech for at least this long so Echo's
// own voice trailing off can't answer its own question. Also kept short — the
// owner usually answers a question right away.
const POST_QUESTION_MS = 1200;
// Hard ceilings on every awaited network / AI call inside processCommand. A
// hung request used to leave the engine suspended (deaf) forever — the single
// biggest cause of "Echo ignores me". On timeout the existing catch blocks
// speak the honest failure line and reopen listening.
const FETCH_TIMEOUT_MS = 20000; // simple data fetches (briefing/status text)
const AI_TIMEOUT_MS = 60000; // AI pipeline replies (Echo chat, assistant)
const OFFER_TIMEOUT_MS = 8000; // best-effort nav offers (generic fallback ok)
// If the engine has been suspended (processing/speaking) with NO audio playing
// for this long, something wedged — force-reset to passive so the mic can
// never silently stay dead. Belt-and-braces on top of the per-call timeouts.
const STUCK_SUSPEND_MS = 60000;

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

export function EchoConversationProvider({ active, children }) {
  const voice = useVoice();
  const supported = useMemo(() => !!getSpeechRecognition(), []);

  const [micEnabled, setMicEnabled] = useState(() => readBool(MIC_OPTIN_KEY));
  const [muted, setMuted] = useState(() => readBool(MIC_MUTE_KEY));
  const [denied, setDenied] = useState(false);
  const [micLost, setMicLost] = useState(false);
  const [convState, setConvState] = useState("passive"); // passive|active|processing|speaking
  // True only while a recognition instance is actually live and capturing —
  // drives the "mic is really hearing you right now" UI indicator.
  const [micLive, setMicLive] = useState(false);
  const [listeningText, setListeningText] = useState("");
  const [followupSeconds, setFollowupSeconds] = useState(null);
  // Show the warm permission prompt once, when an owner who hasn't opted in yet
  // and hasn't been asked this session lands in a browser that supports it.
  const [showPermission, setShowPermission] = useState(false);

  // ---- refs (avoid stale closures inside recognition callbacks) -----------
  const recognitionRef = useRef(null);
  const modeRef = useRef("passive"); // passive | active
  const suspendRef = useRef(false); // ignore results while processing/speaking
  const speakingRef = useRef(false); // Echo audio is playing (or in its cooldown)
  const speakingClearRef = useRef(null); // timer that lifts speakingRef post-cooldown
  const acceptInputAtRef = useRef(0); // ignore speech until this epoch-ms timestamp
  const finalRef = useRef(""); // accumulated final transcript for active capture
  const pauseTimerRef = useRef(null);
  const followupTimerRef = useRef(null);
  const countdownRef = useRef(null);
  const restartTimerRef = useRef(null);
  const patienceRef = useRef(false); // user asked for a moment → no auto-close
  const pendingBriefRef = useRef(null); // section-readout offer awaiting yes/no
  const pendingBriefingChoiceRef = useRef(false); // briefing-type question pending
  const interruptedRef = useRef(false); // a barge-in interrupt is being handled
  const morningStandbyRef = useRef(false); // greeted; briefing awaits go-ahead
  const pendingBrandOfferRef = useRef(null); // other-business briefing offer: { queue: [brands] }
  const pendingBrandPickRef = useRef(false); // "which business?" question pending
  const pendingTransferOfferRef = useRef(null); // live hot-lead handoff offer: { conversationId }
  const pendingPermissionRef = useRef(false); // Echo asked "do you have a moment?" — awaiting yes/no
  const learnedMapRef = useRef(new Map()); // normalized phrase -> learned action
  const misheardRef = useRef(null); // { text, at } awaiting a clarified repeat
  const clarifyRetryRef = useRef(false); // asked "say that again?" once already
  const confRef = useRef(null); // lowest recognizer confidence of the capture
  // Latest voice.stopAll, readable from stable callbacks (handleResult) without
  // adding the ever-changing `voice` object to their dependency lists.
  const stopAllRef = useRef(null);
  const commandHandlerRef = useRef(null);
  // Guided tour: while it's running, short answers ("yes", "next", "stop")
  // are routed to the tour instead of the normal command flow.
  const tourActiveRef = useRef(false);
  // Command generation counter. Every new command bumps it; every interrupt
  // ("Stop", "Cancel"...) bumps it too. In-flight command handlers snapshot the
  // generation at entry and bail after each await if it changed — so a stale
  // AI reply that lands AFTER a stop/new command is silently dropped instead
  // of being spoken. This is what makes Stop truly final (no ghost replies).
  const cmdGenRef = useRef(0);

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

  // Load the owner's learned speech patterns once so familiar phrases match
  // instantly. Failures are silent — Echo just runs on built-in matching.
  useEffect(() => {
    let cancelled = false;
    api
      .echoVoiceGetLearnedPhrases()
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.phrases)) return;
        const map = new Map();
        for (const row of data.phrases) {
          if (row && row.phrase && row.action) map.set(row.phrase, row.action);
        }
        learnedMapRef.current = map;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Gate the mic while Echo is speaking — for ANY Echo audio (morning/weekly
  // briefings, real-time alerts, conversation replies), driven by the shared TTS
  // lifecycle events. `isSpeaking` (speakingRef) flips true when audio starts and
  // stays true for SPEAK_COOLDOWN_MS after it ends, so trailing audio / speaker
  // echo can never feed back into recognition and make Echo talk to itself.
  useEffect(() => {
    const onSpeakStart = () => {
      if (speakingClearRef.current) {
        clearTimeout(speakingClearRef.current);
        speakingClearRef.current = null;
      }
      speakingRef.current = true;
      // Safety net: if the tts-end event is ever missed (browser/runtime
      // anomaly), force the gate back open after a hard cap so the mic can
      // never lock up and leave Echo permanently deaf.
      speakingClearRef.current = setTimeout(() => {
        speakingRef.current = false;
        speakingClearRef.current = null;
      }, SPEAK_SAFETY_MS);
    };
    const onSpeakEnd = () => {
      if (speakingClearRef.current) clearTimeout(speakingClearRef.current);
      speakingClearRef.current = setTimeout(() => {
        speakingRef.current = false;
        speakingClearRef.current = null;
      }, SPEAK_COOLDOWN_MS);
    };
    window.addEventListener("echoai:tts-start", onSpeakStart);
    window.addEventListener("echoai:tts-end", onSpeakEnd);
    return () => {
      window.removeEventListener("echoai:tts-start", onSpeakStart);
      window.removeEventListener("echoai:tts-end", onSpeakEnd);
      if (speakingClearRef.current) {
        clearTimeout(speakingClearRef.current);
        speakingClearRef.current = null;
      }
    };
  }, []);

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
  // Resolves with `true` only when playback ACTUALLY completed (onPlayed
  // fired); `false` when skipped (muted/inactive/empty) or the safety timeout
  // hit. Callers that need proof of playback (e.g. the morning briefing
  // delivered stamp) must check the result; everyone else can ignore it.
  const speakAndWait = useCallback(
    (text) =>
      new Promise((resolve) => {
        if (!text) {
          resolve(false);
          return;
        }
        if (voice.muted || !active) {
          resolve(false);
          return;
        }
        let done = false;
        const onStopped = () => finish(false);
        const finish = (played) => {
          if (done) return;
          done = true;
          clearTimeout(safety);
          window.removeEventListener("echoai:speech-stopped", onStopped);
          resolve(played);
        };
        const safety = setTimeout(() => finish(false), SPEAK_SAFETY_MS);
        // If the user hits the Stop button (or says "stop") the voice engine
        // fires this event — resolve IMMEDIATELY so the conversation flow
        // never hangs on the safety timeout after a manual stop.
        window.addEventListener("echoai:speech-stopped", onStopped);
        voice.enqueue({
          type: "echo_conversation",
          title: "Echo",
          text,
          onPlayed: () => {
            finish(true);
          },
          // Settles on EVERY terminal outcome (played/skipped/stopped/error).
          // Without this, a skipped or errored reply left the engine suspended
          // (deaf to all commands) until the 90s safety timeout — the biggest
          // cause of "Echo ignores me".
          onDone: (status) => {
            finish(status === "played");
          },
        });
      }),
    [voice, active],
  );

  // Keep the barge-in handler's stop hook pointing at the live voice engine.
  useEffect(() => {
    stopAllRef.current = voice && voice.stopAll ? voice.stopAll : null;
  }, [voice]);

  // CONVERSATION STATE MANAGER: tell the voice engine, synchronously, whether
  // Echo is mid-interaction — capturing a command, processing, speaking, or
  // holding the follow-up window. While busy, the queue HOLDS every proactive
  // item (Sage alerts, reminders, briefings); they play only once Echo is
  // fully idle again. Interactive items (conversation replies, tour lines,
  // wizard status) are never held.
  useEffect(() => {
    if (!voice || !voice.registerConversationBusyProbe) return undefined;
    voice.registerConversationBusyProbe(
      () =>
        modeRef.current !== "passive" ||
        suspendRef.current ||
        speakingRef.current,
    );
    return () => voice.registerConversationBusyProbe(null);
  }, [voice]);

  // PERMISSION-TO-SPEAK: tell the voice queue whether Echo can hear a spoken
  // answer right now. If the mic is unsupported, opted out, or muted, the
  // "do you have a moment?" handshake is impossible — the queue bypasses it and
  // delivers alerts directly instead of holding them for an answer that can't come.
  useEffect(() => {
    if (!voice || !voice.registerVoiceInputCapableProbe) return undefined;
    voice.registerVoiceInputCapableProbe(
      () => supported && enabledRef.current && !mutedRef.current,
    );
    return () => voice.registerVoiceInputCapableProbe(null);
  }, [voice, supported]);

  // The moment the engine returns to idle passive listening, ping the voice
  // queue so any held proactive items play immediately (instead of waiting on
  // the queue's 2s backstop poll).
  useEffect(() => {
    if (convState !== "passive") return;
    try {
      window.dispatchEvent(new CustomEvent("echoai:conversation-idle"));
    } catch {
      /* noop */
    }
  }, [convState]);

  // Track whether the guided tour is running (TourEngine announces itself),
  // and forward matched tour commands back to it.
  useEffect(() => {
    const onTourState = (e) => {
      tourActiveRef.current = !!(e && e.detail && e.detail.active);
    };
    window.addEventListener("echoai:tour-state", onTourState);
    return () => {
      window.removeEventListener("echoai:tour-state", onTourState);
      tourActiveRef.current = false;
    };
  }, []);
  const dispatchTourCommand = useCallback((command) => {
    try {
      window.dispatchEvent(
        new CustomEvent("echoai:tour-command", { detail: { command } }),
      );
    } catch {
      /* noop */
    }
  }, []);

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
    setMicLive(false);
  }, []);

  // Forward declaration holder so callbacks can reference the latest starter.
  const startRecognitionRef = useRef(null);

  const shouldBeListening = useCallback(
    () =>
      wantListeningRef.current &&
      enabledRef.current &&
      !mutedRef.current &&
      activeRef.current &&
      !runningRef.current,
    [],
  );

  // Consecutive fast-failure streak (start() throws, or the engine dies within
  // a second of starting). Drives exponential backoff so a broken/blocked mic
  // can never hot-loop the recognizer; reset to 0 on any healthy session.
  const failStreakRef = useRef(0);
  const lastStartAtRef = useRef(0);

  // Fallback restart with a short delay — used when an immediate restart isn't
  // safe (start() threw, or the engine is dying instantly on every start).
  // Backs off with the failure streak but NEVER beyond 1 second — the promise
  // to the owner is that the mic is back within a second of any stop.
  const scheduleRestart = useCallback(() => {
    if (restartTimerRef.current) return;
    const delay = Math.min(100 * 2 ** failStreakRef.current, 1000);
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      if (shouldBeListening()) {
        startRecognitionRef.current && startRecognitionRef.current();
      }
    }, delay);
  }, [shouldBeListening]);

  // Restart with zero delay. The Web Speech engine stops itself regularly
  // (silence timeouts, ~60s session caps); any restart delay is a deaf window
  // where "Hey Echo" — or the start of a command — is silently lost, which is
  // exactly the "I have to repeat myself" bug. Restart synchronously from
  // onend; scheduleRestart remains as the retry path if start() throws.
  const restartNow = useCallback(() => {
    if (shouldBeListening()) {
      startRecognitionRef.current && startRecognitionRef.current();
    }
  }, [shouldBeListening]);

  // Remember a previously-misheard phrase once its repeat resolves to a known
  // action, so next time the owner's own wording works on the first try.
  const maybeLearn = useCallback((action, matchedText) => {
    const miss = misheardRef.current;
    misheardRef.current = null;
    clarifyRetryRef.current = false;
    if (!miss || Date.now() - miss.at > 45000) return;
    const phrase = normalizeSpeech(miss.text);
    if (!phrase || phrase.length < 2 || phrase.split(" ").length > 6) return;
    if (phrase === normalizeSpeech(matchedText || "")) return;
    learnedMapRef.current.set(phrase, action);
    api.echoVoiceLearnPhrase(phrase, action).catch(() => {});
  }, []);

  const processCommand = useCallback(
    async (raw) => {
      let text = (raw || "").trim();
      // Claim a fresh command generation: any older in-flight command becomes
      // stale (its late reply is dropped), and an interrupt bumping the counter
      // makes THIS command stale too. Checked after every await below.
      cmdGenRef.current += 1;
      const gen = cmdGenRef.current;
      const stale = () => gen !== cmdGenRef.current;
      clearTimers();
      // The command is snapshotted — clear the capture buffer NOW so no part
      // of this utterance can leak into (or replay as) the next command.
      finalRef.current = "";
      patienceRef.current = false;
      // The owner sometimes re-says the wake phrase mid-conversation ("Hey
      // Echo, open my leads" while already active). Strip it so the matchers
      // and the AI see only the actual command — otherwise the stale prefix
      // can make Echo answer the wrong thing or re-greet instead of acting.
      const wake = parseWakeWord(text);
      if (wake.matched) text = wake.command;
      // Snapshot + reset the capture confidence so it can't leak into the
      // next command.
      const captureConf = confRef.current;
      confRef.current = null;

      // ---- brand helpers (hoisted; used by several handlers below) --------
      // Deliver a single brand's briefing, then (when more businesses remain
      // in the queue) offer the next one — the redesign's "one business at a
      // time" briefing flow.
      async function deliverBrandBriefing(brand, restQueue) {
        suspendRef.current = true;
        setConvState("processing");
        playEffect("thinking", { volume: 0.35 });
        let brief = "";
        try {
          const b = await withTimeout(
            api.echoVoiceGetBriefing(brand.brand_id),
            FETCH_TIMEOUT_MS,
          );
          brief = (b && b.text) || "";
        } catch {
          brief = "";
        }
        if (stale()) return;
        if (!brief)
          brief = `I couldn't pull the update for ${brand.brand_name} just now, Sir.`;
        setConvState("speaking");
        const rest = Array.isArray(restQueue) ? restQueue : [];
        if (rest.length) {
          await speakAndWait(
            `${brief} Want to hear how ${rest[0].brand_name} is doing?`,
          );
          if (stale()) return;
          pendingBrandOfferRef.current = { queue: rest };
          // eslint-disable-next-line no-use-before-define
          openFollowupWindow(true);
        } else {
          await speakAndWait(brief);
          if (stale()) return;
          // eslint-disable-next-line no-use-before-define
          openFollowupWindow();
        }
      }
      // Point the whole dashboard at another business and confirm out loud.
      // App.jsx validates the id, updates every section, and persists the
      // choice server-side.
      async function switchToBrand(brand) {
        try {
          window.dispatchEvent(
            new CustomEvent("echoai:switch-brand", {
              detail: { brandId: brand.brand_id },
            }),
          );
        } catch {
          /* noop */
        }
        suspendRef.current = true;
        setConvState("speaking");
        await speakAndWait(
          `You got it, Sir — switching over to ${brand.brand_name}. Say "catch me up" whenever you want the rundown.`,
        );
        if (stale()) return;
        // eslint-disable-next-line no-use-before-define
        openFollowupWindow();
      }
      if (!text) {
        // Nothing captured — quietly reopen the follow-up window.
        modeRef.current = "active";
        suspendRef.current = false;
        setConvState("active");
        return;
      }
      setListeningText("");
      // The owner spoke a REAL command → lift the login-silence hold so pending
      // alerts / the weekly auto-briefing may now be delivered. Deliberately
      // fired here (not on the bare wake match in goActive): a misheard wake
      // phrase alone must never unleash auto-spoken content — that was the
      // "Echo randomly starts talking about things I never asked" bug.
      try {
        window.dispatchEvent(new CustomEvent("echoai:user-initiated"));
      } catch {
        /* noop */
      }

      // Learned speech patterns: if the owner has taught Echo this exact
      // phrase, rewrite it to the canonical command it maps to and bump its
      // usage count so strong habits rank first.
      const learnedAction = matchLearnedPhrase(text, learnedMapRef.current);
      if (learnedAction && LEARNED_CANON[learnedAction]) {
        api
          .echoVoiceLearnPhrase(normalizeSpeech(text), learnedAction)
          .catch(() => {});
        text = LEARNED_CANON[learnedAction];
      }

      // Interrupt commands ("Stop", "Cancel", "Never mind", "Wait", "That's
      // enough") — acknowledge and return to listening. Mid-speech barge-ins
      // are caught earlier in handleResult; this covers the same words spoken
      // while Echo is quietly listening.
      if (matchInterruptIntent(text)) {
        maybeLearn("stop", text);
        pendingBriefRef.current = null;
        pendingBriefingChoiceRef.current = false;
        pendingBrandOfferRef.current = null;
        pendingBrandPickRef.current = false;
        pendingTransferOfferRef.current = null;
        pendingPermissionRef.current = false;
        suspendRef.current = true;
        setConvState("speaking");
        await speakAndWait(interruptAck());
        // eslint-disable-next-line no-use-before-define
        openFollowupWindow();
        return;
      }

      // Local intents handled without a server round-trip.
      const intent = matchLocalIntent(text);
      if (intent === "mute") {
        pendingBriefRef.current = null;
        pendingBriefingChoiceRef.current = false;
        pendingBrandOfferRef.current = null;
        pendingBrandPickRef.current = false;
        pendingTransferOfferRef.current = null;
        suspendRef.current = true;
        setConvState("speaking");
        await speakAndWait(goQuietLine());
        playEffect("goodbye");
        // eslint-disable-next-line no-use-before-define
        muteMic();
        return;
      }
      if (intent === "patience") {
        patienceRef.current = true;
        suspendRef.current = true;
        setConvState("speaking");
        await speakAndWait(takeYourTimeLine());
        if (stale()) return;
        // Reopen active listening indefinitely (no countdown) for a moment.
        finalRef.current = "";
        modeRef.current = "active";
        suspendRef.current = false;
        setConvState("active");
        return;
      }

      // PERMISSION-TO-SPEAK: Echo asked "Excuse me Sir, do you have a moment?"
      // and is waiting. "Yes" lets the held alert(s) through; "not now"/"no"
      // stands him down (VoiceContext speaks "Of course Sir…") and holds them
      // until the owner asks; anything else is a real command — hold the alert
      // quietly and process the command normally. A clear nav/music command
      // always counts as "something else", never a yes.
      if (pendingPermissionRef.current) {
        pendingPermissionRef.current = false;
        const answer =
          matchNavIntent(text) || matchMusicIntent(text)
            ? null
            : matchYesNo(text);
        if (answer === "yes") {
          maybeLearn("yes", text);
          try {
            window.dispatchEvent(
              new CustomEvent("echoai:permission-answer", {
                detail: { answer: "yes" },
              }),
            );
          } catch {
            /* noop */
          }
          // Echo stays quiet — VoiceContext delivers the held alert now.
          modeRef.current = "passive";
          suspendRef.current = false;
          setConvState("passive");
          return;
        }
        if (answer === "no") {
          maybeLearn("no", text);
          try {
            window.dispatchEvent(
              new CustomEvent("echoai:permission-answer", {
                detail: { answer: "no" },
              }),
            );
          } catch {
            /* noop */
          }
          // VoiceContext speaks the stand-down line and keeps the alert queued.
          modeRef.current = "passive";
          suspendRef.current = false;
          setConvState("passive");
          return;
        }
        // Neither yes nor no → silently hold the alert; fall through so their
        // actual command (below) is handled as usual.
        try {
          window.dispatchEvent(
            new CustomEvent("echoai:permission-answer", {
              detail: { answer: "other" },
            }),
          );
        } catch {
          /* noop */
        }
      }

      // A live hot-lead handoff offer is pending — Echo asked "Want me to
      // transfer them to you, or keep handling it?" during a live autonomous
      // conversation. "Transfer it" hands the lead to the owner; "keep handling
      // it" leaves Echo running it. A clear new command always wins.
      if (pendingTransferOfferRef.current) {
        const offer = pendingTransferOfferRef.current;
        pendingTransferOfferRef.current = null;
        const answer =
          matchNavIntent(text) || matchMusicIntent(text)
            ? null
            : matchTransferIntent(text);
        if (answer === "transfer") {
          maybeLearn("yes", text);
          suspendRef.current = true;
          setConvState("processing");
          try {
            await api.transferAutonomousConversation(offer.conversationId);
            if (stale()) return;
            setConvState("speaking");
            await speakAndWait(
              "Done, Sir — you're in control of that conversation now. I'll stay out of it until you hand it back to me.",
            );
          } catch {
            if (stale()) return;
            setConvState("speaking");
            await speakAndWait(
              "I couldn't complete the transfer just now, Sir. You can take it over from the dashboard.",
            );
          }
          if (stale()) return;
          // eslint-disable-next-line no-use-before-define
          openFollowupWindow();
          return;
        }
        if (answer === "continue") {
          maybeLearn("no", text);
          suspendRef.current = true;
          setConvState("speaking");
          await speakAndWait(
            "Understood, Sir. I'll keep handling it and let you know the moment anything changes.",
          );
          if (stale()) return;
          // eslint-disable-next-line no-use-before-define
          openFollowupWindow();
          return;
        }
        // Neither → fall through and treat it as a brand-new command.
      }

      // A "want to hear another business?" offer is pending after a per-brand
      // briefing. Yes plays the next business's briefing; a clear new command
      // always wins over the pending offer.
      if (pendingBrandOfferRef.current) {
        const offer = pendingBrandOfferRef.current;
        pendingBrandOfferRef.current = null;
        const answer =
          matchNavIntent(text) || matchMusicIntent(text)
            ? null
            : matchYesNo(text);
        if (answer === "no") {
          maybeLearn("no", text);
          modeRef.current = "passive";
          suspendRef.current = false;
          setConvState("passive");
          return;
        }
        if (answer === "yes") {
          maybeLearn("yes", text);
          const queue = Array.isArray(offer.queue) ? offer.queue : [];
          const next = queue[0];
          if (next) {
            await deliverBrandBriefing(next, queue.slice(1));
            return;
          }
          modeRef.current = "passive";
          suspendRef.current = false;
          setConvState("passive");
          return;
        }
        // Neither yes nor no → treat it as a new command below.
      }

      // Echo asked "which business would you like?" — try the utterance as a
      // bare business name first; anything else falls through as a command.
      if (pendingBrandPickRef.current) {
        pendingBrandPickRef.current = false;
        pendingTransferOfferRef.current = null;
        const ctx = activeBrandCtx();
        const picked = matchBrandSwitch(`switch to ${text}`, ctx.brands);
        if (picked && picked.brand) {
          if (String(picked.brand.brand_id) !== String(ctx.id)) {
            await switchToBrand(picked.brand);
            return;
          }
          suspendRef.current = true;
          setConvState("speaking");
          await speakAndWait(
            `You're already on ${picked.brand.brand_name}, Sir.`,
          );
          if (stale()) return;
          // eslint-disable-next-line no-use-before-define
          openFollowupWindow();
          return;
        }
        // Not a recognizable business name → handle as a normal command.
      }

      // A section-readout offer is pending ("Want me to read the highlights?").
      // Interpret yes/no; anything else falls through as a brand-new command.
      if (pendingBriefRef.current) {
        const pending = pendingBriefRef.current;
        pendingBriefRef.current = null;
        // A clear new command ("take me to settings", "play some jazz") always
        // wins over the pending offer — never treat it as a yes/no answer.
        const answer =
          matchNavIntent(text) || matchMusicIntent(text)
            ? null
            : matchYesNo(text);
        if (answer === "no") {
          maybeLearn("no", text);
          // The owner declined — stay quiet and go back to passive listening.
          modeRef.current = "passive";
          suspendRef.current = false;
          setConvState("passive");
          return;
        }
        if (answer === "yes") {
          maybeLearn("yes", text);
          suspendRef.current = true;
          setConvState("processing");
          playEffect("thinking", { volume: 0.35 });
          let brief = "";
          if (pending.briefSection) {
            // Data-backed readout composed server-side from real numbers.
            try {
              const data = await withTimeout(
                api.getEchoSectionBrief(
                  pending.briefSection,
                  activeBrandCtx().id || undefined,
                ),
                FETCH_TIMEOUT_MS,
              );
              brief = (data && data.text) || "";
            } catch {
              brief = "";
            }
          }
          if (stale()) return;
          if (!brief) {
            // Generic sections (or a failed fetch) → Echo's normal AI pipeline.
            try {
              const handler = commandHandlerRef.current;
              const result = handler
                ? await withTimeout(
                    handler(
                      `Give me a short spoken summary of ${pending.label || "this section"}. Only mention real data you actually have — if you don't have live numbers, briefly explain what this section is for instead.`,
                    ),
                    AI_TIMEOUT_MS,
                  )
                : null;
              brief = (result && result.reply) || "";
            } catch {
              brief = "";
            }
          }
          if (stale()) return;
          if (!brief) brief = "I couldn't pull that up just now.";
          setConvState("speaking");
          await speakAndWait(brief);
          if (stale()) return;
          // eslint-disable-next-line no-use-before-define
          openFollowupWindow();
          return;
        }
        // Neither yes nor no → treat it as a new command below.
      }

      // PERMISSION-TO-SPEAK retrieval: "Hey Echo, what did you need?" — the
      // owner is circling back to an alert they deferred earlier. Ask
      // VoiceContext to release it now. Harmless when nothing is held.
      if (matchPermissionRetrieve(text)) {
        maybeLearn("yes", text);
        try {
          window.dispatchEvent(new CustomEvent("echoai:permission-retrieve"));
        } catch {
          /* noop */
        }
        modeRef.current = "passive";
        suspendRef.current = false;
        setConvState("passive");
        return;
      }

      // The briefing-type question is pending ("full, quick, or specific?").
      // A clear new nav/music command always wins over the pending question.
      if (pendingBriefingChoiceRef.current) {
        pendingBriefingChoiceRef.current = false;
        if (!matchNavIntent(text) && !matchMusicIntent(text)) {
          const choice = matchBriefingChoice(text);
          if (choice === "none") {
            // Declined — stay quiet and return to passive listening.
            modeRef.current = "passive";
            suspendRef.current = false;
            setConvState("passive");
            return;
          }
          suspendRef.current = true;
          setConvState("processing");
          playEffect("thinking", { volume: 0.35 });
          let brief = "";
          if (choice === "full") {
            // Full briefing → the server-built status update, scoped to the
            // business the dashboard is currently on.
            try {
              const data = await withTimeout(
                api.echoVoiceGetStatus(activeBrandCtx().id || undefined),
                FETCH_TIMEOUT_MS,
              );
              brief = (data && data.text) || "";
            } catch {
              brief = "";
            }
          }
          if (stale()) return;
          if (!brief) {
            // Quick summary or a specific business/topic → Echo's AI pipeline
            // (also the fallback if the full-status fetch failed).
            const prompt =
              choice === "quick"
                ? "Give me a quick spoken summary of only the most important things across my businesses right now. Only mention real data you actually have — never invent numbers."
                : choice === "full"
                  ? "Give me a full spoken briefing covering all of my businesses. Only mention real data you actually have — never invent numbers."
                  : `The owner asked for a specific spoken update: "${text}". Answer using only real data you actually have — never invent numbers.`;
            try {
              const handler = commandHandlerRef.current;
              const result = handler
                ? await withTimeout(handler(prompt), AI_TIMEOUT_MS)
                : null;
              brief = (result && result.reply) || "";
            } catch {
              brief = "";
            }
          }
          if (stale()) return;
          if (!brief) brief = "I couldn't pull that together just now, Sir.";
          setConvState("speaking");
          await speakAndWait(brief);
          if (stale()) return;
          // eslint-disable-next-line no-use-before-define
          openFollowupWindow();
          return;
        }
        // A new nav/music command → fall through and handle it normally.
      }

      // Morning standby: Echo greeted the owner and is waiting for an explicit
      // go-ahead. Any briefing request / start phrase / short go-ahead bark
      // ("ready", "run it", "let's go") delivers the morning briefing NOW —
      // Echo never starts it on his own.
      if (morningStandbyRef.current && matchBriefingStart(text)) {
        morningStandbyRef.current = false;
        pendingBriefRef.current = null;
        pendingBriefingChoiceRef.current = false;
        pendingBrandOfferRef.current = null;
        pendingBrandPickRef.current = false;
        pendingTransferOfferRef.current = null;
        suspendRef.current = true;
        setConvState("processing");
        playEffect("thinking", { volume: 0.35 });
        // Brand-scoped briefing: cover ONLY the business the dashboard is on.
        // Other businesses are offered one at a time afterwards.
        const brandCtx = activeBrandCtx();
        const otherBrands = brandCtx.brands.filter(
          (b) => String(b.brand_id) !== String(brandCtx.id),
        );
        let brief = "";
        try {
          const b = await withTimeout(
            api.echoVoiceGetBriefing(brandCtx.id || undefined),
            FETCH_TIMEOUT_MS,
          );
          brief = (b && b.text) || "";
        } catch {
          brief = "";
        }
        if (stale()) return;
        if (brief) {
          setConvState("speaking");
          const played = await speakAndWait(brief);
          if (stale()) return;
          if (played) {
            // Mark delivered only after the owner actually heard it, so the
            // once-per-day server stamp is honest.
            api.echoVoiceMarkBriefingDelivered().catch(() => {});
            if (brandCtx.id && otherBrands.length) {
              // Offer the other businesses one at a time instead of the
              // generic "what to tackle first" hand-off.
              await speakAndWait(
                `That's ${brandCtx.name || "this business"}. Want to hear how ${otherBrands[0].brand_name} is doing?`,
              );
              if (stale()) return;
              pendingBrandOfferRef.current = { queue: otherBrands };
              // eslint-disable-next-line no-use-before-define
              openFollowupWindow(true);
              return;
            }
            // Same post-briefing hand-off as before: "What would you like to
            // tackle first today?" + open listening.
            try {
              window.dispatchEvent(new CustomEvent("echo:briefing-done"));
            } catch {
              /* noop */
            }
          } else {
            // Playback was muted/blocked/timed out — no honest delivery, so
            // stay in standby and let the owner ask again.
            morningStandbyRef.current = true;
          }
        } else {
          // Fetch failed — stay in standby so the owner can simply ask again.
          morningStandbyRef.current = true;
          setConvState("speaking");
          await speakAndWait(
            "I couldn't pull your briefing together just now, Sir. Say the word and I'll try again.",
          );
          if (stale()) return;
          // eslint-disable-next-line no-use-before-define
          openFollowupWindow(true);
        }
        return;
      }

      // Direct status request ("what we got", "status report") → read out the
      // current status for the ACTIVE business immediately, no follow-up
      // question. (Cross-business numbers live in the Portfolio view.)
      if (matchStatusIntent(text)) {
        maybeLearn("status", text);
        pendingBriefRef.current = null;
        pendingBriefingChoiceRef.current = false;
        pendingBrandOfferRef.current = null;
        pendingBrandPickRef.current = false;
        pendingTransferOfferRef.current = null;
        suspendRef.current = true;
        setConvState("processing");
        playEffect("thinking", { volume: 0.35 });
        let statusText = "";
        try {
          const data = await withTimeout(
            api.echoVoiceGetStatus(activeBrandCtx().id || undefined),
            FETCH_TIMEOUT_MS,
          );
          statusText = (data && data.text) || "";
        } catch {
          statusText = "";
        }
        if (stale()) return;
        if (!statusText)
          statusText = "I couldn't pull the current status just now, Sir.";
        setConvState("speaking");
        await speakAndWait(statusText);
        if (stale()) return;
        // eslint-disable-next-line no-use-before-define
        openFollowupWindow();
        return;
      }

      // On-demand briefing request ("give me my briefing", "catch me up").
      // Echo first asks which kind of briefing the owner wants.
      if (matchBriefingIntent(text)) {
        maybeLearn("briefing", text);
        pendingBriefRef.current = null;
        pendingBriefingChoiceRef.current = true;
        suspendRef.current = true;
        setConvState("speaking");
        await speakAndWait(briefingChoiceQuestion());
        if (stale()) return;
        // eslint-disable-next-line no-use-before-define
        openFollowupWindow(true);
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
        await speakAndWait(musicAck(music));
        if (stale()) return;
        // eslint-disable-next-line no-use-before-define
        openFollowupWindow();
        return;
      }

      // Brand switching by voice ("Hey Echo, switch to Blacor Homes").
      // Checked before nav/assistant so a real business name always wins; nav
      // phrases like "switch to settings" fall through because no brand
      // matches them. Only meaningful with more than one real business.
      {
        const ctx = activeBrandCtx();
        const sw =
          ctx.brands.length > 1 ? matchBrandSwitch(text, ctx.brands) : null;
        if (sw && sw.brand) {
          if (String(sw.brand.brand_id) === String(ctx.id)) {
            suspendRef.current = true;
            setConvState("speaking");
            await speakAndWait(
              `You're already on ${sw.brand.brand_name}, Sir.`,
            );
            if (stale()) return;
            // eslint-disable-next-line no-use-before-define
            openFollowupWindow();
            return;
          }
          await switchToBrand(sw.brand);
          return;
        }
        if (sw && sw.ask) {
          const names = ctx.brands.map((b) => b.brand_name).join(", ");
          pendingBrandPickRef.current = true;
          suspendRef.current = true;
          setConvState("speaking");
          await speakAndWait(
            `Which business would you like, Sir? You have ${names}.`,
          );
          if (stale()) return;
          // eslint-disable-next-line no-use-before-define
          openFollowupWindow(true);
          return;
        }
      }

      // Personal assistant ("remind me to call Robert at 2pm", "add a task",
      // "mark off number two", "what's on my task list"). Routed to the
      // dedicated AI-parsed assistant endpoint so it creates/completes real
      // reminders and tasks instead of just chatting about them. An explicit
      // navigation command ("take me to my task list") still wins below.
      if (!matchNavIntent(text) && matchAssistantIntent(text)) {
        suspendRef.current = true;
        setConvState("processing");
        playEffect("thinking", { volume: 0.35 });
        let reply = "";
        let asked = false;
        try {
          let timezone = "";
          try {
            timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
          } catch {
            /* default handled server-side */
          }
          const result = await withTimeout(
            api.echoAssistantCommand(text, timezone),
            AI_TIMEOUT_MS,
          );
          reply = (result && result.reply) || "";
          asked = !!(result && result.isQuestion);
        } catch {
          reply =
            "I couldn't reach your reminder list just now, Sir. Could you try that again in a moment?";
        }
        if (stale()) return;
        if (!reply) {
          reply = "Could you say that again with a bit more detail, Sir?";
          asked = true;
        }
        setConvState("speaking");
        await speakAndWait(reply);
        if (stale()) return;
        asked = asked || isQuestion(reply);
        try {
          window.dispatchEvent(new CustomEvent("echoai:assistant-updated"));
        } catch {
          /* noop */
        }
        // eslint-disable-next-line no-use-before-define
        openFollowupWindow(asked);
        return;
      }

      // Client-side navigation ("take me to my leads", "go to Atlas"). Dispatch
      // the shared navigate-section event the app listens for (App.jsx routes
      // plain section ids and "dept:<agent>" department keys), then verbally
      // confirm what we just opened.
      const navKey = matchNavIntent(text);
      if (navKey) {
        // eslint-disable-next-line no-console
        console.log(
          `[Echo voice] nav intent detected → "${navKey}" (from utterance: "${text}"); dispatching echoai:navigate-section`,
        );
        suspendRef.current = true;
        setConvState("speaking");
        try {
          window.dispatchEvent(
            new CustomEvent("echoai:navigate-section", { detail: navKey }),
          );
        } catch {
          /* noop */
        }
        // Navigate first, then ASK before reading anything. Actions (like the
        // Facebook connect flow) keep the plain confirmation with no offer.
        const offerFallback = navOfferQuestion(navKey);
        if (!offerFallback) {
          await speakAndWait(maybeFlourish(navConfirmation(navKey)));
          if (stale()) return;
          // eslint-disable-next-line no-use-before-define
          openFollowupWindow();
          return;
        }
        const briefSection = BRIEF_SECTIONS[navKey] || null;
        let question = offerFallback;
        if (briefSection) {
          // Data-backed offer with real counts ("You have 12 leads, including
          // 3 hot leads."); fall back to the generic question on any failure.
          try {
            const data = await withTimeout(
              api.getEchoSectionOffer(briefSection, activeBrandCtx().id || undefined),
              OFFER_TIMEOUT_MS,
            );
            if (data && data.question) question = data.question;
          } catch {
            /* keep the generic question */
          }
        }
        if (stale()) return;
        pendingBriefRef.current = {
          navKey,
          briefSection,
          label: navLabel(navKey),
        };
        await speakAndWait(question);
        if (stale()) return;
        // eslint-disable-next-line no-use-before-define
        openFollowupWindow(true);
        return;
      }

      // Nothing matched. If the recognizer itself wasn't confident about a
      // short utterance, ask for clarification naturally instead of guessing —
      // and remember the phrase if the clarified repeat resolves to an action.
      if (
        !clarifyRetryRef.current &&
        typeof captureConf === "number" &&
        captureConf < CONFIDENCE_THRESHOLD &&
        text.split(" ").length <= 5
      ) {
        misheardRef.current = { text, at: Date.now() };
        clarifyRetryRef.current = true;
        suspendRef.current = true;
        setConvState("speaking");
        await speakAndWait(clarifyQuestion());
        if (stale()) return;
        // eslint-disable-next-line no-use-before-define
        openFollowupWindow(true);
        return;
      }
      misheardRef.current = null;
      clarifyRetryRef.current = false;

      // Everything else → Echo's existing message pipeline. Play an instant
      // spoken ack ("Got it, Sir.") the moment the command lands so the user
      // hears a response while the AI reply is still generating; fall back to
      // the thinking sting when no ack blob is cached yet.
      suspendRef.current = true;
      setConvState("processing");
      if (!playAckNow()) playEffect("thinking", { volume: 0.35 });
      let reply = "";
      let asked = false;
      // Streaming: the handler may speak sentences AS they generate. Each
      // partial goes straight into the ordered voice queue; we track the
      // resulting promises so the follow-up window only opens after the LAST
      // sentence finishes playing.
      const partialPlays = [];
      let streamedAny = false;
      const onPartial = (sentence) => {
        if (stale()) return;
        if (!streamedAny) {
          streamedAny = true;
          setConvState("speaking");
        }
        partialPlays.push(speakAndWait(sentence).catch(() => {}));
      };
      try {
        const handler = commandHandlerRef.current;
        const result = handler
          ? await withTimeout(handler(text, onPartial), AI_TIMEOUT_MS)
          : { reply: "", isQuestion: false };
        reply = (result && result.reply) || "";
        asked = !!(result && result.isQuestion);
      } catch {
        reply = streamedAny ? "" : "I hit a snag on that one. Could you try again?";
      }
      if (stale()) return;
      if (!reply && !streamedAny) {
        reply =
          "I want to make sure I understand you correctly. Could you rephrase that?";
        asked = true;
      }
      setConvState("speaking");
      if (streamedAny) {
        // The full reply was already spoken sentence-by-sentence; just wait for
        // the queued sentences to finish. `reply` still carries the full text
        // for the question check below.
        await Promise.all(partialPlays);
      } else {
        await speakAndWait(reply);
      }
      if (stale()) return;
      asked = asked || isQuestion(reply);
      // eslint-disable-next-line no-use-before-define
      openFollowupWindow(asked);
    },
    [clearTimers, speakAndWait, maybeLearn],
  );

  // Reopen active listening after Echo speaks. When Echo asked a question we stay
  // open indefinitely; otherwise we run a 30s countdown then softly close.
  const openFollowupWindow = useCallback(
    (indefinite = false) => {
      clearTimers();
      finalRef.current = "";
      confRef.current = null;
      setListeningText("");
      modeRef.current = "active";
      suspendRef.current = false;
      // A question just went out → hold off on accepting any speech for a few
      // seconds so Echo's own voice trailing off can't trigger a self-reply.
      if (indefinite) acceptInputAtRef.current = Date.now() + POST_QUESTION_MS;
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
        pendingBriefRef.current = null;
        pendingBriefingChoiceRef.current = false;
        pendingBrandOfferRef.current = null;
        pendingBrandPickRef.current = false;
        pendingTransferOfferRef.current = null;
        misheardRef.current = null;
        clarifyRetryRef.current = false;
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
      // Fresh capture → fresh confidence; ambient/wake-phrase confidence must
      // never leak into the command that follows.
      confRef.current = null;
      modeRef.current = "active";
      suspendRef.current = false;
      setConvState("active");
      playEffect("wake");
      // NOTE: the login-silence hold (echoai:user-initiated) is lifted in
      // processCommand once a REAL command lands — never on the bare wake
      // match, so a misheard "Hey Echo" can't unleash auto-spoken content.
      // If the wake utterance already carried a command, give the user a beat to
      // keep talking, then finalize.
      if (initialCommand) {
        pauseTimerRef.current = setTimeout(() => {
          const captured = finalRef.current.trim();
          processCommand(captured);
        }, ACTIVE_PAUSE_MS);
        return;
      }
      // Bare wake word ("Hey Echo" with no command): Echo must ANSWER out loud
      // the instant it hears its name — never just chime and wait in silence.
      // Speak a short acknowledgement, then hold the listening window open
      // (indefinite) so the owner can give the command at their own pace.
      suspendRef.current = true;
      setConvState("speaking");
      const wakeGen = cmdGenRef.current;
      await speakAndWait(wakeAck());
      // If an interrupt/stop landed while the ack was speaking, cmdGenRef was
      // bumped — bail so we don't reopen the listening window on top of the
      // reset the interrupt already performed.
      if (wakeGen !== cmdGenRef.current) return;
      // eslint-disable-next-line no-use-before-define
      openFollowupWindow(true);
    },
    [clearTimers, processCommand, speakAndWait, openFollowupWindow],
  );

  const handleResult = useCallback(
    (event) => {
      // Barge-in: while Echo is speaking, the ONLY thing we listen for is a
      // short standalone interrupt command ("Stop", "Cancel", "Never mind",
      // "Wait", "That's enough"). Echo's own voice leaking into the mic comes
      // through as long sentences, so the exact-utterance match can't
      // self-trigger. On a match Echo halts immediately, acknowledges, and
      // returns to listening.
      // Also honored while Echo is THINKING (suspended/processing): "Stop"
      // must always work instantly, not just while audio is playing. Bumping
      // the command generation makes the in-flight command stale, so its
      // late-arriving reply is dropped instead of spoken.
      if (
        (speakingRef.current || suspendRef.current) &&
        !interruptedRef.current
      ) {
        let heard = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          heard += ` ${event.results[i][0].transcript}`;
        }
        if (matchInterruptIntent(heard.trim())) {
          interruptedRef.current = true;
          cmdGenRef.current += 1; // cancel any in-flight command
          pendingBriefRef.current = null;
          pendingBriefingChoiceRef.current = false;
          pendingBrandOfferRef.current = null;
          pendingBrandPickRef.current = false;
          pendingTransferOfferRef.current = null;
          finalRef.current = "";
          clearTimers();
          // Cut the audio NOW (clears the queue and unwinds the drain loop).
          try {
            if (stopAllRef.current) stopAllRef.current();
          } catch {
            /* noop */
          }
          // A "stop" during tour narration ends the TOUR (which speaks its own
          // goodbye) — skip the generic interrupt acknowledgement.
          if (tourActiveRef.current) {
            dispatchTourCommand("stop");
            interruptedRef.current = false;
            return;
          }
          (async () => {
            try {
              suspendRef.current = true;
              setConvState("speaking");
              await speakAndWait(interruptAck());
            } finally {
              interruptedRef.current = false;
              // eslint-disable-next-line no-use-before-define
              openFollowupWindow();
            }
          })();
        }
        return;
      }
      if (suspendRef.current) return;
      // Echo is speaking (or within its post-speech cooldown): ignore everything
      // the mic hears so Echo can never respond to its own voice.
      if (speakingRef.current) return;
      // Post-question grace period: right after Echo asks something, drop all
      // speech briefly so its own trailing audio can't answer the question.
      if (Date.now() < acceptInputAtRef.current) return;
      let interim = "";
      let addedFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalRef.current = `${finalRef.current} ${chunk}`.trim();
          addedFinal = true;
          // Track the weakest final-chunk confidence for this capture; a low
          // score on an unrecognized command triggers a natural clarification
          // instead of a wrong guess (tuned for Southern accents).
          const conf = event.results[i][0].confidence;
          if (typeof conf === "number" && conf > 0) {
            confRef.current =
              confRef.current === null ? conf : Math.min(confRef.current, conf);
          }
        } else {
          interim += chunk;
        }
      }

      // Guided tour: short spoken answers ("yes", "next", "back", "stop")
      // drive the tour directly — no wake word needed. Only FINAL results are
      // matched so a single utterance can't advance the tour twice.
      if (tourActiveRef.current && addedFinal) {
        const cmd = matchTourCommand(finalRef.current);
        if (cmd) {
          finalRef.current = "";
          setListeningText("");
          if (pauseTimerRef.current) {
            clearTimeout(pauseTimerRef.current);
            pauseTimerRef.current = null;
          }
          dispatchTourCommand(cmd);
          return;
        }
      }

      if (modeRef.current === "passive") {
        const combined = `${finalRef.current} ${interim}`.trim();
        const { matched, command } = parseWakeWord(combined);
        if (matched) {
          finalRef.current = "";
          goActive(command);
          return;
        }
        // No wake word yet: keep only a short tail of the transcript so hours
        // of ambient speech can't grow the buffer or bury a fresh "Hey Echo"
        // in stale text. The tail preserves a wake phrase split across two
        // recognition results (e.g. "hey" finalized, "echo" in the next one).
        if (finalRef.current.length > 80) {
          finalRef.current = finalRef.current.slice(-40);
        }
        return;
      }

      // Active capture: show interim text and finalize after a natural pause.
      const shown = `${finalRef.current} ${interim}`.trim();
      setListeningText(shown);
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      // When the recognizer already delivered a FINAL chunk it has detected end
      // of speech itself — commit fast so Echo feels instant. Interim-only text
      // keeps the longer pause (the user may still be mid-sentence).
      pauseTimerRef.current = setTimeout(() => {
        const captured = finalRef.current.trim();
        if (captured) processCommand(captured);
      }, addedFinal ? FINAL_PAUSE_MS : ACTIVE_PAUSE_MS);
      // If nothing final has landed yet, keep waiting for the pause on interim.
      if (!addedFinal && !finalRef.current) {
        finalRef.current = "";
      }
    },
    [
      goActive,
      processCommand,
      clearTimers,
      speakAndWait,
      openFollowupWindow,
      dispatchTourCommand,
    ],
  );

  const startRecognition = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR || runningRef.current) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    // Ask the engine for alternates — improves accuracy for regional accents.
    rec.maxAlternatives = 3;
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
      setMicLive(false);
      // A session that survived >1s was healthy — reset the failure streak.
      // A session dying almost instantly (blocked device, engine wedge) grows
      // the streak so retries back off instead of hot-looping.
      if (Date.now() - lastStartAtRef.current > 1000) {
        failStreakRef.current = 0;
        // Restart immediately — no timer — so the deaf gap between engine
        // sessions is as close to zero as the browser allows.
        restartNow();
      } else {
        failStreakRef.current = Math.min(failStreakRef.current + 1, 6);
        // First couple of instant deaths still restart immediately (a normal
        // engine hiccup); a persistent streak switches to backed-off retries.
        if (failStreakRef.current <= 2) restartNow();
        else scheduleRestart();
      }
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      lastStartAtRef.current = Date.now();
      runningRef.current = true;
      setMicLive(true);
      setDenied(false);
      setMicLost(false);
    } catch (err) {
      runningRef.current = false;
      setMicLive(false);
      recognitionRef.current = null;
      const name = (err && err.name) || "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        // Permission is hard-blocked: fail closed, no retry loop. The user can
        // re-enable from the mic button, which reopens the permission prompt.
        setDenied(true);
        wantListeningRef.current = false;
        return;
      }
      failStreakRef.current = Math.min(failStreakRef.current + 1, 6);
      scheduleRestart();
    }
  }, [handleResult, restartNow, scheduleRestart, stopRecognition]);
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

  // Watchdog: every second, if we SHOULD be listening but no recognition
  // instance is live and no restart is already scheduled, start one. This is
  // the belt-and-braces guarantee that the mic can never silently stay dead
  // for more than ~1s no matter how the engine stopped.
  useEffect(() => {
    if (!(supported && micEnabled && !muted && active)) return undefined;
    const watchdog = setInterval(() => {
      if (
        wantListeningRef.current &&
        !runningRef.current &&
        !restartTimerRef.current
      ) {
        startRecognitionRef.current && startRecognitionRef.current();
      }
    }, 1000);
    return () => clearInterval(watchdog);
  }, [supported, micEnabled, muted, active]);

  // STUCK-STATE watchdog: if the engine has been suspended (processing /
  // speaking) with no audio actually playing for STUCK_SUSPEND_MS straight,
  // something wedged past every per-call timeout — force a full reset to
  // passive so Echo can NEVER silently stay deaf. Ticks every 5s; any tick
  // where we're not suspended (or audio is genuinely playing) resets the count.
  const stuckTicksRef = useRef(0);
  useEffect(() => {
    if (!(supported && micEnabled && !muted && active)) return undefined;
    const TICK_MS = 5000;
    const maxTicks = Math.ceil(STUCK_SUSPEND_MS / TICK_MS);
    const id = setInterval(() => {
      if (suspendRef.current && !speakingRef.current) {
        stuckTicksRef.current += 1;
        if (stuckTicksRef.current >= maxTicks) {
          stuckTicksRef.current = 0;
          cmdGenRef.current += 1; // drop whatever is still in flight
          clearTimers();
          pendingBriefRef.current = null;
          pendingBriefingChoiceRef.current = false;
          pendingBrandOfferRef.current = null;
          pendingBrandPickRef.current = false;
          pendingTransferOfferRef.current = null;
          finalRef.current = "";
          modeRef.current = "passive";
          suspendRef.current = false;
          setConvState("passive");
        }
      } else {
        stuckTicksRef.current = 0;
      }
    }, TICK_MS);
    return () => {
      clearInterval(id);
      stuckTicksRef.current = 0;
    };
  }, [supported, micEnabled, muted, active, clearTimers]);

  // Preload the personality stings once we're active & opted in.
  useEffect(() => {
    if (micEnabled && active) {
      preloadEffects(["wake", "goodbye", "thinking"]);
      preloadAcks();
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
    pendingBriefRef.current = null;
    pendingBriefingChoiceRef.current = false;
    pendingBrandOfferRef.current = null;
    pendingBrandPickRef.current = false;
    pendingTransferOfferRef.current = null;
    misheardRef.current = null;
    clarifyRetryRef.current = false;
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
      await speakAndWait(tackleFirstQuestion());
      openFollowupWindow(true); // treat as a question → stay open
    };
    window.addEventListener("echo:briefing-done", onBriefingDone);
    return () => window.removeEventListener("echo:briefing-done", onBriefingDone);
  }, [active, supported, speakAndWait, openFollowupWindow]);

  // Morning standby: after the login greeting, Echo goes quiet and waits for
  // the owner's go-ahead. A brief follow-up window lets a bare "ready" /
  // "run it" work without the wake word; after it closes, "Hey Echo, start my
  // briefing" still works any time — the standby flag stays set until the
  // briefing is actually delivered.
  useEffect(() => {
    if (!active) return undefined;
    const onStandby = () => {
      morningStandbyRef.current = true;
      if (!supported || !enabledRef.current || mutedRef.current) return;
      openFollowupWindow(true);
    };
    window.addEventListener("echo:briefing-standby", onStandby);
    return () => window.removeEventListener("echo:briefing-standby", onStandby);
  }, [active, supported, openFollowupWindow]);

  // LIVE HOT-LEAD HANDOFF: VoiceContext dispatches this the instant Echo
  // finishes speaking a "transfer or keep handling?" alert for a live
  // autonomous conversation. Arm the pending offer and open an active listening
  // window so a spoken "transfer it" completes a seamless handoff. If the owner
  // stays silent, the follow-up window closes and Echo keeps handling the lead.
  useEffect(() => {
    if (!active || !supported) return;
    const onOffer = (e) => {
      const conversationId = e && e.detail && e.detail.conversationId;
      if (!conversationId) return;
      pendingTransferOfferRef.current = { conversationId };
      openFollowupWindow(true);
    };
    window.addEventListener("echoai:autonomous-offer", onOffer);
    return () =>
      window.removeEventListener("echoai:autonomous-offer", onOffer);
  }, [active, supported, openFollowupWindow]);

  // PERMISSION-TO-SPEAK: VoiceContext dispatches this the instant Echo finishes
  // asking "Excuse me Sir, do you have a moment?". Arm the pending-permission
  // flag and open an active listening window so the owner's yes/no is captured.
  // If they stay silent, the window closes and the alert stays queued for later
  // ("Hey Echo, what did you need?").
  useEffect(() => {
    if (!active || !supported) return;
    const onAsk = () => {
      pendingPermissionRef.current = true;
      openFollowupWindow(true);
    };
    window.addEventListener("echoai:permission-request", onAsk);
    return () =>
      window.removeEventListener("echoai:permission-request", onAsk);
  }, [active, supported, openFollowupWindow]);

  // LOGOUT KILL SWITCH: stop the mic, all timers, and any sound effect the
  // instant the app broadcasts a logout, so nothing from the conversation
  // engine keeps playing (or re-triggers speech) after the owner logs out.
  useEffect(() => {
    const onLogout = () => {
      clearTimers();
      stopRecognition();
      stopEffect();
      pendingBriefRef.current = null;
      pendingBriefingChoiceRef.current = false;
      pendingBrandOfferRef.current = null;
      pendingBrandPickRef.current = false;
      pendingTransferOfferRef.current = null;
      pendingPermissionRef.current = false;
      morningStandbyRef.current = false;
      finalRef.current = "";
      modeRef.current = "passive";
      suspendRef.current = false;
      setConvState("passive");
      setListeningText("");
    };
    window.addEventListener("echoai:logout", onLogout);
    return () => window.removeEventListener("echoai:logout", onLogout);
  }, [clearTimers, stopRecognition]);

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
      micLive,
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
      // Hands-free is fully on (opted in, unmuted, provider active): the UI
      // should show the live/paused mic indicator only in this state.
      handsFreeOn: supported && micEnabled && !muted && active,
    }),
    [
      supported,
      micEnabled,
      muted,
      active,
      denied,
      micLost,
      micState,
      micLive,
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
