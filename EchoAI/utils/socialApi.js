/**
 * Thin, per-platform client for the social platforms EchoAI publishes to.
 *
 * Each platform exposes three operations used by the social controller and the
 * scheduler:
 *   - verifyConnection(platform, credentials): confirms the stored credentials
 *     actually authenticate against the platform.
 *   - publishPost(platform, credentials, post): publishes post.content and
 *     returns { externalId }.
 *   - fetchMetrics(platform, credentials, post): returns normalized engagement
 *     metrics { likes, comments, shares, reach } for an already-published post.
 *
 * Credentials are a per-platform object (the decrypted value stored in
 * social_accounts), e.g. { accessToken, pageId } for Facebook. These functions
 * make the real documented API calls; when a prerequisite (token, media) is
 * missing they throw an explicit error rather than silently faking success.
 */

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const SUPPORTED_PLATFORMS = [
  "facebook",
  "instagram",
  "tiktok",
  "linkedin",
  "twitter",
  "youtube",
];

function assertSupported(platform) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    const err = new Error(`Unsupported platform: ${platform}`);
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Performs an HTTP request and parses the JSON body, throwing a structured
 * Error on a non-2xx response.
 */
async function httpJson(url, { method = "GET", headers = {}, body } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : typeof body === "string"
            ? body
            : JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Network error contacting platform: ${err.message}`);
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const detail =
      data?.error?.message ||
      data?.error?.detail ||
      data?.detail ||
      data?.title ||
      (typeof data?.error === "string" ? data.error : null) ||
      data?.raw ||
      `HTTP ${response.status}`;
    const err = new Error(`${response.status} ${detail}`);
    err.statusCode = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

function requireFields(platform, credentials, fields) {
  if (!credentials || typeof credentials !== "object") {
    const err = new Error(`Missing credentials for ${platform}`);
    err.statusCode = 400;
    throw err;
  }
  const missing = fields.filter((f) => !credentials[f]);
  if (missing.length) {
    const err = new Error(
      `Missing required ${platform} credential field(s): ${missing.join(", ")}`
    );
    err.statusCode = 400;
    throw err;
  }
}

function bearer(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function mediaRequired(platform) {
  const err = new Error(
    `Publishing to ${platform} requires an uploaded image/video asset, which is not configured for text-only posts.`
  );
  err.statusCode = 422;
  return err;
}

// ---------------------------------------------------------------------------
// verifyConnection
// ---------------------------------------------------------------------------
async function verifyConnection(platform, credentials) {
  assertSupported(platform);
  try {
    switch (platform) {
      case "facebook": {
        requireFields(platform, credentials, ["accessToken"]);
        const data = await httpJson(
          `${GRAPH_BASE}/me?fields=id,name&access_token=${encodeURIComponent(credentials.accessToken)}`
        );
        return { ok: true, username: data.name || credentials.pageId || null };
      }
      case "instagram": {
        requireFields(platform, credentials, ["accessToken", "igUserId"]);
        const data = await httpJson(
          `${GRAPH_BASE}/${credentials.igUserId}?fields=username&access_token=${encodeURIComponent(credentials.accessToken)}`
        );
        return { ok: true, username: data.username || null };
      }
      case "twitter": {
        requireFields(platform, credentials, ["accessToken"]);
        const data = await httpJson("https://api.twitter.com/2/users/me", {
          headers: bearer(credentials.accessToken),
        });
        return { ok: true, username: data?.data?.username || null };
      }
      case "linkedin": {
        requireFields(platform, credentials, ["accessToken"]);
        const data = await httpJson("https://api.linkedin.com/v2/userinfo", {
          headers: bearer(credentials.accessToken),
        });
        return { ok: true, username: data.name || data.email || null };
      }
      case "tiktok": {
        requireFields(platform, credentials, ["accessToken"]);
        const data = await httpJson(
          "https://open.tiktokapis.com/v2/user/info/?fields=display_name",
          { headers: bearer(credentials.accessToken) }
        );
        return { ok: true, username: data?.data?.user?.display_name || null };
      }
      case "youtube": {
        requireFields(platform, credentials, ["accessToken"]);
        const data = await httpJson(
          "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
          { headers: bearer(credentials.accessToken) }
        );
        return { ok: true, username: data?.items?.[0]?.snippet?.title || null };
      }
      default:
        throw mediaRequired(platform);
    }
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

// ---------------------------------------------------------------------------
// publishPost
// ---------------------------------------------------------------------------
async function publishPost(platform, credentials, post) {
  assertSupported(platform);
  const content = post?.content || "";

  switch (platform) {
    case "facebook": {
      requireFields(platform, credentials, ["accessToken", "pageId"]);
      const params = new URLSearchParams({
        message: content,
        access_token: credentials.accessToken,
      });
      const data = await httpJson(`${GRAPH_BASE}/${credentials.pageId}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      return { externalId: data.id, raw: data };
    }
    case "twitter": {
      requireFields(platform, credentials, ["accessToken"]);
      const data = await httpJson("https://api.twitter.com/2/tweets", {
        method: "POST",
        headers: bearer(credentials.accessToken),
        body: { text: content },
      });
      return { externalId: data?.data?.id, raw: data };
    }
    case "linkedin": {
      requireFields(platform, credentials, ["accessToken", "authorUrn"]);
      const data = await httpJson("https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: {
          ...bearer(credentials.accessToken),
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: {
          author: credentials.authorUrn,
          lifecycleState: "PUBLISHED",
          specificContent: {
            "com.linkedin.ugc.ShareContent": {
              shareCommentary: { text: content },
              shareMediaCategory: "NONE",
            },
          },
          visibility: {
            "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
          },
        },
      });
      return { externalId: data.id, raw: data };
    }
    // Instagram, TikTok and YouTube require an uploaded media/video asset to
    // publish; text-only publishing is not supported by their APIs.
    case "instagram":
    case "tiktok":
    case "youtube":
      throw mediaRequired(platform);
    default:
      throw mediaRequired(platform);
  }
}

// ---------------------------------------------------------------------------
// fetchMetrics
// ---------------------------------------------------------------------------
function normalizeMetrics({ likes = null, comments = null, shares = null, reach = null }) {
  return { likes, comments, shares, reach };
}

async function fetchMetrics(platform, credentials, post) {
  assertSupported(platform);
  const externalId = post?.externalPostId;
  if (!externalId) {
    const err = new Error("Cannot fetch metrics without an external post id");
    err.statusCode = 400;
    throw err;
  }

  switch (platform) {
    case "facebook": {
      requireFields(platform, credentials, ["accessToken"]);
      const fields = "likes.summary(true),comments.summary(true),shares";
      const data = await httpJson(
        `${GRAPH_BASE}/${externalId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(credentials.accessToken)}`
      );
      return normalizeMetrics({
        likes: data?.likes?.summary?.total_count ?? null,
        comments: data?.comments?.summary?.total_count ?? null,
        shares: data?.shares?.count ?? null,
      });
    }
    case "twitter": {
      requireFields(platform, credentials, ["accessToken"]);
      const data = await httpJson(
        `https://api.twitter.com/2/tweets/${externalId}?tweet.fields=public_metrics`,
        { headers: bearer(credentials.accessToken) }
      );
      const m = data?.data?.public_metrics || {};
      return normalizeMetrics({
        likes: m.like_count ?? null,
        comments: m.reply_count ?? null,
        shares: m.retweet_count ?? null,
        reach: m.impression_count ?? null,
      });
    }
    case "linkedin": {
      requireFields(platform, credentials, ["accessToken"]);
      const data = await httpJson(
        `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(externalId)}`,
        { headers: bearer(credentials.accessToken) }
      );
      return normalizeMetrics({
        likes: data?.likesSummary?.totalLikes ?? null,
        comments: data?.commentsSummary?.totalComments ?? null,
      });
    }
    case "instagram":
    case "tiktok":
    case "youtube": {
      const err = new Error(
        `Metrics retrieval for ${platform} is not configured (requires media-publishing setup).`
      );
      err.statusCode = 422;
      throw err;
    }
    default: {
      const err = new Error(`Metrics not supported for platform: ${platform}`);
      err.statusCode = 400;
      throw err;
    }
  }
}

module.exports = {
  SUPPORTED_PLATFORMS,
  verifyConnection,
  publishPost,
  fetchMetrics,
};
