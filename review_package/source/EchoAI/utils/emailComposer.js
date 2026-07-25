/**
 * Echo Email Assistant — AI drafting + SMTP sending.
 *
 * Drafts are written in the owner's voice (brand personality + owner profile
 * context) and ALWAYS stored as pending drafts requiring explicit approval —
 * nothing is ever sent without the owner saying so. Sending uses the
 * account's own SMTP with the decrypted app password.
 */

const nodemailer = require("nodemailer");
const db = require("../config/db");
const { createMessage, MODEL } = require("../config/anthropic");
const { decrypt } = require("./encryption");
const emailAccounts = require("./emailAccounts");

function extractText(resp) {
  if (!resp || !Array.isArray(resp.content)) return "";
  return resp.content
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

async function ownerVoiceContext(userId) {
  const { rows } = await db.query(
    `SELECT b.brand_name, b.brand_personality, b.tagline, u.first_name, u.last_name
       FROM users u
       LEFT JOIN brands b ON b.user_id = u.user_id AND COALESCE(b.is_demo, FALSE) = FALSE
      WHERE u.user_id = $1
      ORDER BY b.created_at ASC LIMIT 1`,
    [userId],
  );
  const r = rows[0] || {};
  const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
  const personality =
    r.brand_personality && typeof r.brand_personality === "object"
      ? JSON.stringify(r.brand_personality)
      : r.brand_personality || null;
  return { name: name || null, brandName: r.brand_name || null, personality };
}

const DRAFT_SYSTEM_BASE = `You write an email on behalf of a business owner, in their voice. Rules: professional but warm; concise; no invented facts, prices, dates, or commitments the owner didn't state; never mention being an AI. Reply with EXACTLY one JSON object, no other text: {"subject": "...", "body": "..."}. The body is plain text with normal paragraphs and ends with a simple sign-off using the owner's name.`;

async function draftEmail(userId, { instruction, replyTo }) {
  const ctx = await ownerVoiceContext(userId);
  const system = [
    DRAFT_SYSTEM_BASE,
    ctx.name ? `The owner's name is ${ctx.name}.` : null,
    ctx.brandName ? `Their business is ${ctx.brandName}.` : null,
    ctx.personality ? `Brand personality/tone notes: ${ctx.personality}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const parts = [];
  if (replyTo) {
    parts.push(
      `This is a REPLY to an email from ${replyTo.from_name || replyTo.from_address || "someone"} with subject "${
        replyTo.subject || "(no subject)"
      }". Summary/excerpt of their email: ${replyTo.ai_summary || replyTo.snippet || "(none)"}`,
    );
  }
  parts.push(`The owner's instruction for this email: ${instruction}`);

  const resp = await createMessage(
    { model: MODEL, max_tokens: 900, system, messages: [{ role: "user", content: parts.join("\n\n") }] },
    { label: "Email draft" },
  );
  const text = extractText(resp);
  const parsed = JSON.parse((text.match(/\{[\s\S]*\}/) || [null])[0]);
  if (!parsed || !parsed.subject || !parsed.body || !String(parsed.body).trim()) {
    throw new Error("Email draft came back empty");
  }
  return { subject: String(parsed.subject).trim(), body: String(parsed.body).trim() };
}

async function createDraft(userId, { accountId, toAddress, toName, subject, body, replyToMessageId }) {
  const { rows } = await db.query(
    `INSERT INTO email_drafts (user_id, account_id, reply_to_message_id, to_address, to_name, subject, body)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING draft_id, to_address, to_name, subject, body, status, created_at`,
    [userId, accountId, replyToMessageId || null, toAddress, toName || null, subject, body],
  );
  return rows[0];
}

async function sendDraft(userId, draftId) {
  // Atomic claim: only a pending draft can be sent, exactly once.
  const { rows: claimed } = await db.query(
    `UPDATE email_drafts SET status = 'sending'
      WHERE draft_id = $1 AND user_id = $2 AND status = 'pending'
      RETURNING *`,
    [draftId, userId],
  );
  const draft = claimed[0];
  if (!draft) {
    const e = new Error("That draft was already sent or discarded.");
    e.statusCode = 409;
    throw e;
  }
  const account = await emailAccounts.getOwnedAccount(userId, draft.account_id);
  if (!account) {
    await db.query(
      `UPDATE email_drafts SET status = 'failed', send_error = 'Email account was disconnected' WHERE draft_id = $1`,
      [draftId],
    );
    const e = new Error("The email account for this draft is no longer connected.");
    e.statusCode = 400;
    throw e;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_port === 465,
      auth: { user: account.email_address, pass: decrypt(account.password_encrypted) },
      // Fail fast on a dead SMTP host instead of hanging the request.
      connectionTimeout: 15 * 1000,
      greetingTimeout: 15 * 1000,
      socketTimeout: 30 * 1000,
    });
    await transporter.sendMail({
      from: account.display_name
        ? `"${account.display_name}" <${account.email_address}>`
        : account.email_address,
      to: draft.to_name ? `"${draft.to_name}" <${draft.to_address}>` : draft.to_address,
      subject: draft.subject,
      text: draft.body,
    });
  } catch (err) {
    await db.query(
      `UPDATE email_drafts SET status = 'failed', send_error = $2 WHERE draft_id = $1`,
      [draftId, String(err.message || "send failed").slice(0, 500)],
    );
    const e = new Error("The email couldn't be sent — the mail server rejected it. Nothing went out.");
    e.statusCode = 502;
    e.cause = err;
    throw e;
  }
  const { rows } = await db.query(
    `UPDATE email_drafts SET status = 'sent', sent_at = NOW(), send_error = NULL
      WHERE draft_id = $1 RETURNING draft_id, status, sent_at`,
    [draftId],
  );
  return rows[0];
}

async function discardDraft(userId, draftId) {
  const { rowCount } = await db.query(
    `UPDATE email_drafts SET status = 'discarded'
      WHERE draft_id = $1 AND user_id = $2 AND status = 'pending'`,
    [draftId, userId],
  );
  return rowCount > 0;
}

module.exports = { draftEmail, createDraft, sendDraft, discardDraft, ownerVoiceContext };
