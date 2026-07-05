/**
 * The compact Echo "Talk to Echo" control that lives in the top navigation bar,
 * next to the speaker mute button. It is a small icon button; when Echo is
 * speaking (or an error / autoplay-gesture prompt applies) a compact popover
 * drops down beneath it with the live waveform, the spoken title/text, and
 * Skip / Replay / Talk controls. Everything is driven by the VoiceContext
 * engine; this component is purely presentational + user gestures.
 */
import { useEffect, useRef, useState } from "react";
import { useVoice } from "./VoiceContext.jsx";

const BAR_COUNT = 16;

function Waveform({ active }) {
  const [bars, setBars] = useState(() => new Array(BAR_COUNT).fill(0.2));
  const rafRef = useRef(null);

  useEffect(() => {
    if (!active) {
      setBars(new Array(BAR_COUNT).fill(0.15));
      return;
    }
    let t = 0;
    const tick = () => {
      t += 0.25;
      setBars(
        Array.from({ length: BAR_COUNT }, (_, i) => {
          const base =
            0.5 +
            0.35 * Math.sin(t + i * 0.5) +
            0.15 * Math.sin(t * 1.7 + i * 0.9);
          const jitter = (Math.random() - 0.5) * 0.2;
          return Math.min(1, Math.max(0.12, base + jitter));
        }),
      );
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active]);

  return (
    <div className="flex h-6 items-center gap-[2px]" aria-hidden="true">
      {bars.map((h, i) => (
        <span
          key={i}
          className="w-[2px] rounded-full bg-teal-400 transition-[height] duration-100"
          style={{ height: `${Math.round(h * 100)}%`, opacity: active ? 1 : 0.4 }}
        />
      ))}
    </div>
  );
}

function MicIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 12a6 6 0 01-12 0M12 18v3" />
    </svg>
  );
}

export default function VoicePlayer() {
  const voice = useVoice();
  const [busyStatus, setBusyStatus] = useState(false);

  if (!voice || !voice.active) return null;

  const { muted, playing, current, error, needsGesture } = voice;

  const handleTalk = async () => {
    setBusyStatus(true);
    try {
      await voice.talkToEcho();
    } catch {
      /* error surfaced via context */
    } finally {
      setBusyStatus(false);
    }
  };

  // The popover only appears when there's something to show, keeping the top-bar
  // footprint to a single small icon the rest of the time.
  const expanded =
    busyStatus || Boolean(current) || Boolean(error) || (needsGesture && !playing);

  return (
    <div className="relative">
      <button
        onClick={handleTalk}
        disabled={busyStatus || muted}
        title={muted ? "Unmute to talk to Echo" : "Talk to Echo"}
        aria-label="Talk to Echo"
        className={`relative flex h-7 w-7 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
          expanded
            ? "text-teal-200"
            : "text-teal-300 hover:text-teal-200"
        }`}
      >
        <MicIcon />
        {playing && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-teal-400" />
        )}
      </button>

      {expanded ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-800 bg-gray-950/95 p-3 shadow-xl shadow-black/40 backdrop-blur">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-teal-300">
              {current ? current.title || "Echo" : busyStatus ? "Asking Echo…" : "Echo"}
            </span>
            {playing && <span className="text-[10px] text-gray-500">speaking…</span>}
          </div>

          {current || playing ? <Waveform active={playing} /> : null}

          {current && current.text ? (
            <p className="mt-1 text-xs leading-relaxed text-gray-400 line-clamp-3">
              {current.text}
            </p>
          ) : null}

          {error ? <p className="mt-1 text-xs text-amber-400">{error}</p> : null}

          {needsGesture && !playing ? (
            <p className="mt-1 text-xs text-teal-300">
              Click anywhere to hear Echo’s briefing.
            </p>
          ) : null}

          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={voice.skip}
              disabled={!playing}
              className="rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-40"
            >
              Skip
            </button>
            <button
              onClick={voice.replay}
              className="rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs font-medium text-gray-300 hover:bg-gray-800"
            >
              Replay
            </button>
            <button
              onClick={handleTalk}
              disabled={busyStatus || muted}
              className="ml-auto rounded-lg bg-teal-500/90 px-2.5 py-1 text-xs font-semibold text-black hover:bg-teal-400 disabled:opacity-50"
            >
              {busyStatus ? "Asking…" : "Talk to Echo"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
