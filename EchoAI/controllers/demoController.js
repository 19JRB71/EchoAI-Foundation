const db = require("../config/db");
const emailController = require("./emailController");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Public demo-request handler for the marketing landing page. Requires no
 * authentication. Records the prospect as a 'platform_inquiry' and fires an
 * admin notification email (best-effort) so James can call them back.
 */
async function submitDemoRequest(req, res) {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const businessType =
    typeof req.body.businessType === "string"
      ? req.body.businessType.trim()
      : "";
  const phone = typeof req.body.phone === "string" ? req.body.phone.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim() : "";

  if (!name || !businessType || !phone || !email) {
    return res
      .status(400)
      .json({ error: "Name, business type, phone, and email are required." });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  try {
    const result = await db.query(
      `INSERT INTO platform_inquiries (name, business_type, phone, email, inquiry_type)
       VALUES ($1, $2, $3, $4, 'platform_inquiry')
       RETURNING inquiry_id`,
      [name, businessType, phone, email]
    );

    // Notify the platform owner. Best-effort: never fail the prospect's
    // submission just because the notification email couldn't be sent.
    emailController
      .sendPlatformInquiryNotification({ name, businessType, phone, email })
      .catch((err) =>
        console.error("Platform inquiry notification email error:", err.message)
      );

    return res.status(201).json({
      success: true,
      inquiryId: result.rows[0].inquiry_id,
      message: "Thanks! We'll call you within 24 hours.",
    });
  } catch (err) {
    console.error("Demo request error:", err.message);
    return res
      .status(500)
      .json({ error: "Something went wrong. Please try again." });
  }
}

module.exports = { submitDemoRequest };
