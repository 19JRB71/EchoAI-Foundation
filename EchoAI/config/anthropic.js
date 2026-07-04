require("dotenv").config();

const Anthropic = require("@anthropic-ai/sdk");

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "Warning: ANTHROPIC_API_KEY is not set. Brand discovery (AI) calls will fail until it is configured."
  );
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

// Per-request timeouts (ms). AI-heavy generations (long, multi-part JSON like a
// full drip sequence or a month of calendar posts) legitimately take much longer
// than a short single-shot completion, so they get a longer ceiling. Both are
// env-overridable for tuning without a code change.
const DEFAULT_AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 120000; // 2 min
const HEAVY_AI_TIMEOUT_MS = Number(process.env.AI_HEAVY_TIMEOUT_MS) || 300000; // 5 min

// How many total attempts (initial + retries) an AI-heavy generation gets before
// the error surfaces to the user.
const DEFAULT_AI_ATTEMPTS = Number(process.env.AI_MAX_ATTEMPTS) || 3;

// Transient upstream conditions worth retrying: request timeouts, dropped
// connections, rate limits (429), and 5xx / "overloaded" errors. Deterministic
// failures (auth/quota 4xx) are NOT retried — they'd only fail again.
function isTransientAiError(err) {
  if (!err) return false;
  const name = String(err.name || "");
  if (/Timeout|Connection/i.test(name)) return true;
  const code = err.code;
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNREFUSED" || code === "EPIPE") {
    return true;
  }
  const status = err.status;
  if (status === 408 || status === 409 || status === 429) return true;
  if (typeof status === "number" && status >= 500) return true;
  if (typeof err.message === "string" && /overloaded|timeout|timed out|temporarily/i.test(err.message)) {
    return true;
  }
  return false;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create a message with a per-request timeout and automatic retry on transient
 * upstream failures. Retries use exponential backoff and stop early on
 * non-transient errors. The SDK's own retry is disabled (`maxRetries: 0`) so this
 * wrapper is the single source of retry behavior.
 *
 * @param {object} params - anthropic.messages.create params (model, system, ...).
 * @param {object} [opts]
 * @param {number} [opts.timeout=DEFAULT_AI_TIMEOUT_MS] - per-attempt timeout (ms).
 * @param {number} [opts.attempts=DEFAULT_AI_ATTEMPTS] - total attempts (incl. first).
 * @param {string} [opts.label="AI request"] - label for retry logs.
 */
async function createMessage(params, opts = {}) {
  const timeout = opts.timeout || DEFAULT_AI_TIMEOUT_MS;
  const attempts = Math.max(1, opts.attempts || DEFAULT_AI_ATTEMPTS);
  const label = opts.label || "AI request";

  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await anthropic.messages.create(params, { timeout, maxRetries: 0 });
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !isTransientAiError(err)) throw err;
      const backoffMs = Math.min(8000, 500 * 2 ** (attempt - 1));
      console.warn(
        `${label}: attempt ${attempt}/${attempts} failed (${err && err.message}); retrying in ${backoffMs}ms`
      );
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

module.exports = {
  anthropic,
  MODEL,
  DEFAULT_AI_TIMEOUT_MS,
  HEAVY_AI_TIMEOUT_MS,
  DEFAULT_AI_ATTEMPTS,
  isTransientAiError,
  createMessage,
};
