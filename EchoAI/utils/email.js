require("dotenv").config();

const nodemailer = require("nodemailer");
const { recordCommsUsage } = require("./aiUsage");

const FROM = process.env.EMAIL_FROM || "Zorecho <no-reply@echoai.com>";
const MAX_RETRIES = Number(process.env.EMAIL_MAX_RETRIES || 3);

let transporter = null;

/**
 * Lazily creates a single Nodemailer transporter from SMTP environment
 * variables. Reused across the process so connections can be pooled.
 */
function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST) {
    console.warn(
      "Warning: SMTP_HOST is not set. Outbound email will fail until SMTP is configured."
    );
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });

  return transporter;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a single email, retrying transient failures with a simple linear
 * backoff. Throws the last error if every attempt fails.
 */
async function sendEmail({ to, subject, html, from }) {
  if (!to) throw new Error("Email recipient (to) is required");

  const message = { from: from || FROM, to, subject, html };

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const info = await getTransporter().sendMail(message);
      // Ledger write (fire-and-forget): one row per delivered email so the
      // economics dashboard sees comms cost, not just LLM cost.
      recordCommsUsage({
        provider: "email",
        unitType: "send",
        unitQuantity: 1,
        feature: "email_send",
        providerRef: info.messageId || null,
        retryCount: attempt - 1,
        success: true,
      });
      return { success: true, messageId: info.messageId, to };
    } catch (err) {
      lastError = err;
      console.error(
        `Email send attempt ${attempt}/${MAX_RETRIES} to ${to} failed:`,
        err.message
      );
      if (attempt < MAX_RETRIES) await delay(attempt * 1000);
    }
  }

  recordCommsUsage({
    provider: "email",
    unitType: "send",
    unitQuantity: 1,
    feature: "email_send",
    estimatedCostUsd: 0,
    retryCount: MAX_RETRIES - 1,
    success: false,
    errorCategory: "provider_error",
  });
  throw lastError;
}

/**
 * Sends many emails sequentially, isolating failures so one bad recipient
 * doesn't stop the rest. Returns a per-recipient result summary.
 */
async function sendBulkEmails(messages) {
  const results = [];
  for (const msg of messages) {
    try {
      const result = await sendEmail(msg);
      results.push({ to: msg.to, success: true, messageId: result.messageId });
    } catch (err) {
      results.push({ to: msg.to, success: false, error: err.message });
    }
  }
  return results;
}

module.exports = { sendEmail, sendBulkEmails, getTransporter };
