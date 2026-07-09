/**
 * Echo Email Assistant — owner-only API.
 *
 * Accounts (connect/list/remove), inbox intelligence (summary, important,
 * contracts, messages), drafts (AI draft → approve/send or discard), and
 * on-demand contract analysis. Everything is scoped to the authenticated
 * owner; passwords never leave the server.
 */

const db = require("../config/db");
const emailAccounts = require("../utils/emailAccounts");
const emailMonitor = require("../utils/emailMonitor");
const emailComposer = require("../utils/emailComposer");

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

async function listAccounts(req, res, next) {
  try {
    const accounts = await emailAccounts.listAccounts(req.user.userId);
    res.json({
      accounts: accounts.map((a) => ({
        accountId: a.account_id,
        provider: a.provider,
        emailAddress: a.email_address,
        displayName: a.display_name,
        status: a.status,
        lastError: a.last_error,
        lastCheckedAt: a.last_checked_at,
        createdAt: a.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function connectAccount(req, res, next) {
  try {
    const { emailAddress, password, provider, displayName, imapHost, imapPort, smtpHost, smtpPort } =
      req.body || {};
    if (!emailAddress || typeof emailAddress !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailAddress.trim())) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    if (!password || typeof password !== "string" || !password.trim()) {
      return res.status(400).json({ error: "Please enter the app password for this mailbox." });
    }
    const account = await emailAccounts.createAccount(req.user.userId, {
      emailAddress: emailAddress.trim(),
      password: password.trim(),
      provider,
      displayName,
      imapHost,
      imapPort,
      smtpHost,
      smtpPort,
    });
    res.status(201).json({
      account: {
        accountId: account.account_id,
        provider: account.provider,
        emailAddress: account.email_address,
        displayName: account.display_name,
        status: account.status,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function removeAccount(req, res, next) {
  try {
    const ok = await emailAccounts.deleteAccount(req.user.userId, req.params.id);
    if (!ok) return res.status(404).json({ error: "Email account not found." });
    res.json({ removed: true });
  } catch (err) {
    next(err);
  }
}

// Manual "check now" — sweeps just this owner's accounts immediately.
async function checkNow(req, res, next) {
  try {
    const { rows: accounts } = await db.query(
      `SELECT * FROM email_accounts WHERE user_id = $1`,
      [req.user.userId],
    );
    if (accounts.length === 0) {
      return res.status(400).json({ error: "No email accounts are connected yet." });
    }
    const results = [];
    for (const account of accounts) {
      try {
        const stored = await emailMonitor.sweepAccount(account);
        results.push({ emailAddress: account.email_address, ok: true, newMessages: stored });
      } catch (err) {
        results.push({ emailAddress: account.email_address, ok: false, error: err.message });
      }
    }
    res.json({ results });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Inbox intelligence
// ---------------------------------------------------------------------------

function serializeMessage(m) {
  return {
    messageId: m.message_id,
    accountId: m.account_id,
    emailAddress: m.email_address,
    fromAddress: m.from_address,
    fromName: m.from_name,
    subject: m.subject,
    receivedAt: m.received_at,
    snippet: m.snippet,
    aiSummary: m.ai_summary,
    category: m.category,
    hasAttachments: m.has_attachments,
    attachmentNames: m.attachment_names,
    contractAnalysis: m.contract_analysis,
    leadId: m.lead_id,
  };
}

async function inboxSummary(req, res, next) {
  try {
    const userId = req.user.userId;
    const counts = await emailMonitor.inboxBriefingCounts(userId, 24);
    const { rows: perAccount } = await db.query(
      `SELECT a.account_id, a.email_address, a.status, a.last_checked_at,
              COUNT(m.message_id) FILTER (WHERE m.received_at > NOW() - INTERVAL '24 hours')::int AS new_today
         FROM email_accounts a
         LEFT JOIN email_messages m ON m.account_id = a.account_id
        WHERE a.user_id = $1
        GROUP BY a.account_id
        ORDER BY a.created_at ASC`,
      [userId],
    );
    res.json({
      counts,
      accounts: perAccount.map((a) => ({
        accountId: a.account_id,
        emailAddress: a.email_address,
        status: a.status,
        lastCheckedAt: a.last_checked_at,
        newToday: a.new_today,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function listMessages(req, res, next) {
  try {
    const userId = req.user.userId;
    const category = req.query.category;
    const params = [userId];
    let where = `m.user_id = $1`;
    if (category) {
      if (!emailMonitor.CATEGORIES.includes(category)) {
        return res.status(400).json({ error: "Unknown category." });
      }
      params.push(category);
      where += ` AND m.category = $2`;
    }
    const { rows } = await db.query(
      `SELECT m.*, a.email_address
         FROM email_messages m
         JOIN email_accounts a ON a.account_id = m.account_id
        WHERE ${where}
        ORDER BY m.received_at DESC
        LIMIT 50`,
      params,
    );
    res.json({ messages: rows.map(serializeMessage) });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

async function listDrafts(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT d.*, a.email_address
         FROM email_drafts d
         JOIN email_accounts a ON a.account_id = d.account_id
        WHERE d.user_id = $1
        ORDER BY d.created_at DESC LIMIT 50`,
      [req.user.userId],
    );
    res.json({
      drafts: rows.map((d) => ({
        draftId: d.draft_id,
        accountId: d.account_id,
        fromAddress: d.email_address,
        toAddress: d.to_address,
        toName: d.to_name,
        subject: d.subject,
        body: d.body,
        status: d.status,
        sendError: d.send_error,
        createdAt: d.created_at,
        sentAt: d.sent_at,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// AI-draft an email (new or a reply). Returns a pending draft for approval.
async function draft(req, res, next) {
  try {
    const userId = req.user.userId;
    const { accountId, instruction, toAddress, toName, replyToMessageId } = req.body || {};
    if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
      return res.status(400).json({ error: "Tell Echo what the email should say." });
    }

    let replyTo = null;
    if (replyToMessageId) {
      const { rows } = await db.query(
        `SELECT * FROM email_messages WHERE message_id = $1 AND user_id = $2`,
        [replyToMessageId, userId],
      );
      replyTo = rows[0] || null;
      if (!replyTo) return res.status(404).json({ error: "That email wasn't found." });
    }

    const resolvedTo = (toAddress && String(toAddress).trim()) || (replyTo && replyTo.from_address);
    if (!resolvedTo || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(resolvedTo)) {
      return res.status(400).json({ error: "Who should this email go to? A valid address is needed." });
    }

    let account;
    if (accountId) {
      account = await emailAccounts.getOwnedAccount(userId, accountId);
    } else if (replyTo) {
      account = await emailAccounts.getOwnedAccount(userId, replyTo.account_id);
    } else {
      const accounts = await emailAccounts.listAccounts(userId);
      account = accounts[0]
        ? await emailAccounts.getOwnedAccount(userId, accounts[0].account_id)
        : null;
    }
    if (!account) return res.status(400).json({ error: "Connect an email account first." });

    let drafted;
    try {
      drafted = await emailComposer.draftEmail(userId, { instruction: instruction.trim(), replyTo });
    } catch (err) {
      const e = new Error("Echo couldn't draft that email right now. Please try again in a moment.");
      e.statusCode = 502;
      throw e;
    }

    const saved = await emailComposer.createDraft(userId, {
      accountId: account.account_id,
      toAddress: resolvedTo,
      toName: toName || (replyTo && replyTo.from_name) || null,
      subject: replyTo && replyTo.subject ? `Re: ${replyTo.subject.replace(/^Re:\s*/i, "")}` : drafted.subject,
      body: drafted.body,
      replyToMessageId: replyTo ? replyTo.message_id : null,
    });
    res.status(201).json({
      draft: {
        draftId: saved.draft_id,
        toAddress: saved.to_address,
        toName: saved.to_name,
        subject: saved.subject,
        body: saved.body,
        status: saved.status,
        fromAddress: account.email_address,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function updateDraft(req, res, next) {
  try {
    const { subject, body } = req.body || {};
    if ((!subject || !String(subject).trim()) && (!body || !String(body).trim())) {
      return res.status(400).json({ error: "Nothing to update." });
    }
    const { rows } = await db.query(
      `UPDATE email_drafts
          SET subject = COALESCE(NULLIF($3, ''), subject),
              body = COALESCE(NULLIF($4, ''), body)
        WHERE draft_id = $1 AND user_id = $2 AND status = 'pending'
        RETURNING draft_id, subject, body, status`,
      [req.params.id, req.user.userId, subject ? String(subject).trim() : "", body ? String(body).trim() : ""],
    );
    if (!rows[0]) return res.status(404).json({ error: "That draft can't be edited (already sent or discarded)." });
    res.json({ draft: { draftId: rows[0].draft_id, subject: rows[0].subject, body: rows[0].body, status: rows[0].status } });
  } catch (err) {
    next(err);
  }
}

async function sendDraft(req, res, next) {
  try {
    const result = await emailComposer.sendDraft(req.user.userId, req.params.id);
    res.json({ sent: true, draftId: result.draft_id, sentAt: result.sent_at });
  } catch (err) {
    next(err);
  }
}

async function discardDraft(req, res, next) {
  try {
    const ok = await emailComposer.discardDraft(req.user.userId, req.params.id);
    if (!ok) return res.status(404).json({ error: "That draft was already sent or discarded." });
    res.json({ discarded: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listAccounts,
  connectAccount,
  removeAccount,
  checkNow,
  inboxSummary,
  listMessages,
  listDrafts,
  draft,
  updateDraft,
  sendDraft,
  discardDraft,
};
