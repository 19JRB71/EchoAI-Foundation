require("dotenv").config();

const express = require("express");

const authRoutes = require("./routes/authRoutes");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
const campaignRoutes = require("./routes/campaignRoutes");

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

app.listen(PORT, () => {
  console.log(`EchoAI server is running on port ${PORT}`);
});

module.exports = app;
