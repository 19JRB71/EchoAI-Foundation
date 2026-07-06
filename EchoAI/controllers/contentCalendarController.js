const db = require("../config/db");
const {
  SUPPORTED_PLATFORMS,
  POSTING_FREQUENCIES,
  generateCalendarPosts,
  generateSingleCalendarPost,
  composePostContent,
} = require("../prompts/contentCalendarPrompt");

const CALENDAR_DAYS = 30;

function isSupportedPlatform(platform) {
  return SUPPORTED_PLATFORMS.includes(String(platform || "").toLowerCase());
}

function isSupportedFrequency(freq) {
  return Object.prototype.hasOwnProperty.call(POSTING_FREQUENCIES, freq);
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

/**
 * Deterministically computes the posting slots for a 30-day calendar from the
 * chosen frequency and selected platforms. Each slot is { index, day, platform }
 * with platforms rotated evenly across the scheduled days.
 */
function computeSlots(frequency, platforms) {
  const perWeek = POSTING_FREQUENCIES[frequency].perWeek;
  // Which day-of-week offsets (0-6) within each rolling week carry a post.
  const activeOffsets = new Set();
  if (perWeek >= 7) {
    for (let i = 0; i < 7; i += 1) activeOffsets.add(i);
  } else {
    // Spread `perWeek` posts as evenly as possible across the 7-day window.
    for (let i = 0; i < perWeek; i += 1) {
      activeOffsets.add(Math.round((i * 7) / perWeek) % 7);
    }
  }

  const slots = [];
  let index = 0;
  for (let day = 1; day <= CALENDAR_DAYS; day += 1) {
    if (!activeOffsets.has((day - 1) % 7)) continue;
    const platform = platforms[index % platforms.length];
    index += 1;
    slots.push({ index, day, platform });
  }
  return slots;
}

/** Builds a future scheduled_time from a day offset (1-based) and "HH:MM". */
function scheduledTimeFor(day, time) {
  const [h, m] = String(time || "10:00").split(":").map(Number);
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (day - 1));
  d.setHours(Number.isFinite(h) ? h : 10, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
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
    const slots = computeSlots(freq, selected);
    const generated = await generateCalendarPosts(brand, {
      businessType: String(businessType || "").trim() || brand.industry || null,
      theme,
      slots,
    });

    const posts = slots.map((slot, i) => {
      const g = generated[i];
      return {
        day: slot.day,
        platform: slot.platform,
        contentType: g.contentType,
        postContent: composePostContent(g),
        visualIdea: g.visualIdea,
        callToAction: g.callToAction,
        bestPostingTime: g.bestPostingTime,
        scheduledTime: scheduledTimeFor(slot.day, g.bestPostingTime).toISOString(),
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

module.exports = {
  generateCalendar,
  saveCalendar,
  getCalendar,
  activateCalendar,
  pauseCalendar,
  regeneratePost,
  updatePost,
};
