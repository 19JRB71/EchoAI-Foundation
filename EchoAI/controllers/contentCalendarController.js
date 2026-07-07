const db = require("../config/db");
const {
  SUPPORTED_PLATFORMS,
  POSTING_FREQUENCIES,
  PLATFORM_SCHEDULES,
  CONTENT_TYPES,
  ANGLE_SEEDS,
  DEFAULT_POSTING_TIMES,
  generateCalendarPosts,
  generateSingleCalendarPost,
  composePostContent,
} = require("../prompts/contentCalendarPrompt");
const { zonedWallTimeToUtc, isValidTimezone } = require("../utils/timezone");
const { toJsonbParam } = require("../utils/jsonb");

const CALENDAR_DAYS = 30;
const DEFAULT_TIMEZONE = "America/New_York";
// Guardrail: at most this many posting windows per platform per day, so a
// customized schedule can't be turned into a spam/abuse firehose.
const MAX_WINDOWS_PER_PLATFORM = 6;
// Guardrail: a weekly-cadence platform posts at most this many days per rolling
// 7-day window (7 == every day, i.e. effectively daily).
const MAX_POSTS_PER_WEEK = 7;
const SUPPORTED_CADENCES = ["daily", "weekly"];

/** Validates an "HH:MM" 24h string; returns a zero-padded copy or null. */
function normalizeWindowTime(value) {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/**
 * The coded default posting windows for every platform (the "optimal" schedule),
 * shaped as { platform: { cadence, perWeek?, times: ["HH:MM", ...] } }. Used to
 * seed the settings UI and to fall back per-platform when a brand has no override.
 */
function defaultPostingWindows() {
  const out = {};
  for (const [platform, schedule] of Object.entries(PLATFORM_SCHEDULES)) {
    out[platform] = {
      cadence: schedule.cadence,
      ...(schedule.perWeek ? { perWeek: schedule.perWeek } : {}),
      times: [...(schedule.times || [])],
    };
  }
  return out;
}

/**
 * Sanitizes a client-supplied windows override map into
 * { platform: ["HH:MM", ...] }. Unknown platforms and invalid times are dropped;
 * times are validated, de-duplicated, chronologically sorted, and capped. An
 * empty array for a platform is dropped (it means "use the coded default").
 */
function sanitizeWindows(input) {
  const clean = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return clean;
  for (const [rawPlatform, rawTimes] of Object.entries(input)) {
    const platform = String(rawPlatform || "").toLowerCase();
    if (!PLATFORM_SCHEDULES[platform]) continue;
    if (!Array.isArray(rawTimes)) continue;
    const times = [
      ...new Set(rawTimes.map(normalizeWindowTime).filter(Boolean)),
    ]
      .sort()
      .slice(0, MAX_WINDOWS_PER_PLATFORM);
    if (times.length > 0) clean[platform] = times;
  }
  return clean;
}

/**
 * The coded default per-platform frequency (cadence + weekly count) for the
 * "optimal" schedule, shaped as { platform: { cadence, perWeek? } }. Used to seed
 * the settings UI and to fall back per-platform when a brand has no override.
 */
function defaultPostingFrequencies() {
  const out = {};
  for (const [platform, schedule] of Object.entries(PLATFORM_SCHEDULES)) {
    out[platform] = {
      cadence: schedule.cadence,
      ...(schedule.cadence === "weekly"
        ? { perWeek: schedule.perWeek || 3 }
        : {}),
    };
  }
  return out;
}

/**
 * Sanitizes a client-supplied frequency override map into
 * { platform: { cadence, perWeek? } }. Unknown platforms and invalid cadences are
 * dropped. A "weekly" cadence carries a perWeek clamped to 1..MAX_POSTS_PER_WEEK
 * (defaulting to 3); a "daily" cadence drops perWeek entirely. This only changes
 * HOW OFTEN a platform posts, never its posting times (see sanitizeWindows).
 */
function sanitizeFrequencies(input) {
  const clean = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return clean;
  for (const [rawPlatform, rawFreq] of Object.entries(input)) {
    const platform = String(rawPlatform || "").toLowerCase();
    if (!PLATFORM_SCHEDULES[platform]) continue;
    if (!rawFreq || typeof rawFreq !== "object" || Array.isArray(rawFreq)) continue;
    const cadence = String(rawFreq.cadence || "").toLowerCase();
    if (!SUPPORTED_CADENCES.includes(cadence)) continue;
    if (cadence === "weekly") {
      let perWeek = Number(rawFreq.perWeek);
      if (!Number.isFinite(perWeek)) perWeek = 3;
      perWeek = Math.max(1, Math.min(MAX_POSTS_PER_WEEK, Math.round(perWeek)));
      clean[platform] = { cadence, perWeek };
    } else {
      clean[platform] = { cadence };
    }
  }
  return clean;
}

/**
 * Loads a brand's saved posting-window overrides as { platform: ["HH:MM", ...] }.
 * Returns {} when none are stored. Sanitized on read so stale/invalid rows can't
 * poison scheduling.
 */
async function getBrandWindows(brandId) {
  try {
    const r = await db.query(
      "SELECT windows FROM content_calendar_settings WHERE brand_id = $1",
      [brandId]
    );
    return sanitizeWindows(r.rows[0]?.windows);
  } catch {
    return {};
  }
}

/**
 * Loads a brand's saved per-platform frequency overrides as
 * { platform: { cadence, perWeek? } }. Returns {} when none are stored.
 * Sanitized on read so stale/invalid rows can't poison scheduling.
 */
async function getBrandFrequencies(brandId) {
  try {
    const r = await db.query(
      "SELECT frequencies FROM content_calendar_settings WHERE brand_id = $1",
      [brandId]
    );
    return sanitizeFrequencies(r.rows[0]?.frequencies);
  } catch {
    return {};
  }
}

function isSupportedPlatform(platform) {
  return SUPPORTED_PLATFORMS.includes(String(platform || "").toLowerCase());
}

function isSupportedFrequency(freq) {
  return Object.prototype.hasOwnProperty.call(POSTING_FREQUENCIES, freq);
}

/**
 * The brand's configured timezone drives every post's wall-clock posting time.
 * It lives on availability_schedules (the appointment scheduler owns it); there
 * is no timezone column on brands. Falls back to Eastern when unset/invalid.
 */
async function getBrandTimezone(brandId) {
  try {
    const r = await db.query(
      "SELECT timezone FROM availability_schedules WHERE brand_id = $1 LIMIT 1",
      [brandId]
    );
    const tz = r.rows[0]?.timezone && String(r.rows[0].timezone).trim();
    return tz && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Maps an Anthropic upstream failure to a 502 (vs. a generic 500). */
function isUpstreamAiError(err) {
  return typeof err.status === "number" && err.status >= 400;
}

/**
 * Loads a brand only if it belongs to the authenticated user. Returns null when
 * the brand does not exist or is not owned by the user.
 */
async function getOwnedBrand(userId, brandId) {
  const result = await db.query(
    `SELECT b.brand_id, b.brand_name, b.brand_personality, b.voice_description,
            b.target_audience, u.industry
     FROM brands b
     JOIN users u ON u.user_id = b.user_id
     WHERE b.brand_id = $1 AND b.user_id = $2`,
    [brandId, userId]
  );
  return result.rows[0] || null;
}

/** Which day-of-week offsets (0-6) within a rolling week carry a post. */
function activeOffsetsForPerWeek(perWeek) {
  const offsets = new Set();
  if (perWeek >= 7) {
    for (let i = 0; i < 7; i += 1) offsets.add(i);
  } else {
    // Spread `perWeek` posts as evenly as possible across the 7-day window.
    for (let i = 0; i < perWeek; i += 1) {
      offsets.add(Math.round((i * 7) / perWeek) % 7);
    }
  }
  return offsets;
}

/**
 * Builds raw { day, platform, time } slots for the DEFAULT "optimal" schedule:
 * each platform posts on its own per-platform cadence (PLATFORM_SCHEDULES) at
 * fixed daily windows. `time` is a wall-clock "HH:MM" in the brand's timezone.
 */
function optimalRawSlots(platforms, windowOverrides = {}, frequencyOverrides = {}) {
  const raw = [];
  for (const platform of platforms) {
    const schedule = PLATFORM_SCHEDULES[platform];
    if (!schedule) continue;
    // A brand's saved override replaces this platform's default posting windows;
    // otherwise use the coded default, then a final 08:00 backstop.
    const override = windowOverrides[platform];
    const times =
      override && override.length
        ? override
        : schedule.times && schedule.times.length
          ? schedule.times
          : ["08:00"];
    // A brand's frequency override changes HOW OFTEN the platform posts (its
    // cadence + weekly count); otherwise fall back to the coded cadence.
    const freq = frequencyOverrides[platform];
    const cadence = freq?.cadence || schedule.cadence;
    const perWeek =
      cadence === "weekly"
        ? freq?.perWeek || schedule.perWeek || 3
        : null;
    const offsets =
      cadence === "weekly" ? activeOffsetsForPerWeek(perWeek) : null; // daily: every day
    for (let day = 1; day <= CALENDAR_DAYS; day += 1) {
      if (offsets && !offsets.has((day - 1) % 7)) continue;
      for (const time of times) raw.push({ day, platform, time });
    }
  }
  return raw;
}

/**
 * Builds raw { day, platform } slots for a legacy cadence (daily / N-per-week):
 * one post per active day, platforms rotated evenly. No fixed time — the AI
 * suggests one per slot.
 */
function legacyRawSlots(frequency, platforms) {
  const offsets = activeOffsetsForPerWeek(POSTING_FREQUENCIES[frequency].perWeek);
  const raw = [];
  let i = 0;
  for (let day = 1; day <= CALENDAR_DAYS; day += 1) {
    if (!offsets.has((day - 1) % 7)) continue;
    raw.push({ day, platform: platforms[i % platforms.length] });
    i += 1;
  }
  return raw;
}

/**
 * Deterministically computes the posting slots for a 30-day calendar. Slots are
 * sorted chronologically (day, then time) and each is assigned a content type in
 * strict rotation so NO TWO CONSECUTIVE posts share a type, plus a rotating
 * angle seed so hundreds of posts stay varied. Returns
 * { index, day, platform, time?, contentType, angle } in publishing order.
 */
function computeSlots(frequency, platforms, windowOverrides = {}, frequencyOverrides = {}) {
  const raw =
    frequency === "optimal"
      ? optimalRawSlots(platforms, windowOverrides, frequencyOverrides)
      : legacyRawSlots(frequency, platforms);

  // Order by when the post actually goes out so the content-type rotation
  // guarantee applies to the real publishing sequence.
  raw.sort((a, b) => {
    if (a.day !== b.day) return a.day - b.day;
    const ta = a.time || "12:00";
    const tb = b.time || "12:00";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.platform < b.platform ? -1 : a.platform > b.platform ? 1 : 0;
  });

  return raw.map((s, i) => ({
    index: i + 1,
    day: s.day,
    platform: s.platform,
    time: s.time || null,
    contentType: CONTENT_TYPES[i % CONTENT_TYPES.length],
    angle: ANGLE_SEEDS[i % ANGLE_SEEDS.length],
  }));
}

/**
 * Builds a future scheduled_time from a day offset (1-based) and "HH:MM",
 * interpreting the time as wall-clock in the brand's timezone and returning the
 * matching absolute UTC instant (what the scheduler compares against NOW()).
 */
function scheduledTimeFor(day, time, timezone) {
  const [rawH, rawM] = String(time || "10:00").split(":").map(Number);
  const h = Number.isFinite(rawH) ? rawH : 10;
  const m = Number.isFinite(rawM) ? rawM : 0;
  // Anchor to today's date in the brand's timezone, then add the day offset.
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + (day - 1));
  return zonedWallTimeToUtc(
    base.getFullYear(),
    base.getMonth() + 1,
    base.getDate(),
    h,
    m,
    timezone
  );
}

/**
 * POST /api/content-calendar/generate
 * Generates (but does not save) a full 30-day calendar of planned posts.
 */
async function generateCalendar(req, res) {
  const userId = req.user.userId;
  const { brandId, postingFrequency, platforms, contentTheme, businessType } =
    req.body;
  const freq = String(postingFrequency || "").toLowerCase();
  const selected = Array.isArray(platforms)
    ? [...new Set(platforms.map((p) => String(p || "").toLowerCase()))]
    : [];

  if (!brandId || !freq || selected.length === 0) {
    return res.status(400).json({
      error: "brandId, postingFrequency, and at least one platform are required",
    });
  }
  if (!isSupportedFrequency(freq)) {
    return res.status(400).json({
      error: `Unsupported postingFrequency. Supported: ${Object.keys(POSTING_FREQUENCIES).join(", ")}`,
    });
  }
  const invalid = selected.filter((p) => !isSupportedPlatform(p));
  if (invalid.length > 0) {
    return res.status(400).json({
      error: `Unsupported platform(s): ${invalid.join(", ")}. Supported: ${SUPPORTED_PLATFORMS.join(", ")}`,
    });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    // Warn about platforms whose stored connection is flagged 'error'
    // (expired/revoked login): every post scheduled to them would fail at
    // publish time. Generation still proceeds (posts are saved as drafts and
    // the owner can reconnect before activating), but the response carries a
    // clear warning so the UI can surface it.
    const brokenCheck = await db.query(
      `SELECT platform FROM social_accounts
       WHERE brand_id = $1 AND platform = ANY($2) AND connection_status = 'error'`,
      [brandId, selected]
    );
    const brokenPlatforms = brokenCheck.rows.map((r) => r.platform);

    const theme = String(contentTheme || "").trim() || null;
    const timezone = await getBrandTimezone(brandId);
    const windowOverrides = freq === "optimal" ? await getBrandWindows(brandId) : {};
    const frequencyOverrides =
      freq === "optimal" ? await getBrandFrequencies(brandId) : {};
    const slots = computeSlots(freq, selected, windowOverrides, frequencyOverrides);
    const generated = await generateCalendarPosts(brand, {
      businessType: String(businessType || "").trim() || brand.industry || null,
      theme,
      slots,
    });

    const posts = slots.map((slot, i) => {
      const g = generated[i];
      // "optimal" slots carry a fixed window time; legacy slots use the AI's
      // suggested time. Either way the time is a wall-clock time in the brand's
      // timezone, converted to the correct UTC instant for the scheduler.
      const time = slot.time || g.bestPostingTime;
      return {
        day: slot.day,
        platform: slot.platform,
        contentType: g.contentType,
        postContent: composePostContent(g),
        visualIdea: g.visualIdea,
        callToAction: g.callToAction,
        bestPostingTime: time,
        scheduledTime: scheduledTimeFor(slot.day, time, timezone).toISOString(),
      };
    });

    const now = new Date();
    const response = {
      calendar: {
        postingFrequency: freq,
        contentTheme: theme,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
      },
      count: posts.length,
      posts,
    };
    if (brokenPlatforms.length > 0) {
      const labels = brokenPlatforms
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(", ");
      response.brokenPlatforms = brokenPlatforms;
      response.connectionWarning = `Your ${labels} connection stopped working, so posts scheduled there will fail to publish. Reconnect in Connected Accounts before activating this calendar.`;
    }
    return res.json(response);
  } catch (err) {
    console.error("Generate content calendar error:", err.message);
    if (isUpstreamAiError(err)) {
      return res.status(502).json({
        error:
          "The AI provider could not generate the content calendar right now. Please try again shortly.",
      });
    }
    return res.status(500).json({ error: "Failed to generate content calendar" });
  }
}

/**
 * POST /api/content-calendar
 * Saves a generated calendar and all of its posts. Posts are stored as draft
 * social_posts linked to the new calendar; activation flips them to scheduled.
 */
async function saveCalendar(req, res) {
  const userId = req.user.userId;
  const { brandId, postingFrequency, contentTheme, posts } = req.body;
  const freq = String(postingFrequency || "").toLowerCase();

  if (!brandId || !freq || !Array.isArray(posts) || posts.length === 0) {
    return res.status(400).json({
      error: "brandId, postingFrequency, and a non-empty posts array are required",
    });
  }
  if (!isSupportedFrequency(freq)) {
    return res.status(400).json({
      error: `Unsupported postingFrequency. Supported: ${Object.keys(POSTING_FREQUENCIES).join(", ")}`,
    });
  }

  // Validate every post up front so a bad row never reaches the DB.
  const cleaned = [];
  for (const post of posts) {
    const platform = String(post.platform || "").toLowerCase();
    const content = String(post.postContent || "").trim();
    const when = new Date(post.scheduledTime);
    if (!isSupportedPlatform(platform)) {
      return res.status(400).json({ error: `Unsupported platform: ${platform}` });
    }
    if (!content) {
      return res.status(400).json({ error: "Every post needs postContent" });
    }
    if (Number.isNaN(when.getTime())) {
      return res.status(400).json({ error: "Every post needs a valid scheduledTime" });
    }
    cleaned.push({ platform, content, when });
  }

  const client = await db.getClient();
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    await client.query("BEGIN");
    const now = new Date();
    const cal = await client.query(
      `INSERT INTO content_calendars
         (brand_id, month, year, posting_frequency, content_theme, status)
       VALUES ($1, $2, $3, $4, $5, 'draft')
       RETURNING calendar_id, brand_id, month, year, posting_frequency,
                 content_theme, status, created_at, updated_at`,
      [
        brandId,
        now.getMonth() + 1,
        now.getFullYear(),
        freq,
        String(contentTheme || "").trim() || null,
      ]
    );
    const calendar = cal.rows[0];

    const inserted = [];
    for (const post of cleaned) {
      const row = await client.query(
        `INSERT INTO social_posts
           (brand_id, calendar_id, platform, post_content, scheduled_time, status)
         VALUES ($1, $2, $3, $4, $5, 'draft')
         RETURNING post_id, platform, post_content, scheduled_time, status, created_at`,
        [brandId, calendar.calendar_id, post.platform, post.content, post.when.toISOString()]
      );
      inserted.push(row.rows[0]);
    }

    await client.query("COMMIT");
    return res.status(201).json({ calendar, count: inserted.length, posts: inserted });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Save content calendar error:", err.message);
    return res.status(500).json({ error: "Failed to save content calendar" });
  } finally {
    client.release();
  }
}

/**
 * GET /api/content-calendar/:brandId
 * Returns the brand's most recent calendar with all of its posts + status.
 */
async function getCalendar(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const cal = await db.query(
      `SELECT calendar_id, brand_id, month, year, posting_frequency,
              content_theme, status, created_at, updated_at
       FROM content_calendars
       WHERE brand_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [brandId]
    );
    if (cal.rows.length === 0) {
      return res.json({ brandId, calendar: null, posts: [] });
    }
    const calendar = cal.rows[0];

    const posts = await db.query(
      `SELECT post_id, platform, post_content, scheduled_time, published_time,
              status, engagement_metrics, external_post_id, publish_attempts, created_at
       FROM social_posts
       WHERE calendar_id = $1
       ORDER BY scheduled_time ASC NULLS LAST`,
      [calendar.calendar_id]
    );

    return res.json({
      brandId,
      calendar,
      count: posts.rows.length,
      posts: posts.rows,
    });
  } catch (err) {
    console.error("Get content calendar error:", err.message);
    return res.status(500).json({ error: "Failed to fetch content calendar" });
  }
}

/** Loads a calendar only if its brand belongs to the user. */
async function getOwnedCalendar(userId, calendarId) {
  const result = await db.query(
    `SELECT c.calendar_id, c.brand_id, c.content_theme
     FROM content_calendars c
     JOIN brands b ON b.brand_id = c.brand_id
     WHERE c.calendar_id = $1 AND b.user_id = $2`,
    [calendarId, userId]
  );
  return result.rows[0] || null;
}

/**
 * POST /api/content-calendar/activate
 * Activates a calendar so the scheduler auto-publishes its due posts. Pending
 * (draft) posts are flipped to scheduled; already published/failed posts stay.
 */
async function activateCalendar(req, res) {
  const userId = req.user.userId;
  const { calendarId } = req.body;
  if (!calendarId) {
    return res.status(400).json({ error: "calendarId is required" });
  }

  try {
    const owned = await getOwnedCalendar(userId, calendarId);
    if (!owned) return res.status(404).json({ error: "Calendar not found" });

    // Refuse to flip a month of posts to 'scheduled' when one of the
    // calendar's platforms has a broken stored connection (expired/revoked
    // login): every post aimed there would fail at publish time. Once the
    // owner reconnects, connection_status flips back to 'connected' and
    // activation works with no extra steps. Mirrors the schedulePost check.
    const brokenCheck = await db.query(
      `SELECT DISTINCT sa.platform
       FROM social_posts sp
       JOIN social_accounts sa
         ON sa.brand_id = sp.brand_id AND sa.platform = sp.platform
       WHERE sp.calendar_id = $1
         AND sp.status IN ('draft', 'scheduled')
         AND sa.connection_status = 'error'
       ORDER BY sa.platform`,
      [calendarId]
    );
    if (brokenCheck.rows.length > 0) {
      const brokenPlatforms = brokenCheck.rows.map((r) => r.platform);
      const labels = brokenPlatforms
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(", ");
      return res.status(409).json({
        error: `Your ${labels} connection stopped working, so this calendar's ${labels} posts would fail to publish. Reconnect ${labels} in Connected Accounts, then activate the calendar again.`,
        connectionError: true,
        platforms: brokenPlatforms,
      });
    }

    const client = await db.getClient();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE content_calendars SET status = 'active' WHERE calendar_id = $1",
        [calendarId]
      );
      await client.query(
        "UPDATE social_posts SET status = 'scheduled' WHERE calendar_id = $1 AND status = 'draft'",
        [calendarId]
      );
      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }
    return res.json({ calendarId, status: "active" });
  } catch (err) {
    console.error("Activate content calendar error:", err.message);
    return res.status(500).json({ error: "Failed to activate content calendar" });
  }
}

/**
 * POST /api/content-calendar/pause
 * Pauses auto-posting without deleting the calendar. Still-unpublished scheduled
 * posts are flipped back to draft so the scheduler skips them.
 */
async function pauseCalendar(req, res) {
  const userId = req.user.userId;
  const { calendarId } = req.body;
  if (!calendarId) {
    return res.status(400).json({ error: "calendarId is required" });
  }

  try {
    const owned = await getOwnedCalendar(userId, calendarId);
    if (!owned) return res.status(404).json({ error: "Calendar not found" });

    const client = await db.getClient();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE content_calendars SET status = 'paused' WHERE calendar_id = $1",
        [calendarId]
      );
      await client.query(
        "UPDATE social_posts SET status = 'draft' WHERE calendar_id = $1 AND status = 'scheduled'",
        [calendarId]
      );
      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }
    return res.json({ calendarId, status: "paused" });
  } catch (err) {
    console.error("Pause content calendar error:", err.message);
    return res.status(500).json({ error: "Failed to pause content calendar" });
  }
}

/** Loads a calendar post (with brand + theme) only if owned by the user. */
async function getOwnedCalendarPost(userId, postId) {
  const result = await db.query(
    `SELECT p.post_id, p.platform, p.status, p.calendar_id,
            c.content_theme,
            b.brand_id, b.brand_name, b.brand_personality, b.voice_description,
            b.target_audience, u.industry
     FROM social_posts p
     JOIN content_calendars c ON c.calendar_id = p.calendar_id
     JOIN brands b ON b.brand_id = p.brand_id
     JOIN users u ON u.user_id = b.user_id
     WHERE p.post_id = $1 AND b.user_id = $2`,
    [postId, userId]
  );
  return result.rows[0] || null;
}

/**
 * POST /api/content-calendar/regenerate-post
 * Regenerates the copy for a single calendar post via the AI agent.
 */
async function regeneratePost(req, res) {
  const userId = req.user.userId;
  const { postId } = req.body;
  if (!postId) {
    return res.status(400).json({ error: "postId is required" });
  }

  try {
    const row = await getOwnedCalendarPost(userId, postId);
    if (!row) return res.status(404).json({ error: "Calendar post not found" });
    if (row.status === "published" || row.status === "publishing") {
      return res
        .status(409)
        .json({ error: "Cannot regenerate a post that is already publishing or published" });
    }

    const brand = {
      brand_name: row.brand_name,
      brand_personality: row.brand_personality,
      voice_description: row.voice_description,
      target_audience: row.target_audience,
      industry: row.industry,
    };
    const generated = await generateSingleCalendarPost(brand, {
      platform: row.platform,
      businessType: row.industry || null,
      theme: row.content_theme || null,
    });

    const updated = await db.query(
      `UPDATE social_posts
       SET post_content = $1
       WHERE post_id = $2 AND status NOT IN ('publishing', 'published')
       RETURNING post_id, platform, post_content, scheduled_time, status, created_at`,
      [composePostContent(generated), postId]
    );
    if (updated.rowCount === 0) {
      return res
        .status(409)
        .json({ error: "Cannot regenerate a post that is already publishing or published" });
    }
    return res.json({ post: updated.rows[0] });
  } catch (err) {
    console.error("Regenerate calendar post error:", err.message);
    if (isUpstreamAiError(err)) {
      return res.status(502).json({
        error:
          "The AI provider could not regenerate the post right now. Please try again shortly.",
      });
    }
    return res.status(500).json({ error: "Failed to regenerate post" });
  }
}

/**
 * PUT /api/content-calendar/post/:postId
 * Manually edits a calendar post's content before it goes live.
 */
async function updatePost(req, res) {
  const userId = req.user.userId;
  const { postId } = req.params;
  const { postContent } = req.body;
  const content = String(postContent || "").trim();
  if (!content) {
    return res.status(400).json({ error: "postContent is required" });
  }

  try {
    const row = await getOwnedCalendarPost(userId, postId);
    if (!row) return res.status(404).json({ error: "Calendar post not found" });
    if (row.status === "published" || row.status === "publishing") {
      return res
        .status(409)
        .json({ error: "Cannot edit a post that is already publishing or published" });
    }

    const updated = await db.query(
      `UPDATE social_posts
       SET post_content = $1
       WHERE post_id = $2 AND status NOT IN ('publishing', 'published')
       RETURNING post_id, platform, post_content, scheduled_time, status, created_at`,
      [content, postId]
    );
    if (updated.rowCount === 0) {
      return res
        .status(409)
        .json({ error: "Cannot edit a post that is already publishing or published" });
    }
    return res.json({ post: updated.rows[0] });
  } catch (err) {
    console.error("Update calendar post error:", err.message);
    return res.status(500).json({ error: "Failed to update post" });
  }
}

/**
 * GET /settings/:brandId
 * Returns the brand's posting-window configuration: the coded per-platform
 * defaults (the "optimal" schedule) plus any saved overrides. The UI seeds its
 * editor from `defaults` and shows `windows` on top.
 */
async function getPostingSettings(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const windows = await getBrandWindows(brandId);
    const frequencies = await getBrandFrequencies(brandId);
    return res.json({
      defaults: defaultPostingWindows(),
      windows,
      frequencies,
      maxPerPlatform: MAX_WINDOWS_PER_PLATFORM,
      maxPerWeek: MAX_POSTS_PER_WEEK,
    });
  } catch (err) {
    console.error("Get posting settings error:", err.message);
    return res.status(500).json({ error: "Failed to load posting settings" });
  }
}

/**
 * PUT /settings/:brandId
 * Saves per-platform posting-window overrides for the "optimal" schedule. The
 * body's `windows` map is sanitized (unknown platforms/invalid times dropped,
 * deduped, sorted, capped); an empty/missing platform falls back to the coded
 * default at generation time.
 */
async function updatePostingSettings(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const windows = sanitizeWindows(req.body?.windows);
    const frequencies = sanitizeFrequencies(req.body?.frequencies);
    await db.query(
      `INSERT INTO content_calendar_settings (brand_id, windows, frequencies, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, now())
       ON CONFLICT (brand_id)
       DO UPDATE SET windows = EXCLUDED.windows,
                     frequencies = EXCLUDED.frequencies,
                     updated_at = now()`,
      [brandId, toJsonbParam(windows), toJsonbParam(frequencies)]
    );
    return res.json({
      defaults: defaultPostingWindows(),
      windows,
      frequencies,
      maxPerPlatform: MAX_WINDOWS_PER_PLATFORM,
      maxPerWeek: MAX_POSTS_PER_WEEK,
    });
  } catch (err) {
    console.error("Update posting settings error:", err.message);
    return res.status(500).json({ error: "Failed to save posting settings" });
  }
}

module.exports = {
  generateCalendar,
  saveCalendar,
  getCalendar,
  activateCalendar,
  pauseCalendar,
  regeneratePost,
  updatePost,
  getPostingSettings,
  updatePostingSettings,
  // Exported for unit tests of the deterministic scheduling/rotation logic.
  computeSlots,
  scheduledTimeFor,
  getBrandTimezone,
  sanitizeWindows,
  defaultPostingWindows,
  sanitizeFrequencies,
  defaultPostingFrequencies,
};
