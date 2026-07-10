/**
 * Echo Voice engine — the client runtime behind Echo's spoken voice.
 *
 * Responsibilities (owner-only; the provider is only mounted for owners):
 *  - Load & persist the owner's voice settings (mirrors config/echoVoice.js).
 *  - Auto-play the morning briefing once per day on login (waveform/skip/replay
 *    live in <VoicePlayer/>, which reads this context).
 *  - Poll GET /pending while the app is open and speak reminders + real-time
 *    alerts in order. The SERVER gates enabled/quiet-hours/per-event toggles, so
 *    the client just drains what it is handed and marks each delivered.
 *  - Expose on-demand actions: "Talk to Echo" status briefing, replay, skip.
 *  - A global mute (TopBar speaker) that halts playback without losing settings.
 *
 * All TTS reuses POST /api/echo-voice/speak (ElevenLabs, falling back to OpenAI).
 * The morning briefing first plays an upbeat ElevenLabs wake-up music intro
 * (GET /api/echo-voice/wakeup-intro). Audio is a per-item Blob → object URL,
 * revoked when playback ends.
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
import { api, getToken } from "../api.js";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  isQuietHour,
  chunkForSpeech,
} from "../lib/voiceSettings.js";
import { getWarmAudio, killWarmAudio } from "./audioUnlock.js";
import { standbyGreeting, musicReadyLine } from "./phraseVariety.js";
import { isProactiveVoiceItem } from "./conversationHelpers.js";

const VoiceContext = createContext(null);

// How often to poll the server for pending spoken events while the app is open.
const POLL_MS = 30 * 1000;
const MUTE_KEY = "echoai_voice_muted";
// Per-ISO-week guard so the weekly strategy briefing auto-plays at most once a
// week (persisted across logins/reloads, unlike the per-session morning guard).
const WEEKLY_KEY_PREFIX = "echoai_weekly_";

/** ISO-week identifier like "2026-W27" (matches the server's key for the guard). */
function isoWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7; // Sunday -> 7
  date.setUTCDate(date.getUTCDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
// Anti-reload guard for the morning greeting, scoped to the current auth token.
// A fresh login mints a new JWT, so its key is absent → the greeting plays again
// on EVERY login. A bare page reload keeps the same token (and sessionStorage),
// so the key is present → we don't replay within the same login session.
function briefingSessionKey() {
  const t = getToken();
  // Signature tail is unique per issued JWT; falls back to a shared key if the
  // token is somehow unavailable (still suppresses reload spam within a session).
  const tail = t ? t.slice(-24) : "anon";
  return `echoai_briefing_${tail}`;
}

let itemSeq = 0;
function nextItemId() {
  itemSeq += 1;
  return `local-${itemSeq}`;
}

export function VoiceProvider({ active, children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [firstName, setFirstName] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Playback state exposed to <VoicePlayer/>.
  const [current, setCurrent] = useState(null); // { id, type, title, text }
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  // Set during Presentation Mode when ElevenLabs can't speak: rather than switch
  // to a different (OpenAI) voice mid-demo, we surface the spoken text here so the
  // presenter still sees exactly what Echo would have said. Cleared on the next
  // successful playback / stop.
  const [notice, setNotice] = useState("");
  // True when the browser blocked autoplay; the next user gesture resumes playback.
  const [needsGesture, setNeedsGesture] = useState(false);
  // Proactive channel/tool suggestions returned with the weekly briefing. The
  // owner can act on them (navigate + accept) or dismiss (decline) from the
  // Echo popover; both decisions are recorded server-side for deduping.
  const [suggestions, setSuggestions] = useState([]);
  // LOGIN SILENCE RULE: after the standby greeting, Echo says NOTHING else and
  // never navigates until the owner initiates (speaks a wake-word command or
  // presses an Echo control). Auto-delivered speech (pending alerts like Sage
  // urgent reports, the weekly auto-briefing) is held behind this flag.
  const [userInitiated, setUserInitiated] = useState(false);
  const userInitiatedRef = useRef(false);

  // Internal refs (not state, to avoid re-renders / stale closures).
  const queueRef = useRef([]); // pending items to speak
  const currentRef = useRef(null); // item being spoken now
  const audioRef = useRef(null);
  const urlRef = useRef(null);
  const resolveRef = useRef(null); // resolves the in-flight speakItem promise
  const busyRef = useRef(false); // guards the drain loop
  const lastPlayedRef = useRef(null); // for replay
  // Server notification ids that reached a terminal state this session (spoken,
  // user-dismissed, user-stopped, or failed too many times). Only autoplay-
  // "blocked" items stay un-terminal so a later poll retries them — everything
  // the OWNER ended (stop/mute) or that keeps erroring is settled, because
  // re-serving the same alert every 30s poll is exactly the "Echo repeats
  // himself in a loop" bug.
  const deliveredIds = useRef(new Set());
  // Failed TTS attempts per notification id — after 2 errors the item is
  // dismissed instead of retrying (and repeating) forever.
  const speakAttemptsRef = useRef(new Map());
  const settingsRef = useRef(settings);
  const mutedRef = useRef(muted);
  const activeRef = useRef(active);
  const needsGestureRef = useRef(false);
  // True while Sales Presentation Mode is running. Read at synth time so EVERY
  // spoken surface (briefing, scripted lines, suggestions, nav confirmations)
  // requests the strict ElevenLabs-only path — the voice never switches mid-demo.
  const presentationRef = useRef(false);
  // CONVERSATION STATE MANAGER hook-in: the conversation engine registers a
  // synchronous probe that answers "is Echo in an active interaction right
  // now?" (capturing a command, processing, speaking, or holding a follow-up
  // window). While it returns true, PROACTIVE queue items (Sage alerts,
  // reminders, briefings) are HELD — they never interrupt a conversation, and
  // play only once Echo is fully back to idle passive listening.
  const conversationBusyProbeRef = useRef(null);
  // Retry timer for held proactive items (cleared on deactivate).
  const holdTimerRef = useRef(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    needsGestureRef.current = needsGesture;
  }, [needsGesture]);

  // Track Presentation Mode so every spoken surface requests the strict
  // ElevenLabs-only path while a demo is live (see synth calls in speakItem).
  useEffect(() => {
    const onStart = () => {
      presentationRef.current = true;
    };
    const onStop = () => {
      presentationRef.current = false;
      setNotice("");
    };
    window.addEventListener("echoai:demo-start", onStart);
    window.addEventListener("echoai:demo-stop", onStop);
    return () => {
      window.removeEventListener("echoai:demo-start", onStart);
      window.removeEventListener("echoai:demo-stop", onStop);
    };
  }, []);

  // ---- settings ---------------------------------------------------------
  const refreshSettings = useCallback(async () => {
    try {
      const data = await api.echoVoiceGetSettings();
      setSettings(normalizeSettings(data.settings));
      setFirstName(data.firstName || null);
      setSettingsLoaded(true);
      return data;
    } catch (err) {
      // Never trap the app on a settings read failure; fall back to defaults.
      setSettingsLoaded(true);
      throw err;
    }
  }, []);

  const saveSettings = useCallback(async (next, name) => {
    const merged = normalizeSettings(next);
    const payload = { settings: merged };
    if (typeof name === "string") payload.firstName = name;
    const data = await api.echoVoiceSaveSettings(payload);
    setSettings(normalizeSettings(data.settings));
    if (typeof data.firstName !== "undefined") setFirstName(data.firstName || null);
    return data;
  }, []);

  // ---- low-level playback ----------------------------------------------
  const cleanupAudio = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      try {
        el.pause();
        el.oncanplay = null;
        el.onended = null;
        el.onerror = null;
        el.removeAttribute("src");
        el.load();
      } catch {
        /* noop */
      }
    }
    audioRef.current = null;
    if (urlRef.current) {
      try {
        URL.revokeObjectURL(urlRef.current);
      } catch {
        /* noop */
      }
      urlRef.current = null;
    }
  }, []);

  // Speak a single item's text. Resolves when playback ends (or fails). Marks a
  // server notification delivered on natural completion.
  // Resolves with a status: "played" | "error" | "blocked" | "stopped" |
  // "skipped". Only "played" marks a notification delivered; "blocked"/"stopped"
  // halt the drain loop (autoplay gate / mute), the rest let it advance.
  const speakItem = useCallback(
    (item) =>
      new Promise((resolve) => {
        // settle() fires at most once and clears the shared resolver so
        // skip()/stopAll() can force-advance a stuck item.
        let settled = false;
        // Resolver for the chunk currently playing, so skip()/stopAll() can
        // interrupt mid-chunk (settle → cleanupAudio pauses it, but the awaited
        // playback promise must also unwind).
        let chunkDone = null;
        const settle = (status) => {
          if (settled) return;
          settled = true;
          resolveRef.current = null;
          if (chunkDone) {
            const done = chunkDone;
            chunkDone = null;
            done("interrupted");
          }
          cleanupAudio();
          // Restore background music volume now that Echo has stopped speaking.
          try {
            window.dispatchEvent(new Event("echoai:tts-end"));
          } catch {
            /* noop */
          }
          resolve(status);
        };
        resolveRef.current = settle;
        (async () => {
          // Duck any background music while Echo speaks (restored in settle()).
          if (!mutedRef.current && activeRef.current) {
            try {
              window.dispatchEvent(new Event("echoai:tts-start"));
            } catch {
              /* noop */
            }
          }
          // Split the script into small chunks so the first (short) chunk starts
          // playing in ~1-2s while later chunks synthesize during playback. This
          // cuts time-to-first-audio from ~10s (whole-script TTS) to ~1-2s.
          const style = settingsRef.current.style;
          // Morning briefing only: play the upbeat wake-up music intro first, then
          // speak. Best-effort — a missing/failed intro (204/error → null) or an
          // autoplay block just falls through to the spoken briefing.
          if (item.playIntro) {
            try {
              const introBlob = await api.echoVoiceWakeupIntro();
              if (settled) return;
              if (introBlob && !mutedRef.current && activeRef.current) {
                const iurl = URL.createObjectURL(introBlob);
                urlRef.current = iurl;
                const el = getWarmAudio() || new Audio();
                try {
                  el.pause();
                } catch {
                  /* noop */
                }
                el.muted = false;
                el.src = iurl;
                el.volume = settingsRef.current.volume;
                audioRef.current = el;
                await new Promise((res) => {
                  chunkDone = res;
                  el.onended = () => res("played");
                  el.onerror = () => res("error");
                  el.play().catch(() => res("blocked"));
                });
                chunkDone = null;
                if (urlRef.current === iurl) {
                  try {
                    URL.revokeObjectURL(iurl);
                  } catch {
                    /* noop */
                  }
                  urlRef.current = null;
                }
                if (audioRef.current === el) audioRef.current = null;
              }
            } catch {
              /* intro is best-effort; never block the briefing */
            }
            if (settled) return;
          }
          const chunks = chunkForSpeech(item.text);
          if (chunks.length === 0) {
            settle("played");
            return;
          }
          // Prefetch pipeline: `pending` is the synthesis promise for the chunk
          // we're about to play. The next chunk's synthesis is kicked off as soon
          // as the current chunk *starts* playing, overlapping network + TTS with
          // playback so there are no gaps between chunks.
          // Strict = ElevenLabs-only (voice never switches to OpenAI). Presentation
          // Mode forces it for the whole demo; Sage's urgent industry alerts force
          // it per-item so a broken ElevenLabs account shows text instead of a
          // different-sounding voice (task requirement for Sage spoken alerts).
          const strict = presentationRef.current || item.type === "sage_urgent";
          let pending = api.echoVoiceSpeak(chunks[0], style, { presentation: strict });
          for (let i = 0; i < chunks.length; i++) {
            let blob;
            try {
              blob = await pending;
            } catch (err) {
              // Presentation Mode + ElevenLabs unavailable: NEVER switch to a
              // different voice. Show the spoken text as a notification and treat
              // the item as delivered so the demo keeps moving.
              if (err && err.code === "tts_unavailable") {
                setNotice(
                  presentationRef.current
                    ? "Voice paused — the presentation voice is temporarily unavailable, so Echo is showing the text instead."
                    : `Voice unavailable — showing the alert as text instead: ${item.text}`,
                );
                settle("played");
                return;
              }
              // First chunk failed → surface the error. A later chunk failing
              // just ends the briefing gracefully after what was already spoken.
              if (i === 0) {
                setError(err.message || "Voice playback failed");
                settle("error");
              } else {
                settle("played");
              }
              return;
            }
            pending = null;
            // Skipped/stopped/muted while synthesizing → bail without playing.
            if (settled) return;
            if (mutedRef.current || !activeRef.current) {
              settle("stopped");
              return;
            }
            const url = URL.createObjectURL(blob);
            urlRef.current = url;
            // Reuse the ONE warm <audio> element that was unlocked during the
            // login gesture (see audioUnlock.js). Playing that same element again
            // is permitted with no fresh gesture, so the morning briefing
            // auto-plays reliably. Fall back to a new element if unavailable.
            const el = getWarmAudio() || new Audio();
            try {
              el.pause();
            } catch {
              /* noop */
            }
            el.muted = false;
            el.src = url;
            el.volume = settingsRef.current.volume;
            audioRef.current = el;
            const status = await new Promise((res) => {
              chunkDone = res;
              el.onended = () => res("played");
              el.onerror = () => res("error");
              el.play()
                .then(() => {
                  // Playback started → prefetch the next chunk now so it's ready
                  // the instant this one ends.
                  if (i + 1 < chunks.length && !pending) {
                    pending = api.echoVoiceSpeak(chunks[i + 1], style, {
                      presentation: strict,
                    });
                    // Neutralize an unhandled rejection if we bail before awaiting.
                    pending.catch(() => {});
                  }
                })
                .catch(() => res("blocked"));
            });
            chunkDone = null;
            // Release this chunk's element/URL before advancing to the next one.
            if (urlRef.current === url) {
              try {
                URL.revokeObjectURL(url);
              } catch {
                /* noop */
              }
              urlRef.current = null;
            }
            if (audioRef.current === el) audioRef.current = null;
            if (settled) return;
            if (status === "blocked") {
              // Autoplay gated before the first user gesture (morning briefing).
              // Halt; the drain loop re-queues the whole item for the next gesture.
              settle("blocked");
              return;
            }
            // "error" → skip this chunk but keep going. Either way, make sure the
            // next chunk's synthesis is in flight before we loop.
            if (i + 1 < chunks.length && !pending) {
              pending = api.echoVoiceSpeak(chunks[i + 1], style, {
                presentation: strict,
              });
            }
          }
          settle("played");
        })();
      }),
    [cleanupAudio],
  );

  // Drain the queue one item at a time.
  const drain = useCallback(async () => {
    if (busyRef.current) return;
    if (mutedRef.current || !activeRef.current) return;
    busyRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        if (mutedRef.current || !activeRef.current) break;
        // CONVERSATION-PRIORITY RULE: while the conversation engine reports an
        // active interaction, proactive items (alerts/reminders/briefings) are
        // held in place — pick the first item that is allowed to play now.
        const probe = conversationBusyProbeRef.current;
        const conversationBusy = !!(probe && probe());
        let idx = 0;
        if (conversationBusy) {
          idx = queueRef.current.findIndex((q) => !isProactiveVoiceItem(q));
          if (idx === -1) break; // everything is held; retry once idle
        }
        const item = queueRef.current.splice(idx, 1)[0];
        // Brand-isolation validation at the moment of speech: if the owner
        // switched brands after this alert was queued, do NOT speak it. It is
        // not marked delivered, so it stays pending server-side and delivers
        // when the owner returns to its brand.
        if (item.brandId) {
          const bctx =
            (typeof window !== "undefined" && window.__echoaiBrands) || {};
          const nowActive = bctx.activeIsDemo ? null : bctx.activeId || null;
          if (String(nowActive || "") !== String(item.brandId)) continue;
        }
        currentRef.current = item;
        lastPlayedRef.current = item;
        setCurrent(item);
        setPlaying(true);
        setError("");
        setNotice("");
        const status = await speakItem(item);
        setPlaying(false);
        currentRef.current = null;
        if (item.notificationId) {
          if (status === "played") {
            // Natural completion → tell the server so it isn't re-served.
            deliveredIds.current.add(item.notificationId);
            api.echoVoiceMarkNotification(item.notificationId).catch(() => {});
          } else if (status === "skipped" || status === "stopped") {
            // User skipped OR explicitly stopped/muted playback → dismiss it.
            // An explicit stop must be final: leaving it un-terminal meant the
            // 30s poll re-served the SAME alert over and over — the repeat loop.
            deliveredIds.current.add(item.notificationId);
            api
              .echoVoiceMarkNotification(item.notificationId, "dismissed")
              .catch(() => {});
          } else if (status === "error") {
            // TTS failure → retry on a later poll, but only a couple of times.
            // A permanently-broken item must never loop the same text forever.
            const tries =
              (speakAttemptsRef.current.get(item.notificationId) || 0) + 1;
            speakAttemptsRef.current.set(item.notificationId, tries);
            if (tries >= 2) {
              deliveredIds.current.add(item.notificationId);
              api
                .echoVoiceMarkNotification(item.notificationId, "dismissed")
                .catch(() => {});
            }
          }
          // blocked → un-terminal; it re-queues below and plays after a gesture.
        }
        if (status === "played" && item.onPlayed) {
          try {
            await item.onPlayed();
          } catch {
            /* noop */
          }
        }
        // Terminal-status hook: fires for EVERY outcome except "blocked" (the
        // item will replay after a user gesture, so it isn't finished yet).
        // The conversation engine uses this so a skipped/stopped/errored reply
        // can never leave it suspended (deaf) until the 90s safety timeout.
        if (status !== "blocked" && item.onDone) {
          try {
            item.onDone(status);
          } catch {
            /* noop */
          }
        }
        if (status === "blocked") {
          // Autoplay was gated before a user gesture. Put the item back at the
          // front (it has no notificationId, so nothing would re-serve it) and
          // flag that we need a gesture; the next click/keypress resumes playback.
          queueRef.current.unshift(item);
          // Sync the ref NOW (the state effect lands a render later) so the
          // finally-block re-drain below can't spin on a still-blocked item.
          needsGestureRef.current = true;
          setNeedsGesture(true);
          break;
        }
        // Muted/stopped mid-flight → halt; a user gesture will restart the loop.
        // "skipped"/"error" fall through to the next item.
        if (status === "stopped") break;
      }
    } finally {
      busyRef.current = false;
      if (!currentRef.current) setCurrent(null);
      // An enqueue that raced this loop's unwind (e.g. the barge-in
      // acknowledgement right after stopAll()) hit the busyRef guard and was
      // never played. stopAll() clears the queue, so anything still here is a
      // NEW item that must play — kick the loop again. The autoplay-blocked
      // case is excluded: it deliberately waits for a user gesture.
      if (
        queueRef.current.length > 0 &&
        !needsGestureRef.current &&
        !mutedRef.current &&
        activeRef.current
      ) {
        const probe = conversationBusyProbeRef.current;
        const busyNow = !!(probe && probe());
        const allHeld =
          busyNow && queueRef.current.every((q) => isProactiveVoiceItem(q));
        if (allHeld) {
          // Everything left is a held proactive item. Poll again shortly as a
          // backstop; the conversation engine also pings us the moment it goes
          // idle (echoai:conversation-idle), so delivery is usually instant.
          if (!holdTimerRef.current) {
            holdTimerRef.current = setTimeout(() => {
              holdTimerRef.current = null;
              drain();
            }, 2000);
          }
        } else {
          setTimeout(() => drain(), 0);
        }
      }
    }
  }, [speakItem]);

  // Register (or clear) the conversation engine's busy probe.
  const registerConversationBusyProbe = useCallback((fn) => {
    conversationBusyProbeRef.current = typeof fn === "function" ? fn : null;
  }, []);

  // The conversation engine pings this event the moment it returns to idle
  // passive listening — deliver any held proactive items right away.
  useEffect(() => {
    const onIdle = () => {
      // The idle ping supersedes the 2s backstop — drop it to avoid a
      // redundant wakeup right after this drain.
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      drain();
    };
    window.addEventListener("echoai:conversation-idle", onIdle);
    return () => window.removeEventListener("echoai:conversation-idle", onIdle);
  }, [drain]);

  const enqueue = useCallback(
    (item, { front = false } = {}) => {
      const entry = { id: nextItemId(), ...item };
      if (front) queueRef.current.unshift(entry);
      else queueRef.current.push(entry);
      drain();
      return entry.id;
    },
    [drain],
  );

  // Resume autoplay-gated playback on the next user gesture. The morning
  // briefing is enqueued before any click, so browsers block it; the first
  // interaction anywhere flips the gate and drains the pending item.
  useEffect(() => {
    if (!needsGesture || !active) return;
    const resume = () => {
      needsGestureRef.current = false;
      setNeedsGesture(false);
      drain();
    };
    window.addEventListener("pointerdown", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
  }, [needsGesture, active, drain]);

  // ---- public actions ---------------------------------------------------
  // Mark the session "user initiated": the owner explicitly engaged Echo
  // (wake-word command, or pressing an Echo control). Only after this may
  // Echo auto-speak pending alerts / the weekly auto-briefing.
  const markUserInitiated = useCallback(() => {
    if (userInitiatedRef.current) return;
    userInitiatedRef.current = true;
    setUserInitiated(true);
  }, []);
  useEffect(() => {
    const onInitiated = () => markUserInitiated();
    window.addEventListener("echoai:user-initiated", onInitiated);
    return () =>
      window.removeEventListener("echoai:user-initiated", onInitiated);
  }, [markUserInitiated]);

  const skip = useCallback(() => {
    setPlaying(false);
    // Force the in-flight speakItem promise to resolve as "skipped"; the drain
    // loop then dismisses the notification server-side and advances to the next
    // queued item on its own.
    if (resolveRef.current) resolveRef.current("skipped");
    else cleanupAudio();
  }, [cleanupAudio]);

  const replay = useCallback(() => {
    const last = lastPlayedRef.current;
    if (!last) return;
    enqueue({ ...last, id: undefined, notificationId: undefined }, { front: true });
  }, [enqueue]);

  const stopAll = useCallback(() => {
    queueRef.current = [];
    // Resolve any in-flight speakItem so the drain loop unwinds (else busyRef
    // stays set and future enqueues never play).
    if (resolveRef.current) resolveRef.current("stopped");
    else cleanupAudio();
    setPlaying(false);
    setCurrent(null);
    currentRef.current = null;
    setNotice("");
    // An explicit stop/mute clears the queue, so drop the stale "click to hear"
    // hint too — there's nothing left waiting on a gesture.
    setNeedsGesture(false);
    // Tell every waiter (e.g. the conversation engine's speakAndWait) that
    // playback was cut RIGHT NOW, so nothing hangs on a 90s safety timeout.
    try {
      window.dispatchEvent(new CustomEvent("echoai:speech-stopped"));
    } catch {
      /* noop */
    }
  }, [cleanupAudio]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      try {
        localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        /* noop */
      }
      if (next) stopAll();
      return next;
    });
  }, [stopAll]);

  // On-demand "Talk to Echo": a fresh current-status spoken update. Always
  // allowed (a deliberate user gesture) even during quiet hours / if muted-off.
  const talkToEcho = useCallback(async () => {
    try {
      markUserInitiated();
      setError("");
      // Scope the spoken status to the business the dashboard is showing
      // (App.jsx publishes it on window.__echoaiBrands). Demo brand → global.
      const bctx = (typeof window !== "undefined" && window.__echoaiBrands) || {};
      const brandId = bctx.activeIsDemo ? undefined : bctx.activeId || undefined;
      const data = await api.echoVoiceGetStatus(brandId);
      enqueue(
        {
          type: "status",
          title: "Status update",
          text: data.text,
        },
        { front: true },
      );
      return data;
    } catch (err) {
      setError(err.message || "Couldn't reach Echo");
      throw err;
    }
  }, [enqueue, markUserInitiated]);

  // On-demand weekly strategy briefing (the "Weekly" button). Plays immediately
  // (front of queue) and stamps this week's guard so it won't also auto-play.
  const weeklyBriefing = useCallback(async () => {
    try {
      markUserInitiated();
      setError("");
      const data = await api.echoVoiceGetWeekly();
      const key = WEEKLY_KEY_PREFIX + (data.weekKey || isoWeekKey());
      // Claim this week SYNCHRONOUSLY (not in onPlayed) so the auto-play effect
      // can't also fire an unsolicited second briefing — a deliberate manual play
      // satisfies the week. The button itself is never gated by the guard, so the
      // owner can always re-play on demand (it just re-stamps the same week).
      try {
        localStorage.setItem(key, "1");
      } catch {
        /* noop */
      }
      setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      enqueue(
        {
          type: "weekly_briefing",
          title: "Weekly strategy briefing",
          text: data.text,
        },
        { front: true },
      );
      return data;
    } catch (err) {
      setError(err.message || "Couldn't reach Echo");
      throw err;
    }
  }, [enqueue, markUserInitiated]);

  // Record the owner's decision on a proactive suggestion and drop it from the
  // popover. "Set it up" navigates to the tool's section; "Not now" just dismisses.
  const acceptSuggestion = useCallback((sug) => {
    if (!sug || !sug.key) return;
    setSuggestions((list) => list.filter((s) => s.key !== sug.key));
    api.echoVoiceDecideSuggestion(sug.key, "accepted").catch(() => {});
    if (sug.section) {
      try {
        window.dispatchEvent(
          new CustomEvent("echoai:navigate-section", { detail: sug.section }),
        );
      } catch {
        /* noop */
      }
    }
  }, []);

  const dismissSuggestion = useCallback((sug) => {
    if (!sug || !sug.key) return;
    setSuggestions((list) => list.filter((s) => s.key !== sug.key));
    api.echoVoiceDecideSuggestion(sug.key, "declined").catch(() => {});
  }, []);

  // ---- morning briefing (once/day) -------------------------------------
  const briefingTriedRef = useRef(false);
  useEffect(() => {
    if (!active || !settingsLoaded) return;
    if (muted) return;
    if (briefingTriedRef.current) return;
    briefingTriedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        // Scope the login briefing to the brand the dashboard is showing so
        // its Sage note can never reference another brand's intelligence.
        const bctx0 =
          (typeof window !== "undefined" && window.__echoaiBrands) || {};
        const briefingBrand = bctx0.activeIsDemo ? null : bctx0.activeId || null;
        const b = await api.echoVoiceGetBriefing(briefingBrand || undefined);
        if (cancelled) return;
        if (!b.enabled || !b.autoBriefing) return;
        // The standby greeting fires on EVERY login (owner preference), not
        // once per day — it never replays the briefing itself, it only tells
        // the owner Echo is standing by. The token-scoped session key below
        // still stops bare page reloads from re-greeting.
        const key = briefingSessionKey();
        try {
          if (sessionStorage.getItem(key)) return;
        } catch {
          /* noop */
        }
        // Echo NEVER auto-plays the briefing. He greets the owner, announces
        // he is standing by, and waits for an explicit go-ahead ("Hey Echo,
        // start my briefing", "ready", "run it"...). The conversation engine
        // owns delivery — and only IT marks the briefing delivered, so the
        // once-per-day server stamp reflects a briefing that was actually heard.
        enqueue({
          type: "morning_briefing",
          title: "Morning greeting",
          // When the owner has saved morning-music favorites, Echo also lets
          // them know their playlist is ready ("Hey Echo, start my music").
          // Greet by the owner's LOCAL clock (server-computed from the brand
          // settings timezone): morning gets the briefing standby, while an
          // afternoon/evening/late login offers a quick day update instead.
          text: (() => {
            // Tell the owner which business they're set up on (multi-business
            // accounts only) so they can say "switch to <name>" right away.
            const bx =
              (typeof window !== "undefined" && window.__echoaiBrands) || {};
            const brandLine =
              !bx.activeIsDemo &&
              bx.activeName &&
              Array.isArray(bx.brands) &&
              bx.brands.length > 1
                ? ` You're set up on ${bx.activeName} — say "switch to" another business anytime.`
                : "";
            const base = `${standbyGreeting(b.partOfDay)}${brandLine}`;
            return b.musicReady ? `${base} ${musicReadyLine()}` : base;
          })(),
          // No music intro — go straight to Echo speaking.
          playIntro: false,
          onPlayed: async () => {
            try {
              sessionStorage.setItem(key, "1");
            } catch {
              /* noop */
            }
            // Hand off to the always-on conversation engine: Echo goes quiet
            // and waits for the owner to start the briefing.
            try {
              window.dispatchEvent(new CustomEvent("echo:briefing-standby"));
            } catch {
              /* noop */
            }
          },
        });
      } catch {
        /* briefing is best-effort; never block the app */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, settingsLoaded, muted, enqueue]);

  // ---- weekly strategy briefing (once/week) -----------------------------
  // Auto-plays the weekly briefing at most once per ISO week, appended after the
  // morning greeting. Guarded in localStorage (persists across logins) and gated
  // by the same enabled + autoBriefing prefs as the morning briefing. The
  // per-week guard is checked BEFORE the request so we never spend an AI call we
  // won't use.
  const weeklyTriedRef = useRef(false);
  useEffect(() => {
    if (!active || !settingsLoaded) return;
    if (muted) return;
    // LOGIN SILENCE RULE: never auto-play the weekly briefing right after
    // login. It only auto-plays once the owner has engaged Echo this session.
    if (!userInitiated) return;
    if (weeklyTriedRef.current) return;
    weeklyTriedRef.current = true;
    const s = settingsRef.current;
    if (!s.enabled || !s.autoBriefing) return;
    const key = WEEKLY_KEY_PREFIX + isoWeekKey();
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      /* noop */
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await api.echoVoiceGetWeekly();
        if (cancelled) return;
        const guardKey = WEEKLY_KEY_PREFIX + (data.weekKey || isoWeekKey());
        // Re-check after the async fetch: a manual "Weekly" click could have
        // claimed the week in the meantime. Then claim SYNCHRONOUSLY before
        // enqueue so this path can't double up with a concurrent trigger. A
        // blocked (autoplay-gated) item is re-queued in-session by the drain
        // loop, so claiming up front doesn't lose the briefing within the session.
        try {
          if (localStorage.getItem(guardKey)) return;
          localStorage.setItem(guardKey, "1");
        } catch {
          /* noop */
        }
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
        enqueue({
          type: "weekly_briefing",
          title: "Weekly strategy briefing",
          text: data.text,
        });
      } catch {
        /* best-effort; never block the app */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, settingsLoaded, muted, userInitiated, enqueue]);

  // ---- pending poll (reminders + alerts) --------------------------------
  useEffect(() => {
    if (!active) return;
    let stopped = false;

    const poll = async () => {
      if (stopped) return;
      if (mutedRef.current) return;
      if (document.hidden) return;
      // LOGIN SILENCE RULE: hold ALL auto-spoken alerts (Sage urgent reports,
      // reminders, hot-lead alerts...) until the owner has engaged Echo this
      // session. On login Echo says the standby greeting and nothing else.
      if (!userInitiatedRef.current) return;
      // Client-side quiet-hours guard (server also enforces, coarsely in UTC).
      const s = settingsRef.current;
      if (!s.enabled) return;
      if (isQuietHour(new Date().getHours(), s.quietHours)) return;
      try {
        // Brand isolation: tell the server which brand the dashboard is
        // showing so brand-scoped alerts (Sage urgent reports…) for OTHER
        // brands stay held server-side until the owner switches to them.
        const bctx = (typeof window !== "undefined" && window.__echoaiBrands) || {};
        const activeBrandId = bctx.activeIsDemo ? null : bctx.activeId || null;
        // On the demo brand send an explicit "none" sentinel (non-UUID) so the
        // server holds ALL brand-scoped alerts instead of falling back to the
        // last real active brand.
        const data = await api.echoVoiceGetPending(
          new Date().getHours(),
          bctx.activeIsDemo ? "none" : activeBrandId
        );
        if (stopped) return;
        const list = (data && data.notifications) || [];
        for (const n of list) {
          // Delivery-time validation (defense in depth): never enqueue a
          // brand-scoped alert unless its brandId matches the brand the
          // dashboard is showing RIGHT NOW. It stays pending server-side and
          // delivers after the owner switches to that brand.
          const alertBrand =
            n.payload && n.payload.brandId ? String(n.payload.brandId) : null;
          if (alertBrand && String(activeBrandId || "") !== alertBrand) continue;
          // Skip terminal (spoken/dismissed) items, and anything already queued
          // or currently playing, so we don't double-enqueue. A blocked/stopped
          // item leaves the queue without becoming terminal, so it re-enqueues
          // here on a later tick — reminders/alerts are never silently dropped.
          if (deliveredIds.current.has(n.id)) continue;
          const alreadyQueued =
            queueRef.current.some((q) => q.notificationId === n.id) ||
            (currentRef.current &&
              currentRef.current.notificationId === n.id);
          if (alreadyQueued) continue;
          enqueue({
            type: n.type,
            title: n.title,
            text: n.text,
            notificationId: n.id,
            // Carried so the drain loop can re-validate brand isolation at
            // the moment of speech (the owner may switch brands in between).
            brandId: alertBrand,
            // Live hot-lead handoff: after Echo speaks the "transfer or keep
            // handling?" alert, hand the conversationId to the conversation
            // engine so a spoken "transfer it" completes a seamless handoff.
            onPlayed:
              n.type === "autonomous_hot_lead" &&
              n.payload &&
              n.payload.conversationId
                ? () => {
                    try {
                      window.dispatchEvent(
                        new CustomEvent("echoai:autonomous-offer", {
                          detail: {
                            conversationId: n.payload.conversationId,
                          },
                        }),
                      );
                    } catch {
                      /* noop */
                    }
                  }
                : undefined,
          });
        }
      } catch {
        /* transient; try again next tick */
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [active, enqueue]);

  // Load settings once when the provider becomes active.
  useEffect(() => {
    if (!active) return;
    refreshSettings().catch(() => {});
  }, [active, refreshSettings]);

  // Tear down audio when the provider deactivates (logout).
  useEffect(() => {
    if (active) return;
    stopAll();
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    deliveredIds.current = new Set();
    speakAttemptsRef.current = new Map();
    briefingTriedRef.current = false;
    weeklyTriedRef.current = false;
    userInitiatedRef.current = false;
    setUserInitiated(false);
    setNeedsGesture(false);
  }, [active, stopAll]);

  // LOGOUT KILL SWITCH: the instant the app broadcasts a logout, silence
  // everything — the TTS queue, the in-flight chunk, the warm (unlocked)
  // audio element, and any browser speech synthesis. Also runs on unmount
  // (the provider unmounts when the app returns to the login screen), so
  // audio can never keep speaking after logout.
  useEffect(() => {
    const killAudio = () => {
      stopAll();
      killWarmAudio();
      try {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
      } catch {
        /* noop */
      }
    };
    window.addEventListener("echoai:logout", killAudio);
    return () => {
      window.removeEventListener("echoai:logout", killAudio);
      killAudio();
    };
  }, [stopAll]);

  const value = useMemo(
    () => ({
      active,
      settings,
      firstName,
      settingsLoaded,
      muted,
      playing,
      current,
      error,
      notice,
      needsGesture,
      suggestions,
      acceptSuggestion,
      dismissSuggestion,
      refreshSettings,
      saveSettings,
      toggleMute,
      talkToEcho,
      weeklyBriefing,
      replay,
      skip,
      stopAll,
      enqueue,
      markUserInitiated,
      registerConversationBusyProbe,
    }),
    [
      active,
      settings,
      firstName,
      settingsLoaded,
      muted,
      playing,
      current,
      error,
      notice,
      needsGesture,
      suggestions,
      acceptSuggestion,
      dismissSuggestion,
      refreshSettings,
      saveSettings,
      toggleMute,
      talkToEcho,
      weeklyBriefing,
      replay,
      skip,
      stopAll,
      enqueue,
      markUserInitiated,
      registerConversationBusyProbe,
    ],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice() {
  return useContext(VoiceContext);
}
