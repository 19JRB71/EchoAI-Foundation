/**
 * Echo Voice configuration — the single source of truth for voice-preference
 * defaults, the voice-style → OpenAI-TTS-voice mapping, and quiet-hours logic.
 * Shared by the controller, the enqueue helper, and the scheduler so all of them
 * apply the owner's preferences identically.
 */

// The three user-facing "voice styles" map onto real OpenAI TTS voices. `nova`
// is warm/natural, `shimmer` is bright/upbeat, `onyx` is deep/measured.
const VOICE_STYLES = {
  professional: "onyx",
  friendly: "nova",
  energetic: "shimmer",
};

const DEFAULT_STYLE = "friendly";

// Every event that can be spoken. Each has a default on/off used when the owner
// has never toggled it. Reminders default on; noisier alerts stay opt-in-able.
const EVENT_TYPES = [
  "morning_briefing",
  "appointment_15m",
  "appointment_5m",
  "followup_due",
  "day_summary",
  "hot_lead",
  "budget_low",
  "sentinel_fixed",
  "rep_completed",
];

// Defaults applied when a user has no stored voice_settings (or is missing keys).
const DEFAULT_SETTINGS = {
  enabled: true,
  style: DEFAULT_STYLE,
  volume: 0.9, // 0..1, applied client-side to the <audio> element
  autoBriefing: true, // morning briefing plays automatically on login
  quietHours: { enabled: true, start: 20, end: 8 }, // 8pm–8am, local browser time on the client; server uses UTC hour as a coarse guard
  events: {
    appointment_15m: true,
    appointment_5m: true,
    followup_due: true,
    day_summary: true,
    hot_lead: true,
    budget_low: true,
    sentinel_fixed: true,
    rep_completed: true,
  },
};

/**
 * Merge stored (possibly partial / legacy) settings over the defaults so callers
 * always get a fully-populated, valid settings object.
 */
function normalizeSettings(stored) {
  const s = stored && typeof stored === "object" ? stored : {};
  const quiet = s.quietHours && typeof s.quietHours === "object" ? s.quietHours : {};
  const events = s.events && typeof s.events === "object" ? s.events : {};

  const style = VOICE_STYLES[s.style] ? s.style : DEFAULT_SETTINGS.style;
  let volume = Number(s.volume);
  if (!Number.isFinite(volume)) volume = DEFAULT_SETTINGS.volume;
  volume = Math.min(1, Math.max(0, volume));

  return {
    enabled: typeof s.enabled === "boolean" ? s.enabled : DEFAULT_SETTINGS.enabled,
    style,
    volume,
    autoBriefing:
      typeof s.autoBriefing === "boolean" ? s.autoBriefing : DEFAULT_SETTINGS.autoBriefing,
    quietHours: {
      enabled:
        typeof quiet.enabled === "boolean" ? quiet.enabled : DEFAULT_SETTINGS.quietHours.enabled,
      start: clampHour(quiet.start, DEFAULT_SETTINGS.quietHours.start),
      end: clampHour(quiet.end, DEFAULT_SETTINGS.quietHours.end),
    },
    events: EVENT_TYPES.reduce((acc, type) => {
      if (type === "morning_briefing") return acc; // controlled by autoBriefing
      const val = events[type];
      acc[type] = typeof val === "boolean" ? val : DEFAULT_SETTINGS.events[type] !== false;
      return acc;
    }, {}),
  };
}

function clampHour(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 23) return fallback;
  return n;
}

/** Resolve a stored style name to the concrete OpenAI voice. */
function voiceForStyle(style) {
  return VOICE_STYLES[style] || VOICE_STYLES[DEFAULT_STYLE];
}

/**
 * Is `hour` (0..23) inside the quiet window? Handles windows that wrap midnight
 * (e.g. start=20, end=8 → quiet from 20:00 to 08:00).
 */
function isQuietHour(hour, quietHours) {
  if (!quietHours || !quietHours.enabled) return false;
  const { start, end } = quietHours;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end; // wraps midnight
}

module.exports = {
  VOICE_STYLES,
  DEFAULT_STYLE,
  EVENT_TYPES,
  DEFAULT_SETTINGS,
  normalizeSettings,
  voiceForStyle,
  isQuietHour,
};
