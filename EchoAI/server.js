require("dotenv").config();

const express = require("express");

const authRoutes = require("./routes/authRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
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

app.listen(PORT, () => {
  console.log(`EchoAI server is running on port ${PORT}`);
});

module.exports = app;
