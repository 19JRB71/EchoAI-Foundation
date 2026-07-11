const db = require("../config/db");
const { sageContextForBrand } = require("../utils/sageContext");
const { encrypt, decrypt } = require("../utils/encryption");
const {
  generateSocialPosts,
  SUPPORTED_PLATFORMS,
} = require("../prompts/socialContentPrompt");
const socialApi = require("../utils/socialApi");
const { getUserTier } = require("../middleware/featureGate");
const { meetsTier } = require("../config/tiers");
const { alertOwnerOfFailedSend } = require("../utils/failedSendAlerts");
const { getPublicBaseUrl } = require("../config/twilio");

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
  const credentials = JSON.parse(decrypt(row.credentials_encrypted));
  // Facebook posting runs on the unified Facebook connection: the brand's
  // social_accounts row records WHICH Page it posts to (pageId), while the Page
  // access token itself lives (encrypted, single source of truth) on the user's
  // api_integrations row and is resolved live here. Older manually-connected
  // rows that still carry their own accessToken keep working unchanged.
  if (platform === "facebook" && !credentials.accessToken && credentials.pageId) {
    const token = await resolveFacebookPageToken(brandId, credentials.pageId);
    if (token) credentials.accessToken = token;
  }
  return {
    accountId: row.account_id,
    username: row.platform_username,
    status: row.connection_status,
    credentials,
  };
}

/**
 * Resolves the live Facebook Page access token for a brand's selected Page from
 * the owning user's unified Facebook connection (api_integrations). Returns null
 * when there is no connection or no stored token for that Page. Keeping the token
 * in one place (never copied into social_accounts) means it can never go stale.
 */
async function resolveFacebookPageToken(brandId, pageId) {
  const { rows } = await db.query(
    `SELECT ai.facebook_page_tokens
       FROM api_integrations ai
       JOIN brands b ON b.user_id = ai.user_id
      WHERE b.brand_id = $1 AND ai.platform = 'facebook'
        AND ai.connection_status = 'connected'`,
    [brandId]
  );
  if (!rows.length || !rows[0].facebook_page_tokens) return null;
  try {
    const tokens = JSON.parse(decrypt(rows[0].facebook_page_tokens));
    return tokens[pageId] || null;
  } catch (_e) {
    return null;
  }
}

/**
 * POST /api/social/facebook-page  { brandId, pageId }
 * Chooses which Facebook Page the given brand posts to (Nova). The Page must
 * belong to the user's unified Facebook connection and have a stored publish
 * token (captured during OAuth). Only the Page id is stored in social_accounts;
 * the token is resolved live at publish time from api_integrations.
 */
async function setFacebookBrandPage(req, res) {
  const userId = req.user.userId;
  const { brandId, pageId } = req.body;
  if (!brandId || !pageId) {
    return res.status(400).json({ error: "brandId and pageId are required" });
  }
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const { rows } = await db.query(
      `SELECT facebook_pages, facebook_page_tokens
         FROM api_integrations
        WHERE user_id = $1 AND platform = 'facebook'
          AND connection_status = 'connected'`,
      [userId]
    );
    if (!rows.length) {
      return res.status(400).json({
        error: "Connect your Facebook account first, then choose a Page to post from.",
        needsFacebook: true,
      });
    }
    const pages = rows[0].facebook_pages || [];
    const page = pages.find((p) => p.id === pageId);
    if (!page) {
      return res
        .status(400)
        .json({ error: "That Page is not part of your connected Facebook account." });
    }
    let tokens = {};
    try {
      tokens = rows[0].facebook_page_tokens
        ? JSON.parse(decrypt(rows[0].facebook_page_tokens))
        : {};
    } catch (_e) {
      tokens = {};
    }
    if (!tokens[pageId]) {
      return res.status(400).json({
        error:
          "Reconnect Facebook to grant posting permission for your Pages, then try again.",
        needsReconnect: true,
      });
    }

    // Selecting a Page counts as connecting the Facebook platform for this
    // account (tier-limited on Starter). Switching Page for an already-connected
    // brand stays within the limit (facebook is already counted).
    await enforceSocialPlatformLimit(userId, "facebook");

    // Store only the Page id — the token is resolved live at publish time from
    // api_integrations (single source of truth), so it never goes stale.
    const encrypted = encrypt(JSON.stringify({ pageId }));
    const insert = await db.query(
      `INSERT INTO social_accounts
         (brand_id, platform, platform_username, credentials_encrypted, connection_status)
       VALUES ($1, 'facebook', $2, $3, 'connected')
       ON CONFLICT (brand_id, platform)
       DO UPDATE SET platform_username = EXCLUDED.platform_username,
                     credentials_encrypted = EXCLUDED.credentials_encrypted,
                     connection_status = 'connected'
       RETURNING account_id, platform, platform_username,
                 connection_status, created_at, updated_at`,
      [brandId, page.name || pageId, encrypted]
    );
    const row = insert.rows[0];
    return res.status(200).json({
      pageId,
      account: {
        platform: row.platform,
        username: row.platform_username,
        status: row.connection_status,
        connectedAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (err) {
    console.error("Set Facebook brand page error:", err.message);
    if (err.statusCode) {
      const payload = { error: err.message };
      if (err.upgradeRequired) {
        payload.upgradeRequired = true;
        payload.requiredTier = err.requiredTier;
      }
      return res.status(err.statusCode).json(payload);
    }
    return res.status(500).json({ error: "Failed to set Facebook Page for posting" });
  }
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

    brand._sageContext = await sageContextForBrand(brand.brand_id);
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

    // Refuse to queue a post that is guaranteed to fail at publish time: if
    // the brand's stored connection for this platform is flagged 'error'
    // (expired/revoked login), tell the owner to reconnect first. Once they
    // reconnect, connection_status flips back to 'connected' and this check
    // passes with no extra steps.
    const accountCheck = await db.query(
      `SELECT connection_status FROM social_accounts
       WHERE brand_id = $1 AND platform = $2
       LIMIT 1`,
      [brandId, normalizedPlatform]
    );
    if (
      accountCheck.rows.length > 0 &&
      accountCheck.rows[0].connection_status === "error"
    ) {
      const label =
        normalizedPlatform.charAt(0).toUpperCase() + normalizedPlatform.slice(1);
      return res.status(409).json({
        error: `Your ${label} connection stopped working, so this post would fail to publish. Reconnect ${label} in Connected Accounts, then schedule it again.`,
        connectionError: true,
        platform: normalizedPlatform,
      });
    }

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
 * PUT /api/social/posts/:postId/reschedule
 * Puts a FAILED post back on the schedule at a new future time and clears the
 * stored failure reason. Ownership is enforced with a join to brands on
 * user_id; only the failed -> scheduled transition is allowed so a published
 * or in-flight post can never be re-queued (double-post risk). Branches on
 * the atomic UPDATE's row count, never a pre-read.
 */
async function reschedulePost(req, res) {
  const userId = req.user.userId;
  const { postId } = req.params;
  const { scheduledTime } = req.body || {};

  // post_id is a UUID; reject malformed ids up front so they surface as a
  // clean 400 instead of a Postgres cast error.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!postId || !UUID_RE.test(postId)) {
    return res.status(400).json({ error: "Invalid post id" });
  }
  if (!scheduledTime) {
    return res.status(400).json({ error: "scheduledTime is required" });
  }
  const when = new Date(scheduledTime);
  if (Number.isNaN(when.getTime())) {
    return res
      .status(400)
      .json({ error: "scheduledTime must be a valid date/time" });
  }
  if (when.getTime() <= Date.now()) {
    return res
      .status(400)
      .json({ error: "scheduledTime must be in the future" });
  }

  try {
    const result = await db.query(
      `UPDATE social_posts sp
       SET status = 'scheduled', scheduled_time = $1, engagement_metrics = NULL,
           publish_attempts = 0
       FROM brands b
       WHERE sp.post_id = $2
         AND b.brand_id = sp.brand_id
         AND b.user_id = $3
         AND sp.status = 'failed'
       RETURNING sp.post_id, sp.brand_id, sp.platform, sp.post_content,
                 sp.scheduled_time, sp.published_time, sp.status,
                 sp.engagement_metrics, sp.external_post_id, sp.created_at`,
      [when.toISOString(), postId, userId]
    );
    if (result.rows.length > 0) {
      return res.json({ post: result.rows[0] });
    }

    // Nothing updated: either the post isn't ours (404, same as any foreign
    // resource) or it exists but isn't in 'failed' (409 with the real status).
    const check = await db.query(
      `SELECT sp.status FROM social_posts sp
       JOIN brands b ON b.brand_id = sp.brand_id AND b.user_id = $2
       WHERE sp.post_id = $1`,
      [postId, userId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }
    return res.status(409).json({
      error: `Only failed posts can be rescheduled (this post is '${check.rows[0].status}')`,
    });
  } catch (err) {
    console.error("Reschedule post error:", err.message);
    return res.status(500).json({ error: "Failed to reschedule post" });
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
              status, engagement_metrics, external_post_id, publish_attempts, created_at
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
  // Posts drafted with a visual store a relative /uploads/images/... path;
  // platforms fetch the image themselves so they need an absolute public URL.
  let imageUrl;
  if (post.image_url) {
    if (/^https:\/\//i.test(post.image_url)) {
      imageUrl = post.image_url;
    } else {
      const base = getPublicBaseUrl();
      if (base) imageUrl = `${base}${post.image_url}`;
    }
  }
  const result = await socialApi.publishPost(post.platform, account.credentials, {
    content: post.post_content,
    imageUrl,
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

// A post gets this many total publish attempts before it is marked 'failed'
// for a transient platform error. Hard errors (expired token, rejected
// content, bad credentials) never retry — they fail on the first attempt.
const MAX_PUBLISH_ATTEMPTS = 2;
// How long a transiently-failed post waits before the scheduler picks it up
// again (the every-minute tick republishes it once scheduled_time passes).
const PUBLISH_RETRY_DELAY_MINUTES = 5;

/**
 * Transient publish failures are worth one automatic retry: network-level
 * errors that never reached the platform (socialApi marks them
 * `err.transient`), platform 5xx responses, and 429 rate limits. Everything
 * else — 4xx auth/content rejections, missing accounts, and any error without
 * an explicit transient signal (e.g. "no post id returned", where the platform
 * call may have succeeded) — is treated as hard, because retrying those either
 * cannot help or risks double-posting.
 */
function isTransientPublishError(err) {
  if (err && err.transient === true) return true;
  const status = err && err.statusCode;
  return status === 429 || (typeof status === "number" && status >= 500);
}

/**
 * Alerts the brand owner the moment one of their scheduled posts flips to
 * 'failed' so they can reschedule the same day instead of discovering it in
 * the calendar next week. Mirrors the hot-lead alert pattern: web push to
 * every installed device + FCM mirror to native mobile devices.
 *
 * Invariants:
 *  - Best-effort: never throws into the scheduler loop.
 *  - Demo brands never alert.
 *  - One alert per failure: callers invoke this only where the atomic
 *    scheduled/publishing -> failed UPDATE actually hit a row, and the
 *    per-post notification tag collapses any duplicate deliveries.
 *  - Deep-links to the calendar (/dashboard?section=social) so the owner can
 *    use the one-click Reschedule immediately.
 */
async function alertOwnerOfFailedPost({ postId, brandId, platform, reason }) {
  const platformLabel = platform
    ? platform.charAt(0).toUpperCase() + platform.slice(1)
    : "Social";
  const why = String(reason || "Unknown error").slice(0, 160);
  await alertOwnerOfFailedSend({
    brandId,
    title: "⚠️ Post failed to publish",
    buildBody: (brand) =>
      `${platformLabel} post for ${brand.brand_name} didn't publish: ${why} Tap to reschedule.`,
    url: "/dashboard?section=social",
    tag: `post-failed-${postId}`,
    mobileData: { type: "post_failed", postId: String(postId) },
    logLabel: "Failed-post",
  });
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
  const RESCUE_REASON =
    "Publishing was interrupted by a server restart. The post may or may not have gone out — check the platform and reschedule if needed.";
  const rescued = await db.query(
    `UPDATE social_posts
     SET status = 'failed', engagement_metrics = $1
     WHERE status = 'publishing' AND updated_at < NOW() - INTERVAL '10 minutes'
     RETURNING post_id, brand_id, platform`,
    [JSON.stringify({ error: RESCUE_REASON })]
  );
  if (rescued.rows.length > 0) {
    console.warn(
      `Social scheduler: rescued ${rescued.rows.length} post(s) stuck in 'publishing' and marked them failed.`
    );
    // Alert each owner right away — the RETURNING rows are exactly the posts
    // that transitioned to 'failed' in this sweep, so each alerts once.
    for (const row of rescued.rows) {
      await alertOwnerOfFailedPost({
        postId: row.post_id,
        brandId: row.brand_id,
        platform: row.platform,
        reason: RESCUE_REASON,
      });
    }
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
     RETURNING post_id, brand_id, platform, post_content, image_url, publish_attempts`
  );

  let published = 0;
  for (const post of due.rows) {
    try {
      await publishStoredPost(post);
      published += 1;
    } catch (err) {
      const attemptsUsed = (post.publish_attempts || 0) + 1;
      // One transient hiccup (timeout, 5xx, rate limit) shouldn't force the
      // owner to reschedule by hand: put the post back to 'scheduled' a few
      // minutes out and let the regular tick retry it. The status guard keeps
      // this from clobbering a row something else already resolved. Hard
      // errors and exhausted retries fall through to 'failed' as before.
      if (isTransientPublishError(err) && attemptsUsed < MAX_PUBLISH_ATTEMPTS) {
        console.warn(
          `Social publish hit a transient error for post ${post.post_id} ` +
            `(attempt ${attemptsUsed}/${MAX_PUBLISH_ATTEMPTS}), retrying in ` +
            `${PUBLISH_RETRY_DELAY_MINUTES} minutes:`,
          err.message
        );
        await db.query(
          `UPDATE social_posts
           SET status = 'scheduled',
               scheduled_time = NOW() + make_interval(mins => ${PUBLISH_RETRY_DELAY_MINUTES}),
               publish_attempts = publish_attempts + 1
           WHERE post_id = $1 AND status = 'publishing'`,
          [post.post_id]
        );
        continue;
      }
      console.error(`Social publish failed for post ${post.post_id}:`, err.message);
      // Status-guarded flip: only the row this tick claimed ('publishing') can
      // transition, and the row count tells us whether the transition really
      // happened here — the owner is alerted only for that real transition.
      const marked = await db.query(
        `UPDATE social_posts
         SET status = 'failed', engagement_metrics = $1,
             publish_attempts = publish_attempts + 1
         WHERE post_id = $2 AND status = 'publishing'
         RETURNING post_id`,
        [JSON.stringify({ error: err.message }), post.post_id]
      );
      if (marked.rows.length > 0) {
        await alertOwnerOfFailedPost({
          postId: post.post_id,
          brandId: post.brand_id,
          platform: post.platform,
          reason: err.message,
        });
      }
    }
  }

  if (due.rows.length > 0) {
    console.log(
      `Social scheduler: published ${published}/${due.rows.length} due post(s).`
    );
  }
  return { due: due.rows.length, published };
}

// --- Connection re-verify sweep (scheduler) ---------------------------------

/**
 * Alerts the brand owner that a social login just broke (real
 * 'connected' -> 'error' transition only — the caller branches on the guarded
 * UPDATE's row count, so repeated sweeps over a still-broken account never
 * re-alert). Best-effort via the shared failed-send helper: demo brands never
 * alert, delivery failures never throw into the sweep, and the per-account
 * notification tag collapses any duplicate deliveries at the tray.
 */
async function alertOwnerOfBrokenConnection(row) {
  const platform = row.platform;
  const platformLabel = platform
    ? platform.charAt(0).toUpperCase() + platform.slice(1)
    : "Social";
  await alertOwnerOfFailedSend({
    brandId: row.brand_id,
    title: `⚠️ ${platformLabel} connection needs attention`,
    buildBody: (brand) =>
      `Your ${platformLabel} login for ${brand.brand_name} stopped working. ` +
      `Tap to reconnect before scheduled posts fail.`,
    url: "/dashboard?section=social",
    tag: `social-connection-error-${row.account_id}`,
    mobileData: {
      type: "social_connection_error",
      accountId: String(row.account_id),
      platform: String(platform || ""),
    },
    logLabel: "Broken-connection",
  });
}

/**
 * Flips one account to 'error', status-guarded, and alerts the brand owner
 * only when the UPDATE actually hit a row (a real 'connected' -> 'error'
 * transition). Returns the sweep outcome: "flagged" for a real flip,
 * "already-flagged" when the account was in 'error' before this sweep pass.
 */
async function flagAccountRow(row) {
  const result = await db.query(
    `UPDATE social_accounts SET connection_status = 'error'
     WHERE account_id = $1 AND connection_status <> 'error'`,
    [row.account_id]
  );
  if (result.rowCount > 0) {
    // Real transition: tell the owner NOW instead of waiting for them to
    // open the dashboard. A still-'error' account hits 0 rows above, so
    // repeated sweeps never re-alert (dedup by design, not by tag alone).
    await alertOwnerOfBrokenConnection(row);
    return "flagged";
  }
  return "already-flagged";
}

/**
 * Re-verifies one stored social account's credentials against its platform and
 * reconciles connection_status. Outcomes:
 *   - "flagged":  a hard verification failure (expired/revoked token, bad
 *     credentials) flipped the account 'connected' -> 'error' (a REAL
 *     transition — the guarded UPDATE hit a row) so the dashboard warns the
 *     owner BEFORE the next scheduled post fails; the owner is also push-alerted.
 *   - "already-flagged": hard failure on an account already in 'error' — no
 *     transition happened, so no re-alert.
 *   - "restored": credentials verified fine for an account previously stuck in
 *     'error' (e.g. the owner reauthorized on the platform side), so status is
 *     flipped back to 'connected'.
 *   - "skipped":  a transient failure (network blip, 429, platform 5xx) —
 *     status is left untouched because the credentials may be perfectly valid.
 *   - "ok":       verified and already 'connected'; nothing to do.
 * Status flips are guarded by the current status in the WHERE clause so an
 * owner reconnecting mid-sweep can't be clobbered by a stale result.
 */
async function reverifyAccountRow(row) {
  let credentials;
  try {
    credentials = JSON.parse(decrypt(row.credentials_encrypted));
  } catch {
    // Undecryptable/corrupt credentials can never publish — hard failure.
    return flagAccountRow(row);
  }

  try {
    await socialApi.verifyConnection(row.platform, credentials);
  } catch (err) {
    // Only hard failures (auth rejections, missing fields) flag the account.
    // Transient errors never reached / weren't answered by the platform, so
    // flipping to 'error' would raise a false alarm on working credentials.
    if (isTransientPublishError(err)) return "skipped";
    return flagAccountRow(row);
  }

  if (row.connection_status === "error") {
    await db.query(
      `UPDATE social_accounts SET connection_status = 'connected'
       WHERE account_id = $1 AND connection_status = 'error'`,
      [row.account_id]
    );
    return "restored";
  }
  return "ok";
}

/**
 * Periodic sweep: re-verifies every stored social connection (real brands
 * only) so an expired/revoked login surfaces as a "needs attention" warning on
 * the calendar views before more scheduled posts fail. Best-effort per
 * account: one account's failure never stops the sweep.
 */
async function reverifySocialConnections() {
  const { rows } = await db.query(
    `SELECT sa.account_id, sa.brand_id, sa.platform, sa.connection_status, sa.credentials_encrypted
     FROM social_accounts sa
     JOIN brands b ON b.brand_id = sa.brand_id
     WHERE b.is_demo = false
     ORDER BY sa.account_id ASC`
  );

  const summary = { checked: 0, flagged: 0, restored: 0, skipped: 0 };
  for (const row of rows) {
    try {
      const outcome = await module.exports.reverifyAccountRow(row);
      summary.checked += 1;
      if (outcome === "flagged" || outcome === "already-flagged")
        summary.flagged += 1;
      else if (outcome === "restored") summary.restored += 1;
      else if (outcome === "skipped") summary.skipped += 1;
    } catch (err) {
      console.error(
        `Social connection re-verify failed for account ${row.account_id}:`,
        err.message
      );
    }
  }

  if (rows.length > 0) {
    console.log(
      `Social connection re-verify complete: ${summary.checked}/${rows.length} checked, ` +
        `${summary.flagged} flagged, ${summary.restored} restored, ${summary.skipped} transient-skipped.`
    );
  }
  return summary;
}

module.exports = {
  connectSocialAccount,
  generateSocialContent,
  schedulePost,
  reschedulePost,
  getSocialCalendar,
  getSocialAccounts,
  disconnectSocialAccount,
  getPostPerformance,
  publishStoredPost,
  publishDuePosts,
  reverifySocialConnections,
  setFacebookBrandPage,
  resolveFacebookPageToken,
  // exported for tests (and so the sweep's per-row guard seam is stubbable)
  reverifyAccountRow,
};
