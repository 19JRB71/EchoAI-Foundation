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
 * All TTS reuses POST /api/echo-voice/speak (OpenAI under the hood). Audio is a
 * per-item Blob → object URL, revoked when playback ends.
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
import { api } from "../api.js";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  isQuietHour,
  chunkForSpeech,
} from "../lib/voiceSettings.js";

const VoiceContext = createContext(null);

// How often to poll the server for pending spoken events while the app is open.
const POLL_MS = 30 * 1000;
const MUTE_KEY = "echoai_voice_muted";

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
  // True when the browser blocked autoplay; the next user gesture resumes playback.
  const [needsGesture, setNeedsGesture] = useState(false);

  // Internal refs (not state, to avoid re-renders / stale closures).
  const queueRef = useRef([]); // pending items to speak
  const currentRef = useRef(null); // item being spoken now
  const audioRef = useRef(null);
  const urlRef = useRef(null);
  const resolveRef = useRef(null); // resolves the in-flight speakItem promise
  const busyRef = useRef(false); // guards the drain loop
  const lastPlayedRef = useRef(null); // for replay
  // Server notification ids that reached a terminal state this session (spoken
  // or user-dismissed). Blocked/stopped/errored items are NOT added here so a
  // later poll re-enqueues them — we never silently drop a reminder/alert.
  const deliveredIds = useRef(new Set());
  const settingsRef = useRef(settings);
  const mutedRef = useRef(muted);
  const activeRef = useRef(active);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

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
        el.src = "";
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
          resolve(status);
        };
        resolveRef.current = settle;
        (async () => {
          // Split the script into small chunks so the first (short) chunk starts
          // playing in ~1-2s while later chunks synthesize during playback. This
          // cuts time-to-first-audio from ~10s (whole-script TTS) to ~1-2s.
          const style = settingsRef.current.style;
          const chunks = chunkForSpeech(item.text);
          if (chunks.length === 0) {
            settle("played");
            return;
          }
          // Prefetch pipeline: `pending` is the synthesis promise for the chunk
          // we're about to play. The next chunk's synthesis is kicked off as soon
          // as the current chunk *starts* playing, overlapping network + TTS with
          // playback so there are no gaps between chunks.
          let pending = api.echoVoiceSpeak(chunks[0], style);
          for (let i = 0; i < chunks.length; i++) {
            let blob;
            try {
              blob = await pending;
            } catch (err) {
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
            const el = new Audio(url);
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
                    pending = api.echoVoiceSpeak(chunks[i + 1], style);
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
              pending = api.echoVoiceSpeak(chunks[i + 1], style);
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
        const item = queueRef.current.shift();
        currentRef.current = item;
        lastPlayedRef.current = item;
        setCurrent(item);
        setPlaying(true);
        setError("");
        const status = await speakItem(item);
        setPlaying(false);
        currentRef.current = null;
        if (item.notificationId) {
          if (status === "played") {
            // Natural completion → tell the server so it isn't re-served.
            deliveredIds.current.add(item.notificationId);
            api.echoVoiceMarkNotification(item.notificationId).catch(() => {});
          } else if (status === "skipped") {
            // User skipped → dismiss it (don't re-serve, but it wasn't spoken).
            deliveredIds.current.add(item.notificationId);
            api
              .echoVoiceMarkNotification(item.notificationId, "dismissed")
              .catch(() => {});
          }
          // blocked/stopped/error → leave it un-terminal so a later poll retries.
        }
        if (status === "played" && item.onPlayed) {
          try {
            await item.onPlayed();
          } catch {
            /* noop */
          }
        }
        if (status === "blocked") {
          // Autoplay was gated before a user gesture. Put the item back at the
          // front (it has no notificationId, so nothing would re-serve it) and
          // flag that we need a gesture; the next click/keypress resumes playback.
          queueRef.current.unshift(item);
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
    }
  }, [speakItem]);

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
    // An explicit stop/mute clears the queue, so drop the stale "click to hear"
    // hint too — there's nothing left waiting on a gesture.
    setNeedsGesture(false);
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
      setError("");
      const data = await api.echoVoiceGetStatus();
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
  }, [enqueue]);

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
        const b = await api.echoVoiceGetBriefing();
        if (cancelled) return;
        if (!b.enabled || !b.autoBriefing) return;
        if (b.alreadyDeliveredToday) return;
        // Session guard: don't replay across tab reloads within the same day.
        const key = `echoai_briefing_${new Date().toISOString().slice(0, 10)}`;
        try {
          if (sessionStorage.getItem(key)) return;
        } catch {
          /* noop */
        }
        enqueue({
          type: "morning_briefing",
          title: "Morning briefing",
          text: b.text,
          onPlayed: async () => {
            try {
              sessionStorage.setItem(key, "1");
            } catch {
              /* noop */
            }
            api.echoVoiceMarkBriefingDelivered().catch(() => {});
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

  // ---- pending poll (reminders + alerts) --------------------------------
  useEffect(() => {
    if (!active) return;
    let stopped = false;

    const poll = async () => {
      if (stopped) return;
      if (mutedRef.current) return;
      if (document.hidden) return;
      // Client-side quiet-hours guard (server also enforces, coarsely in UTC).
      const s = settingsRef.current;
      if (!s.enabled) return;
      if (isQuietHour(new Date().getHours(), s.quietHours)) return;
      try {
        const data = await api.echoVoiceGetPending(new Date().getHours());
        if (stopped) return;
        const list = (data && data.notifications) || [];
        for (const n of list) {
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
    deliveredIds.current = new Set();
    briefingTriedRef.current = false;
    setNeedsGesture(false);
  }, [active, stopAll]);

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
      needsGesture,
      refreshSettings,
      saveSettings,
      toggleMute,
      talkToEcho,
      replay,
      skip,
      stopAll,
      enqueue,
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
      needsGesture,
      refreshSettings,
      saveSettings,
      toggleMute,
      talkToEcho,
      replay,
      skip,
      stopAll,
      enqueue,
    ],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice() {
  return useContext(VoiceContext);
}
