require("dotenv").config();

/**
 * external_proofs writer — the single place proof rows are created.
 *
 * Rules (Prompt 006 owner terms, binding):
 *   - A proof row is written ONLY from a real provider response the caller
 *     already received. Callers must never invoke recordExternalProof before
 *     the provider acknowledged the action (term 4).
 *   - Evidence is stored verbatim BUT with secrets redacted (term 10): any
 *     key that names a credential, and any value that looks like a Facebook
 *     access token, Resend key, or Bearer header, is replaced with
 *     "[REDACTED]" before persisting.
 *   - (run_key, provider, action) is unique; a retried runner hits ON
 *     CONFLICT DO NOTHING and gets the existing row back (term 12 — no
 *     duplicate proof rows, ever).
 *   - Rows are immutable at the database level (migration 130 trigger).
 */

const db = require("../config/db");

// Key names that must never be persisted with a value. Word-boundary match so
// "author" / "action" never trip the "auth"/"token" patterns.
const SECRET_KEY_RE =
  /(^|[^a-z])(access[-_]?token|refresh[-_]?token|page[-_]?token|token|secret|password|passwd|authorization|auth|cookie|set[-_]?cookie|api[-_]?key|apikey|credential|credentials)s?([^a-z]|$)/i;

// Value shapes that are credentials regardless of the key they sit under.
const SECRET_VALUE_PATTERNS = [
  /EAA[A-Za-z0-9]{20,}/g, // Facebook access tokens
  /\bre_[A-Za-z0-9_]{10,}/g, // Resend API keys
  /Bearer\s+[A-Za-z0-9._\-]{10,}/g, // Authorization headers
  /([?&](?:access_token|token|api_key|key)=)[^&\s"']+/g, // tokens in URLs
];

function redactString(value) {
  let out = value;
  for (const re of SECRET_VALUE_PATTERNS) {
    out = out.replace(re, (match, prefix) =>
      prefix ? `${prefix}[REDACTED]` : "[REDACTED]"
    );
  }
  return out;
}

/**
 * Deep-copies `value` with credential keys and credential-shaped strings
 * replaced by "[REDACTED]". Safe on any JSON-serializable input.
 */
function redactEvidence(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactEvidence);
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SECRET_KEY_RE.test(key) ? "[REDACTED]" : redactEvidence(val);
  }
  return out;
}

/**
 * Writes one proof row from a provider response the caller already holds.
 * Returns { row, created } — created=false means an identical
 * (runKey, provider, action) row already existed (idempotent retry).
 */
async function recordExternalProof({
  runKey,
  provider,
  action,
  externalId = null,
  brandId = null,
  userId = null,
  environment,
  evidence,
}) {
  if (!runKey || !provider || !action) {
    throw new Error("recordExternalProof: runKey, provider and action are required");
  }
  if (!environment) {
    throw new Error("recordExternalProof: environment is required");
  }
  if (evidence === null || evidence === undefined) {
    // No provider response, no proof row — never write preemptively.
    throw new Error("recordExternalProof: evidence (the provider response) is required");
  }

  const redacted = redactEvidence(evidence);
  const inserted = await db.query(
    `INSERT INTO external_proofs
       (run_key, provider, action, external_id, brand_id, user_id, environment, evidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (run_key, provider, action) DO NOTHING
     RETURNING *`,
    [
      runKey,
      provider,
      action,
      externalId,
      brandId,
      userId,
      environment,
      JSON.stringify(redacted),
    ]
  );
  if (inserted.rows.length > 0) return { row: inserted.rows[0], created: true };

  const existing = await db.query(
    `SELECT * FROM external_proofs
      WHERE run_key = $1 AND provider = $2 AND action = $3`,
    [runKey, provider, action]
  );
  return { row: existing.rows[0] || null, created: false };
}

/** All proof rows for one run, oldest first. */
async function getRunProofs(runKey) {
  const { rows } = await db.query(
    `SELECT * FROM external_proofs WHERE run_key = $1 ORDER BY created_at ASC`,
    [runKey]
  );
  return rows;
}

/** The environment tag every proof row in this process carries. */
function currentEnvironment() {
  return process.env.APP_ENV || process.env.NODE_ENV || "development";
}

module.exports = {
  recordExternalProof,
  getRunProofs,
  redactEvidence,
  currentEnvironment,
};
