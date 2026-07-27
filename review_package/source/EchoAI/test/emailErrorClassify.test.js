const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// classifyEmailError: mirrors the SMS classifier — decides whether a failed
// email send is permanent (hard bounce / invalid address — retrying unchanged
// just fails again, the owner must fix or remove the contact) or transient
// (SMTP outage / connection blip / greylisting — safe to retry). Drives the
// "fix first" vs "safe to retry" grouping in the failed-recipient panel.
// ---------------------------------------------------------------------------

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";

const { classifyEmailError } = require("../controllers/emailMarketingController");

test("SMTP 5xx reply codes classify as permanent (hard bounce)", () => {
  for (const code of [550, 551, 553, 554, 501]) {
    const { permanent } = classifyEmailError({
      responseCode: code,
      message: `${code} mailbox unavailable`,
    });
    assert.strictEqual(permanent, true, `code ${code} should be permanent`);
  }
});

test("SMTP 4xx reply codes classify as transient (safe to retry)", () => {
  for (const code of [421, 450, 451, 452]) {
    const { permanent } = classifyEmailError({
      responseCode: code,
      message: `${code} try again later`,
    });
    assert.strictEqual(permanent, false, `code ${code} should be transient`);
  }
});

test("numeric SMTP codes surfaced as strings still classify by code", () => {
  assert.strictEqual(
    classifyEmailError({ code: "550", message: "rejected" }).permanent,
    true
  );
  assert.strictEqual(
    classifyEmailError({ responseCode: "451", message: "try later" }).permanent,
    false
  );
});

test("connection-level errors (string codes) classify as transient", () => {
  for (const code of ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "EAUTH"]) {
    const { permanent } = classifyEmailError({
      code,
      message: "connection failure",
    });
    assert.strictEqual(permanent, false, `${code} should be transient`);
  }
});

test("invalid-address text without a reply code classifies as permanent", () => {
  for (const msg of [
    "No such user here",
    "Invalid recipient address",
    "Mailbox unavailable",
    "550 5.1.1 recipient rejected",
  ]) {
    const { permanent } = classifyEmailError({ message: msg });
    assert.strictEqual(permanent, true, `"${msg}" should be permanent`);
  }
});

test("generic / outage text without a reply code stays transient", () => {
  for (const msg of [
    "Connection timed out",
    "Service temporarily unavailable",
    "Send failed",
  ]) {
    const { permanent } = classifyEmailError({ message: msg });
    assert.strictEqual(permanent, false, `"${msg}" should be transient`);
  }
});

test("a null/undefined error yields a safe transient default", () => {
  const a = classifyEmailError(null);
  assert.strictEqual(a.permanent, false);
  assert.strictEqual(a.message, "Send failed");
  const b = classifyEmailError(undefined);
  assert.strictEqual(b.permanent, false);
});

test("the message is preserved and truncated to 300 chars", () => {
  const long = "x".repeat(500);
  const { message } = classifyEmailError({ message: long });
  assert.strictEqual(message.length, 300);
});
