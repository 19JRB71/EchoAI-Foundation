/**
 * Echo Voice settings panel (Echo department → Voice Settings).
 *
 * Owner-only preferences for Echo's spoken voice: master enable, voice style,
 * volume, per-event toggles, quiet hours, the morning auto-briefing, and the
 * owner's first name used in spoken copy. Reads/writes through the VoiceContext
 * engine so changes take effect immediately (no reload).
 */
import { useEffect, useMemo, useState } from "react";
import Spinner from "../components/Spinner.jsx";
import { useVoice } from "../voice/VoiceContext.jsx";
import {
  VOICE_STYLE_META,
  EVENT_META,
  formatHour,
} from "../lib/voiceSettings.js";
import {
  buildVoiceReport,
  getVoiceEvents,
  clearVoiceEvents,
} from "../voice/flightRecorder.js";

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
        checked ? "bg-teal-500" : "bg-gray-700"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function VoiceSettings() {
  const voice = useVoice();
  const [draft, setDraft] = useState(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [err, setErr] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [diagCopiedAt, setDiagCopiedAt] = useState(0);

  // Load current settings once the context is ready.
  useEffect(() => {
    if (!voice) return;
    let active = true;
    (async () => {
      try {
        if (!voice.settingsLoaded) await voice.refreshSettings();
      } catch {
        /* fall back to whatever the context holds */
      }
      if (active) {
        setDraft((d) => d || voice.settings);
        setName((n) => (n !== "" ? n : voice.firstName || ""));
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice && voice.settingsLoaded]);

  // Initialize draft from context on first availability.
  useEffect(() => {
    if (voice && !draft) setDraft(voice.settings);
    if (voice && name === "" && voice.firstName) setName(voice.firstName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice]);

  const dirty = useMemo(() => {
    if (!voice || !draft) return false;
    return (
      JSON.stringify(draft) !== JSON.stringify(voice.settings) ||
      (name || "") !== (voice.firstName || "")
    );
  }, [draft, name, voice]);

  if (!voice) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-gray-800 bg-gray-900/60 p-8 text-center text-gray-400">
        Voice is unavailable in this workspace.
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="mx-auto max-w-3xl">
        <Spinner label="Loading voice settings…" />
      </div>
    );
  }

  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const updateEvent = (key, val) =>
    setDraft((d) => ({ ...d, events: { ...d.events, [key]: val } }));
  const updateQuiet = (patch) =>
    setDraft((d) => ({ ...d, quietHours: { ...d.quietHours, ...patch } }));

  const handleSave = async () => {
    setSaving(true);
    setErr("");
    try {
      // Drop blank music slots so the saved list matches what the server keeps.
      const cleaned = {
        ...draft,
        musicFavorites: (draft.musicFavorites || [])
          .map((s) => (typeof s === "string" ? s.trim() : ""))
          .filter(Boolean),
      };
      await voice.saveSettings(cleaned, name.trim());
      setDraft(cleaned);
      setSavedAt(Date.now());
    } catch (e) {
      setErr(e.message || "Couldn't save your voice settings.");
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setErr("");
    try {
      // Persist first so the preview uses the chosen style, then speak a sample.
      if (dirty) await voice.saveSettings(draft, name.trim());
      await voice.talkToEcho();
    } catch (e) {
      setErr(e.message || "Couldn't play a preview.");
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-100">Echo Voice</h1>
        <p className="mt-1 text-sm text-gray-400">
          Echo can speak to you — a morning briefing when you log in, spoken
          reminders before appointments and follow-ups, and real-time alerts for
          hot leads and account issues. Tune it all here.
        </p>
      </div>

      {/* Master enable */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-gray-100">
              Echo's voice
            </div>
            <div className="text-xs text-gray-400">
              Master switch for all spoken briefings, reminders and alerts.
            </div>
          </div>
          <Toggle
            checked={draft.enabled}
            onChange={(v) => update({ enabled: v })}
          />
        </div>
      </section>

      <fieldset
        disabled={!draft.enabled}
        className={draft.enabled ? "space-y-6" : "space-y-6 opacity-50"}
      >
        {/* Your name */}
        <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
          <label className="text-sm font-semibold text-gray-100">
            What should Echo call you?
          </label>
          <p className="mb-2 text-xs text-gray-400">
            Echo uses your first name in spoken briefings (e.g. "Good morning,
            Alex").
          </p>
          <input
            type="text"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your first name"
            className="w-full max-w-xs rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-teal-500 focus:outline-none"
          />
        </section>

        {/* Voice style */}
        <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
          <div className="mb-3 text-sm font-semibold text-gray-100">
            Voice style
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {Object.entries(VOICE_STYLE_META).map(([key, meta]) => {
              const selected = draft.style === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => update({ style: key })}
                  className={`rounded-xl border p-3 text-left transition ${
                    selected
                      ? "border-teal-500 bg-teal-500/10"
                      : "border-gray-700 bg-gray-950 hover:border-gray-600"
                  }`}
                >
                  <div className="text-sm font-semibold text-gray-100">
                    {meta.label}
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    {meta.description}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Volume */}
        <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-100">Volume</span>
            <span className="text-xs text-gray-400">
              {Math.round(draft.volume * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={draft.volume}
            onChange={(e) => update({ volume: Number(e.target.value) })}
            className="w-full accent-teal-500"
          />
        </section>

        {/* Morning briefing */}
        <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-gray-100">
                Morning briefing on login
              </div>
              <div className="text-xs text-gray-400">
                Echo automatically speaks a summary of what happened since you
                were last here — once per day.
              </div>
            </div>
            <Toggle
              checked={draft.autoBriefing}
              onChange={(v) => update({ autoBriefing: v })}
            />
          </div>
        </section>

        {/* Music preferences */}
        <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
          <div className="text-sm font-semibold text-gray-100">
            Music preferences
          </div>
          <p className="mb-3 mt-1 text-xs text-gray-400">
            Save up to five favorite songs, artists, or playlists. Say
            &ldquo;Hey Echo, start my music&rdquo;, &ldquo;play my morning
            playlist&rdquo;, &ldquo;play song number two&rdquo;, or &ldquo;play my
            second song&rdquo; and Echo
            plays them through YouTube. &ldquo;Next song&rdquo; skips,
            &ldquo;stop the music&rdquo; stops.
          </p>
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-5 text-right text-xs text-gray-500">
                  {i + 1}.
                </span>
                <input
                  type="text"
                  value={(draft.musicFavorites || [])[i] || ""}
                  maxLength={200}
                  onChange={(e) => {
                    const next = Array.from(
                      { length: 5 },
                      (_, j) => (draft.musicFavorites || [])[j] || "",
                    );
                    next[i] = e.target.value;
                    update({ musicFavorites: next });
                  }}
                  placeholder={
                    i === 0
                      ? 'e.g. "AC/DC Thunderstruck"'
                      : "Song, artist, or playlist name"
                  }
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-teal-500 focus:outline-none"
                />
              </div>
            ))}
          </div>
        </section>

        {/* Event toggles */}
        <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
          <div className="mb-3 text-sm font-semibold text-gray-100">
            What Echo speaks
          </div>
          <div className="divide-y divide-gray-800">
            {EVENT_META.map((ev) => (
              <div
                key={ev.key}
                className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div>
                  <div className="text-sm text-gray-200">{ev.label}</div>
                  <div className="text-xs text-gray-500">{ev.description}</div>
                </div>
                <Toggle
                  checked={draft.events[ev.key] !== false}
                  onChange={(v) => updateEvent(ev.key, v)}
                />
              </div>
            ))}
          </div>
        </section>

        {/* Quiet hours */}
        <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-gray-100">
                Quiet hours
              </div>
              <div className="text-xs text-gray-400">
                Echo stays silent during this window (your local time).
              </div>
            </div>
            <Toggle
              checked={draft.quietHours.enabled}
              onChange={(v) => updateQuiet({ enabled: v })}
            />
          </div>
          {draft.quietHours.enabled && (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-gray-300">
              <span>From</span>
              <select
                value={draft.quietHours.start}
                onChange={(e) => updateQuiet({ start: Number(e.target.value) })}
                className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-gray-100"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {formatHour(h)}
                  </option>
                ))}
              </select>
              <span>to</span>
              <select
                value={draft.quietHours.end}
                onChange={(e) => updateQuiet({ end: Number(e.target.value) })}
                className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-gray-100"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {formatHour(h)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>
      </fieldset>

      {/* Voice diagnostic recorder (flight recorder) */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
        <div className="text-sm font-semibold text-gray-100">
          Voice diagnostic report
        </div>
        <p className="mb-3 mt-1 text-xs text-gray-400">
          Echo quietly keeps a log of this session&apos;s voice activity — what
          the microphone heard, what Echo said, and what it decided to do with
          each phrase. If Echo misbehaves (talks to herself, ignores a command,
          interrupts you), copy the report right after it happens and paste it
          to support — it shows exactly what went wrong. Nothing is sent
          anywhere unless you share it, and the log clears when you reload or
          close the tab.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              const report = buildVoiceReport();
              try {
                await navigator.clipboard.writeText(report);
                setDiagCopiedAt(Date.now());
              } catch {
                // Clipboard blocked (some browsers/iframes): download instead.
                const blob = new Blob([report], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "echo-voice-report.txt";
                a.click();
                URL.revokeObjectURL(url);
                setDiagCopiedAt(Date.now());
              }
            }}
            className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-medium text-gray-200 transition hover:bg-gray-800"
          >
            📋 Copy diagnostic report
          </button>
          <button
            type="button"
            onClick={() => {
              clearVoiceEvents();
              setDiagCopiedAt(0);
            }}
            className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-400 transition hover:bg-gray-900"
          >
            Clear log
          </button>
          {diagCopiedAt > 0 && (
            <span className="text-xs text-teal-300">
              Copied — paste it into the chat.
            </span>
          )}
          <span className="text-xs text-gray-500">
            {getVoiceEvents().length} events recorded this session
          </span>
        </div>
      </section>

      {err && (
        <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">
          {err}
        </div>
      )}

      <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-2xl border border-gray-800 bg-gray-950/90 p-4 backdrop-blur">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="rounded-lg bg-teal-500 px-5 py-2 text-sm font-semibold text-black transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        <button
          onClick={handlePreview}
          disabled={previewing || !draft.enabled || voice.muted}
          className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-medium text-gray-200 transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          title={voice.muted ? "Unmute Echo to preview" : "Hear a sample in this voice"}
        >
          {previewing ? "Playing…" : "🔊 Preview voice"}
        </button>
        {savedAt > 0 && !dirty && (
          <span className="text-xs text-teal-300">Saved</span>
        )}
        {voice.muted && (
          <span className="text-xs text-amber-400">
            Voice is muted from the top bar — unmute to hear Echo.
          </span>
        )}
      </div>
    </div>
  );
}
