require("dotenv").config();

/**
 * Centralized environment-variable validation.
 *
 * Critical vars are required for the server to function at all (auth, sessions,
 * encryption, database). If any are missing the process exits with a single,
 * clear message instead of crashing later with a cryptic error.
 *
 * Feature vars gate optional third-party integrations. When missing we only
 * warn — the related feature is disabled gracefully (the relevant route returns
 * a 503 / "not configured" response) rather than taking down the whole server.
 */
const CRITICAL = [
  ["DATABASE_URL", "PostgreSQL connection string"],
  ["JWT_SECRET", "signing secret for auth tokens"],
  ["SESSION_SECRET", "secret for OAuth CSRF session cookies"],
  ["ENCRYPTION_KEY", "AES-256 key for encrypting stored API tokens"],
];

const FEATURES = [
  {
    name: "AI brand discovery / content (Anthropic)",
    vars: ["ANTHROPIC_API_KEY"],
  },
  {
    name: "Voice & image generation (OpenAI)",
    vars: ["OPENAI_API_KEY"],
  },
  {
    name: "Billing (Stripe)",
    vars: ["STRIPE_SECRET_KEY"],
    optional: ["STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STARTER", "STRIPE_PRICE_GROWTH", "STRIPE_PRICE_PRO", "STRIPE_PRICE_ENTERPRISE"],
  },
  {
    name: "Transactional email (SMTP)",
    vars: ["SMTP_HOST"],
  },
  {
    name: "Facebook ad connection (OAuth)",
    vars: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
  },
  {
    name: "Web push notifications (VAPID)",
    vars: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"],
  },
];

/**
 * Validates the environment. Throws on missing critical vars. Returns a summary
 * of which optional features are enabled so the caller can log it at boot.
 */
function validateEnv() {
  const missingCritical = CRITICAL.filter(([key]) => !process.env[key]);
  if (missingCritical.length > 0) {
    const lines = missingCritical
      .map(([key, desc]) => `  - ${key} (${desc})`)
      .join("\n");
    throw new Error(
      `Missing required environment variable(s):\n${lines}\n` +
        "Set these before starting the server.",
    );
  }

  const features = FEATURES.map((f) => {
    const missing = f.vars.filter((v) => !process.env[v]);
    const enabled = missing.length === 0;
    if (!enabled) {
      console.warn(
        `Feature disabled — ${f.name}: missing ${missing.join(", ")}.`,
      );
    } else if (f.optional) {
      const missingOptional = f.optional.filter((v) => !process.env[v]);
      if (missingOptional.length > 0) {
        console.warn(
          `Feature partially configured — ${f.name}: missing optional ${missingOptional.join(", ")}.`,
        );
      }
    }
    return { name: f.name, enabled };
  });

  return { features };
}

module.exports = { validateEnv };
