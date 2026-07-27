const crypto = require("crypto");

const db = require("../config/db");
const { encrypt, decrypt } = require("../utils/encryption");
const {
  clientId,
  clientSecret,
  adsDeveloperToken,
  AUTH_ENDPOINT,
  TOKEN_ENDPOINT,
  USERINFO_ENDPOINT,
  SCOPES,
  SERVICE_SCOPES,
  oauthConfigured,
  adsConfigured,
} = require("../config/google");

/**
 * Resolves the public OAuth redirect_uri for this deployment. Prefers the stable
 * Replit domain(s); falls back to the forwarded request host. Overridable with
 * GOOGLE_REDIRECT_URI. Must be registered in the Google Cloud OAuth client's
 * Authorized redirect URIs.
 */
function getRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  let base;
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    base = `https://${domains.split(",")[0].trim()}`;
  } else if (process.env.REPLIT_DEV_DOMAIN) {
    base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  } else {
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
    base = `${proto}://${req.get("host")}`;
  }
  return `${base}/api/google/oauth/callback`;
}

function dashboardRedirect(status, message) {
  const params = new URLSearchParams({ google: status });
  if (message) params.set("google_message", message);
  return `/dashboard?${params.toString()}`;
}

/** Which Zorecho services a stored scope string unlocks. */
function servicesFromScope(scope) {
  const granted = String(scope || "").split(/\s+/).filter(Boolean);
  const services = {};
  for (const [service, requiredScope] of Object.entries(SERVICE_SCOPES)) {
    services[service] = granted.includes(requiredScope);
  }
  return services;
}

/** Performs an authenticated GET against a Google API, throwing on errors. */
async function googleFetch(url, accessToken, errorLabel, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, ...extraHeaders },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg =
      data.error?.message ||
      data.error_description ||
      `${errorLabel} failed (HTTP ${res.status})`;
    const err = new Error(msg);
    err.googleError = true;
    throw err;
  }
  return data;
}

/**
 * Loads the user's Google grant and returns a valid (refreshed if needed) access
 * token. Throws a tagged error when the user has not connected Google.
 */
async function getValidAccessToken(userId) {
  const result = await db.query(
    `SELECT access_token_encrypted, refresh_token_encrypted, scope, token_expiry
     FROM google_integrations
     WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row || !row.refresh_token_encrypted) {
    const err = new Error("Google account is not connected");
    err.notConnected = true;
    throw err;
  }

  // Reuse the stored access token until ~1 minute before it expires.
  const expiry = row.token_expiry ? new Date(row.token_expiry).getTime() : 0;
  if (row.access_token_encrypted && expiry - Date.now() > 60_000) {
    return { accessToken: decrypt(row.access_token_encrypted), scope: row.scope };
  }

  // Otherwise refresh using the refresh token.
  const refreshToken = decrypt(row.refresh_token_encrypted);
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error || !data.access_token) {
    const err = new Error(
      data.error_description || data.error || "Could not refresh Google access token",
    );
    err.googleError = true;
    throw err;
  }

  const newExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000);
  await db.query(
    `UPDATE google_integrations
     SET access_token_encrypted = $1, token_expiry = $2, connection_status = 'connected'
     WHERE user_id = $3`,
    [encrypt(data.access_token), newExpiry, userId],
  );
  return { accessToken: data.access_token, scope: row.scope };
}

/** Maps a thrown error to the right HTTP response. */
function fail(res, err, fallback) {
  if (err.notConnected) {
    return res.status(400).json({ error: "Connect your Google account first." });
  }
  if (err.googleError) {
    return res.status(502).json({ error: `Google API error: ${err.message}` });
  }
  return res.status(500).json({ error: fallback });
}

/**
 * POST /api/google/oauth/initiate   (Authorization: Bearer <jwt>)
 * Stores a CSRF state + user id in the session and returns the Google OAuth URL.
 */
async function initiateOAuth(req, res) {
  if (!oauthConfigured()) {
    return res
      .status(503)
      .json({ error: "Google connection is not configured on the server." });
  }

  const userId = req.user.userId;
  const state = crypto.randomBytes(16).toString("hex");
  req.session.googleOAuth = { state, userId };

  req.session.save((err) => {
    if (err) {
      console.error("Google OAuth session save error:", err.message);
      return res.status(500).json({ error: "Could not start the Google connection." });
    }
    const authUrl = new URL(AUTH_ENDPOINT);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", getRedirectUri(req));
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES.join(" "));
    authUrl.searchParams.set("state", state);
    // offline + consent guarantees a refresh token on first and repeat connects.
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("include_granted_scopes", "true");
    return res.status(200).json({ authUrl: authUrl.toString() });
  });
}

/**
 * GET /api/google/oauth/callback?code=&state=
 * Verifies CSRF state, exchanges the code for tokens, fetches the account email,
 * stores everything (tokens encrypted), and redirects to the dashboard.
 */
async function oauthCallback(req, res) {
  const { code, state, error: gError } = req.query;
  const sessionState = req.session?.googleOAuth?.state;
  const userId = req.session?.googleOAuth?.userId;

  if (req.session) delete req.session.googleOAuth;

  if (gError) {
    return res.redirect(dashboardRedirect("error", "Google authorization was cancelled."));
  }
  if (!code || !state || !sessionState || !userId) {
    return res.redirect(dashboardRedirect("error", "Invalid or expired Google authorization."));
  }
  if (state !== sessionState) {
    return res.redirect(dashboardRedirect("error", "Security check failed. Please try again."));
  }

  try {
    const redirectUri = getRedirectUri(req);

    // Exchange the authorization code for tokens.
    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: String(code),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || tokenData.error || !tokenData.access_token) {
      throw new Error(
        tokenData.error_description || tokenData.error || "Token exchange failed",
      );
    }

    // Fetch the connected Google account email (best-effort).
    let email = null;
    try {
      const info = await googleFetch(USERINFO_ENDPOINT, tokenData.access_token, "Userinfo");
      email = info.email || null;
    } catch {
      email = null;
    }

    const expiry = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);
    const scope = tokenData.scope || SCOPES.join(" ");

    // A refresh token is only returned on first consent; preserve any existing
    // one when Google omits it on a re-connect.
    const encAccess = encrypt(tokenData.access_token);
    const encRefresh = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null;

    const { rows } = await db.query(
      `INSERT INTO google_integrations
         (user_id, google_account_email, access_token_encrypted,
          refresh_token_encrypted, scope, token_expiry, connection_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'connected')
       ON CONFLICT (user_id)
       DO UPDATE SET google_account_email = EXCLUDED.google_account_email,
                     access_token_encrypted = EXCLUDED.access_token_encrypted,
                     refresh_token_encrypted = COALESCE(EXCLUDED.refresh_token_encrypted,
                                                        google_integrations.refresh_token_encrypted),
                     scope = EXCLUDED.scope,
                     token_expiry = EXCLUDED.token_expiry,
                     connection_status = 'connected'
       RETURNING refresh_token_encrypted`,
      [userId, email, encAccess, encRefresh, scope, expiry],
    );

    // Without a stored refresh token (neither newly issued nor previously kept)
    // the access token will expire in ~1h and every later read would fail. Mark
    // the connection as needing re-consent instead of falsely reporting success.
    if (!rows[0]?.refresh_token_encrypted) {
      await db.query(
        `UPDATE google_integrations SET connection_status = 'error' WHERE user_id = $1`,
        [userId],
      );
      return res.redirect(
        dashboardRedirect(
          "error",
          "Google didn't return offline access. Remove Zorecho from your Google account permissions, then reconnect.",
        ),
      );
    }

    return res.redirect(dashboardRedirect("connected"));
  } catch (err) {
    console.error("Google OAuth callback error:", err.message);
    return res.redirect(
      dashboardRedirect("error", `Google connection failed: ${err.message}`),
    );
  }
}

/**
 * GET /api/google/status
 * Returns the user's Google connection state and per-service availability.
 * Never returns tokens.
 */
async function getConnectionStatus(req, res) {
  const userId = req.user.userId;
  try {
    const result = await db.query(
      `SELECT google_account_email, scope, connection_status
       FROM google_integrations
       WHERE user_id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        configured: oauthConfigured(),
        adsConfigured: adsConfigured(),
        connected: false,
        email: null,
        services: servicesFromScope(""),
      });
    }

    const row = result.rows[0];
    return res.status(200).json({
      configured: oauthConfigured(),
      adsConfigured: adsConfigured(),
      connected: row.connection_status === "connected",
      connectionStatus: row.connection_status,
      email: row.google_account_email,
      services: servicesFromScope(row.scope),
    });
  } catch (err) {
    console.error("Get Google status error:", err.message);
    return res.status(500).json({ error: "Failed to load Google connection status" });
  }
}

/**
 * POST /api/google/disconnect
 * Removes the user's Google integration entirely.
 */
async function disconnect(req, res) {
  const userId = req.user.userId;
  try {
    await db.query(`DELETE FROM google_integrations WHERE user_id = $1`, [userId]);
    return res.status(200).json({ disconnected: true });
  } catch (err) {
    console.error("Disconnect Google error:", err.message);
    return res.status(500).json({ error: "Failed to disconnect Google account" });
  }
}

/**
 * GET /api/google/business-profile
 * Fetches the customer's Google Business Profile (first account + location) and
 * a review summary. Real Business Profile API calls — explicit error if the user
 * hasn't connected or granted the business.manage scope.
 */
async function getBusinessProfile(req, res) {
  if (!oauthConfigured()) {
    return res.status(503).json({ error: "Google connection is not configured." });
  }
  const userId = req.user.userId;
  try {
    const { accessToken } = await getValidAccessToken(userId);

    const accounts = await googleFetch(
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
      accessToken,
      "Business Profile accounts",
    );
    const account = (accounts.accounts || [])[0];
    if (!account) {
      return res.json({ connected: true, account: null, locations: [], reviews: null });
    }

    const locResp = await googleFetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations` +
        `?readMask=name,title,phoneNumbers,storefrontAddress,websiteUri,categories`,
      accessToken,
      "Business Profile locations",
    );
    const locations = locResp.locations || [];

    // Reviews come from the legacy v4 API and may be unavailable; surface that
    // explicitly rather than silently returning nothing.
    let reviews = null;
    const firstLocation = locations[0];
    if (firstLocation) {
      try {
        const reviewResp = await googleFetch(
          `https://mybusiness.googleapis.com/v4/${account.name}/${firstLocation.name}/reviews`,
          accessToken,
          "Business Profile reviews",
        );
        reviews = {
          averageRating: reviewResp.averageRating || null,
          totalReviewCount: reviewResp.totalReviewCount || 0,
        };
      } catch (reviewErr) {
        reviews = { error: reviewErr.message };
      }
    }

    return res.json({
      connected: true,
      account: { name: account.name, accountName: account.accountName },
      locations,
      reviews,
    });
  } catch (err) {
    console.error("Get Google Business Profile error:", err.message);
    return fail(res, err, "Failed to fetch Google Business Profile");
  }
}

/**
 * GET /api/google/analytics
 * Fetches the last 30 days of GA4 traffic (sessions, pageviews, bounce rate, and
 * top traffic sources) for the customer's first Analytics property.
 */
async function getAnalytics(req, res) {
  if (!oauthConfigured()) {
    return res.status(503).json({ error: "Google connection is not configured." });
  }
  const userId = req.user.userId;
  try {
    const { accessToken } = await getValidAccessToken(userId);

    // Discover the user's first GA4 property via the Admin API.
    const summaries = await googleFetch(
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
      accessToken,
      "Analytics account summaries",
    );
    let propertyId = null;
    for (const acct of summaries.accountSummaries || []) {
      const prop = (acct.propertySummaries || [])[0];
      if (prop?.property) {
        propertyId = prop.property; // e.g. "properties/123456789"
        break;
      }
    }
    if (!propertyId) {
      return res.json({ connected: true, property: null, metrics: null, topSources: [] });
    }

    const runReport = async (requestBody) => {
      const res2 = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        },
      );
      const data = await res2.json().catch(() => ({}));
      if (!res2.ok || data.error) {
        const err = new Error(data.error?.message || `Analytics report failed (HTTP ${res2.status})`);
        err.googleError = true;
        throw err;
      }
      return data;
    };

    const dateRanges = [{ startDate: "30daysAgo", endDate: "today" }];

    const totals = await runReport({
      dateRanges,
      metrics: [
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "bounceRate" },
      ],
    });
    const totalRow = totals.rows?.[0]?.metricValues || [];
    const metrics = {
      sessions: Number(totalRow[0]?.value || 0),
      pageviews: Number(totalRow[1]?.value || 0),
      bounceRate: Number(totalRow[2]?.value || 0),
    };

    const sources = await runReport({
      dateRanges,
      dimensions: [{ name: "sessionSource" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 5,
    });
    const topSources = (sources.rows || []).map((r) => ({
      source: r.dimensionValues?.[0]?.value || "(unknown)",
      sessions: Number(r.metricValues?.[0]?.value || 0),
    }));

    return res.json({ connected: true, property: propertyId, metrics, topSources });
  } catch (err) {
    console.error("Get Google Analytics error:", err.message);
    return fail(res, err, "Failed to fetch Google Analytics");
  }
}

/**
 * GET /api/google/ads/performance
 * Fetches active Google Ads campaign performance. Requires both an OAuth
 * connection and a configured Google Ads developer token.
 */
async function getAdsPerformance(req, res) {
  if (!oauthConfigured()) {
    return res.status(503).json({ error: "Google connection is not configured." });
  }
  if (!adsConfigured()) {
    return res
      .status(503)
      .json({ error: "Google Ads requires a developer token (GOOGLE_ADS_DEVELOPER_TOKEN)." });
  }
  const userId = req.user.userId;
  try {
    const { accessToken } = await getValidAccessToken(userId);

    // List accessible customers, then query the first one's active campaigns.
    const customers = await googleFetch(
      "https://googleads.googleapis.com/v17/customers:listAccessibleCustomers",
      accessToken,
      "Google Ads customers",
      { "developer-token": adsDeveloperToken },
    );
    const resourceName = (customers.resourceNames || [])[0];
    if (!resourceName) {
      return res.json({ connected: true, customerId: null, campaigns: [] });
    }
    const customerId = resourceName.split("/")[1];

    const query =
      "SELECT campaign.id, campaign.name, campaign.status, " +
      "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions " +
      "FROM campaign WHERE campaign.status = 'ENABLED' " +
      "AND segments.date DURING LAST_30_DAYS";

    const reportRes = await fetch(
      `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": adsDeveloperToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      },
    );
    const reportData = await reportRes.json().catch(() => ({}));
    if (!reportRes.ok) {
      const err = new Error(
        reportData?.[0]?.error?.message ||
          reportData.error?.message ||
          `Google Ads query failed (HTTP ${reportRes.status})`,
      );
      err.googleError = true;
      throw err;
    }

    const campaigns = [];
    const batches = Array.isArray(reportData) ? reportData : [reportData];
    for (const batch of batches) {
      for (const row of batch.results || []) {
        campaigns.push({
          id: row.campaign?.id,
          name: row.campaign?.name,
          status: row.campaign?.status,
          impressions: Number(row.metrics?.impressions || 0),
          clicks: Number(row.metrics?.clicks || 0),
          costMicros: Number(row.metrics?.costMicros || 0),
          conversions: Number(row.metrics?.conversions || 0),
        });
      }
    }

    return res.json({ connected: true, customerId, campaigns });
  } catch (err) {
    console.error("Get Google Ads performance error:", err.message);
    return fail(res, err, "Failed to fetch Google Ads performance");
  }
}

/**
 * GET /api/google/ad-plan
 * Returns the most recent Google Ads plan across the user's brands (or null).
 * These plans are generated by the Setup Agent when the user opts in to Google
 * ads during onboarding.
 */
async function getAdPlan(req, res) {
  const userId = req.user.userId;
  try {
    const { rows } = await db.query(
      `SELECT p.plan_id, p.brand_id, b.brand_name, p.location, p.monthly_budget,
              p.keywords, p.status, p.created_at, p.updated_at
       FROM google_ad_plans p
       JOIN brands b ON b.brand_id = p.brand_id
       WHERE b.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT 1`,
      [userId],
    );
    if (rows.length === 0) return res.json({ plan: null });
    const row = rows[0];
    return res.json({
      plan: {
        planId: row.plan_id,
        brandId: row.brand_id,
        brandName: row.brand_name,
        location: row.location,
        monthlyBudget: row.monthly_budget,
        keywords: row.keywords,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (err) {
    console.error("Get Google ad plan error:", err.message);
    return res.status(500).json({ error: "Failed to fetch your Google Ads plan" });
  }
}

module.exports = {
  initiateOAuth,
  oauthCallback,
  getConnectionStatus,
  disconnect,
  getBusinessProfile,
  getAnalytics,
  getAdsPerformance,
  getAdPlan,
  oauthConfigured,
  // Reused by the reputation controller to read Google Business Profile reviews.
  getValidAccessToken,
  googleFetch,
};
