require("dotenv").config();

const express = require("express");

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

app.get("/", (req, res) => {
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

app.listen(PORT, () => {
  console.log(`EchoAI server is running on port ${PORT}`);
  startScheduler();
  seedAdmin().catch((err) => {
    console.error("Admin seeder failed:", err.message);
  });
});

module.exports = app;
