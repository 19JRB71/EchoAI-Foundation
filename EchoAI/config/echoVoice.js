/**
 * Echo Voice configuration — the single source of truth for voice-preference
 * defaults, the voice-style → OpenAI-TTS-voice mapping, and quiet-hours logic.
 * Shared by the controller, the enqueue helper, and the scheduler so all of them
 * apply the owner's preferences identically.
 */

// The user-facing "voice styles" map onto real OpenAI TTS voices (all six are
// supported by the `tts-1` model). Keep this in sync with the client mirror in
// `client/src/lib/voiceSettings.js` (VOICE_STYLE_META).
const VOICE_STYLES = {
  professional: "onyx", // deep/measured
  friendly: "nova", // warm/natural (default)
  energetic: "shimmer", // bright/upbeat
  balanced: "alloy", // neutral/even-keeled
  expressive: "fable", // characterful/storyteller
  confident: "echo", // crisp/assured
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
  "goal_alert",
  "sage_urgent",
  "personal_reminder",
  "task_alert",
  "task_checkin",
  "email_alert",
  "autonomous_hot_lead",
  "competitor_ad_threat",
  "competitor_site_change",
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
    goal_alert: true,
    sage_urgent: true,
    personal_reminder: true,
    task_alert: true,
    task_checkin: true,
    email_alert: true,
    autonomous_hot_lead: true,
    competitor_ad_threat: true,
    competitor_site_change: true,
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
    // Only persist the favorites key when the owner has actually set a list, so
    // "never set" stays distinguishable (the admin default suggestions apply
    // until the first explicit save). JSON.stringify drops `undefined`.
    ...(Array.isArray(s.musicFavorites)
      ? { musicFavorites: sanitizeMusicFavorites(s.musicFavorites) }
      : {}),
  };
}

function clampHour(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 23) return fallback;
  return n;
}

// Morning music favorites: up to 5 saved songs/artists/playlists (free-text
// names searched on YouTube at play time). The platform admin account starts
// with three suggestions until they save their own list; everyone else starts
// empty. Once the owner saves settings, the stored list (even empty) wins.
const MAX_MUSIC_FAVORITES = 5;
const DEFAULT_ADMIN_MUSIC_FAVORITES = [
  "AC/DC Thunderstruck",
  "Pharrell Williams Happy",
  "Survivor Eye of the Tiger",
];

/** Trim/clamp a stored favorites list to at most 5 non-empty names. */
function sanitizeMusicFavorites(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => s.trim().slice(0, 200))
    .slice(0, MAX_MUSIC_FAVORITES);
}

/**
 * Resolve the owner's music favorites from the RAW stored voice_settings blob.
 * Distinguishes "never set" (admin gets the default suggestions) from an
 * explicitly saved list (stored array wins, even when emptied on purpose).
 */
function resolveMusicFavorites(stored, role) {
  const s = stored && typeof stored === "object" ? stored : {};
  if (Array.isArray(s.musicFavorites)) return sanitizeMusicFavorites(s.musicFavorites);
  return role === "admin" ? DEFAULT_ADMIN_MUSIC_FAVORITES.slice() : [];
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
  MAX_MUSIC_FAVORITES,
  DEFAULT_ADMIN_MUSIC_FAVORITES,
  sanitizeMusicFavorites,
  resolveMusicFavorites,
  normalizeSettings,
  voiceForStyle,
  isQuietHour,
};
