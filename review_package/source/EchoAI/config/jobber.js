require("dotenv").config();

/**
 * Jobber integration configuration.
 *
 * Zorecho connects to a customer's Jobber account (field-service CRM) via
 * OAuth 2.0 so Echo can pull in clients as leads, read the booked schedule,
 * and push converted leads back into Jobber as clients. Without the OAuth
 * app credentials the connect flow cannot run, so endpoints surface a clear
 * 503 / "not configured" response instead of a broken redirect.
 *
 * Credentials come from a (free) Jobber Developer Center app:
 *   https://developer.getjobber.com — create an app, set the redirect URI to
 *   <site>/api/jobber/oauth/callback, then set JOBBER_CLIENT_ID and
 *   JOBBER_CLIENT_SECRET.
 */

const clientId = process.env.JOBBER_CLIENT_ID;
const clientSecret = process.env.JOBBER_CLIENT_SECRET;

const AUTH_ENDPOINT = "https://api.getjobber.com/api/oauth/authorize";
const TOKEN_ENDPOINT = "https://api.getjobber.com/api/oauth/token";
const GRAPHQL_ENDPOINT = "https://api.getjobber.com/api/graphql";

// Pinned Jobber GraphQL API version (sent on every request). Bump deliberately
// after checking Jobber's changelog — never silently.
const API_VERSION = process.env.JOBBER_API_VERSION || "2025-01-20";

/** True when the Jobber OAuth app credentials are configured. */
function configured() {
  return Boolean(clientId && clientSecret);
}

module.exports = {
  clientId,
  clientSecret,
  AUTH_ENDPOINT,
  TOKEN_ENDPOINT,
  GRAPHQL_ENDPOINT,
  API_VERSION,
  configured,
};
