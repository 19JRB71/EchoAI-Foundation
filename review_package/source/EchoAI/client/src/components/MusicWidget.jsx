import { useState } from "react";
import { useMusic } from "../music/MusicContext.jsx";

// Compact background-music player pinned at the bottom of the sidebar. Drives the
// same YouTube player Echo controls by voice; search needs YOUTUBE_API_KEY.
export default function MusicWidget() {
  const m = useMusic();
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);

  async function onSearch(e) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    setSearching(true);
    try {
      await m.playQuery(query);
      setQ("");
    } finally {
      setSearching(false);
    }
  }

  const btn =
    "flex h-8 w-8 items-center justify-center rounded-md border border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-40";

  return (
    <div className="mt-3 rounded-lg border border-gray-800 bg-gray-950 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        <span aria-hidden>♪</span> Music
      </div>

      {m.current ? (
        <div className="mb-2 min-w-0">
          <div className="truncate text-sm font-medium text-gray-200" title={m.current.title}>
            {m.current.title}
          </div>
          {m.current.channel && (
            <div className="truncate text-xs text-gray-500">{m.current.channel}</div>
          )}
        </div>
      ) : (
        <div className="mb-2 text-xs text-gray-500">Nothing playing</div>
      )}

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={m.togglePlay}
          disabled={!m.current}
          title={m.playing ? "Pause" : "Play"}
          aria-label={m.playing ? "Pause" : "Play"}
          className={btn}
        >
          {m.playing ? "❚❚" : "▶"}
        </button>
        <button
          type="button"
          onClick={m.skip}
          disabled={!m.current}
          title="Skip"
          aria-label="Skip to next track"
          className={btn}
        >
          ⏭
        </button>
        <button
          type="button"
          onClick={m.stop}
          disabled={!m.current}
          title="Stop"
          aria-label="Stop music"
          className={btn}
        >
          ■
        </button>
        <input
          type="range"
          min="0"
          max="100"
          value={m.volume}
          onChange={(e) => m.setVolume(Number(e.target.value))}
          title="Volume"
          aria-label="Music volume"
          className="ml-1 h-1 flex-1 cursor-pointer accent-amber-500"
        />
      </div>

      {m.configured ? (
        <form onSubmit={onSearch} className="mt-2 flex gap-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Play a song or vibe…"
            className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 focus:border-amber-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={searching || !q.trim()}
            className="rounded-md bg-amber-500 px-2 py-1 text-xs font-semibold text-gray-900 hover:opacity-90 disabled:opacity-50"
          >
            {searching ? "…" : "Play"}
          </button>
        </form>
      ) : (
        <div className="mt-2 text-[11px] leading-tight text-gray-600">
          Add a YouTube API key to search &amp; play music by voice.
        </div>
      )}
    </div>
  );
}
