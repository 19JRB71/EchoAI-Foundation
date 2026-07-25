require("dotenv").config();

/**
 * Single source of truth for WHICH environment this server is running in.
 *
 * Money depends on this answer (background AI is production-only), so detection
 * is explicit and the basis is logged at boot rather than silently trusted:
 *
 *   1. APP_ENV, when set, always wins ("production" | "development" | anything).
 *   2. Any Railway marker variable → production (Railway is the only prod host).
 *   3. A Replit workspace marker → development (the workspace must never be
 *      mistaken for production even if NODE_ENV is set).
 *   4. NODE_ENV === "production" → production.
 *   5. Otherwise development.
 */
function detectEnvironment() {
  const explicit = (process.env.APP_ENV || "").trim().toLowerCase();
  if (explicit) return { name: explicit, basis: "APP_ENV" };
  if (
    process.env.RAILWAY_ENVIRONMENT_NAME ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_PROJECT_ID
  ) {
    return { name: "production", basis: "Railway environment variables" };
  }
  if (process.env.REPL_ID || process.env.REPLIT_DEV_DOMAIN) {
    return { name: "development", basis: "Replit workspace variables" };
  }
  if (process.env.NODE_ENV === "production") {
    return { name: "production", basis: "NODE_ENV" };
  }
  return { name: "development", basis: "default (no production markers found)" };
}

const detected = detectEnvironment();

const ENVIRONMENT = detected.name;
const ENVIRONMENT_BASIS = detected.basis;

function isProduction() {
  return ENVIRONMENT === "production";
}

// Best-effort deployment version for the usage ledger (Railway injects the git
// SHA of the deployed commit; absent in development).
const DEPLOY_VERSION =
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.RAILWAY_DEPLOYMENT_ID ||
  null;

module.exports = { ENVIRONMENT, ENVIRONMENT_BASIS, isProduction, DEPLOY_VERSION };
