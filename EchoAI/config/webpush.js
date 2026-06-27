/**
 * Web Push (VAPID) configuration.
 *
 * VAPID keys identify this server to the browsers' push services. They live in
 * env vars (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT) so they stay
 * stable across restarts — regenerating them would invalidate every existing
 * subscription.
 *
 * When the keys are absent, push is treated as *not configured*: the feature
 * gracefully disables itself instead of crashing the server.
 */

const webpush = require("web-push");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:alerts@echoai.app";

const isConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (isConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// SSRF guardrail: a PushSubscription.endpoint is supplied by the client and is
// later used as an outbound request target by webpush.sendNotification(). To
// stop an authenticated user from turning that into a server-side request to an
// arbitrary host, the endpoint must be https AND on a known browser push
// service. (Mirrors the allowlist approach used for saved image URLs.)
const ALLOWED_PUSH_HOST_SUFFIXES = [
  ".googleapis.com", // Chrome / FCM (fcm.googleapis.com)
  ".push.services.mozilla.com", // Firefox (autopush)
  ".push.apple.com", // Safari / iOS (web.push.apple.com)
  ".notify.windows.com", // Edge / WNS
  ".push.microsoft.com", // Edge (newer WNS)
];

function isAllowedPushEndpoint(endpoint) {
  if (typeof endpoint !== "string") return false;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_PUSH_HOST_SUFFIXES.some(
    (suffix) => host === suffix.slice(1) || host.endsWith(suffix),
  );
}

module.exports = {
  webpush,
  isConfigured,
  publicKey: VAPID_PUBLIC_KEY || null,
  isAllowedPushEndpoint,
};
