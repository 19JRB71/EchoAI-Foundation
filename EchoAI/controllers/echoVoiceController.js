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
const {
  normalizeSettings,
  resolveMusicFavorites,
  voiceForStyle,
  isQuietHour,
} = require("../config/echoVoice");
const { gatherBriefingData, gatherWeeklyData, narrate } = require("../utils/echoBriefing");
const { userPartOfDay } = require("../utils/timeOfDay");
const {
  priorityForEvent,
  priorityRankSql,
  PRIORITY_RANK,
} = require("../config/notificationPriority");
const { recordShown, recordDecision, isValidKey } = require("../utils/echoSuggestions");
const { toJsonbParam } = require("../utils/jsonb");
const echoContext = require("../utils/echoContext");

/**
 * Speech-mode personalization block for a spoken briefing. Best-effort: returns
 * "" on any failure so the briefing still renders. It is tone/priority guidance
 * only — the spoken invariant (facts only from `data`) is preserved by framing.
 */
async function speechKnowledge(userId, brandId = null) {
  try {
    return await echoContext.buildKnowledgeContext(userId, brandId, { mode: "speech" });
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
// defaults to "Sir" when neither is set.
function displayName(user) {
  if (!user) return null;
  if (user.preferred_name && user.preferred_name.trim())
    return user.preferred_name.trim();
  if (user.first_name && user.first_name.trim()) return user.first_name.trim();
  if (user.role === "admin") return "Sir";
  return null;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** GET /api/echo-voice/settings — the owner's normalized voice settings. */
async function getSettings(req, res) {
  try {
    const user = await loadUser(req.user.userId);
    const settings = normalizeSettings(user && user.voice_settings);
    // Favorites resolve from the RAW blob so a never-set admin account still
    // sees the three default song suggestions until they save their own list.
    settings.musicFavorites = resolveMusicFavorites(
      user && user.voice_settings,
      user && user.role,
    );
    return res.json({
      settings,
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
// Instant spoken acknowledgements ("Got it, Sir.") — pre-cached TTS
// ---------------------------------------------------------------------------

// Short spoken acks Echo plays the INSTANT a command lands, so the user hears
// a response while the real AI reply is still generating. Synthesized once per
// (phrase, voice) and cached to disk; the client preloads the blobs so playback
// is local (<200ms). Keys are stable; bump ACK_VERSION to re-synthesize all.
const ACK_VERSION = "v1";
const ACK_PHRASES = {
  gotit: "Got it, Sir.",
  onit: "On it, Sir.",
  rightaway: "Right away, Sir.",
  understood: "Understood.",
  onemoment: "One moment, Sir.",
  letmecheck: "Let me check on that.",
};

const ackGenerating = new Map(); // cacheKey -> in-flight Promise<Buffer>

/**
 * GET /api/echo-voice/ack/:name — a short cached spoken acknowledgement in the
 * owner's chosen voice style. audio/mpeg, or 204 for an unknown name /
 * unconfigured voice / failure so the client just falls back to a sound effect.
 */
async function ackSound(req, res) {
  const phrase = ACK_PHRASES[req.params.name];
  if (!phrase) return res.status(204).end();
  if (!isVoiceConfigured()) return res.status(204).end();
  try {
    const user = await loadUser(req.user.userId);
    const settings = normalizeSettings(user && user.voice_settings);
    const voice = voiceForStyle(settings.style);
    // Voice-scoped cache key so a style change never plays the wrong voice.
    const safeVoice = String(voice).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
    const cacheKey = `ack-${ACK_VERSION}-${req.params.name}-${safeVoice}`;
    const file = path.join(AUDIO_DIR, `${cacheKey}.mp3`);
    let audio = null;
    try {
      const stat = fs.statSync(file);
      if (stat.size > 0) audio = fs.readFileSync(file);
    } catch {
      /* not cached yet */
    }
    if (!audio) {
      if (!ackGenerating.has(cacheKey)) {
        const p = (async () => {
          const buf = await synthesizeSpeech(phrase, voice, { label: "echo-ack" });
          fs.mkdirSync(AUDIO_DIR, { recursive: true });
          fs.writeFileSync(file, buf);
          return buf;
        })().finally(() => ackGenerating.delete(cacheKey));
        ackGenerating.set(cacheKey, p);
      }
      audio = await ackGenerating.get(cacheKey);
    }
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    return res.send(audio);
  } catch (err) {
    console.error(`ack:${req.params.name} error:`, err.message);
    return res.status(204).end();
  }
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
 * Resolve an optional ?brandId= into an owned, real (non-demo) brand id.
 * Returns { ok: true, brandId } (null brandId = account-wide) or { ok: false }
 * when the id isn't a brand this user owns — callers 404 on that so a foreign
 * or stale id is an explicit error, never a silently different briefing.
 */
async function resolveBriefingBrand(userId, raw) {
  const requested = raw ? String(raw).trim() : "";
  if (!requested) return { ok: true, brandId: null };
  try {
    const r = await db.query(
      `SELECT brand_id FROM brands
        WHERE brand_id = $1 AND user_id = $2 AND is_demo = false`,
      [requested, userId]
    );
    return r.rows.length ? { ok: true, brandId: r.rows[0].brand_id } : { ok: false };
  } catch {
    // Malformed uuid → same as not found.
    return { ok: false };
  }
}

/**
 * GET /api/echo-voice/briefing — the morning briefing text (scoped to the
 * active brand via ?brandId=; account-wide without it).
 * Returns `alreadyDeliveredToday` so the client only auto-plays it once per day.
 * "Since you were last here" uses last_login_at (falls back to last 24h).
 */
async function getBriefing(req, res) {
  try {
    const brand = await resolveBriefingBrand(req.user.userId, req.query.brandId);
    if (!brand.ok) return res.status(404).json({ error: "Brand not found" });
    const user = await loadUser(req.user.userId);
    const settings = normalizeSettings(user && user.voice_settings);
    // Time-of-day awareness (owner requirement): the FULL daily briefing only
    // exists in the morning window (5:00–11:59 in the owner's brand-settings
    // timezone, Eastern by default). Afternoon/evening/late logins get a
    // day-update instead — Echo never says "Good morning" after noon.
    const tod = await userPartOfDay(req.user.userId);
    const built =
      tod.part === "morning"
        ? await buildMorningBriefing(req.user.userId, user, brand.brandId)
        : await buildDayUpdate(req.user.userId, user, tod.part, brand.brandId);
    return res.json({
      text: built.text,
      aiNarrated: built.aiNarrated,
      style: settings.style,
      firstName: displayName(user),
      // The owner's local part of day — drives the client's greeting choice.
      partOfDay: tod.part,
      timezone: tod.timezone,
      kind: tod.part === "morning" ? "morning" : "update",
      // Recomputed per request (depends on the user's live last_briefing_at, not
      // the cached narration) so once-per-day auto-play gating stays correct.
      alreadyDeliveredToday: sameDay(user && user.last_briefing_at, new Date()),
      autoBriefing: settings.autoBriefing,
      enabled: settings.enabled,
      // Whether the owner has saved morning-music favorites (admin defaults
      // count) — the login greeting adds "your playlist is ready" when true.
      musicReady:
        resolveMusicFavorites(user && user.voice_settings, user && user.role).length > 0,
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
async function buildMorningBriefing(userId, userMaybe, brandId = null) {
  const cacheKey = `${userId}:${brandId || "all"}`;
  const cached = morningBriefingCache.get(cacheKey);
  if (cached && Date.now() - cached.builtAt < MORNING_BRIEFING_TTL_MS) {
    return { text: cached.text, aiNarrated: cached.aiNarrated };
  }
  const user = userMaybe || (await loadUser(userId));
  const since = user && user.last_login_at ? user.last_login_at : null;
  const data = await gatherBriefingData(userId, since, brandId);
  // The morning briefing auto-plays on login, so it must be ready fast: give the
  // AI narration a tight budget and a single attempt, then fall back to the
  // instant deterministic template so speech starts within ~2s of login.
  const { text, aiNarrated } = await narrate("morning", displayName(user), data, {
    timeout: 1500,
    attempts: 1,
    partOfDay: "morning",
    knowledge: await speechKnowledge(userId, brandId),
  });
  morningBriefingCache.set(cacheKey, { text, aiNarrated, builtAt: Date.now() });
  return { text, aiNarrated };
}

/**
 * The afternoon/evening/late-night day update: a "how the day is going" status
 * read that opens with the correct local-time greeting. Never cached — it
 * reflects today's live numbers, and it replaces the morning briefing entirely
 * outside the 5:00–11:59 window (a mid-day login must never hear "Good morning").
 */
async function buildDayUpdate(userId, userMaybe, part, brandId = null) {
  const user = userMaybe || (await loadUser(userId));
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const data = await gatherBriefingData(userId, startOfDay, brandId);
  // Same tight budget as the login-time morning briefing: speech must start fast.
  return narrate("status", displayName(user), data, {
    timeout: 1500,
    attempts: 1,
    partOfDay: part,
    knowledge: await speechKnowledge(userId, brandId),
  });
}

/**
 * Pre-generate the morning briefing for every real (non-demo) brand owner so the
 * first login of the day plays instantly. Best-effort per owner; failures are
 * logged and skipped. Called by the 06:00 scheduler job.
 */
async function warmMorningBriefings() {
  const owners = (
    await db.query(
      `SELECT DISTINCT b.user_id, u.last_active_brand_id
         FROM brands b
         JOIN users u ON u.user_id = b.user_id
        WHERE b.is_demo = false`
    )
  ).rows;
  let warmed = 0;
  for (const owner of owners) {
    try {
      // Warm the briefing the owner will actually hear at login: their last
      // active brand's (the client requests that one), falling back to the
      // account-wide briefing when no brand is remembered. Force a rebuild so
      // the 06:00 warm always reflects the new day's data.
      const brandId = owner.last_active_brand_id || null;
      morningBriefingCache.delete(`${owner.user_id}:${brandId || "all"}`);
      await buildMorningBriefing(owner.user_id, null, brandId);
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
    const brand = await resolveBriefingBrand(req.user.userId, req.query.brandId);
    if (!brand.ok) return res.status(404).json({ error: "Brand not found" });
    const user = await loadUser(req.user.userId);
    const settings = normalizeSettings(user && user.voice_settings);
    const data = await gatherWeeklyData(req.user.userId, brand.brandId);
    const tod = await userPartOfDay(req.user.userId);
    const { text, aiNarrated } = await narrate("weekly", displayName(user), data, {
      knowledge: await speechKnowledge(req.user.userId, brand.brandId),
      partOfDay: tod.part,
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
    const brand = await resolveBriefingBrand(req.user.userId, req.query.brandId);
    if (!brand.ok) return res.status(404).json({ error: "Brand not found" });
    const user = await loadUser(req.user.userId);
    const settings = normalizeSettings(user && user.voice_settings);
    // On-demand status is about "right now" — look at today, not since last login.
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const data = await gatherBriefingData(req.user.userId, startOfDay, brand.brandId);
    const { text, aiNarrated } = await narrate("status", displayName(user), data, {
      knowledge: await speechKnowledge(req.user.userId, brand.brandId),
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

    // Brand isolation: alerts stamped with a brandId (Sage urgent reports,
    // geo exclusions…) are only delivered while the owner is viewing THAT
    // brand. The client sends the brand it is showing (?activeBrandId=,
    // ownership-verified); fallback is the server-remembered active brand.
    // Mismatched alerts stay 'pending' and deliver when the owner switches.
    const activeBrandId = await resolveActiveBrandForPending(
      req.user.userId,
      req.query.activeBrandId
    );

    // Brand-scoped alerts (payload.brandId) for OTHER brands are held in the
    // SQL itself — they stay 'pending' and can never starve the LIMIT — and
    // deliver on a later poll once the owner switches to that brand.
    // Deliver highest-priority (red) alerts first so a "go through them" batch
    // leads with the urgent items, then falls back to oldest-first within a
    // priority tier.
    const rows = (
      await db.query(
        `SELECT notification_id, event_type, title, spoken_text, payload, created_at
           FROM echo_voice_notifications
          WHERE user_id = $1 AND status = 'pending'
            AND deliver_after <= NOW()
            AND (expires_at IS NULL OR expires_at > NOW())
            AND (payload->>'brandId' IS NULL OR payload->>'brandId' = $2)
          ORDER BY ${priorityRankSql()} ASC, deliver_after ASC, created_at ASC
          LIMIT 8`,
        [req.user.userId, activeBrandId ? String(activeBrandId) : ""]
      )
    ).rows;

    // Respect per-event toggles. day_summary is on when its toggle is on.
    const filtered = rows.filter((r) => {
      const toggle = settings.events[r.event_type];
      if (toggle === false) return false; // per-type toggle off
      // Defense in depth: re-validate brand isolation even though the SQL
      // already holds mismatched brand-scoped alerts.
      const alertBrand = r.payload && r.payload.brandId ? String(r.payload.brandId) : null;
      if (alertBrand && String(activeBrandId || "") !== alertBrand) return false;
      return true;
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
 * Resolve the brand the owner is currently viewing, for brand-isolated alert
 * delivery. A client-supplied id is ownership-verified with a join (never
 * trusted raw); without one we fall back to the server-remembered
 * last_active_brand_id. Returns null when no owned, non-demo brand resolves —
 * every brand-scoped alert is then held.
 */
const BRAND_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveActiveBrandForPending(userId, requestedBrandId) {
  const requested = typeof requestedBrandId === "string" ? requestedBrandId.trim() : "";
  if (requested && !BRAND_UUID_RE.test(requested)) return null;
  if (requested) {
    const r = await db.query(
      `SELECT brand_id FROM brands
        WHERE brand_id = $1 AND user_id = $2 AND is_demo = false`,
      [requested, userId]
    );
    return r.rows.length ? r.rows[0].brand_id : null;
  }
  const r = await db.query(
    `SELECT u.last_active_brand_id AS brand_id
       FROM users u
       JOIN brands b ON b.brand_id = u.last_active_brand_id
                    AND b.user_id = u.user_id AND b.is_demo = false
      WHERE u.user_id = $1`,
    [userId]
  );
  return r.rows.length ? r.rows[0].brand_id : null;
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

// Fetch every ready, non-expired pending notification for the owner. Shared by
// the badge summary and the panel list. This is the VISUAL notification center,
// so — unlike the spoken /pending queue — it is NOT gated by voice-enabled,
// quiet hours, or per-event voice toggles: the owner should always see what is
// waiting even when they've silenced Echo's voice.
async function loadPendingNotifications(userId) {
  const rows = (
    await db.query(
      `SELECT notification_id, brand_id, event_type, title, spoken_text,
              payload, created_at
         FROM echo_voice_notifications
        WHERE user_id = $1 AND status = 'pending'
          AND deliver_after <= NOW()
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY created_at DESC`,
      [userId]
    )
  ).rows;
  return rows.map((r) => {
    // The originating brand: the dedicated brand_id column when set, otherwise
    // a payload.brandId stamp (some alerts only carry the latter). null = a
    // general (non-brand) notification.
    const brandId =
      r.brand_id ||
      (r.payload && r.payload.brandId ? String(r.payload.brandId) : null);
    return {
      id: r.notification_id,
      brandId: brandId ? String(brandId) : null,
      type: r.event_type,
      priority: priorityForEvent(r.event_type, r.payload),
      title: r.title || null,
      text: r.spoken_text || null,
      createdAt: r.created_at,
    };
  });
}

function emptyCounts() {
  return { red: 0, yellow: 0, green: 0, total: 0 };
}

/**
 * GET /api/echo-voice/notification-summary — per-brand + general badge counts
 * ({red,yellow,green,total}) for the owner. Drives the colored tab badges; the
 * client polls it and refetches on change for near-real-time updates.
 */
async function getNotificationSummary(req, res) {
  try {
    const items = await loadPendingNotifications(req.user.userId);
    const brands = {};
    const general = emptyCounts();
    for (const it of items) {
      const bucket = it.brandId
        ? brands[it.brandId] || (brands[it.brandId] = emptyCounts())
        : general;
      if (bucket[it.priority] === undefined) continue;
      bucket[it.priority] += 1;
      bucket.total += 1;
    }
    return res.json({ brands, general, totalCount: items.length });
  } catch (err) {
    console.error("getNotificationSummary error:", err.message);
    return res.status(500).json({ error: "Failed to load notification summary" });
  }
}

/**
 * GET /api/echo-voice/notifications/list?brandId=<id|general> — the pending
 * notifications for one brand (or the general bucket when brandId is omitted or
 * "general"), grouped nowhere (the client groups by priority). Owner-scoped.
 */
async function listBrandNotifications(req, res) {
  try {
    const raw = typeof req.query.brandId === "string" ? req.query.brandId.trim() : "";
    const wantGeneral = !raw || raw === "general";
    const items = (await loadPendingNotifications(req.user.userId)).filter((it) =>
      wantGeneral ? it.brandId === null : it.brandId === raw
    );
    // Stable priority order (red → yellow → green), newest first within a tier.
    items.sort((a, b) => {
      const ra = PRIORITY_RANK[a.priority] ?? 1;
      const rb = PRIORITY_RANK[b.priority] ?? 1;
      if (ra !== rb) return ra - rb;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    return res.json({ notifications: items });
  } catch (err) {
    console.error("listBrandNotifications error:", err.message);
    return res.status(500).json({ error: "Failed to load notifications" });
  }
}

/**
 * POST /api/echo-voice/notifications/clear — bulk-dismiss pending notifications
 * for the owner. Optional body { brandId } scopes to one brand ("general"
 * clears only the non-brand bucket); omit it to clear everything. Powers the
 * panel's "Clear all" button and the "Hey Echo, clear my notifications" command.
 */
async function clearNotifications(req, res) {
  try {
    const raw =
      req.body && typeof req.body.brandId === "string" ? req.body.brandId.trim() : "";
    let result;
    // Only clear notifications that are actually surfaced right now — the same
    // ready/non-expired window summary + list use. Otherwise "clear" would
    // silently dismiss future-scheduled reminders the owner never saw.
    const readyWindow =
      "AND deliver_after <= NOW() AND (expires_at IS NULL OR expires_at > NOW())";
    if (!raw) {
      result = await db.query(
        `UPDATE echo_voice_notifications
            SET status = 'dismissed', delivered_at = NOW()
          WHERE user_id = $1 AND status = 'pending'
            ${readyWindow}`,
        [req.user.userId]
      );
    } else if (raw === "general") {
      result = await db.query(
        `UPDATE echo_voice_notifications
            SET status = 'dismissed', delivered_at = NOW()
          WHERE user_id = $1 AND status = 'pending'
            AND brand_id IS NULL AND payload->>'brandId' IS NULL
            ${readyWindow}`,
        [req.user.userId]
      );
    } else {
      result = await db.query(
        `UPDATE echo_voice_notifications
            SET status = 'dismissed', delivered_at = NOW()
          WHERE user_id = $1 AND status = 'pending'
            AND (brand_id::text = $2 OR payload->>'brandId' = $2)
            ${readyWindow}`,
        [req.user.userId, raw]
      );
    }
    return res.json({ ok: true, cleared: result.rowCount });
  } catch (err) {
    console.error("clearNotifications error:", err.message);
    return res.status(500).json({ error: "Failed to clear notifications" });
  }
}


// ---------------------------------------------------------------------------
// Learned speech patterns
// ---------------------------------------------------------------------------
// Echo adapts to how the owner naturally talks: phrases Echo initially
// misheard get mapped to the action the owner meant, so over time fewer
// repetitions are needed. Phrases are stored normalized (lowercase, no
// punctuation) and matched exactly on the client.

const LEARNABLE_ACTIONS = new Set([
  "stop",
  "yes",
  "no",
  "briefing",
  "briefing_quick",
  "status",
]);

async function getLearnedPhrases(req, res) {
  try {
    const r = await db.query(
      `SELECT phrase, action
         FROM voice_learned_phrases
        WHERE user_id = $1
        ORDER BY hits DESC, last_used_at DESC
        LIMIT 300`,
      [req.user.userId]
    );
    return res.json({ phrases: r.rows });
  } catch (err) {
    console.error("getLearnedPhrases error:", err.message);
    return res.status(500).json({ error: "Failed to load learned phrases" });
  }
}

async function saveLearnedPhrase(req, res) {
  try {
    const phrase = String((req.body && req.body.phrase) || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const action = String((req.body && req.body.action) || "").trim();
    if (!phrase || phrase.length < 2 || phrase.length > 80) {
      return res.status(400).json({ error: "Invalid phrase" });
    }
    if (phrase.split(" ").length > 6) {
      return res.status(400).json({ error: "Phrase too long to learn" });
    }
    if (!LEARNABLE_ACTIONS.has(action)) {
      return res.status(400).json({ error: "Invalid action" });
    }
    await db.query(
      `INSERT INTO voice_learned_phrases (user_id, phrase, action)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, phrase)
       DO UPDATE SET action = EXCLUDED.action,
                     hits = voice_learned_phrases.hits + 1,
                     last_used_at = NOW()`,
      [req.user.userId, phrase, action]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("saveLearnedPhrase error:", err.message);
    return res.status(500).json({ error: "Failed to save learned phrase" });
  }
}

module.exports = {
  getSettings,
  updateSettings,
  speak,
  wakeupIntro,
  sound,
  ackSound,
  getBriefing,
  markBriefingDelivered,
  getWeeklyBriefing,
  decideSuggestion,
  getStatus,
  getPending,
  markNotificationDelivered,
  getNotificationSummary,
  listBrandNotifications,
  clearNotifications,
  warmMorningBriefings,
  getLearnedPhrases,
  saveLearnedPhrase,
};
