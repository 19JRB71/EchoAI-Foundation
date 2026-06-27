require("dotenv").config();

const express = require("express");
const session = require("express-session");
const ConnectPgSimple = require("connect-pg-simple");
const path = require("path");
const fs = require("fs");

const { pool } = require("./config/db");

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
const videoRoutes = require("./routes/videoRoutes");
const emailCampaignRoutes = require("./routes/emailCampaignRoutes");
const imageRoutes = require("./routes/imageRoutes");
const pushRoutes = require("./routes/pushRoutes");
const facebookOAuthRoutes = require("./routes/facebookOAuthRoutes");

const { startScheduler } = require("./utils/scheduler");
const { seedAdmin } = require("./utils/adminSeeder");

const app = express();
const PORT = process.env.PORT || 5000;

// The Stripe webhook needs the raw request body for signature verification,
// so skip JSON parsing for that specific route.
app.use((req, res, next) => {
  if (req.originalUrl === "/api/subscriptions/webhook") {
    return next();
  }
  return express.json()(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

// Trust the Replit reverse proxy so secure cookies / req.protocol reflect HTTPS.
app.set("trust proxy", 1);

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
app.use("/api/video", videoRoutes);
app.use("/api/email-campaigns", emailCampaignRoutes);
app.use("/api/images", imageRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/facebook", facebookOAuthRoutes);

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
app.use(express.static(clientDist));

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
  res.sendFile(clientIndex);
});

app.listen(PORT, () => {
  console.log(`EchoAI server is running on port ${PORT}`);
  startScheduler();
  seedAdmin().catch((err) => {
    console.error("Admin seeder failed:", err.message);
  });
});

module.exports = app;
