const db = require("../config/db");
const { encrypt, decrypt } = require("../utils/encryption");
const {
  generateSocialPosts,
  SUPPORTED_PLATFORMS,
} = require("../prompts/socialContentPrompt");
const socialApi = require("../utils/socialApi");
const { getUserTier } = require("../middleware/featureGate");
const { meetsTier } = require("../config/tiers");

// Starter accounts may connect at most this many distinct social platforms.
// Professional and above are unlimited (all 6 platforms).
const STARTER_PLATFORM_LIMIT = 2;

/**
 * Enforces the per-tier social-platform limit. Starter is capped at 2 distinct
 * platforms across all of the user's brands; Professional+ is unlimited.
 * Reconnecting an already-connected platform is always allowed. Throws a 403
 * (with upgrade metadata) when a new platform would exceed the cap.
 */
async function enforceSocialPlatformLimit(userId, platform) {
  const { tier, role } = await getUserTier(userId);
  if (role === "admin" || meetsTier(tier, "pro")) return; // unlimited

  const { rows } = await db.query(
    `SELECT DISTINCT sa.platform
       FROM social_accounts sa
       JOIN brands b ON b.brand_id = sa.brand_id
      WHERE b.user_id = $1`,
    [userId]
  );
  const platforms = new Set(rows.map((r) => r.platform));
  platforms.add(platform); // counting the one being connected
  if (platforms.size > STARTER_PLATFORM_LIMIT) {
    const err = new Error(
      `Your Starter plan supports social posting on ${STARTER_PLATFORM_LIMIT} platforms. Upgrade to Professional to connect all 6.`
    );
    err.statusCode = 403;
    err.upgradeRequired = true;
    err.requiredTier = "pro";
    throw err;
  }
}

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

    // Tier gate: Starter is limited to 2 social platforms; Pro+ is unlimited.
    await enforceSocialPlatformLimit(userId, normalizedPlatform);

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
    // Surface the tier-limit upgrade prompt (and any other tagged client error)
    // verbatim so the UI can offer an upgrade path.
    if (err.statusCode) {
      const payload = { error: err.message };
      if (err.upgradeRequired) {
        payload.upgradeRequired = true;
        payload.requiredTier = err.requiredTier;
      }
      return res.status(err.statusCode).json(payload);
    }
    return res.status(500).json({ error: "Failed to connect social account" });
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
 * GET /api/social/accounts/:brandId
 * Lists the brand's connected social accounts (no credentials are ever returned).
 */
async function getSocialAccounts(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `SELECT platform, platform_username, connection_status, created_at, updated_at
       FROM social_accounts
       WHERE brand_id = $1
       ORDER BY platform ASC`,
      [brandId]
    );

    const accounts = result.rows.map((row) => ({
      platform: row.platform,
      username: row.platform_username,
      status: row.connection_status,
      connectedAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return res.json({ brandId, count: accounts.length, accounts });
  } catch (err) {
    console.error("Get social accounts error:", err.message);
    return res.status(500).json({ error: "Failed to fetch social accounts" });
  }
}

/**
 * DELETE /api/social/accounts/:brandId/:platform
 * Disconnects (removes) a brand's connected social account for a platform.
 */
async function disconnectSocialAccount(req, res) {
  const userId = req.user.userId;
  const { brandId, platform } = req.params;
  const normalizedPlatform = String(platform || "").toLowerCase();

  if (!isSupportedPlatform(normalizedPlatform)) {
    return res.status(400).json({
      error: `Unsupported platform. Supported: ${SUPPORTED_PLATFORMS.join(", ")}`,
    });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `DELETE FROM social_accounts
       WHERE brand_id = $1 AND platform = $2
       RETURNING account_id`,
      [brandId, normalizedPlatform]
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ error: `No connected ${normalizedPlatform} account for this brand` });
    }
    return res.json({ disconnected: true, platform: normalizedPlatform });
  } catch (err) {
    console.error("Disconnect social account error:", err.message);
    return res.status(500).json({ error: "Failed to disconnect social account" });
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
      `SELECT post_id, platform, external_post_id, published_time, engagement_metrics
       FROM social_posts
       WHERE brand_id = $1 AND status = 'published'
       ORDER BY published_time DESC NULLS LAST`,
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
        publishedTime: post.published_time,
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
  // Rescue posts stranded in 'publishing' by a crash/restart between the
  // claim and the final status write. A normal tick finishes in seconds, so
  // anything stuck for 10+ minutes is dead. They're marked 'failed' (not
  // retried) because the crash may have happened AFTER the platform call
  // succeeded — re-publishing could double-post; the owner sees the failure
  // and can reschedule if the post never actually went out.
  const rescued = await db.query(
    `UPDATE social_posts
     SET status = 'failed', engagement_metrics = $1
     WHERE status = 'publishing' AND updated_at < NOW() - INTERVAL '10 minutes'
     RETURNING post_id`,
    [
      JSON.stringify({
        error:
          "Publishing was interrupted by a server restart. The post may or may not have gone out — check the platform and reschedule if needed.",
      }),
    ]
  );
  if (rescued.rows.length > 0) {
    console.warn(
      `Social scheduler: rescued ${rescued.rows.length} post(s) stuck in 'publishing' and marked them failed.`
    );
  }

  const due = await db.query(
    `UPDATE social_posts
     SET status = 'publishing'
     WHERE post_id IN (
       SELECT sp.post_id FROM social_posts sp
       JOIN brands b ON b.brand_id = sp.brand_id
       WHERE sp.status = 'scheduled' AND sp.scheduled_time <= NOW()
         AND b.is_demo = false
         AND (
           sp.calendar_id IS NULL
           OR sp.calendar_id IN (
             SELECT calendar_id FROM content_calendars WHERE status = 'active'
           )
         )
       ORDER BY sp.scheduled_time ASC
       LIMIT 50
       FOR UPDATE OF sp SKIP LOCKED
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
  getSocialAccounts,
  disconnectSocialAccount,
  getPostPerformance,
  publishStoredPost,
  publishDuePosts,
};
