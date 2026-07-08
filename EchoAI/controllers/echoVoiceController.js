/**
 * Echo Voice controller — the owner-facing API behind Echo's spoken voice.
 *
 * Scope & gating: every endpoint is owner-only (mounted behind `requireOwner`)
 * and is deliberately NOT Pro-gated. Echo's voice is a core assistant across all
 * tiers, mirroring the setup-agent voice precedent (owner-only, ungated). Team
 * members never receive the owner's spoken briefings/alerts.
 *
 * TTS reuses the shared synthesis (voiceController → ElevenLabs, falling back to
 * OpenAI); this controller maps the owner's chosen style to a concrete OpenAI
 * voice (used only when the OpenAI fallback runs) and serves the wake-up intro.
 */
const fs = require("fs");
const path = require("path");
const db = require("../config/db");
const { synthesizeSpeech, isVoiceConfigured } = require("./voiceController");
const elevenlabs = require("../utils/elevenlabs");
const { normalizeSettings, voiceForStyle, isQuietHour } = require("../config/echoVoice");
const { gatherBriefingData, gatherWeeklyData, narrate } = require("../utils/echoBriefing");
const { recordShown, recordDecision, isValidKey } = require("../utils/echoSuggestions");
const { toJsonbParam } = require("../utils/jsonb");
const echoContext = require("../utils/echoContext");

/**
 * Speech-mode personalization block for a spoken briefing. Best-effort: returns
 * "" on any failure so the briefing still renders. It is tone/priority guidance
 * only — the spoken invariant (facts only from `data`) is preserved by framing.
 */
async function speechKnowledge(userId) {
  try {
    return await echoContext.buildKnowledgeContext(userId, null, { mode: "speech" });
  } catch (_e) {
    return "";
  }
}

/** Load the owner's row (first name, timestamps, stored settings). */
async function loadUser(userId) {
  const r = await db.query(
    `SELECT user_id, first_name, preferred_name, role, business_name, last_login_at, last_briefing_at, voice_settings
       FROM users WHERE user_id = $1`,
    [userId]
  );
  return r.rows[0] || null;
}

// What Echo calls the owner: their explicit name preference ("Boss",
// "Mr. Blacketer"…) wins, then their first name; the platform admin account
// defaults to "James" when neither is set.
function displayName(user) {
  if (!user) return null;
  if (user.preferred_name && user.preferred_name.trim())
    return user.preferred_name.trim();
  if (user.first_name && user.first_name.trim()) return user.first_name.trim();
  if (user.role === "admin") return "James";
  return null;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** GET /api/echo-voice/settings — the owner's normalized voice settings. */
async function getSettings(req, res) {
  try {
    const user = await loadUser(req.user.userId);
    return res.json({
      settings: normalizeSettings(user && user.voice_settings),
      firstName: displayName(user),
    });
  } catch (err) {
    console.error("getSettings error:", err.message);
    return res.status(500).json({ error: "Failed to load voice settings" });
  }
}

/**
 * PUT /api/echo-voice/settings — persist voice settings (and optionally the
 * owner's first name, which the spoken copy uses). Body may be partial; it is
 * normalized over defaults so the stored blob is always valid.
 */
async function updateSettings(req, res) {
  try {
    const body = req.body || {};
    const merged = normalizeSettings(body.settings || body);
    const fields = ["voice_settings = $2"];
    const params = [req.user.userId, toJsonbParam(merged)];

    if (typeof body.firstName === "string") {
      params.push(body.firstName.trim().slice(0, 120) || null);
      fields.push(`first_name = $${params.length}`);
    }

    const r = await db.query(
      `UPDATE users SET ${fields.join(", ")}, updated_at = NOW()
        WHERE user_id = $1
        RETURNING first_name, voice_settings`,
      params
    );
    const row = r.rows[0];
    return res.json({
      settings: normalizeSettings(row && row.voice_settings),
      firstName: row && row.first_name ? row.first_name : null,
    });
  } catch (err) {
    console.error("updateSettings error:", err.message);
    return res.status(500).json({ error: "Failed to save voice settings" });
  }
}

// ---------------------------------------------------------------------------
// Speech synthesis (owner-only, ungated)
// ---------------------------------------------------------------------------

/**
 * POST /api/echo-voice/speak — synthesize `text` in the owner's chosen voice
 * style and return the MP3. This is the ungated, owner-only TTS Echo uses for
 * briefings/reminders so voice works on every tier.
 */
async function speak(req, res) {
  const { text, style, presentation } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "text is required" });
  }
  // Sales Presentation Mode: the voice must never switch providers mid-demo, so
  // ElevenLabs is REQUIRED (no OpenAI fallback). If it can't speak, tell the
  // client to show a text notification instead of a different voice.
  const strict = Boolean(presentation);
  if (strict && !elevenlabs.ttsConfigured()) {
    return res
      .status(503)
      .json({ error: "Presentation voice unavailable", code: "tts_unavailable" });
  }
  if (!strict && !isVoiceConfigured()) {
    return res.status(503).json({ error: "Voice is not configured" });
  }
  try {
    const user = await loadUser(req.user.userId);
    const settings = normalizeSettings(user && user.voice_settings);
    const voice = voiceForStyle(style || settings.style);
    const audio = await synthesizeSpeech(String(text).slice(0, 4000), voice, {
      strict,
      label: "echo-speak",
    });
    res.setHeader("Content-Type", "audio/mpeg");
    return res.send(audio);
  } catch (err) {
    // Presentation mode with ElevenLabs down → 503 so the client shows text and
    // never falls back to a different voice.
    if (err && err.code === "tts_unavailable") {
      return res
        .status(503)
        .json({ error: "Presentation voice unavailable", code: "tts_unavailable" });
    }
    // ElevenLabs reached us but refused (bad key / quota exceeded / unknown
    // voice) → surface the exact reason instead of masking it with another voice.
    if (err && err.code === "elevenlabs_error") {
      console.error("Echo speak — ElevenLabs refused:", err.message);
      return res
        .status(502)
        .json({ error: err.message, provider: "elevenlabs", code: "elevenlabs_error" });
    }
    console.error("Echo speak error:", err.message);
    // Upstream AI (OpenAI) failure → 502, matching the AI-call convention.
    return res.status(502).json({ error: "Failed to generate speech" });
  }
}

// ---------------------------------------------------------------------------
// Morning wake-up music intro (ElevenLabs sound generation)
// ---------------------------------------------------------------------------

const AUDIO_DIR = path.join(__dirname, "..", "uploads", "audio");

// The morning wake-up music: a short, punchy AC/DC-style electric guitar riff
// that plays right before the briefing. Generated once and cached to disk (it's
// identical for every owner) so we don't pay the generation cost/latency on
// every login. The filename is VERSIONED (`-v2`) so changing the prompt below
// naturally invalidates any previously-cached synth sting from the old prompt.
const WAKEUP_PROMPT =
  "Short punchy electric guitar riff, AC/DC style hard rock: bold, energetic, " +
  "high-octane wake-up music with driving power chords and attitude. " +
  "Instrumental only, no vocals.";
const WAKEUP_DURATION = 4;
const WAKEUP_KEY = "wakeup-intro-v2";

// Named sound-effect catalog — tasteful, professional stings that give Echo
// personality through audio. Each is generated once and cached to disk. Keep
// them short so they enhance rather than interrupt the conversation.
const SOUND_EFFECTS = {
  // Played the instant Echo hears the wake word — "I'm listening".
  wake: {
    prompt:
      "Short soft UI activation chime: a single bright, friendly two-note ascending " +
      "digital confirmation tone. Clean, subtle, modern assistant wake sound.",
    duration: 1,
    influence: 0.4,
  },
  // Played when Echo goes quiet / the conversation closes.
  goodbye: {
    prompt:
      "Short soft UI sign-off chime: a gentle two-note descending tone, calm and " +
      "friendly, signalling an assistant going quiet. Subtle and warm.",
    duration: 1,
    influence: 0.4,
  },
  // Subtle ambient bed while Echo is processing a request.
  thinking: {
    prompt:
      "Very subtle ambient processing sound: soft warm synth shimmer with a faint " +
      "pulse, calm and unobtrusive, indicating a system quietly working.",
    duration: 2,
    influence: 0.3,
  },
  // Energetic alert before Echo speaks a hot-lead notification.
  hotlead: {
    prompt:
      "Short energetic positive alert: a bright, exciting upward notification sting " +
      "that grabs attention in a good way, signalling an important opportunity.",
    duration: 1,
    influence: 0.5,
  },
  // Brief celebration when a goal or milestone is hit.
  celebration: {
    prompt:
      "Short celebratory success sting: a brief triumphant sparkle with an uplifting " +
      "resolve, signalling an achievement. Joyful but tasteful, no vocals.",
    duration: 2,
    influence: 0.5,
  },
  // Subtle, non-alarming tone before Echo delivers bad news.
  error: {
    prompt:
      "Short subtle alert tone: a soft, low two-note cue signalling that something " +
      "needs attention. Serious but calm and professional, not harsh.",
    duration: 1,
    influence: 0.4,
  },
};

// Dedupe concurrent generations per cache key (multiple logins racing the first
// request for the same sound).
const soundGenerating = new Map();

/**
 * Return a cached ElevenLabs sound (generating + caching it on first request).
 * Concurrent callers for the same key share one in-flight generation.
 */
async function ensureCachedSound(key, prompt, durationSeconds, promptInfluence) {
  const file = path.join(AUDIO_DIR, `${key}.mp3`);
  try {
    const stat = fs.statSync(file);
    if (stat.size > 0) return fs.readFileSync(file);
  } catch (_e) {
    /* not cached yet — generate below */
  }
  if (!soundGenerating.has(key)) {
    const p = (async () => {
      const buf = await elevenlabs.generateSound(prompt, {
        durationSeconds,
        promptInfluence,
      });
      fs.mkdirSync(AUDIO_DIR, { recursive: true });
      fs.writeFileSync(file, buf);
      return buf;
    })().finally(() => {
      soundGenerating.delete(key);
    });
    soundGenerating.set(key, p);
  }
  return soundGenerating.get(key);
}

// Shared responder: stream a cached sound as audio/mpeg, or 204 (best-effort) so
// the client simply skips it — a sound must never block or error the caller.
async function serveCachedSound(res, key, prompt, duration, influence, label) {
  if (!elevenlabs.soundConfigured()) {
    return res.status(204).end();
  }
  try {
    const audio = await ensureCachedSound(key, prompt, duration, influence);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(audio);
  } catch (err) {
    console.error(`${label} error:`, err.message);
    return res.status(204).end();
  }
}

/**
 * GET /api/echo-voice/wakeup-intro — the upbeat AC/DC-style music intro that
 * plays before the morning briefing. audio/mpeg, or 204 when ElevenLabs isn't
 * configured / generation fails (the intro must never block the briefing).
 */
async function wakeupIntro(req, res) {
  return serveCachedSound(
    res,
    WAKEUP_KEY,
    WAKEUP_PROMPT,
    WAKEUP_DURATION,
    0.6,
    "wakeupIntro",
  );
}

/**
 * GET /api/echo-voice/sound/:name — a named personality sound effect (wake,
 * goodbye, thinking, hotlead, celebration, error). audio/mpeg, or 204 for an
 * unknown name / unconfigured ElevenLabs / failure so the client just skips it.
 */
async function sound(req, res) {
  const spec = SOUND_EFFECTS[req.params.name];
  if (!spec) return res.status(204).end();
  return serveCachedSound(
    res,
    `sfx-${req.params.name}`,
    spec.prompt,
    spec.duration,
    spec.influence,
    `sound:${req.params.name}`,
  );
}

// ---------------------------------------------------------------------------
// Briefings
// ---------------------------------------------------------------------------

function sameDay(a, b) {
  if (!a || !b) return false;
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/**
 * GET /api/echo-voice/briefing — the morning briefing text.
 * Returns `alreadyDeliveredToday` so the client only auto-plays it once per day.
 * "Since you were last here" uses last_login_at (falls back to last 24h).
 */
async function getBriefing(req, res) {
  try {
    const user = await loadUser(req.user.userId);
    const settings = normalizeSettings(user && user.voice_settings);
    const built = await buildMorningBriefing(req.user.userId, user);
    return res.json({
      text: built.text,
      aiNarrated: built.aiNarrated,
      style: settings.style,
      firstName: displayName(user),
      // Recomputed per request (depends on the user's live last_briefing_at, not
      // the cached narration) so once-per-day auto-play gating stays correct.
      alreadyDeliveredToday: sameDay(user && user.last_briefing_at, new Date()),
      autoBriefing: settings.autoBriefing,
      enabled: settings.enabled,
    });
  } catch (err) {
    console.error("getBriefing error:", err.message);
    return res.status(500).json({ error: "Failed to build briefing" });
  }
}

// Faster Echo: cache the (expensive) morning briefing narration per owner so a
// login auto-play returns instantly. Warmed at 06:00 by the scheduler; entries
// expire after MORNING_BRIEFING_TTL_MS so a mid-day login never plays stale copy.
const morningBriefingCache = new Map();
const MORNING_BRIEFING_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Build (or reuse a fresh cached) morning briefing narration for an owner.
 * Returns `{ text, aiNarrated }`. The heavy work — gathering cross-business data
 * and AI narration — is what we cache; per-request state stays out of the cache.
 */
async function buildMorningBriefing(userId, userMaybe) {
  const cached = morningBriefingCache.get(userId);
  if (cached && Date.now() - cached.builtAt < MORNING_BRIEFING_TTL_MS) {
    return { text: cached.text, aiNarrated: cached.aiNarrated };
  }
  const user = userMaybe || (await loadUser(userId));
  const since = user && user.last_login_at ? user.last_login_at : null;
  const data = await gatherBriefingData(userId, since);
  // The morning briefing auto-plays on login, so it must be ready fast: give the
  // AI narration a tight budget and a single attempt, then fall back to the
  // instant deterministic template so speech starts within ~2s of login.
  const { text, aiNarrated } = await narrate("morning", displayName(user), data, {
    timeout: 1500,
    attempts: 1,
    knowledge: await speechKnowledge(userId),
  });
  morningBriefingCache.set(userId, { text, aiNarrated, builtAt: Date.now() });
  return { text, aiNarrated };
}

/**
 * Pre-generate the morning briefing for every real (non-demo) brand owner so the
 * first login of the day plays instantly. Best-effort per owner; failures are
 * logged and skipped. Called by the 06:00 scheduler job.
 */
async function warmMorningBriefings() {
  const owners = (
    await db.query(
      `SELECT DISTINCT b.user_id
         FROM brands b
        WHERE b.is_demo = false`
    )
  ).rows;
  let warmed = 0;
  for (const owner of owners) {
    try {
      // Force a rebuild so the 06:00 warm always reflects the new day's data.
      morningBriefingCache.delete(owner.user_id);
      await buildMorningBriefing(owner.user_id);
      warmed += 1;
    } catch (err) {
      console.error(`Morning briefing warm failed for user ${owner.user_id}:`, err.message);
    }
  }
  console.log(`Morning briefing pre-generation complete: ${warmed} owner(s) warmed.`);
}

/** POST /api/echo-voice/briefing/delivered — stamp last_briefing_at (once/day). */
async function markBriefingDelivered(req, res) {
  try {
    await db.query("UPDATE users SET last_briefing_at = NOW() WHERE user_id = $1", [
      req.user.userId,
    ]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("markBriefingDelivered error:", err.message);
    return res.status(500).json({ error: "Failed to update briefing state" });
  }
}

/**
 * GET /api/echo-voice/weekly-briefing — the weekly strategy briefing text.
 * Synthesizes the past 7 days across ALL of the owner's businesses into a short
 * spoken review plus the top opportunities and risks. `weekKey` (the ISO-week
 * identifier) lets the client auto-play it at most once per week.
 */
async function getWeeklyBriefing(req, res) {
  try {
    const user = await loadUser(req.user.userId);
    const settings = normalizeSettings(user && user.voice_settings);
    const data = await gatherWeeklyData(req.user.userId);
    const { text, aiNarrated } = await narrate("weekly", displayName(user), data, {
      knowledge: await speechKnowledge(req.user.userId),
    });
    const suggestions = data.suggestions || [];
    // Delivering the briefing counts as "shown" — resets each suggestion's
    // 30-day dedup window. Best-effort; never blocks the briefing.
    if (suggestions.length) {
      await recordShown(
        req.user.userId,
        suggestions.map((s) => s.key),
      );
    }
    return res.json({
      text,
      aiNarrated,
      style: settings.style,
      firstName: displayName(user),
      weekKey: isoWeekKey(new Date()),
      suggestions,
    });
  } catch (err) {
    console.error("getWeeklyBriefing error:", err.message);
    return res.status(500).json({ error: "Failed to build weekly briefing" });
  }
}

/**
 * Record the owner's decision on a proactive suggestion. "accepted" (they set
 * the channel up) suppresses it permanently; "declined" suppresses it 90 days.
 * Owner-scoped by req.user.userId — no cross-user access possible.
 */
async function decideSuggestion(req, res) {
  try {
    const key = String(req.params.key || "").trim();
    const decision = String((req.body && req.body.decision) || "").trim();
    if (!key || !isValidKey(key)) {
      return res.status(400).json({ error: "Unknown suggestion key" });
    }
    if (decision !== "accepted" && decision !== "declined") {
      return res.status(400).json({ error: "decision must be 'accepted' or 'declined'" });
    }
    await recordDecision(req.user.userId, key, decision);
    return res.json({ ok: true });
  } catch (err) {
    console.error("decideSuggestion error:", err.message);
    return res.status(500).json({ error: "Failed to record suggestion decision" });
  }
}

/** ISO-week identifier like "2026-W27" (Monday-based) for once-per-week gating. */
function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7; // Sunday -> 7
  date.setUTCDate(date.getUTCDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** GET /api/echo-voice/status — the on-demand "Talk to Echo" status update. */
async function getStatus(req, res) {
  try {
    const user = await loadUser(req.user.userId);
    const settings = normalizeSettings(user && user.voice_settings);
    // On-demand status is about "right now" — look at today, not since last login.
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const data = await gatherBriefingData(req.user.userId, startOfDay);
    const { text, aiNarrated } = await narrate("status", displayName(user), data, {
      knowledge: await speechKnowledge(req.user.userId),
    });
    return res.json({ text, aiNarrated, style: settings.style, firstName: displayName(user) });
  } catch (err) {
    console.error("getStatus error:", err.message);
    return res.status(500).json({ error: "Failed to build status update" });
  }
}

// ---------------------------------------------------------------------------
// Spoken-event queue (reminders + alerts)
// ---------------------------------------------------------------------------

/**
 * GET /api/echo-voice/pending — pending spoken events the client should speak.
 * The server is the source of truth for gating: if voice is disabled, or the
 * event's per-type toggle is off, or it's quiet hours, nothing is returned. A
 * `clientHour` query param (0..23, the browser's local hour) lets quiet-hours use
 * the owner's real timezone; it falls back to the server hour.
 */
async function getPending(req, res) {
  try {
    const user = await loadUser(req.user.userId);
    const settings = normalizeSettings(user && user.voice_settings);
    if (!settings.enabled) return res.json({ notifications: [], enabled: false });

    const hour = parseHour(req.query.clientHour);
    if (isQuietHour(hour, settings.quietHours)) {
      return res.json({ notifications: [], quietHours: true });
    }

    const rows = (
      await db.query(
        `SELECT notification_id, event_type, title, spoken_text, payload, created_at
           FROM echo_voice_notifications
          WHERE user_id = $1 AND status = 'pending'
            AND deliver_after <= NOW()
            AND (expires_at IS NULL OR expires_at > NOW())
          ORDER BY deliver_after ASC, created_at ASC
          LIMIT 5`,
        [req.user.userId]
      )
    ).rows;

    // Respect per-event toggles. day_summary is on when its toggle is on.
    const filtered = rows.filter((r) => {
      const toggle = settings.events[r.event_type];
      return toggle !== false; // unknown/enabled → allow
    });

    return res.json({
      notifications: filtered.map((r) => ({
        id: r.notification_id,
        type: r.event_type,
        title: r.title,
        text: r.spoken_text,
        payload: r.payload || null,
        createdAt: r.created_at,
      })),
      style: settings.style,
      volume: settings.volume,
    });
  } catch (err) {
    console.error("getPending error:", err.message);
    return res.status(500).json({ error: "Failed to load pending voice alerts" });
  }
}

function parseHour(raw) {
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0 && n <= 23) return n;
  return new Date().getHours();
}

/**
 * POST /api/echo-voice/notifications/:id/delivered — mark one spoken (or
 * dismissed). Scoped to the owner so a client can't touch another user's queue.
 */
async function markNotificationDelivered(req, res) {
  try {
    const status = req.body && req.body.status === "dismissed" ? "dismissed" : "delivered";
    const r = await db.query(
      `UPDATE echo_voice_notifications
          SET status = $3, delivered_at = NOW()
        WHERE notification_id = $1 AND user_id = $2 AND status = 'pending'
        RETURNING notification_id`,
      [req.params.id, req.user.userId, status]
    );
    return res.json({ ok: true, updated: r.rowCount });
  } catch (err) {
    console.error("markNotificationDelivered error:", err.message);
    return res.status(500).json({ error: "Failed to update alert" });
  }
}

module.exports = {
  getSettings,
  updateSettings,
  speak,
  wakeupIntro,
  sound,
  getBriefing,
  markBriefingDelivered,
  getWeeklyBriefing,
  decideSuggestion,
  getStatus,
  getPending,
  markNotificationDelivered,
  warmMorningBriefings,
};
