const APP_URL = process.env.APP_URL || "https://app.echoai.com";
const BRAND = "Zorecho";
const ACCENT = "#4f46e5";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Converts plain text (e.g. an AI-written report) into simple HTML paragraphs.
 */
function paragraphsToHtml(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">${escapeHtml(
          p
        ).replace(/\n/g, "<br/>")}</p>`
    )
    .join("");
}

/**
 * Shared, on-brand HTML shell: Zorecho logo placeholder, heading, body, and a
 * single clear call-to-action button.
 */
function layout({ heading, bodyHtml, ctaLabel, ctaUrl }) {
  const cta =
    ctaLabel && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
           <tr>
             <td style="border-radius:8px;background:${ACCENT};">
               <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">${escapeHtml(
                 ctaLabel
               )}</a>
             </td>
           </tr>
         </table>`
      : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:24px 32px;border-bottom:1px solid #f0f0f0;">
                <!-- Zorecho logo placeholder -->
                <span style="font-size:22px;font-weight:800;color:${ACCENT};letter-spacing:-0.5px;">${BRAND}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">${escapeHtml(
                  heading
                )}</h1>
                ${bodyHtml}
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background:#fafafa;border-top:1px solid #f0f0f0;">
                <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">You're receiving this email because you have an ${BRAND} account.<br/>${BRAND} — AI-powered marketing on autopilot.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function welcomeEmail({ businessName }) {
  const name = businessName ? escapeHtml(businessName) : "there";
  const bodyHtml = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">Hi ${name}, welcome to ${BRAND}! We're thrilled to have you on board.</p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">${BRAND} runs your marketing on autopilot — discovering your brand, launching and optimizing campaigns, qualifying leads through AI conversations, and sending you a clear weekly report so you always know what's working.</p>
    <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">Here's what to expect next: your first campaigns will start gathering data, hot leads will land in your inbox the moment they're qualified, and your weekly performance report arrives every Monday morning.</p>`;
  return {
    subject: `Welcome to ${BRAND}! 🎉`,
    html: layout({
      heading: `Welcome to ${BRAND}`,
      bodyHtml,
      ctaLabel: "Go to your dashboard",
      ctaUrl: APP_URL,
    }),
  };
}

function weeklyReportEmail({ brandName, reportBody }) {
  const bodyHtml = `
    <p style="margin:0 0 16px;color:#6b7280;font-size:14px;">Here's how ${escapeHtml(
      brandName || "your brand"
    )} performed this week.</p>
    ${paragraphsToHtml(reportBody)}`;
  return {
    subject: `Your ${BRAND} weekly report${brandName ? ` — ${brandName}` : ""}`,
    html: layout({
      heading: "Your weekly performance report",
      bodyHtml,
      ctaLabel: "View full analytics",
      ctaUrl: APP_URL,
    }),
  };
}

function hotLeadAlertEmail({ leadName, leadEmail, leadPhone, brandName, summary }) {
  const rows = [
    ["Name", leadName || "Unknown"],
    ["Email", leadEmail || "—"],
    ["Phone", leadPhone || "—"],
  ]
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px;width:90px;">${label}</td><td style="padding:6px 0;color:#111827;font-size:14px;font-weight:600;">${escapeHtml(
          value
        )}</td></tr>`
    )
    .join("");

  const bodyHtml = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">A new <strong>hot lead</strong> just qualified through ${escapeHtml(
      brandName || "your"
    )}'s AI chatbot. Reach out while they're engaged!</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;width:100%;background:#f9fafb;border-radius:8px;padding:8px 16px;">${rows}</table>
    <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">What they said</p>
    <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;background:#f9fafb;border-left:3px solid ${ACCENT};padding:12px 16px;border-radius:4px;">${escapeHtml(
      summary || "No summary available."
    )}</p>`;
  return {
    subject: `🔥 Hot lead: ${leadName || "New prospect"}`,
    html: layout({
      heading: "You have a hot lead",
      bodyHtml,
      ctaLabel: "View lead in dashboard",
      ctaUrl: `${APP_URL}`,
    }),
  };
}

function paymentReminderEmail({ businessName, reason, daysUntilLock }) {
  const name = businessName ? escapeHtml(businessName) : "there";
  let bodyHtml;
  let subject;

  if (reason === "failed") {
    const days = daysUntilLock == null ? 7 : daysUntilLock;
    subject = `Action needed: your ${BRAND} payment failed`;
    bodyHtml = `
      <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">Hi ${name}, we tried to process your ${BRAND} subscription payment today but it didn't go through.</p>
      <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">Please update your payment method to avoid interruption — your account will be locked in <strong>${days} day${
        days === 1 ? "" : "s"
      }</strong> if payment isn't resolved.</p>`;
  } else {
    subject = `Your ${BRAND} subscription renews in 3 days`;
    bodyHtml = `
      <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">Hi ${name}, this is a friendly reminder that your ${BRAND} subscription renews in <strong>3 days</strong>.</p>
      <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">No action is needed if your payment details are up to date. If anything has changed, you can update your payment method anytime.</p>`;
  }

  return {
    subject,
    html: layout({
      heading: reason === "failed" ? "Payment failed" : "Upcoming renewal",
      bodyHtml,
      ctaLabel: "Update payment method",
      ctaUrl: `${APP_URL}`,
    }),
  };
}

function accountLockedEmail({ businessName }) {
  const name = businessName ? escapeHtml(businessName) : "there";
  const bodyHtml = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">Hi ${name}, your ${BRAND} account has been locked because we couldn't process your subscription payment.</p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">Your campaigns are paused, but nothing is lost. To restore full access, just update your payment method:</p>
    <ol style="margin:0 0 24px;padding-left:20px;color:#374151;font-size:15px;line-height:1.8;">
      <li>Open your ${BRAND} dashboard.</li>
      <li>Go to Settings → Billing.</li>
      <li>Add or update your card. Access is restored instantly once payment succeeds.</li>
    </ol>`;
  return {
    subject: `Your ${BRAND} account has been locked`,
    html: layout({
      heading: "Your account is locked",
      bodyHtml,
      ctaLabel: "Restore access",
      ctaUrl: `${APP_URL}`,
    }),
  };
}

/**
 * Admin notification sent to James when a prospect submits the public
 * landing-page demo request form.
 */
function platformInquiryEmail({ name, businessType, phone, email }) {
  const bodyHtml = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">A new prospect just requested a demo from the ${BRAND} landing page. Call them within 24 hours.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;width:140px;">Name</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;">${escapeHtml(
        name
      )}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">Business type</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;">${escapeHtml(
        businessType
      )}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">Phone</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;">${escapeHtml(
        phone
      )}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">Email</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;">${escapeHtml(
        email
      )}</td></tr>
    </table>`;
  return {
    subject: `New demo request: ${name} (${businessType})`,
    html: layout({
      heading: "New demo request",
      bodyHtml,
      ctaLabel: "Email this prospect",
      ctaUrl: `mailto:${email}`,
    }),
  };
}

const ROLE_BLURB = {
  viewer:
    "As a Viewer you'll have read-only access to leads, reports, analytics, and the CRM.",
  sales_rep:
    "As a Sales Rep you'll work one assigned lead at a time from your queue, call them right through the platform, and log the outcome. You won't see the full lead list or any contact numbers.",
  manager:
    "As a Manager you'll have read-only access to everything — leads, reports, analytics, campaigns, and the CRM. You can review the whole workspace, but only admins can make changes.",
  admin:
    "As an Admin you'll be able to run everything, plus manage team members and billing.",
};

/**
 * Invitation email for a NEW person (no Zorecho account yet). Contains the
 * secure one-time accept link that expires in 48 hours.
 */
function teamInvitationEmail({ businessName, role, acceptUrl, expiresHours }) {
  const workspace = businessName ? escapeHtml(businessName) : `the ${BRAND} workspace`;
  const blurb = ROLE_BLURB[role] || ROLE_BLURB.viewer;
  const hours = expiresHours || 48;
  const bodyHtml = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">You've been invited to join <strong>${workspace}</strong> on ${BRAND} as a <strong>${escapeHtml(
      role || "team member"
    )}</strong>.</p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">${escapeHtml(
      blurb
    )}</p>
    <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">Click the button below to accept your invitation and set up your account. This secure link expires in <strong>${hours} hours</strong>.</p>`;
  return {
    subject: `You've been invited to join ${businessName || BRAND}`,
    html: layout({
      heading: "You're invited to join the team",
      bodyHtml,
      ctaLabel: "Accept invitation",
      ctaUrl: acceptUrl || APP_URL,
    }),
  };
}

/**
 * Notification for an EXISTING Zorecho user who was added to a workspace
 * immediately (no acceptance step needed).
 */
function teamMemberAddedEmail({ businessName, role, loginUrl }) {
  const workspace = businessName ? escapeHtml(businessName) : `a ${BRAND} workspace`;
  const blurb = ROLE_BLURB[role] || ROLE_BLURB.viewer;
  const bodyHtml = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">You've been added to <strong>${workspace}</strong> on ${BRAND} as a <strong>${escapeHtml(
      role || "team member"
    )}</strong>.</p>
    <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">${escapeHtml(
      blurb
    )} Just log in to start working inside the workspace.</p>`;
  return {
    subject: `You've been added to ${businessName || BRAND}`,
    html: layout({
      heading: "You've joined a team",
      bodyHtml,
      ctaLabel: "Log in to Zorecho",
      ctaUrl: loginUrl || APP_URL,
    }),
  };
}

module.exports = {
  welcomeEmail,
  weeklyReportEmail,
  hotLeadAlertEmail,
  paymentReminderEmail,
  accountLockedEmail,
  platformInquiryEmail,
  teamInvitationEmail,
  teamMemberAddedEmail,
};
