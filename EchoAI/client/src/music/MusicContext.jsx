import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../api.js";

// In-dashboard YouTube music player. A single hidden YT.Player instance plays
// audio in the background while the owner works; a sidebar widget and Echo's
// voice commands drive it. Playback uses the YouTube IFrame API (video IDs only,
// no key needed); turning a spoken request like "play some lofi" into a video ID
// uses the server's /api/music/search (needs YOUTUBE_API_KEY, degrades to 503).

const MusicContext = createContext(null);

const IFRAME_API_SRC = "https://www.youtube.com/iframe_api";
const DEFAULT_VOLUME = 60;
const DUCK_FACTOR = 0.25; // lower music to 25% while Echo is speaking
const MORNING_QUERY = "uplifting morning focus music";

let apiLoading = null;
// Loads the YouTube IFrame API exactly once and resolves when window.YT is ready.
function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiLoading) return apiLoading;
  apiLoading = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") {
        try {
          prev();
        } catch {
          /* ignore */
        }
      }
      resolve(window.YT);
    };
    if (!document.querySelector(`script[src="${IFRAME_API_SRC}"]`)) {
      const tag = document.createElement("script");
      tag.src = IFRAME_API_SRC;
      document.head.appendChild(tag);
    }
  });
  return apiLoading;
}

export function MusicProvider({ children }) {
  const playerRef = useRef(null);
  const readyRef = useRef(false);
  const queueRef = useRef([]);
  const indexRef = useRef(0);
  const volumeRef = useRef(DEFAULT_VOLUME);
  const duckedRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(null); // { videoId, title, channel }
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME);
  const [configured, setConfigured] = useState(false);

  // Whether music search is available (search key set on the server).
  useEffect(() => {
    let alive = true;
    api
      .musicStatus()
      .then((s) => {
        if (alive) setConfigured(Boolean(s && s.configured));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const applyVolume = useCallback((v) => {
    const p = playerRef.current;
    if (!p || !readyRef.current) return;
    const effective = duckedRef.current ? Math.round(v * DUCK_FACTOR) : v;
    try {
      p.setVolume(effective);
    } catch {
      /* player not ready */
    }
  }, []);

  const playIndex = useCallback(
    (i) => {
      const list = queueRef.current;
      if (i < 0 || i >= list.length) return;
      indexRef.current = i;
      const track = list[i];
      setCurrent(track);
      const p = playerRef.current;
      if (!p || !readyRef.current) return;
      try {
        p.loadVideoById(track.videoId);
        applyVolume(volumeRef.current);
      } catch {
        /* not ready yet */
      }
    },
    [applyVolume],
  );

  // Create the hidden player once the API is loaded.
  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then((YT) => {
      if (cancelled || !YT || playerRef.current) return;
      playerRef.current = new YT.Player("echo-yt-player", {
        height: "0",
        width: "0",
        playerVars: { autoplay: 1, controls: 0, disablekb: 1 },
        events: {
          onReady: () => {
            readyRef.current = true;
            setReady(true);
            applyVolume(volumeRef.current);
            // If a track was queued before the player existed, start it now.
            if (queueRef.current.length) playIndex(indexRef.current);
          },
          onStateChange: (e) => {
            // 1 = playing, 2 = paused, 0 = ended.
            if (e.data === 1) setPlaying(true);
            else if (e.data === 2) setPlaying(false);
            else if (e.data === 0) {
              // Auto-advance to the next queued track; stop at the end.
              const next = indexRef.current + 1;
              if (next < queueRef.current.length) playIndex(next);
              else setPlaying(false);
            }
          },
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [applyVolume, playIndex]);

  const playResults = useCallback(
    (list) => {
      const tracks = (Array.isArray(list) ? list : []).filter(
        (t) => t && t.videoId,
      );
      if (!tracks.length) return;
      queueRef.current = tracks;
      playIndex(0);
    },
    [playIndex],
  );

  const playQuery = useCallback(
    async (q) => {
      const query = (q && q.trim()) || MORNING_QUERY;
      try {
        const { results } = await api.musicSearch(query, 10);
        playResults(results);
      } catch {
        /* search unavailable (503/502) — nothing to play */
      }
    },
    [playResults],
  );

  // Play the owner's saved Music Preferences (up to 5 songs/artists), starting
  // at `index` (0-based) then continuing through the rest of the list. Each
  // saved name resolves to its top YouTube result at play time.
  const playFavorites = useCallback(
    async (index = 0) => {
      let favs = [];
      try {
        const r = await api.echoVoiceGetSettings();
        favs = (r && r.settings && r.settings.musicFavorites) || [];
      } catch {
        /* owner-only settings unavailable — nothing to play */
      }
      favs = favs.filter((s) => typeof s === "string" && s.trim());
      if (!favs.length) return;
      const start = Math.min(Math.max(0, Number(index) || 0), favs.length - 1);
      const ordered = favs.slice(start).concat(favs.slice(0, start));
      const settled = await Promise.allSettled(
        ordered.map((q) => api.musicSearch(q, 1)),
      );
      const tracks = settled.flatMap((s) =>
        s.status === "fulfilled" && s.value && Array.isArray(s.value.results)
          ? s.value.results.slice(0, 1)
          : [],
      );
      playResults(tracks);
    },
    [playResults],
  );

  const pause = useCallback(() => {
    const p = playerRef.current;
    if (p && readyRef.current) {
      try {
        p.pauseVideo();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const resume = useCallback(() => {
    const p = playerRef.current;
    if (p && readyRef.current && current) {
      try {
        p.playVideo();
      } catch {
        /* ignore */
      }
    }
  }, [current]);

  const togglePlay = useCallback(() => {
    if (playing) pause();
    else resume();
  }, [playing, pause, resume]);

  const skip = useCallback(() => {
    const next = indexRef.current + 1;
    if (next < queueRef.current.length) playIndex(next);
  }, [playIndex]);

  const stop = useCallback(() => {
    const p = playerRef.current;
    if (p && readyRef.current) {
      try {
        p.stopVideo();
      } catch {
        /* ignore */
      }
    }
    queueRef.current = [];
    indexRef.current = 0;
    setCurrent(null);
    setPlaying(false);
  }, []);

  const setVolume = useCallback(
    (v) => {
      const clamped = Math.max(0, Math.min(100, Math.round(v)));
      volumeRef.current = clamped;
      setVolumeState(clamped);
      applyVolume(clamped);
    },
    [applyVolume],
  );

  const nudgeVolume = useCallback(
    (delta) => setVolume(volumeRef.current + delta),
    [setVolume],
  );

  // Ducking: drop music volume while Echo speaks, restore afterward.
  const duck = useCallback(() => {
    duckedRef.current = true;
    applyVolume(volumeRef.current);
  }, [applyVolume]);
  const unduck = useCallback(() => {
    duckedRef.current = false;
    applyVolume(volumeRef.current);
  }, [applyVolume]);

  // Voice-command bridge: EchoConversation dispatches window events; run them.
  useEffect(() => {
    const onCommand = (e) => {
      const { action, value } = (e && e.detail) || {};
      switch (action) {
        case "play":
          playQuery(value);
          break;
        case "favorites":
          playFavorites((e.detail && e.detail.index) || 0);
          break;
        case "pause":
          pause();
          break;
        case "resume":
          resume();
          break;
        case "skip":
          skip();
          break;
        case "stop":
          stop();
          break;
        case "volume":
          nudgeVolume(value === "down" ? -20 : 20);
          break;
        default:
          break;
      }
    };
    const onTtsStart = () => duck();
    const onTtsEnd = () => unduck();
    const onMorning = () => playQuery(MORNING_QUERY);

    window.addEventListener("echoai:music-command", onCommand);
    window.addEventListener("echoai:tts-start", onTtsStart);
    window.addEventListener("echoai:tts-end", onTtsEnd);
    window.addEventListener("echoai:morning-return", onMorning);
    return () => {
      window.removeEventListener("echoai:music-command", onCommand);
      window.removeEventListener("echoai:tts-start", onTtsStart);
      window.removeEventListener("echoai:tts-end", onTtsEnd);
      window.removeEventListener("echoai:morning-return", onMorning);
    };
  }, [playQuery, playFavorites, pause, resume, skip, stop, nudgeVolume, duck, unduck]);

  const value = useMemo(
    () => ({
      ready,
      playing,
      current,
      volume,
      configured,
      playQuery,
      playResults,
      togglePlay,
      pause,
      resume,
      skip,
      stop,
      setVolume,
    }),
    [
      ready,
      playing,
      current,
      volume,
      configured,
      playQuery,
      playResults,
      togglePlay,
      pause,
      resume,
      skip,
      stop,
      setVolume,
    ],
  );

  return (
    <MusicContext.Provider value={value}>
      {/* Hidden audio-only player. */}
      <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
        <div id="echo-yt-player" />
      </div>
      {children}
    </MusicContext.Provider>
  );
}

export function useMusic() {
  const ctx = useContext(MusicContext);
  if (!ctx) {
    // Safe no-op fallback so components don't crash if used outside the provider.
    return {
      ready: false,
      playing: false,
      current: null,
      volume: 0,
      configured: false,
      playQuery: () => {},
      playResults: () => {},
      togglePlay: () => {},
      pause: () => {},
      resume: () => {},
      skip: () => {},
      stop: () => {},
      setVolume: () => {},
    };
  }
  return ctx;
}
