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
import { getWarmAudio } from "./audioUnlock.js";

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
  // True while Sales Presentation Mode is running. Read at synth time so EVERY
  // spoken surface (briefing, scripted lines, suggestions, nav confirmations)
  // requests the strict ElevenLabs-only path — the voice never switches mid-demo.
  const presentationRef = useRef(false);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

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
        const item = queueRef.current.shift();
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
    setNotice("");
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

  // On-demand weekly strategy briefing (the "Weekly" button). Plays immediately
  // (front of queue) and stamps this week's guard so it won't also auto-play.
  const weeklyBriefing = useCallback(async () => {
    try {
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
  }, [enqueue]);

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
        const b = await api.echoVoiceGetBriefing();
        if (cancelled) return;
        if (!b.enabled || !b.autoBriefing) return;
        // Fire on EVERY login regardless of whether the account has data — the
        // greeting must always play. The token-scoped guard only suppresses a
        // bare page reload within the same login session; a new login mints a new
        // token and greets again. We deliberately do NOT honor
        // `alreadyDeliveredToday`.
        const key = briefingSessionKey();
        try {
          if (sessionStorage.getItem(key)) return;
        } catch {
          /* noop */
        }
        enqueue({
          type: "morning_briefing",
          title: "Morning briefing",
          text: b.text,
          // No music intro — go straight to Echo speaking.
          playIntro: false,
          onPlayed: async () => {
            try {
              sessionStorage.setItem(key, "1");
            } catch {
              /* noop */
            }
            api.echoVoiceMarkBriefingDelivered().catch(() => {});
            // Hand off to the always-on conversation engine: after the briefing,
            // Echo asks what to tackle first and starts listening (if enabled).
            try {
              window.dispatchEvent(new CustomEvent("echo:briefing-done"));
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
    weeklyTriedRef.current = false;
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
    ],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice() {
  return useContext(VoiceContext);
}
