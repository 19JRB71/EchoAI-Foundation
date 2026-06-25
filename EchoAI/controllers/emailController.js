const { sendEmail } = require("../utils/email");
const templates = require("../utils/emailTemplates");

/**
 * Sends the welcome email after a customer completes onboarding.
 * Accepts { email, business_name }.
 */
async function sendWelcomeEmail(user) {
  const { subject, html } = templates.welcomeEmail({
    businessName: user.business_name,
  });
  return sendEmail({ to: user.email, subject, html });
}

/**
 * Delivers the AI-generated weekly report to the customer's inbox.
 * Accepts { email, brandName, reportBody, subject? }.
 */
async function sendWeeklyReportEmail({ email, brandName, reportBody, subject }) {
  const tpl = templates.weeklyReportEmail({ brandName, reportBody });
  return sendEmail({
    to: email,
    subject: subject || tpl.subject,
    html: tpl.html,
  });
}

/**
 * Alerts the business owner the moment a lead is scored hot.
 * Accepts { ownerEmail, brandName, lead: { lead_name, email, phone }, summary }.
 */
async function sendHotLeadAlert({ ownerEmail, brandName, lead, summary }) {
  const { subject, html } = templates.hotLeadAlertEmail({
    leadName: lead && lead.lead_name,
    leadEmail: lead && lead.email,
    leadPhone: lead && lead.phone,
    brandName,
    summary,
  });
  return sendEmail({ to: ownerEmail, subject, html });
}

/**
 * Warns the customer about an upcoming renewal (reason "upcoming") or a failed
 * payment (reason "failed", with daysUntilLock until the account is locked).
 * Accepts { email, businessName, reason, daysUntilLock }.
 */
async function sendPaymentReminderEmail({ email, businessName, reason, daysUntilLock }) {
  const { subject, html } = templates.paymentReminderEmail({
    businessName,
    reason,
    daysUntilLock,
  });
  return sendEmail({ to: email, subject, html });
}

/**
 * Tells the customer their account is locked and how to restore access.
 * Accepts { email, businessName }.
 */
async function sendAccountLockedEmail({ email, businessName }) {
  const { subject, html } = templates.accountLockedEmail({ businessName });
  return sendEmail({ to: email, subject, html });
}

/**
 * POST /api/email/test  (auth + admin)
 * Manually triggers any of the five email types with sample data so the platform
 * owner can verify deliverability. Body: { type, to? }. Falls back to the
 * requesting admin's own email when "to" is omitted.
 */
async function triggerTestEmail(req, res) {
  const { type, to } = req.body;
  const recipient = to || (req.user && req.user.email);

  if (!type) {
    return res.status(400).json({ error: "type is required" });
  }
  if (!recipient) {
    return res.status(400).json({ error: "A recipient (to) is required" });
  }

  try {
    let result;
    switch (type) {
      case "welcome":
        result = await sendWelcomeEmail({ email: recipient, business_name: "Acme Co" });
        break;
      case "weekly_report":
        result = await sendWeeklyReportEmail({
          email: recipient,
          brandName: "Acme Co",
          reportBody:
            "Great week! Your campaigns brought in 42 new leads at a lower cost per lead than last week.\n\nConversions are trending up. Next step: consider increasing budget on your best-performing campaign.",
        });
        break;
      case "hot_lead":
        result = await sendHotLeadAlert({
          ownerEmail: recipient,
          brandName: "Acme Co",
          lead: {
            lead_name: "Jane Prospect",
            email: "jane@example.com",
            phone: "+1 555-0100",
          },
          summary:
            "Jane asked about pricing and implementation timelines and wants to get started within the next two weeks.",
        });
        break;
      case "payment_reminder":
        result = await sendPaymentReminderEmail({
          email: recipient,
          businessName: "Acme Co",
          reason: "failed",
          daysUntilLock: 7,
        });
        break;
      case "account_locked":
        result = await sendAccountLockedEmail({ email: recipient, businessName: "Acme Co" });
        break;
      default:
        return res.status(400).json({ error: `Unknown email type: ${type}` });
    }

    return res.json({ message: `Test "${type}" email sent`, result });
  } catch (err) {
    console.error("Test email error:", err.message);
    return res.status(500).json({ error: "Failed to send test email" });
  }
}

/**
 * Notifies the platform owner (James) when a prospect submits the public
 * landing-page demo request form. Sent to ADMIN_EMAIL.
 * Accepts { name, businessType, phone, email }.
 */
async function sendPlatformInquiryNotification({ name, businessType, phone, email }) {
  const to = process.env.ADMIN_EMAIL;
  if (!to) {
    throw new Error("ADMIN_EMAIL is not configured");
  }
  const { subject, html } = templates.platformInquiryEmail({
    name,
    businessType,
    phone,
    email,
  });
  return sendEmail({ to, subject, html });
}

module.exports = {
  sendWelcomeEmail,
  sendWeeklyReportEmail,
  sendHotLeadAlert,
  sendPaymentReminderEmail,
  sendAccountLockedEmail,
  sendPlatformInquiryNotification,
  triggerTestEmail,
};
