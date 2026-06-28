require("dotenv").config();

/**
 * Google integration configuration.
 *
 * EchoAI connects to a customer's Google services (Business Profile, Ads,
 * Analytics, Search Console) via a single OAuth flow. Without the OAuth client
 * credentials the connect flow cannot run, so endpoints surface a clear 503 /
 * "not configured" response instead of bouncing the user to a broken Google
 * dialog. Google Ads additionally needs an approved developer token.
 */

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const adsDeveloperToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";

// Permissions EchoAI requests across the customer's Google marketing surfaces.
const SCOPES = [
  "https://www.googleapis.com/auth/business.manage",
  "https://www.googleapis.com/auth/adwords",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
];

// Maps each granted OAuth scope to the EchoAI service it unlocks, so the UI can
// show per-service connection status from the single stored grant.
const SERVICE_SCOPES = {
  businessProfile: "https://www.googleapis.com/auth/business.manage",
  googleAds: "https://www.googleapis.com/auth/adwords",
  googleAnalytics: "https://www.googleapis.com/auth/analytics.readonly",
  searchConsole: "https://www.googleapis.com/auth/webmasters.readonly",
  calendar: "https://www.googleapis.com/auth/calendar.events",
};

/** True when the Google OAuth client credentials are configured. */
function oauthConfigured() {
  return Boolean(clientId && clientSecret);
}

/** True when the Google Ads developer token is configured. */
function adsConfigured() {
  return Boolean(adsDeveloperToken);
}

module.exports = {
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
};
