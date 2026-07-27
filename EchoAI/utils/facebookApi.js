const { GRAPH_VERSION } = require("../config/facebook");

const GRAPH_BASE = "https://graph.facebook.com";

// Facebook error codes that indicate rate limiting / throttling.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Makes an authenticated call to the Facebook Graph API.
 * Handles rate limiting (HTTP 429 and FB throttle codes) with exponential
 * backoff, and surfaces Facebook errors as structured Error objects.
 *
 * @param {string} path        Graph path, e.g. "act_123/campaigns"
 * @param {object} opts
 * @param {string} opts.method GET | POST | DELETE
 * @param {object} opts.params Query/body params (objects are JSON-stringified)
 * @param {string} opts.accessToken
 */
async function graphRequest(path, { method = "GET", params = {}, accessToken } = {}) {
  if (!accessToken) {
    throw new Error("A Facebook access token is required for Graph API calls");
  }

  const url = new URL(`${GRAPH_BASE}/${GRAPH_VERSION}/${String(path).replace(/^\//, "")}`);
  url.searchParams.set("access_token", accessToken);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }

  let attempt = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let response;

    try {
      response = await fetch(url, { method });
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        attempt += 1;
        await sleep(2 ** attempt * 500);
        continue;
      }
      throw new Error(`Facebook API network error: ${err.message}`);
    }

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (response.ok) {
      return data;
    }

    const fbError = data.error || {};
    const code = fbError.code;
    const isRateLimited = response.status === 429 || RATE_LIMIT_CODES.has(code);

    if (isRateLimited && attempt < MAX_RETRIES) {
      attempt += 1;
      // Honor Retry-After if present, otherwise exponential backoff.
      const retryAfter = parseInt(response.headers.get("retry-after"), 10);
      const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 2 ** attempt * 1000;
      await sleep(delay);
      continue;
    }

    const error = new Error(fbError.message || `Facebook API error (HTTP ${response.status})`);
    error.status = response.status;
    error.fbCode = code;
    error.fbType = fbError.type;
    error.fbSubcode = fbError.error_subcode;
    throw error;
  }
}

function graphGet(path, params, accessToken) {
  return graphRequest(path, { method: "GET", params, accessToken });
}

function graphPost(path, params, accessToken) {
  return graphRequest(path, { method: "POST", params, accessToken });
}

/**
 * Verifies an ad account is reachable with the given token by fetching basic
 * fields. Throws a structured error if the account is invalid/unreachable.
 */
function verifyAdAccount(adAccountId, accessToken) {
  const id = String(adAccountId).startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  return graphGet(id, { fields: "name,account_status,currency,timezone_name" }, accessToken);
}

/**
 * Creates the actual Facebook ad object (adset + creative → deliverable ad).
 * This is the ONLY function the launch paths may use to POST /ads, and it
 * always creates the ad PAUSED — a spending safeguard: nothing this platform
 * launches may ever go live without an explicit, separate unpause step.
 *
 * @param {string} accountRef  "act_<id>"
 * @param {object} p           { name, adSetId, creativeId }
 * @param {string} accessToken
 * @returns {Promise<{id: string}>}
 */
async function createPausedAd(accountRef, { name, adSetId, creativeId } = {}, accessToken) {
  if (!accountRef || !adSetId || !creativeId) {
    throw new Error("createPausedAd requires accountRef, adSetId and creativeId");
  }
  const params = {
    name: name || "Ad",
    adset_id: adSetId,
    creative: { creative_id: creativeId },
    status: "PAUSED",
  };
  // PAUSED-only assertion: no caller can override the status. If this ever
  // fails, the code above was tampered with — refuse to create the ad.
  if (params.status !== "PAUSED") {
    throw new Error("Spending safeguard violated: ads must be created PAUSED");
  }
  return graphPost(`${accountRef}/ads`, params, accessToken);
}

module.exports = {
  graphRequest,
  graphGet,
  graphPost,
  verifyAdAccount,
  createPausedAd,
};
