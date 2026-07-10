require("dotenv").config();

// ---------------------------------------------------------------------------
// Hermes 4 (Nous Research) — Echo's decision / orchestration BRAIN.
//
// Architecture split (see replit.md): Hermes does the thinking, deciding,
// routing and orchestrating; Anthropic Claude does the writing and creating
// (ad copy, emails, briefings). This module is the single chokepoint for every
// Hermes call, mirroring config/anthropic.js:
//   - graceful when unconfigured (feature var, not boot-critical): calls fail
//     loudly with a clear message but the server never crashes at boot.
//   - per-request timeout + retry ONLY on transient upstream conditions.
//
// The Nous Portal inference API is OpenAI-compatible, so this talks to it with
// plain fetch (no extra SDK) — the same request shape as /v1/chat/completions.
// ---------------------------------------------------------------------------

const BASE_URL = (
  process.env.NOUS_PORTAL_BASE_URL || "https://inference-api.nousresearch.com/v1"
).replace(/\/+$/, "");
const MODEL = process.env.NOUS_HERMES_MODEL || "nousresearch/hermes-4-70b";
const API_KEY = process.env.NOUS_PORTAL_API_KEY || "";

// Orchestration decisions are small and latency-sensitive (they gate a voice
// reply), so the default ceiling is much tighter than Claude's content timeouts.
const DEFAULT_TIMEOUT_MS = Number(process.env.HERMES_TIMEOUT_MS) || 15000;
const DEFAULT_ATTEMPTS = Number(process.env.HERMES_MAX_ATTEMPTS) || 2;

function hermesConfigured() {
  return Boolean(API_KEY);
}

if (!hermesConfigured()) {
  console.warn(
    "Warning: NOUS_PORTAL_API_KEY is not set. Hermes (Echo's decision brain) is disabled; " +
      "Echo falls back to its existing behavior until it is configured.",
  );
}

// Transient upstream conditions worth retrying: request timeouts, dropped
// connections, rate limits (429), and 5xx. Deterministic failures (auth/quota
// 4xx) are NOT retried — they would only fail again.
function isTransientHermesError(err) {
  if (!err) return false;
  const name = String(err.name || "");
  if (/Abort|Timeout|Connection/i.test(name)) return true;
  const code = err.code;
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNREFUSED" || code === "EPIPE") {
    return true;
  }
  const status = err.status;
  if (status === 408 || status === 409 || status === 429) return true;
  if (typeof status === "number" && status >= 500) return true;
  if (typeof err.message === "string" && /overloaded|timeout|timed out|temporarily|fetch failed/i.test(err.message)) {
    return true;
  }
  return false;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Single-shot chat completion against the Nous Portal (OpenAI-compatible).
 * Returns the assistant reply TEXT. Throws on any failure (the caller maps it
 * to a graceful fallback — Echo never breaks because the brain is unavailable).
 *
 * @param {object} params
 * @param {string} [params.system]      - system prompt.
 * @param {Array}  params.messages      - [{role, content}] chat turns.
 * @param {number} [params.max_tokens]  - reply ceiling (default 512).
 * @param {number} [params.temperature] - sampling temp (default 0.2 — decisions).
 * @param {object} [opts]
 * @param {number} [opts.timeout]  - per-attempt timeout ms.
 * @param {number} [opts.attempts] - total attempts incl. first.
 * @param {string} [opts.label]    - label for retry logs.
 */
async function createCompletion(params, opts = {}) {
  if (!hermesConfigured()) {
    throw new Error("Hermes is not configured: set NOUS_PORTAL_API_KEY to enable it.");
  }
  const timeout = opts.timeout || DEFAULT_TIMEOUT_MS;
  const attempts = Math.max(1, opts.attempts || DEFAULT_ATTEMPTS);
  const label = opts.label || "Hermes request";

  const messages = [];
  if (params.system) messages.push({ role: "system", content: params.system });
  for (const m of params.messages || []) messages.push(m);

  const body = {
    model: params.model || MODEL,
    messages,
    max_tokens: params.max_tokens || 512,
    temperature: params.temperature != null ? params.temperature : 0.2,
  };
  if (params.response_format) body.response_format = params.response_format;

  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const resp = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!resp.ok) {
        let detail = "";
        try {
          detail = (await resp.text()).slice(0, 300);
        } catch {
          /* ignore */
        }
        const e = new Error(`Hermes HTTP ${resp.status}${detail ? `: ${detail}` : ""}`);
        e.status = resp.status;
        throw e;
      }
      const json = await resp.json();
      const text =
        json &&
        json.choices &&
        json.choices[0] &&
        json.choices[0].message &&
        typeof json.choices[0].message.content === "string"
          ? json.choices[0].message.content.trim()
          : "";
      if (!text) throw new Error("Hermes returned an empty response.");
      return text;
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !isTransientHermesError(err)) throw err;
      const backoffMs = Math.min(4000, 400 * 2 ** (attempt - 1));
      console.warn(
        `${label}: attempt ${attempt}/${attempts} failed (${err && err.message}); retrying in ${backoffMs}ms`,
      );
      await sleep(backoffMs);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

module.exports = {
  BASE_URL,
  MODEL,
  hermesConfigured,
  isTransientHermesError,
  createCompletion,
};
