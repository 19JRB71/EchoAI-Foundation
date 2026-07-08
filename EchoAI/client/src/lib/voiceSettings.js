/**
 * Client mirror of the backend `config/echoVoice.js`. Keep the shape, defaults,
 * style list, event list, and quiet-hours logic in sync with the server so the
 * settings panel and the voice engine reason about preferences identically.
 * The server remains the source of truth for gating (GET /pending already
 * filters), but the client normalizes for display + optimistic UI.
 */

export const VOICE_STYLE_META = {
  professional: {
    label: "Professional",
    description: "Deep, measured, and calm — like a seasoned chief of staff.",
  },
  friendly: {
    label: "Friendly",
    description: "Warm and natural — Echo's default, approachable tone.",
  },
  energetic: {
    label: "Energetic",
    description: "Bright and upbeat — great for a high-momentum day.",
  },
  balanced: {
    label: "Balanced",
    description: "Neutral and clear — even-keeled and easy to listen to.",
  },
  expressive: {
    label: "Expressive",
    description: "Characterful and warm — a storyteller's cadence.",
  },
  confident: {
    label: "Confident",
    description: "Crisp and assured — direct and to the point.",
  },
};

export const DEFAULT_STYLE = "friendly";

// Owner-toggleable spoken events (morning_briefing is controlled by autoBriefing,
// so it is intentionally not listed here).
export const EVENT_META = [
  {
    key: "appointment_15m",
    label: "Appointment reminders (15 min)",
    description: "Echo speaks a heads-up 15 minutes before each appointment.",
  },
  {
    key: "appointment_5m",
    label: "Appointment reminders (5 min)",
    description: "A final nudge 5 minutes before an appointment starts.",
  },
  {
    key: "followup_due",
    label: "Follow-up due",
    description: "Reminders when a scheduled follow-up call is due.",
  },
  {
    key: "day_summary",
    label: "End-of-day summary",
    description: "A spoken wrap-up of the day around 6pm.",
  },
  {
    key: "hot_lead",
    label: "Hot lead alerts",
    description: "Instant alert when a high-intent lead comes in.",
  },
  {
    key: "budget_low",
    label: "Budget alerts",
    description: "Heads-up when a campaign's budget is running low.",
  },
  {
    key: "sentinel_fixed",
    label: "Sentinel auto-fixes",
    description: "Notice when Sentinel automatically fixes an account issue.",
  },
  {
    key: "rep_completed",
    label: "Sales rep completed a lead",
    description: "Alert when a sales rep wraps up a lead in the queue.",
  },
];

const EVENT_KEYS = EVENT_META.map((e) => e.key);

export const DEFAULT_SETTINGS = {
  enabled: true,
  style: DEFAULT_STYLE,
  volume: 0.9,
  autoBriefing: true,
  quietHours: { enabled: true, start: 20, end: 8 },
  events: EVENT_KEYS.reduce((acc, k) => {
    acc[k] = true;
    return acc;
  }, {}),
};

function clampHour(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 23) return fallback;
  return n;
}

/** Merge stored (possibly partial) settings over the defaults. */
export function normalizeSettings(stored) {
  const s = stored && typeof stored === "object" ? stored : {};
  const quiet = s.quietHours && typeof s.quietHours === "object" ? s.quietHours : {};
  const events = s.events && typeof s.events === "object" ? s.events : {};

  const style = VOICE_STYLE_META[s.style] ? s.style : DEFAULT_SETTINGS.style;
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
        typeof quiet.enabled === "boolean"
          ? quiet.enabled
          : DEFAULT_SETTINGS.quietHours.enabled,
      start: clampHour(quiet.start, DEFAULT_SETTINGS.quietHours.start),
      end: clampHour(quiet.end, DEFAULT_SETTINGS.quietHours.end),
    },
    events: EVENT_KEYS.reduce((acc, k) => {
      const val = events[k];
      acc[k] = typeof val === "boolean" ? val : true;
      return acc;
    }, {}),
    // Saved morning-music favorites (up to 5 songs/artists). The server owns
    // the admin default suggestions; the client just mirrors what it was sent.
    musicFavorites: Array.isArray(s.musicFavorites)
      ? s.musicFavorites
          .filter((f) => typeof f === "string" && f.trim())
          .map((f) => f.trim().slice(0, 200))
          .slice(0, 5)
      : [],
  };
}

/**
 * Is `hour` (0..23) inside the quiet window? Mirrors the server; handles windows
 * that wrap midnight (start=20, end=8 → quiet 20:00–08:00).
 */
export function isQuietHour(hour, quietHours) {
  if (!quietHours || !quietHours.enabled) return false;
  const { start, end } = quietHours;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

/**
 * Split a spoken script into small sequential chunks so the first (short) chunk
 * can be synthesized and start playing in ~1-2s while later chunks synthesize in
 * the background. The first chunk is kept deliberately small (fast time-to-first-
 * audio); later chunks are larger to minimize request overhead. Sentence
 * boundaries are preserved so speech sounds natural.
 */
export function chunkForSpeech(text, { firstMax = 120, max = 240 } = {}) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return [];
  // Sentences (keeping terminal punctuation), or the trailing unpunctuated tail.
  const sentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [clean];
  const chunks = [];
  let buf = "";
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    const limit = chunks.length === 0 ? firstMax : max;
    if (!buf) {
      buf = s;
    } else if (buf.length + 1 + s.length <= limit) {
      buf += " " + s;
    } else {
      chunks.push(buf);
      buf = s;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/** Format an hour (0..23) as a friendly 12h label, e.g. 20 → "8:00 PM". */
export function formatHour(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  const period = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${period}`;
}
