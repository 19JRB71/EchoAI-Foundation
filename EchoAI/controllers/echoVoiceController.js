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
    `SELECT user_id, first_name, business_name, last_login_at, last_briefing_at, voice_settings
       FROM users WHERE user_id = $1`,
    [userId]
  );
  return r.rows[0] || null;
}

function displayName(user) {
  if (!user) return null;
  if (user.first_name && user.first_name.trim()) return user.first_name.trim();
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
  const { text, style } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "text is required" });
  }
  if (!isVoiceConfigured()) {
    return res.status(503).json({ error: "Voice is not configured" });
  }
  try {
    const user = await loadUser(req.user.userId);
    const settings = normalizeSettings(user && user.voice_settings);
    const voice = voiceForStyle(style || settings.style);
    const audio = await synthesizeSpeech(String(text).slice(0, 4000), voice);
    res.setHeader("Content-Type", "audio/mpeg");
    return res.send(audio);
  } catch (err) {
    console.error("Echo speak error:", err.message);
    // Upstream AI (OpenAI) failure → 502, matching the AI-call convention.
    return res.status(502).json({ error: "Failed to generate speech" });
  }
}

// ---------------------------------------------------------------------------
// Morning wake-up music intro (ElevenLabs sound generation)
// ---------------------------------------------------------------------------

// An upbeat, energetic 3-4s sting played right before the morning briefing —
// think a high-tech hero striding into their lab. Generated once and cached to
// disk (it's identical for every owner) so we don't pay the generation cost or
// latency on every login.
const WAKEUP_PROMPT =
  "Upbeat, energetic cinematic intro sting: a triumphant futuristic synth swell " +
  "with a punchy rhythmic pulse, like a high-tech hero confidently walking into " +
  "their lab. Bright, motivating, powerful. Instrumental only, no vocals.";
const WAKEUP_DURATION = 4;
const AUDIO_DIR = path.join(__dirname, "..", "uploads", "audio");
const WAKEUP_FILE = path.join(AUDIO_DIR, "wakeup-intro.mp3");

// Dedupe concurrent generations (multiple logins racing the first request).
let wakeupGenerating = null;

async function ensureWakeupIntro() {
  try {
    const stat = fs.statSync(WAKEUP_FILE);
    if (stat.size > 0) return fs.readFileSync(WAKEUP_FILE);
  } catch (_e) {
    /* not cached yet — generate below */
  }
  if (!wakeupGenerating) {
    wakeupGenerating = (async () => {
      const buf = await elevenlabs.generateSound(WAKEUP_PROMPT, {
        durationSeconds: WAKEUP_DURATION,
        promptInfluence: 0.6,
      });
      fs.mkdirSync(AUDIO_DIR, { recursive: true });
      fs.writeFileSync(WAKEUP_FILE, buf);
      return buf;
    })().finally(() => {
      wakeupGenerating = null;
    });
  }
  return wakeupGenerating;
}

/**
 * GET /api/echo-voice/wakeup-intro — the upbeat music intro that plays before the
 * morning briefing. Returns audio/mpeg. Best-effort: if ElevenLabs isn't
 * configured or generation fails, responds 204 so the client simply skips the
 * intro and goes straight into the spoken briefing (the intro must never block).
 */
async function wakeupIntro(req, res) {
  if (!elevenlabs.soundConfigured()) {
    return res.status(204).end();
  }
  try {
    const audio = await ensureWakeupIntro();
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(audio);
  } catch (err) {
    console.error("wakeupIntro error:", err.message);
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
 * GET /api/echo-voice/briefing — the morning briefing text.
 * Returns `alreadyDeliveredToday` so the client only auto-plays it once per day.
 * "Since you were last here" uses last_login_at (falls back to last 24h).
 */
async function getBriefing(req, res) {
  try {
    const user = await loadUser(req.user.userId);
    const settings = normalizeSettings(user && user.voice_settings);
    const since = user && user.last_login_at ? user.last_login_at : null;
    const data = await gatherBriefingData(req.user.userId, since);
    // The morning briefing auto-plays on login, so it must be ready fast: give
    // the AI narration a tight budget and a single attempt, then fall back to the
    // instant deterministic template so speech starts within ~2s of login.
    const { text, aiNarrated } = await narrate("morning", displayName(user), data, {
      timeout: 1500,
      attempts: 1,
      knowledge: await speechKnowledge(req.user.userId),
    });
    return res.json({
      text,
      aiNarrated,
      style: settings.style,
      firstName: displayName(user),
      alreadyDeliveredToday: sameDay(user && user.last_briefing_at, new Date()),
      autoBriefing: settings.autoBriefing,
      enabled: settings.enabled,
    });
  } catch (err) {
    console.error("getBriefing error:", err.message);
    return res.status(500).json({ error: "Failed to build briefing" });
  }
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
    return res.json({
      text,
      aiNarrated,
      style: settings.style,
      firstName: displayName(user),
      weekKey: isoWeekKey(new Date()),
    });
  } catch (err) {
    console.error("getWeeklyBriefing error:", err.message);
    return res.status(500).json({ error: "Failed to build weekly briefing" });
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
  getBriefing,
  markBriefingDelivered,
  getWeeklyBriefing,
  getStatus,
  getPending,
  markNotificationDelivered,
};
