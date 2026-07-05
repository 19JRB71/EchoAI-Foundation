/**
 * The always-visible Echo Voice dock (bottom-left, clear of the Echo FAB).
 *
 * Idle: a compact pill with a mute toggle + "Talk to Echo" on-demand status.
 * Active: expands into a live waveform with the spoken title/text and Skip /
 * Replay controls. Everything here is driven by the VoiceContext engine; this
 * component is purely presentational + user gestures.
 */
import { useEffect, useRef, useState } from "react";
import { useVoice } from "./VoiceContext.jsx";

const BAR_COUNT = 22;

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
      // A lively, organic-looking waveform: layered sines + a little jitter.
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
    <div className="flex h-8 items-center gap-[3px]" aria-hidden="true">
      {bars.map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-teal-400 transition-[height] duration-100"
          style={{ height: `${Math.round(h * 100)}%`, opacity: active ? 1 : 0.4 }}
        />
      ))}
    </div>
  );
}

function SpeakerIcon({ muted }) {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 9v6h3l4.5 4.5V4.5L9 9H6z"
      />
      {muted ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 9l4 4m0-4l-4 4" />
      ) : (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17 8.5a5 5 0 010 7M19.5 6a8.5 8.5 0 010 12"
        />
      )}
    </svg>
  );
}

export default function VoicePlayer() {
  const voice = useVoice();
  const [busyStatus, setBusyStatus] = useState(false);

  if (!voice || !voice.active) return null;

  const { muted, playing, current, error, settings } = voice;

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

  const expanded = Boolean(current) || Boolean(error);

  return (
    <div className="fixed bottom-6 left-6 z-40 max-w-[calc(100vw-3rem)]">
      <div className="flex flex-col gap-2 rounded-2xl border border-gray-800 bg-gray-950/95 p-3 shadow-xl shadow-black/40 backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            onClick={voice.toggleMute}
            title={muted ? "Unmute Echo's voice" : "Mute Echo's voice"}
            aria-label={muted ? "Unmute Echo's voice" : "Mute Echo's voice"}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
              muted
                ? "border-gray-700 bg-gray-900 text-gray-500 hover:text-gray-300"
                : "border-teal-500/40 bg-teal-500/10 text-teal-300 hover:bg-teal-500/20"
            }`}
          >
            <SpeakerIcon muted={muted} />
          </button>

          {expanded ? (
            <div className="min-w-[190px] flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-teal-300">
                  {current ? current.title || "Echo" : "Echo"}
                </span>
                {playing && (
                  <span className="text-[10px] text-gray-500">speaking…</span>
                )}
              </div>
              <Waveform active={playing} />
            </div>
          ) : (
            <button
              onClick={handleTalk}
              disabled={busyStatus || muted}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-teal-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
              title={
                muted ? "Unmute to talk to Echo" : "Get a spoken status update from Echo"
              }
            >
              {busyStatus ? "Asking Echo…" : "🎙 Talk to Echo"}
            </button>
          )}
        </div>

        {current && current.text ? (
          <p className="max-w-xs text-xs leading-relaxed text-gray-400 line-clamp-3">
            {current.text}
          </p>
        ) : null}

        {error ? (
          <p className="max-w-xs text-xs text-amber-400">{error}</p>
        ) : null}

        {expanded ? (
          <div className="flex items-center gap-2">
            <button
              onClick={voice.skip}
              disabled={!playing}
              className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-40"
            >
              Skip
            </button>
            <button
              onClick={voice.replay}
              className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800"
            >
              Replay
            </button>
            <button
              onClick={handleTalk}
              disabled={busyStatus || muted}
              className="ml-auto rounded-lg bg-teal-500/90 px-3 py-1.5 text-xs font-semibold text-black hover:bg-teal-400 disabled:opacity-50"
            >
              Talk to Echo
            </button>
          </div>
        ) : null}

        {muted ? (
          <p className="text-[10px] text-gray-600">
            Voice muted — {settings.enabled ? "unmute to hear Echo" : "voice is off in settings"}
          </p>
        ) : null}
      </div>
    </div>
  );
}
