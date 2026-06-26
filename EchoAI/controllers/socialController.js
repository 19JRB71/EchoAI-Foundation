const db = require("../config/db");
const { encrypt, decrypt } = require("../utils/encryption");
const {
  generateSocialPosts,
  SUPPORTED_PLATFORMS,
} = require("../prompts/socialContentPrompt");
const socialApi = require("../utils/socialApi");

function isSupportedPlatform(platform) {
  return SUPPORTED_PLATFORMS.includes(String(platform || "").toLowerCase());
}

/**
 * Loads a brand only if it belongs to the authenticated user. Returns null when
 * the brand does not exist or is not owned by the user.
 */
async function getOwnedBrand(userId, brandId) {
  const result = await db.query(
    `SELECT brand_id, brand_name, brand_personality, voice_description,
            visual_style_preferences, target_audience
     FROM brands
     WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId]
  );
  return result.rows[0] || null;
}

/**
 * Loads a brand's connected social account (with decrypted credentials) for a
 * platform. Throws a 400 if the brand has no account for that platform.
 */
async function loadConnectedAccount(brandId, platform) {
  const result = await db.query(
    `SELECT account_id, platform_username, credentials_encrypted, connection_status
     FROM social_accounts
     WHERE brand_id = $1 AND platform = $2`,
    [brandId, platform]
  );
  if (result.rows.length === 0) {
    const err = new Error(`No connected ${platform} account for this brand`);
    err.statusCode = 400;
    throw err;
  }
  const row = result.rows[0];
  return {
    accountId: row.account_id,
    username: row.platform_username,
    status: row.connection_status,
    credentials: JSON.parse(decrypt(row.credentials_encrypted)),
  };
}

/**
 * POST /api/social/connect
 * Connects a social account: verifies the credentials against the platform and
 * stores them (encrypted) in social_accounts.
 */
async function connectSocialAccount(req, res) {
  const userId = req.user.userId;
  const { brandId, platform, credentials, username } = req.body;
  const normalizedPlatform = String(platform || "").toLowerCase();

  if (!brandId || !platform || !credentials) {
    return res
      .status(400)
      .json({ error: "brandId, platform, and credentials are required" });
  }
  if (!isSupportedPlatform(normalizedPlatform)) {
    return res.status(400).json({
      error: `Unsupported platform. Supported: ${SUPPORTED_PLATFORMS.join(", ")}`,
    });
  }
  if (typeof credentials !== "object" || Array.isArray(credentials)) {
    return res
      .status(400)
      .json({ error: "credentials must be an object of platform auth values" });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    // Verify the connection works before persisting the status.
    let verification;
    try {
      verification = await socialApi.verifyConnection(normalizedPlatform, credentials);
    } catch (err) {
      verification = { ok: false, detail: err.message };
    }

    const resolvedUsername = username || verification.username || null;
    const status = verification.ok ? "connected" : "error";
    const encrypted = encrypt(JSON.stringify(credentials));

    const result = await db.query(
      `INSERT INTO social_accounts
         (brand_id, platform, platform_username, credentials_encrypted, connection_status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (brand_id, platform)
       DO UPDATE SET platform_username = EXCLUDED.platform_username,
                     credentials_encrypted = EXCLUDED.credentials_encrypted,
                     connection_status = EXCLUDED.connection_status
       RETURNING account_id, brand_id, platform, platform_username,
                 connection_status, created_at, updated_at`,
      [brandId, normalizedPlatform, resolvedUsername, encrypted, status]
    );

    const account = result.rows[0];
    if (!verification.ok) {
      return res.status(502).json({
        account,
        warning: `Credentials stored but verification failed: ${verification.detail || "unknown error"}`,
      });
    }
    return res.status(201).json({ account });
  } catch (err) {
    console.error("Connect social account error:", err.message);
    return res
      .status(err.statusCode || 500)
      .json({ error: "Failed to connect social account" });
  }
}

/**
 * POST /api/social/generate
 * Generates five platform-native post variations for a brand + topic using the
 * Anthropic API.
 */
async function generateSocialContent(req, res) {
  const userId = req.user.userId;
  const { brandId, topic, platform } = req.body;
  const normalizedPlatform = String(platform || "").toLowerCase();

  if (!brandId || !topic || !platform) {
    return res
      .status(400)
      .json({ error: "brandId, topic, and platform are required" });
  }
  if (!isSupportedPlatform(normalizedPlatform)) {
    return res.status(400).json({
      error: `Unsupported platform. Supported: ${SUPPORTED_PLATFORMS.join(", ")}`,
    });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const variations = await generateSocialPosts(brand, topic, normalizedPlatform, 5);
    return res.json({
      platform: normalizedPlatform,
      topic,
      count: variations.length,
      variations,
    });
  } catch (err) {
    console.error("Generate social content error:", err.message);
    return res.status(500).json({ error: "Failed to generate social content" });
  }
}

/**
 * POST /api/social/schedule
 * Queues a post to be published at an exact scheduled time.
 */
async function schedulePost(req, res) {
  const userId = req.user.userId;
  const { brandId, platform, postContent, scheduledTime } = req.body;
  const normalizedPlatform = String(platform || "").toLowerCase();

  if (!brandId || !platform || !postContent || !scheduledTime) {
    return res.status(400).json({
      error: "brandId, platform, postContent, and scheduledTime are required",
    });
  }
  if (!isSupportedPlatform(normalizedPlatform)) {
    return res.status(400).json({
      error: `Unsupported platform. Supported: ${SUPPORTED_PLATFORMS.join(", ")}`,
    });
  }
  const when = new Date(scheduledTime);
  if (Number.isNaN(when.getTime())) {
    return res
      .status(400)
      .json({ error: "scheduledTime must be a valid date/time" });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `INSERT INTO social_posts (brand_id, platform, post_content, scheduled_time, status)
       VALUES ($1, $2, $3, $4, 'scheduled')
       RETURNING post_id, brand_id, platform, post_content, scheduled_time, status, created_at`,
      [brandId, normalizedPlatform, postContent, when.toISOString()]
    );
    return res.status(201).json({ post: result.rows[0] });
  } catch (err) {
    console.error("Schedule post error:", err.message);
    return res.status(500).json({ error: "Failed to schedule post" });
  }
}

/**
 * GET /api/social/calendar/:brandId
 * Returns all scheduled and published posts for a brand across all platforms.
 */
async function getSocialCalendar(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `SELECT post_id, platform, post_content, scheduled_time, published_time,
              status, engagement_metrics, external_post_id, created_at
       FROM social_posts
       WHERE brand_id = $1
       ORDER BY COALESCE(scheduled_time, published_time, created_at) ASC`,
      [brandId]
    );
    return res.json({ brandId, count: result.rows.length, posts: result.rows });
  } catch (err) {
    console.error("Get social calendar error:", err.message);
    return res.status(500).json({ error: "Failed to fetch social calendar" });
  }
}

/**
 * GET /api/social/performance/:brandId
 * Pulls fresh engagement metrics from each platform for the brand's published
 * posts. Per-post failures are surfaced inline rather than failing the request.
 */
async function getPostPerformance(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const published = await db.query(
      `SELECT post_id, platform, external_post_id, engagement_metrics
       FROM social_posts
       WHERE brand_id = $1 AND status = 'published'`,
      [brandId]
    );

    const performance = [];
    for (const post of published.rows) {
      let metrics = post.engagement_metrics || null;
      try {
        const account = await loadConnectedAccount(brandId, post.platform);
        if (post.external_post_id) {
          metrics = await socialApi.fetchMetrics(post.platform, account.credentials, {
            externalPostId: post.external_post_id,
          });
          await db.query(
            "UPDATE social_posts SET engagement_metrics = $1 WHERE post_id = $2",
            [JSON.stringify(metrics), post.post_id]
          );
        }
      } catch (err) {
        metrics = { ...(metrics || {}), error: err.message };
      }
      performance.push({
        postId: post.post_id,
        platform: post.platform,
        externalPostId: post.external_post_id,
        metrics,
      });
    }

    return res.json({ brandId, count: performance.length, performance });
  } catch (err) {
    console.error("Get post performance error:", err.message);
    return res.status(500).json({ error: "Failed to fetch post performance" });
  }
}

/**
 * Publishes a single stored post row to its platform and updates its status.
 * Used by the scheduler. Throws on failure so the caller can mark it failed.
 */
async function publishStoredPost(post) {
  const account = await loadConnectedAccount(post.brand_id, post.platform);
  const result = await socialApi.publishPost(post.platform, account.credentials, {
    content: post.post_content,
  });
  // A publish without a platform post id leaves an unreconcilable record, so
  // treat it as a failure rather than marking it published.
  if (!result.externalId) {
    throw new Error("Platform did not return a post id; treating publish as failed");
  }
  await db.query(
    `UPDATE social_posts
     SET status = 'published', published_time = NOW(), external_post_id = $1
     WHERE post_id = $2`,
    [result.externalId, post.post_id]
  );
  return result;
}

/**
 * Publishes every scheduled post whose scheduled_time has passed. Posts are
 * claimed atomically (status -> 'publishing') so overlapping scheduler ticks
 * cannot double-publish. Returns a summary of how many were processed.
 */
async function publishDuePosts() {
  const due = await db.query(
    `UPDATE social_posts
     SET status = 'publishing'
     WHERE post_id IN (
       SELECT post_id FROM social_posts
       WHERE status = 'scheduled' AND scheduled_time <= NOW()
       ORDER BY scheduled_time ASC
       LIMIT 50
       FOR UPDATE SKIP LOCKED
     )
     RETURNING post_id, brand_id, platform, post_content`
  );

  let published = 0;
  for (const post of due.rows) {
    try {
      await publishStoredPost(post);
      published += 1;
    } catch (err) {
      console.error(`Social publish failed for post ${post.post_id}:`, err.message);
      await db.query(
        "UPDATE social_posts SET status = 'failed', engagement_metrics = $1 WHERE post_id = $2",
        [JSON.stringify({ error: err.message }), post.post_id]
      );
    }
  }

  if (due.rows.length > 0) {
    console.log(
      `Social scheduler: published ${published}/${due.rows.length} due post(s).`
    );
  }
  return { due: due.rows.length, published };
}

module.exports = {
  connectSocialAccount,
  generateSocialContent,
  schedulePost,
  getSocialCalendar,
  getPostPerformance,
  publishStoredPost,
  publishDuePosts,
};
