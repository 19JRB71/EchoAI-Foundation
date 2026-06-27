const crypto = require("crypto");

const db = require("../config/db");
const { encrypt } = require("../utils/encryption");
const { GRAPH_VERSION, appId, appSecret } = require("../config/facebook");

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const OAUTH_DIALOG = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

// Permissions EchoAI needs to read and manage the customer's ad account.
const SCOPES = [
  "ads_management",
  "ads_read",
  "business_management",
  "pages_read_engagement",
];

/**
 * True when the Facebook app credentials needed for OAuth are configured.
 * Without these the connect flow cannot run, so endpoints surface a clear 503
 * instead of bouncing the user to a broken Facebook dialog.
 */
function oauthConfigured() {
  return Boolean(appId && appSecret);
}

/**
 * Resolves the public base URL of this deployment for building the OAuth
 * redirect_uri. Prefers the stable Replit domain(s); falls back to the
 * forwarded request host. Can be overridden wholesale with FACEBOOK_REDIRECT_URI.
 */
function getRedirectUri(req) {
  if (process.env.FACEBOOK_REDIRECT_URI) {
    return process.env.FACEBOOK_REDIRECT_URI;
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
  return `${base}/api/facebook/oauth/callback`;
}

function dashboardRedirect(status, message) {
  const params = new URLSearchParams({ fb: status });
  if (message) params.set("fb_message", message);
  return `/dashboard?${params.toString()}`;
}

async function graphFetch(url, errorLabel) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error?.message || `${errorLabel} failed (HTTP ${res.status})`;
    const err = new Error(msg);
    err.fbError = true;
    throw err;
  }
  return data;
}

/**
 * POST /api/facebook/oauth/initiate   (Authorization: Bearer <jwt>)
 *
 * Stores a CSRF `state` + the authenticated user id in the session and returns
 * the Facebook OAuth dialog URL. The client then performs a top-level navigation
 * to that URL. Using an authenticated POST (rather than a token-in-query GET
 * redirect) keeps the bearer JWT out of URLs, logs, and browser history.
 */
async function initiateOAuth(req, res) {
  if (!oauthConfigured()) {
    return res
      .status(503)
      .json({ error: "Facebook connection is not configured on the server." });
  }

  const userId = req.user.userId;
  const state = crypto.randomBytes(16).toString("hex");
  req.session.fbOAuth = { state, userId };

  // Persist the session before responding so the callback can read it.
  req.session.save((err) => {
    if (err) {
      console.error("Facebook OAuth session save error:", err.message);
      return res.status(500).json({ error: "Could not start the Facebook connection." });
    }
    const authUrl = new URL(OAUTH_DIALOG);
    authUrl.searchParams.set("client_id", appId);
    authUrl.searchParams.set("redirect_uri", getRedirectUri(req));
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("scope", SCOPES.join(","));
    authUrl.searchParams.set("response_type", "code");
    return res.status(200).json({ authUrl: authUrl.toString() });
  });
}

/**
 * GET /api/facebook/oauth/callback?code=&state=
 *
 * Verifies the CSRF state against the session, exchanges the code for a
 * long-lived user token, fetches the user's ad accounts, stores everything
 * (token encrypted) in api_integrations, and redirects back to the dashboard.
 */
async function oauthCallback(req, res) {
  const { code, state, error: fbError, error_description: fbErrorDesc } = req.query;
  const sessionState = req.session?.fbOAuth?.state;
  const userId = req.session?.fbOAuth?.userId;

  // Clear the one-time OAuth state regardless of outcome.
  if (req.session) delete req.session.fbOAuth;

  if (fbError) {
    return res.redirect(
      dashboardRedirect("error", fbErrorDesc || "Facebook authorization was cancelled."),
    );
  }
  if (!code || !state || !sessionState || !userId) {
    return res.redirect(dashboardRedirect("error", "Invalid or expired Facebook authorization."));
  }
  if (state !== sessionState) {
    return res.redirect(dashboardRedirect("error", "Security check failed. Please try again."));
  }

  try {
    const redirectUri = getRedirectUri(req);

    // 1. Exchange the code for a short-lived access token.
    const shortUrl = new URL(`${GRAPH}/oauth/access_token`);
    shortUrl.searchParams.set("client_id", appId);
    shortUrl.searchParams.set("client_secret", appSecret);
    shortUrl.searchParams.set("redirect_uri", redirectUri);
    shortUrl.searchParams.set("code", String(code));
    const shortData = await graphFetch(shortUrl.toString(), "Token exchange");

    // 2. Exchange the short-lived token for a long-lived one (~60 days).
    const longUrl = new URL(`${GRAPH}/oauth/access_token`);
    longUrl.searchParams.set("grant_type", "fb_exchange_token");
    longUrl.searchParams.set("client_id", appId);
    longUrl.searchParams.set("client_secret", appSecret);
    longUrl.searchParams.set("fb_exchange_token", shortData.access_token);
    const longData = await graphFetch(longUrl.toString(), "Long-lived token exchange");
    const accessToken = longData.access_token;

    // 3. Fetch the user's ad accounts.
    const acctUrl = new URL(`${GRAPH}/me/adaccounts`);
    acctUrl.searchParams.set("fields", "account_id,name,account_status,currency");
    acctUrl.searchParams.set("access_token", accessToken);
    const acctData = await graphFetch(acctUrl.toString(), "Fetching ad accounts");

    const adAccounts = (acctData.data || []).map((a) => ({
      id: a.id || `act_${a.account_id}`,
      accountId: a.account_id,
      name: a.name || a.id,
      accountStatus: a.account_status,
      currency: a.currency,
    }));

    const selectedRef = adAccounts.length ? adAccounts[0].id : null;
    const encryptedToken = encrypt(accessToken);

    await db.query(
      `INSERT INTO api_integrations
         (user_id, platform, api_token_encrypted, account_ref, facebook_ad_accounts, connection_status)
       VALUES ($1, 'facebook', $2, $3, $4::jsonb, 'connected')
       ON CONFLICT (user_id, platform)
       DO UPDATE SET api_token_encrypted = EXCLUDED.api_token_encrypted,
                     account_ref = EXCLUDED.account_ref,
                     facebook_ad_accounts = EXCLUDED.facebook_ad_accounts,
                     connection_status = 'connected'`,
      [userId, encryptedToken, selectedRef, JSON.stringify(adAccounts)],
    );

    return res.redirect(dashboardRedirect("connected"));
  } catch (err) {
    console.error("Facebook OAuth callback error:", err.message);
    const message = err.fbError
      ? `Facebook connection failed: ${err.message}`
      : "Could not complete the Facebook connection.";
    return res.redirect(dashboardRedirect("error", message));
  }
}

/**
 * GET /api/facebook/accounts
 * Returns the connected Facebook ad accounts for the current user. Never
 * returns the access token.
 */
async function getConnectedAccounts(req, res) {
  const userId = req.user.userId;
  try {
    const result = await db.query(
      `SELECT account_ref, facebook_ad_accounts, connection_status
       FROM api_integrations
       WHERE user_id = $1 AND platform = 'facebook'`,
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        configured: oauthConfigured(),
        connected: false,
        accounts: [],
        selectedAccountId: null,
      });
    }

    const row = result.rows[0];
    return res.status(200).json({
      configured: oauthConfigured(),
      connected: row.connection_status === "connected",
      connectionStatus: row.connection_status,
      accounts: row.facebook_ad_accounts || [],
      selectedAccountId: row.account_ref,
    });
  } catch (err) {
    console.error("Get connected Facebook accounts error:", err.message);
    return res.status(500).json({ error: "Failed to load Facebook accounts" });
  }
}

/**
 * POST /api/facebook/select-account  { accountId }
 * Sets which connected ad account EchoAI should manage. The id must be one of
 * the accounts returned by Facebook at connect time.
 */
async function selectAccount(req, res) {
  const userId = req.user.userId;
  const { accountId } = req.body;
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }

  try {
    const result = await db.query(
      `SELECT facebook_ad_accounts FROM api_integrations
       WHERE user_id = $1 AND platform = 'facebook'`,
      [userId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No connected Facebook account found" });
    }

    const accounts = result.rows[0].facebook_ad_accounts || [];
    if (!accounts.some((a) => a.id === accountId)) {
      return res.status(400).json({ error: "Unknown ad account" });
    }

    await db.query(
      `UPDATE api_integrations SET account_ref = $1
       WHERE user_id = $2 AND platform = 'facebook'`,
      [accountId, userId],
    );

    return res.status(200).json({ selectedAccountId: accountId });
  } catch (err) {
    console.error("Select Facebook account error:", err.message);
    return res.status(500).json({ error: "Failed to update selected ad account" });
  }
}

/**
 * POST /api/facebook/disconnect
 * Removes the user's Facebook integration entirely.
 */
async function disconnectAccount(req, res) {
  const userId = req.user.userId;
  try {
    await db.query(
      `DELETE FROM api_integrations WHERE user_id = $1 AND platform = 'facebook'`,
      [userId],
    );
    return res.status(200).json({ disconnected: true });
  } catch (err) {
    console.error("Disconnect Facebook account error:", err.message);
    return res.status(500).json({ error: "Failed to disconnect Facebook account" });
  }
}

module.exports = {
  initiateOAuth,
  oauthCallback,
  getConnectedAccounts,
  selectAccount,
  disconnectAccount,
  oauthConfigured,
};
