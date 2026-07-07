require("dotenv").config();

const express = require("express");
const session = require("express-session");
const ConnectPgSimple = require("connect-pg-simple");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

const { validateEnv } = require("./config/env");
const { pool } = require("./config/db");

// Validate the environment before anything else. Missing critical vars (DB,
// JWT, session, encryption) abort the boot with a single clear message instead
// of failing later with a cryptic stack trace.
const { features } = validateEnv();

const authRoutes = require("./routes/authRoutes");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
const campaignRoutes = require("./routes/campaignRoutes");
const brandRoutes = require("./routes/brandRoutes");
const leadRoutes = require("./routes/leadRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const optimizationRoutes = require("./routes/optimizationRoutes");
const adminRoutes = require("./routes/adminRoutes");
const voiceRoutes = require("./routes/voiceRoutes");
const emailRoutes = require("./routes/emailRoutes");
const demoRoutes = require("./routes/demoRoutes");
const publicRoutes = require("./routes/publicRoutes");
const socialRoutes = require("./routes/socialRoutes");
const contentCalendarRoutes = require("./routes/contentCalendarRoutes");
const adStudioRoutes = require("./routes/adStudioRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const videoRoutes = require("./routes/videoRoutes");
const emailCampaignRoutes = require("./routes/emailCampaignRoutes");
const emailMarketingRoutes = require("./routes/emailMarketingRoutes");
const imageRoutes = require("./routes/imageRoutes");
const pushRoutes = require("./routes/pushRoutes");
const facebookOAuthRoutes = require("./routes/facebookOAuthRoutes");
const googleRoutes = require("./routes/googleRoutes");
const seoRoutes = require("./routes/seoRoutes");
const roiRoutes = require("./routes/roiRoutes");
const customerIntelligenceRoutes = require("./routes/customerIntelligenceRoutes");
const portfolioRoutes = require("./routes/portfolioRoutes");
const capitalFundingRoutes = require("./routes/capitalFundingRoutes");
const reputationRoutes = require("./routes/reputationRoutes");
const phoneRoutes = require("./routes/phoneRoutes");
const websiteChatbotRoutes = require("./routes/websiteChatbotRoutes");
const salesScriptRoutes = require("./routes/salesScriptRoutes");
const webhookRoutes = require("./routes/webhookRoutes");
const agencyRoutes = require("./routes/agencyRoutes");
const affiliateRoutes = require("./routes/affiliateRoutes");
const teamRoutes = require("./routes/teamRoutes");
const crmRoutes = require("./routes/crmRoutes");
const appointmentRoutes = require("./routes/appointmentRoutes");
const followUpRoutes = require("./routes/followUpRoutes");
const smsRoutes = require("./routes/smsRoutes");
const tourRoutes = require("./routes/tourRoutes");
const setupAgentRoutes = require("./routes/setupAgentRoutes");
const echoRoutes = require("./routes/echoRoutes");
const echoVoiceRoutes = require("./routes/echoVoiceRoutes");
const agentRoutes = require("./routes/agentRoutes");
const healthRoutes = require("./routes/healthRoutes");
const salesAgentRoutes = require("./routes/salesAgentRoutes");
const goalRoutes = require("./routes/goalRoutes");
const musicRoutes = require("./routes/musicRoutes");
const sageRoutes = require("./routes/sageRoutes");

// Mobile API (v2) — lean payloads, cursor pagination, standard envelopes.
const mobileAuthRoutes = require("./routes/mobileAuthRoutes");
const mobilePushRoutes = require("./routes/mobilePushRoutes");
const mobileRoutes = require("./routes/mobileRoutes");

const { startScheduler } = require("./utils/scheduler");
const { seedAdmin } = require("./utils/adminSeeder");

const app = express();
const PORT = process.env.PORT || 5000;
const IS_PROD = process.env.NODE_ENV === "production";

// Trust the Replit reverse proxy so secure cookies / req.protocol reflect HTTPS
// and rate-limit / logging see the real client IP via X-Forwarded-For.
app.set("trust proxy", 1);

// Request logging: see every request hitting the server. Concise in production,
// colored/dev format locally.
app.use(morgan(IS_PROD ? "combined" : "dev"));

// CORS. In production, restrict API access to our own domain(s): the comma-
// separated REPLIT_DOMAINS plus any explicit ALLOWED_ORIGINS. In development we
// allow all origins so the preview/canvas iframe and local tooling work.
const allowedOrigins = [
  ...(process.env.REPLIT_DOMAINS || "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => `https://${d}`),
  ...(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
];
// The embeddable website chatbot widget is loaded on arbitrary third-party
// customer sites, so its PUBLIC endpoints must accept any origin (and never
// reflect credentials). Everything else follows the standard allowlist.
// Method-aware so the OWNER-only `PUT /api/chatbot/config/:brandId` is NOT
// opened to any origin — only the read config (GET), chat (POST), and capture
// (POST) endpoints the widget actually uses, plus their POST preflight.
function isPublicWidgetRequest(req) {
  const p = req.path;
  const m = req.method;
  if (m === "GET" && p.startsWith("/api/chatbot/config/")) return true;
  if (m === "POST" && (p === "/api/chatbot/chat" || p === "/api/chatbot/capture")) {
    return true;
  }
  // CORS preflight for the JSON POSTs (config GET is a simple request, and the
  // owner-only PUT is intentionally excluded so it stays allowlist-gated).
  if (m === "OPTIONS" && (p === "/api/chatbot/chat" || p === "/api/chatbot/capture")) {
    return true;
  }
  return false;
}
app.use(
  cors((req, callback) => {
    if (isPublicWidgetRequest(req)) {
      return callback(null, { origin: true, credentials: false });
    }
    const origin = req.header("Origin");
    // Same-origin / non-browser requests (no Origin header) are always allowed.
    if (!origin) return callback(null, { origin: true, credentials: true });
    // Same-origin browser requests: the Origin matches the host we are being
    // served on. Browsers send an Origin header on crossorigin module-script and
    // fetch requests even for the site's own assets, so this MUST pass regardless
    // of env config — otherwise the SPA's own JS is blocked and the page renders
    // blank. Covers any deploy domain (Replit, Railway, custom) with no setup.
    const host = req.headers.host;
    if (host && (origin === `https://${host}` || origin === `http://${host}`)) {
      return callback(null, { origin: true, credentials: true });
    }
    if (!IS_PROD) return callback(null, { origin: true, credentials: true });
    if (allowedOrigins.includes(origin)) {
      return callback(null, { origin: true, credentials: true });
    }
    return callback(new Error("Not allowed by CORS"), { origin: false });
  }),
);

// Rate limiting on all API routes to prevent abuse. Generous default ceiling so
// legitimate dashboard usage is never throttled; the standard headers let
// clients back off. The Stripe webhook is exempt (Stripe controls its own rate
// and must never be dropped).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 1000),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  skip: (req) => req.path === "/subscriptions/webhook",
});
app.use("/api", apiLimiter);

// The Stripe webhook needs the raw request body for signature verification, so
// skip JSON parsing for that specific route. Match on req.path + method (not
// originalUrl) so query params / trailing slashes can't accidentally let the
// JSON parser consume the body and break signature verification.
// Support-ticket endpoints accept a base64 screenshot data URL, which easily
// exceeds the default 100 KB JSON limit. Let their own routers parse the body
// with a larger, scoped limit instead of raising it globally (which would widen
// the DoS surface for every other endpoint).
const LARGE_BODY_SUPPORT_PATHS = new Set([
  "/api/health-monitor/support",
  "/api/public/support",
]);
app.use((req, res, next) => {
  if (req.method === "POST" && req.path === "/api/subscriptions/webhook") {
    return next();
  }
  if (req.method === "POST" && LARGE_BODY_SUPPORT_PATHS.has(req.path)) {
    return next();
  }
  return express.json()(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

// Session store (PostgreSQL via connect-pg-simple) — used to hold the Facebook
// OAuth `state` (CSRF) and initiating user across the redirect round-trip.
// sameSite "lax" is required so the session cookie survives Facebook's top-level
// GET redirect back to the callback.
const PgSession = ConnectPgSimple(session);
if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is not set; refusing to start with an insecure session secret");
}
app.use(
  session({
    store: new PgSession({ pool, tableName: "session" }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 1000,
    },
  }),
);

app.get("/api/health", (req, res) => {
  res.json({
    name: "EchoAI",
    status: "ok",
    message: "EchoAI API is running",
  });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/brands", brandRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/optimize", optimizationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/voice", voiceRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/demo", demoRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/social", socialRoutes);
app.use("/api/content-calendar", contentCalendarRoutes);
app.use("/api/ad-studio", adStudioRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/video", videoRoutes);
app.use("/api/email-campaigns", emailCampaignRoutes);
app.use("/api/email-marketing", emailMarketingRoutes);
app.use("/api/images", imageRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/facebook", facebookOAuthRoutes);
app.use("/api/google", googleRoutes);
app.use("/api/seo", seoRoutes);
app.use("/api/roi", roiRoutes);
app.use("/api/intelligence", customerIntelligenceRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/capital", capitalFundingRoutes);
app.use("/api/reputation", reputationRoutes);
app.use("/api/phone", phoneRoutes);
app.use("/api/chatbot", websiteChatbotRoutes);
app.use("/api/sales-scripts", salesScriptRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/agencies", agencyRoutes);
app.use("/api/affiliates", affiliateRoutes);
app.use("/api/team", teamRoutes);
app.use("/api/crm", crmRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/follow-ups", followUpRoutes);
app.use("/api/sms", smsRoutes);
app.use("/api/tour", tourRoutes);
app.use("/api/setup-agent", setupAgentRoutes);
app.use("/api/echo", echoRoutes);
app.use("/api/echo-voice", echoVoiceRoutes);
app.use("/api/agents", agentRoutes);
app.use("/api/health-monitor", healthRoutes);
app.use("/api/sales-agent", salesAgentRoutes);
app.use("/api/goals", goalRoutes);
app.use("/api/music", musicRoutes);
app.use("/api/sage", sageRoutes);

// Mobile API (v2). Mounted under /api so the rate limiter covers it, and before
// the SPA fallback. /api/v2/auth + /api/v2/push are named per the mobile spec;
// /api/v2 also serves the lean dashboard + cursor-paginated leads endpoints.
app.use("/api/v2/auth", mobileAuthRoutes);
app.use("/api/v2/push", mobilePushRoutes);
app.use("/api/v2", mobileRoutes);

// Serve saved AI-generated images persisted to disk (DALL-E URLs expire, so we
// download and serve them locally). Mounted before the SPA fallback.
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Serve the built React client (single-origin: API + SPA on one port).
const clientDist = path.join(__dirname, "client", "dist");
const clientIndex = path.join(clientDist, "index.html");
if (!fs.existsSync(clientIndex)) {
  console.warn(
    `Warning: client build not found at ${clientDist}. ` +
      "Run `cd client && npm run build` so the SPA can be served.",
  );
}
// Hashed assets (index-<hash>.js/.css) are immutable — cache them hard. But
// index.html must NEVER be cached: it's the only file that points at the current
// hashed bundle, so a stale cached index.html pins the browser to an old build
// (e.g. a dashboard without newly-shipped features). Always revalidate it.
app.use(
  express.static(clientDist, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-cache");
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }),
);

// SPA fallback: non-API GET requests for non-file paths return index.html so
// React Router can handle client-side routes (/, /dashboard, /voice/:brandId).
// Asset-like paths (containing a ".") are skipped so missing files 404 instead
// of silently returning HTML.
app.use((req, res, next) => {
  if (
    req.method !== "GET" ||
    req.path.startsWith("/api") ||
    req.path.includes(".")
  ) {
    return next();
  }
  // Same rule as above: the SPA entry document must always be revalidated.
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(clientIndex);
});

// Unknown API routes return a JSON 404 (never Express's default HTML page).
app.use("/api", (req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
});

// Global error handler — guarantees every failure (including malformed JSON
// bodies and errors thrown in handlers) returns a JSON response instead of an
// HTML stack-trace page or a crash. Must be the LAST middleware and keep all
// four args so Express recognizes it as an error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Body-parser raises this on malformed JSON request bodies. Match the
  // parser-specific shape (type + status + a `body` property) rather than any
  // SyntaxError, so unrelated server-side SyntaxErrors aren't misreported as 400.
  if (err.type === "entity.parse.failed" || (err.status === 400 && "body" in err)) {
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  console.error("Unhandled error:", err.stack || err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: IS_PROD ? "Internal server error" : err.message || "Internal server error",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`EchoAI server is running on port ${PORT} (${IS_PROD ? "production" : "development"})`);
  const enabled = features.filter((f) => f.enabled).map((f) => f.name);
  const disabled = features.filter((f) => !f.enabled).map((f) => f.name);
  console.log(`Features enabled: ${enabled.length ? enabled.join(", ") : "(none)"}`);
  if (disabled.length) console.log(`Features disabled: ${disabled.join(", ")}`);
  startScheduler();
  seedAdmin().catch((err) => {
    console.error("Admin seeder failed:", err.message);
  });
});

module.exports = app;
