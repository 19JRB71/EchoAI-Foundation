/**
 * Echo Email Assistant — 15-minute inbox monitor.
 *
 * For every connected account: fetch messages newer than the stored IMAP UID
 * cursor, AI-categorize + summarize them (honest: AI failure stores the
 * message with category 'general' and NULL summary — never fabricated), file
 * contract/lead/payment/invoice intelligence, and queue voice alerts for the
 * things that matter. Per-account and per-message guards keep one bad mailbox
 * or one bad message from silencing the rest of the sweep.
 */

const { simpleParser } = require("mailparser");
const db = require("../config/db");
const { createMessage, MODEL } = require("../config/anthropic");
const emailAccounts = require("./emailAccounts");
const { enqueueOwnerVoiceEvent } = require("./echoVoiceNotifications");
const { sendEmail } = require("./email");
const autonomousEngine = require("../controllers/autonomousConversationController");

const CATEGORIES = ["urgent", "important", "contract", "lead", "invoice", "payment", "general"];
const MAX_NEW_PER_SWEEP = 25; // per account per sweep — briefings stay sane
const SNIPPET_LEN = 400;

function extractText(resp) {
  if (!resp || !Array.isArray(resp.content)) return "";
  return resp.content
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// ---------------------------------------------------------------------------
// AI classification (batch, one call per account sweep)
// ---------------------------------------------------------------------------

const CLASSIFY_SYSTEM = `You triage a business owner's incoming email. For EACH email you are given (numbered), reply with EXACTLY one JSON array, no other text, one object per email in the same order:
[{"n": 1, "category": "...", "summary": "..."}]
category MUST be one of: urgent (needs attention today), important (needs attention this week), contract (contains or discusses a contract/agreement/legal document), lead (a business inquiry, quote request, or contact-form submission from a potential customer), invoice (a bill or invoice from a vendor), payment (a payment received/processed notification, e.g. from Stripe), general (everything else — newsletters, promos, notifications).
summary: 1-2 plain sentences of what the email says and any ask/deadline. Base it ONLY on the provided text; never invent details.`;

async function classifyBatch(emails) {
  const numbered = emails
    .map(
      (e, i) =>
        `EMAIL ${i + 1}\nFrom: ${e.fromName || ""} <${e.fromAddress || ""}>\nSubject: ${e.subject || "(no subject)"}\nAttachments: ${
          e.attachmentNames.length ? e.attachmentNames.join(", ") : "none"
        }\nBody excerpt: ${e.snippet || "(empty)"}`,
    )
    .join("\n\n");
  const resp = await createMessage(
    {
      model: MODEL,
      max_tokens: 1500,
      system: CLASSIFY_SYSTEM,
      messages: [{ role: "user", content: numbered }],
    },
    { label: "Email triage" },
  );
  const text = extractText(resp);
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Email triage returned no JSON");
  const arr = JSON.parse(match[0]);
  const out = new Map();
  for (const item of arr) {
    const n = Number(item && item.n);
    const category = CATEGORIES.includes(item && item.category) ? item.category : "general";
    const summary =
      item && typeof item.summary === "string" && item.summary.trim() ? item.summary.trim() : null;
    if (n >= 1 && n <= emails.length) out.set(n, { category, summary });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetch new messages for one account
// ---------------------------------------------------------------------------

async function fetchNewMessages(account) {
  const client = await emailAccounts.openImap(account);
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      const uidValidity = mailbox.uidValidity ? Number(mailbox.uidValidity) : null;
      let sinceUid = Number(account.last_seen_uid) || 0;
      // UIDVALIDITY changed → old UIDs are meaningless; restart cursor at the
      // top so we never re-import the whole mailbox as "new".
      const validityChanged =
        uidValidity && account.uid_validity && Number(account.uid_validity) !== uidValidity;
      const firstRun = sinceUid === 0 || validityChanged;

      const nextUid = mailbox.uidNext ? Number(mailbox.uidNext) : null;
      if (firstRun) {
        // Baseline: mark everything current as seen; monitoring starts now.
        return { messages: [], newCursor: nextUid ? nextUid - 1 : 0, uidValidity };
      }

      const messages = [];
      let highest = sinceUid;
      for await (const msg of client.fetch(
        { uid: `${sinceUid + 1}:*` },
        { uid: true, envelope: true, bodyStructure: true, source: true },
        { uid: true },
      )) {
        if (Number(msg.uid) <= sinceUid) continue; // IMAP servers echo the last UID on x:*
        highest = Math.max(highest, Number(msg.uid));
        if (messages.length >= MAX_NEW_PER_SWEEP) continue; // still advance cursor
        let parsed = null;
        try {
          parsed = await simpleParser(msg.source);
        } catch (_) {
          parsed = null;
        }
        const attachments = (parsed && parsed.attachments) || [];
        messages.push({
          uid: Number(msg.uid),
          fromAddress: msg.envelope?.from?.[0]?.address || null,
          fromName: msg.envelope?.from?.[0]?.name || null,
          subject: msg.envelope?.subject || null,
          receivedAt: msg.envelope?.date || new Date(),
          snippet: parsed && parsed.text ? parsed.text.replace(/\s+/g, " ").trim().slice(0, SNIPPET_LEN) : "",
          attachmentNames: attachments.map((a) => a.filename).filter(Boolean),
          attachments, // kept in-memory only for contract analysis, never stored
        });
      }
      return { messages, newCursor: highest, uidValidity };
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch (_) {
      client.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Persistence + alerts
// ---------------------------------------------------------------------------

async function storeMessage(account, m, triage) {
  const { rows } = await db.query(
    `INSERT INTO email_messages
       (account_id, user_id, message_uid, from_address, from_name, subject,
        received_at, snippet, ai_summary, category, has_attachments, attachment_names)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     ON CONFLICT (account_id, message_uid) DO NOTHING
     RETURNING message_id`,
    [
      account.account_id,
      account.user_id,
      m.uid,
      m.fromAddress,
      m.fromName,
      m.subject,
      m.receivedAt,
      m.snippet,
      triage ? triage.summary : null,
      triage ? triage.category : "general",
      m.attachmentNames.length > 0,
      JSON.stringify(m.attachmentNames),
    ],
  );
  return rows[0] ? rows[0].message_id : null;
}

const ALERT_CATEGORIES = new Set(["urgent", "contract", "payment"]);

async function alertForMessage(account, messageId, m, triage) {
  if (!triage || !ALERT_CATEGORIES.has(triage.category)) return;
  const who = m.fromName || m.fromAddress || "someone";
  let spoken;
  if (triage.category === "payment") {
    spoken = `Good news: a payment notification just arrived in ${account.email_address}. ${triage.summary || ""}`.trim();
  } else if (triage.category === "contract") {
    spoken = `You've received what looks like a contract from ${who} in ${account.email_address}. Want me to review it and summarize the key terms?`;
  } else {
    spoken = `An email that needs your attention today just arrived from ${who}: ${
      triage.summary || m.subject || "no subject"
    }`;
  }
  // enqueueOwnerVoiceEvent respects the owner's voice settings (master switch
  // + the "Email alerts" event toggle) — never alert someone who opted out.
  const id = await enqueueOwnerVoiceEvent(account.user_id, "email_alert", () => spoken, {
    title: "Email alert",
    payload: { messageId, category: triage.category, account: account.email_address },
    dedupKey: `email:${account.account_id}:${m.uid}`,
    expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
  });
  if (id) {
    await db.query(`UPDATE email_messages SET alerted = TRUE WHERE message_id = $1`, [messageId]);
  }
}

// ---------------------------------------------------------------------------
// Per-account sweep
// ---------------------------------------------------------------------------

async function sweepAccount(account) {
  const { messages, newCursor, uidValidity } = await module.exports.fetchNewMessages(account);

  let triageMap = new Map();
  if (messages.length > 0) {
    try {
      triageMap = await module.exports.classifyBatch(messages);
    } catch (err) {
      // Honest degradation: messages are still recorded (category general,
      // no summary) so nothing is lost; no fabricated summaries.
      console.error(`Email triage failed for ${account.email_address}:`, err.message);
      triageMap = new Map();
    }
  }

  let stored = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    try {
      const triage = triageMap.get(i + 1) || null;
      const messageId = await module.exports.storeMessage(account, m, triage);
      if (!messageId) continue; // already stored by an earlier overlapping sweep
      stored += 1;
      await module.exports.alertForMessage(account, messageId, m, triage);
      if (triage && triage.category === "contract") {
        await module.exports
          .analyzeContractIfPossible(account, messageId, m)
          .catch((e) => console.error("Contract analysis failed:", e.message));
      }
      if (triage && triage.category === "lead") {
        await module.exports
          .captureLeadFromEmail(account, messageId, m, triage)
          .catch((e) => console.error("Email lead capture failed:", e.message));
      }
    } catch (err) {
      console.error(`Email message processing failed (uid ${m.uid}):`, err.message);
    }
  }

  await db.query(
    `UPDATE email_accounts
        SET last_seen_uid = GREATEST(last_seen_uid, $2), uid_validity = $3,
            last_checked_at = NOW(), status = 'connected', last_error = NULL, updated_at = NOW()
      WHERE account_id = $1`,
    [account.account_id, newCursor, uidValidity],
  );
  return stored;
}

// ---------------------------------------------------------------------------
// Contract analysis (PDF attachments → plain-English key terms)
// ---------------------------------------------------------------------------

const CONTRACT_SYSTEM = `You summarize a contract for a business owner in plain English. Cover: payment terms, deadlines and dates, each party's obligations, cancellation/termination clauses, and anything unusual or worth a closer look. Be factual and base everything ONLY on the document text. You are not a lawyer and must not give legal advice — summarize what the document says. Keep it under 250 words, short bullet-like sentences.`;

async function analyzeContractIfPossible(account, messageId, m) {
  const pdf = (m.attachments || []).find(
    (a) => a.contentType === "application/pdf" || /\.pdf$/i.test(a.filename || ""),
  );
  let docText = "";
  if (pdf && pdf.content) {
    try {
      const { pdf: parsePdf } = require("pdf-parse");
      const parsed = await parsePdf(pdf.content);
      docText = (parsed.text || "").slice(0, 60000);
    } catch (err) {
      console.error("PDF text extraction failed:", err.message);
    }
  }
  if (!docText) docText = m.snippet || "";
  if (!docText.trim()) return; // nothing readable — no fabricated analysis

  const resp = await createMessage(
    {
      model: MODEL,
      max_tokens: 800,
      system: CONTRACT_SYSTEM,
      messages: [{ role: "user", content: `Document from email "${m.subject || ""}":\n\n${docText}` }],
    },
    { label: "Contract analysis" },
  );
  const analysis = extractText(resp);
  if (!analysis) return;
  await db.query(`UPDATE email_messages SET contract_analysis = $2 WHERE message_id = $1`, [
    messageId,
    analysis,
  ]);
}

// ---------------------------------------------------------------------------
// Lead capture → Pulse CRM (dedup in app code per platform convention)
// ---------------------------------------------------------------------------

const LEAD_EXTRACT_SYSTEM = `Extract the potential customer's contact details from this inquiry email. Reply with EXACTLY one JSON object, no other text: {"name": "...", "email": "...", "phone": "...", "note": "one sentence on what they want"}. Use null for anything not present in the email. Never invent details.`;

async function captureLeadFromEmail(account, messageId, m, triage) {
  // Attach to the owner's primary real brand; no brand → nowhere to file it.
  const { rows: brandRows } = await db.query(
    `SELECT brand_id FROM brands WHERE user_id = $1 AND COALESCE(is_demo, FALSE) = FALSE
      ORDER BY created_at ASC LIMIT 1`,
    [account.user_id],
  );
  if (!brandRows[0]) return;
  const brandId = brandRows[0].brand_id;

  let contact = { name: m.fromName, email: m.fromAddress, phone: null, note: triage.summary };
  try {
    const resp = await createMessage(
      {
        model: MODEL,
        max_tokens: 300,
        system: LEAD_EXTRACT_SYSTEM,
        messages: [
          {
            role: "user",
            content: `From: ${m.fromName || ""} <${m.fromAddress || ""}>\nSubject: ${m.subject || ""}\n\n${m.snippet || ""}`,
          },
        ],
      },
      { label: "Email lead extraction" },
    );
    const parsed = JSON.parse((extractText(resp).match(/\{[\s\S]*\}/) || ["{}"])[0]);
    contact = {
      name: parsed.name || m.fromName || null,
      email: parsed.email || m.fromAddress || null,
      phone: parsed.phone || null,
      note: parsed.note || triage.summary || null,
    };
  } catch (_) {
    // extraction failure → fall back to raw sender details (still real data)
  }
  if (!contact.email && !contact.phone) return;

  // Dedup in app code (leads table is shared by several insert paths).
  const { rows: existing } = await db.query(
    `SELECT lead_id FROM leads
      WHERE brand_id = $1 AND (
        (COALESCE($2,'') <> '' AND LOWER(email) = LOWER($2))
        OR (COALESCE($3,'') <> '' AND phone = $3)
      )
      LIMIT 1`,
    [brandId, contact.email || "", contact.phone || ""],
  );
  let leadId;
  const existedBefore = Boolean(existing[0]);
  if (existing[0]) {
    leadId = existing[0].lead_id;
  } else {
    const { rows: created } = await db.query(
      `INSERT INTO leads (brand_id, lead_name, email, phone, temperature, conversation_history)
       VALUES ($1,$2,$3,$4,'warm', $5::jsonb) RETURNING lead_id`,
      [
        brandId,
        contact.name,
        contact.email,
        contact.phone,
        JSON.stringify([
          {
            role: "system",
            text: `Captured automatically from an email to ${account.email_address}: ${contact.note || m.subject || "inquiry"}`,
            ts: new Date().toISOString(),
          },
        ]),
      ],
    );
    leadId = created[0].lead_id;
    // Sage V2 P3 attribution (flag-gated no-op when dark): an inbound email
    // created this lead — first touch is genuinely known.
    require("./leadOutcome").setFirstTouch(leadId, "email").catch(() => {});
  }
  await db.query(`UPDATE email_messages SET lead_id = $2 WHERE message_id = $1`, [messageId, leadId]);

  // Two-Way Autonomous Conversation (email channel): if this is a reply from a
  // lead we already know (i.e. someone we've reached out to before — a reply to
  // our outbound), let Echo carry the conversation autonomously. Brand-new cold
  // inquiries are left for the owner's normal inbox flow. Best-effort — never
  // breaks the sweep.
  if (existedBefore && contact.email) {
    try {
      await maybeAutonomousEmailReply({
        account,
        brandId,
        leadId,
        replyToAddress: contact.email,
        subject: m.subject,
        inboundText: m.snippet || m.subject || "",
      });
    } catch (err) {
      console.error("Autonomous email reply failed:", err.message);
    }
  }
}

/** Renders a plain-text reply body as simple HTML paragraphs (no markdown). */
function replyBodyToHtml(text) {
  const escape = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  return String(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/**
 * Generate + send one autonomous email reply for a lead, and log it in the CRM
 * via the shared engine. Only sends when the engine produces a reply and the
 * conversation hasn't been transferred to the owner.
 */
async function maybeAutonomousEmailReply({
  account,
  brandId,
  leadId,
  replyToAddress,
  subject,
  inboundText,
}) {
  const { rows: brandRows } = await db.query(
    `SELECT brand_id, brand_name, brand_personality, voice_description, target_audience
     FROM brands WHERE brand_id = $1`,
    [brandId],
  );
  const brand = brandRows[0];
  if (!brand) return;

  const { rows: leadRows } = await db.query(
    `SELECT lead_id, conversation_history, temperature FROM leads WHERE lead_id = $1`,
    [leadId],
  );
  const lead = leadRows[0];
  if (!lead) return;

  const result = await autonomousEngine.handleInboundReply({
    brand,
    ownerUserId: account.user_id,
    lead,
    channel: "email",
    inboundText,
    history: Array.isArray(lead.conversation_history) ? lead.conversation_history : [],
  });

  if (result.transferred || !result.reply) return;

  const replySubject = /^re:/i.test(subject || "")
    ? subject
    : `Re: ${subject || "your message"}`;
  await sendEmail({
    to: replyToAddress,
    subject: replySubject,
    html: replyBodyToHtml(result.reply),
    from: account.email_address || undefined,
  });
}

// ---------------------------------------------------------------------------
// Full sweep (scheduler entry, every 15 minutes)
// ---------------------------------------------------------------------------

async function sweepAllEmailAccounts() {
  const { rows: accounts } = await db.query(
    `SELECT * FROM email_accounts
      WHERE last_checked_at IS NULL OR last_checked_at < NOW() - INTERVAL '10 minutes'
      ORDER BY last_checked_at ASC NULLS FIRST`,
  );
  let ok = 0;
  for (const account of accounts) {
    try {
      await module.exports.sweepAccount(account);
      ok += 1;
    } catch (err) {
      console.error(`Email sweep failed for ${account.email_address}:`, err.message);
      // Only mark hard auth failures as errors; transient issues stay connected.
      const authFail = /auth|login|credential|password/i.test(err.message || "");
      await db
        .query(
          `UPDATE email_accounts
              SET last_checked_at = NOW(), updated_at = NOW(),
                  status = CASE WHEN $2 THEN 'error' ELSE status END,
                  last_error = $3
            WHERE account_id = $1`,
          [account.account_id, authFail, String(err.message || "sweep failed").slice(0, 500)],
        )
        .catch(() => {});
    }
  }
  if (accounts.length > 0) {
    console.log(`Email monitor: swept ${ok}/${accounts.length} account(s).`);
  }
}

// ---------------------------------------------------------------------------
// Inbox status for briefings (real cached counts only)
// ---------------------------------------------------------------------------

async function inboxBriefingCounts(userId, sinceHours = 24) {
  const { rows } = await db.query(
    `SELECT category, COUNT(*)::int AS n
       FROM email_messages
      WHERE user_id = $1 AND received_at > NOW() - ($2 || ' hours')::interval
      GROUP BY category`,
    [userId, String(sinceHours)],
  );
  const counts = { total: 0 };
  for (const c of CATEGORIES) counts[c] = 0;
  for (const r of rows) {
    counts[r.category] = r.n;
    counts.total += r.n;
  }
  return counts;
}

module.exports = {
  CATEGORIES,
  classifyBatch,
  fetchNewMessages,
  storeMessage,
  alertForMessage,
  sweepAccount,
  analyzeContractIfPossible,
  captureLeadFromEmail,
  sweepAllEmailAccounts,
  inboxBriefingCounts,
};
