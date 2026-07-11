// Echo — the persistent AI companion.
//
// After setup, Echo walks the owner through ACTIVATING their marketing without
// making them navigate anywhere: connect Facebook -> preview + approve the first
// ad campaign -> preview + approve the content calendar -> ongoing mode. It drives
// the EXISTING feature controllers in-process (the same synthetic req/res pattern
// the Setup Agent uses) so nothing is faked — a real campaign is launched, a real
// calendar is activated. Every action is shown as a preview and requires one-click
// approval (or a Facebook password) before it executes.
//
// Invariant (matches the Setup Agent): a single failed step NEVER blocks the
// journey — it is recorded as skipped with a friendly message and Echo moves on.

const crypto = require("crypto");
const db = require("../config/db");
const { createMessage, streamMessage, MODEL } = require("../config/anthropic");

const adCreativeStudioController = require("./adCreativeStudioController");
const campaignController = require("./campaignController");
const contentCalendarController = require("./contentCalendarController");
const voiceController = require("./voiceController");
const echoContext = require("../utils/echoContext");
const echoOrchestrator = require("../utils/echoOrchestrator");
const featureSuggestions = require("../utils/featureSuggestions");
const emailComposer = require("../utils/emailComposer");
const emailAccounts = require("../utils/emailAccounts");

// ---------------------------------------------------------------------------
// Echo chat → email draft (voice/chat compose; ALWAYS a pending draft, never
// sent without explicit approval in the Email tab).
// ---------------------------------------------------------------------------
async function createEchoEmailDraft(userId, recipient, instruction) {
  const accounts = await emailAccounts.listAccounts(userId);
  if (accounts.length === 0) {
    const e = new Error("no email account connected");
    e.friendly = "Connect an email account in the Email tab first, then I can draft it for you.";
    throw e;
  }

  let toAddress = null;
  let toName = null;
  let replyTo = null;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
    toAddress = recipient;
  } else if (recipient) {
    // "reply to John" — find the most recent monitored email from that sender.
    const { rows } = await db.query(
      `SELECT * FROM email_messages
        WHERE user_id = $1 AND (from_name ILIKE $2 OR from_address ILIKE $2)
        ORDER BY received_at DESC LIMIT 1`,
      [userId, `%${recipient}%`],
    );
    if (rows[0] && rows[0].from_address) {
      replyTo = rows[0];
      toAddress = rows[0].from_address;
      toName = rows[0].from_name;
    }
  }
  if (!toAddress) {
    const e = new Error("recipient not resolved");
    e.friendly = `I couldn't find an email address for "${recipient}" — tell me the address and I'll draft it right away.`;
    throw e;
  }

  const accountId = replyTo ? replyTo.account_id : accounts[0].account_id;
  const drafted = await emailComposer.draftEmail(userId, { instruction, replyTo });
  const saved = await emailComposer.createDraft(userId, {
    accountId,
    toAddress,
    toName,
    subject:
      replyTo && replyTo.subject ? `Re: ${replyTo.subject.replace(/^Re:\s*/i, "")}` : drafted.subject,
    body: drafted.body,
    replyToMessageId: replyTo ? replyTo.message_id : null,
  });
  return { draftId: saved.draft_id, toAddress, toName };
}

// ---------------------------------------------------------------------------
// In-process controller invocation (same pattern as setupAgentController.invoke)
// ---------------------------------------------------------------------------
function invoke(controllerFn, userId, { body = {}, params = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = { body, params, user: { userId } };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode, payload });
      },
      send(payload) {
        resolve({ statusCode: this.statusCode, payload });
      },
    };
    Promise.resolve(controllerFn(req, res)).catch(reject);
  });
}

function ensureOk(result, fallbackMessage) {
  if (!result || result.statusCode < 200 || result.statusCode >= 300) {
    const err = new Error(
      (result && result.payload && result.payload.error) || fallbackMessage || "Action failed.",
    );
    err.statusCode = result && result.statusCode >= 400 ? result.statusCode : 502;
    throw err;
  }
  return result.payload;
}

function extractText(resp) {
  if (!resp || !Array.isArray(resp.content)) return "";
  return resp.content
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------
const MAX_MESSAGES = 100;
const arr = (x) => (Array.isArray(x) ? x : []);

function echoMsg(type, text, extra = {}) {
  return { id: crypto.randomUUID(), role: "echo", type, text, ts: new Date().toISOString(), ...extra };
}
function userMsg(text) {
  return { id: crypto.randomUUID(), role: "user", type: "text", text, ts: new Date().toISOString() };
}
function pushMsg(messages, ...msgs) {
  const next = [...arr(messages), ...msgs];
  return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
}

// Voice execution: how the owner responded to a pending action, in natural
// language. Order matters — a decline ("no, cancel") must win over an affirm,
// and an explicit "confirm" is distinguished from a plain "yes" so high-stakes
// actions can require the stronger word.
const DECLINE_RE =
  /^(?:no\b|nope|nah|not now|cancel|decline|skip( it| that)?|hold off|don'?t|do not|stop)\b/i;
const CONFIRM_RE = /\bconfirm(?:ed|s|ing)?\b/i;
const AFFIRM_RE =
  /^(?:yes|yep|yeah|yup|sure|ok|okay|okey|go ahead|go for it|do it|please do|sounds good|let'?s do it|approve[d]?|launch it|send it|run it)\b/i;

/**
 * Classify an utterance as an approval decision for a pending action:
 * "decline" | "confirm" (explicit) | "affirm" (routine yes) | "none".
 */
function classifyApprovalUtterance(text) {
  const t = (text || "").trim();
  if (DECLINE_RE.test(t)) return "decline";
  if (CONFIRM_RE.test(t)) return "confirm";
  if (AFFIRM_RE.test(t)) return "affirm";
  return "none";
}

async function getOrCreateState(userId) {
  const { rows } = await db.query(
    `INSERT INTO echo_companion (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [userId],
  );
  return rows[0];
}

async function getBrand(userId) {
  const { rows } = await db.query(
    `SELECT brand_id, brand_name FROM brands
     WHERE user_id = $1 AND is_demo = false ORDER BY created_at ASC LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

/** All of the owner's REAL businesses (demo excluded), for the chat switcher. */
async function listBusinesses(userId) {
  const { rows } = await db.query(
    `SELECT brand_id, brand_name FROM brands
     WHERE user_id = $1 AND is_demo = false ORDER BY created_at ASC`,
    [userId],
  );
  return rows;
}

/**
 * Resolve the business Echo's chat should be about. When the owner has picked a
 * business (context switch) we honor that id after verifying ownership + that it
 * isn't the demo brand; otherwise we default to their first real business.
 */
async function resolveChatBrand(userId, brandId) {
  if (brandId) {
    const { rows } = await db.query(
      `SELECT brand_id, brand_name FROM brands
       WHERE brand_id = $1 AND user_id = $2 AND is_demo = false`,
      [brandId, userId],
    );
    if (rows[0]) return rows[0];
  }
  return getBrand(userId);
}

// pendingAction: pass an object to set, or null to clear. activation_status /
// completed_actions / messages are left unchanged when omitted (COALESCE).
async function persist(userId, { activation_status, completed_actions, messages, pendingAction = null }) {
  await db.query(
    `UPDATE echo_companion SET
       activation_status = COALESCE($2, activation_status),
       completed_actions = COALESCE($3::jsonb, completed_actions),
       messages          = COALESCE($4::jsonb, messages),
       pending_action    = $5::jsonb,
       updated_at        = NOW()
     WHERE user_id = $1`,
    [
      userId,
      activation_status || null,
      completed_actions ? JSON.stringify(completed_actions) : null,
      messages ? JSON.stringify(messages) : null,
      pendingAction ? JSON.stringify(pendingAction) : null,
    ],
  );
}

// Strip the server-only `exec` before sending a pending action to the client.
function sanitizePending(pending) {
  if (!pending) return null;
  return { key: pending.key, text: pending.text, card: pending.card };
}

// ---------------------------------------------------------------------------
// Activation journey. Each step's build() returns one of:
//   { type: "info"|"skip", text }           -> Echo speaks, step auto-completes
//   { type: "connection", connect, text }   -> OAuth hand-off, step waits
//   { type: "preview", text, card, exec }   -> preview requiring Approve/Decline
// ---------------------------------------------------------------------------
const DEFAULT_DAILY_BUDGET = Number(process.env.ECHO_DEFAULT_DAILY_BUDGET) || 20;

const ACTIVATION_STEPS = [
  {
    key: "welcome",
    async build({ brand }) {
      const name = brand ? brand.brand_name : "your business";
      return {
        type: "info",
        text: `Great news — ${name} is all set up. I built your brand profile, created your first ad creatives, and drafted your content calendar. Now let's get you live and bringing in leads. I'll show you everything before it goes out.`,
      };
    },
  },
  {
    key: "connect_facebook",
    async build({ userId }) {
      const connected = await db.query(
        `SELECT 1 FROM api_integrations
         WHERE user_id = $1 AND platform = 'facebook' AND connection_status = 'connected'`,
        [userId],
      );
      if (connected.rows.length > 0) {
        return { type: "info", text: "I'm connected to your Facebook account." };
      }
      return {
        type: "connection",
        connect: "facebook",
        text: "First I need to connect your Facebook account so I can launch your ad campaigns. Click Connect Facebook below and log in — I'll take it from there.",
      };
    },
  },
  {
    key: "launch_campaign",
    skipMessage:
      "I'll set up your ad campaign later — you can launch one anytime from the Ad Studio.",
    async build({ brand }) {
      if (!brand) return { type: "skip", text: "No brand yet — I'll set up campaigns once your brand profile exists." };
      const existing = await db.query("SELECT 1 FROM campaigns WHERE brand_id = $1 LIMIT 1", [
        brand.brand_id,
      ]);
      if (existing.rows.length > 0) {
        return { type: "info", text: "Your first ad campaign is already set up." };
      }
      const creativeRow = await db.query(
        `SELECT creative_id, campaign_goal, creative_concept FROM ad_creatives
         WHERE brand_id = $1 AND status <> 'launched'
         ORDER BY created_at DESC LIMIT 1`,
        [brand.brand_id],
      );
      if (creativeRow.rows.length === 0) {
        return {
          type: "skip",
          text: "I don't have an ad creative to launch yet — you can generate one in the Ad Studio.",
        };
      }
      const creative = creativeRow.rows[0];
      const concept = creative.creative_concept || {};
      const pkg = (Array.isArray(concept.packages) && concept.packages[0]) || {};
      const card = {
        kind: "campaign",
        title: "Facebook Ad Campaign",
        headline: pkg.headline || "Your ad",
        body: (Array.isArray(pkg.bodyCopyVariations) && pkg.bodyCopyVariations[0]) || "",
        visual: pkg.imageDescription || "",
        audience: (pkg.audienceTargeting && pkg.audienceTargeting.description) || "",
        cta: pkg.callToAction || "Learn More",
        budget: DEFAULT_DAILY_BUDGET,
        objective: creative.campaign_goal || "lead_generation",
      };
      return {
        type: "preview",
        text: "Before I launch your first campaign, here's exactly what's going out. Review it and hit Approve & Launch when you're ready.",
        card,
        exec: {
          action: "launch_campaign",
          creativeId: creative.creative_id,
          budget: DEFAULT_DAILY_BUDGET,
          // High-stakes: launching an ad campaign spends real money, so a spoken
          // "yes" isn't enough — Echo requires an explicit "confirm".
          risk: "high_stakes",
          confirmReason: `spends real ad money — $${DEFAULT_DAILY_BUDGET}/day`,
        },
      };
    },
  },
  {
    key: "activate_calendar",
    skipMessage:
      "I'll leave your content calendar for now — you can activate it anytime from the Content Calendar section.",
    async build({ brand }) {
      if (!brand) return { type: "skip", text: "No brand yet — nothing to schedule." };
      const calRow = await db.query(
        `SELECT calendar_id FROM content_calendars
         WHERE brand_id = $1 AND status = 'draft'
         ORDER BY created_at DESC LIMIT 1`,
        [brand.brand_id],
      );
      if (calRow.rows.length === 0) {
        return { type: "info", text: "Your content calendar is already active (or not on your current plan)." };
      }
      const calendarId = calRow.rows[0].calendar_id;
      let posts = [];
      try {
        const p = await db.query(
          `SELECT * FROM social_posts WHERE calendar_id = $1 ORDER BY created_at ASC LIMIT 5`,
          [calendarId],
        );
        posts = p.rows.map((r) => ({
          platform: r.platform || "social",
          content: r.post_content || r.content || r.caption || r.body || "",
        }));
      } catch (_e) {
        posts = [];
      }
      return {
        type: "preview",
        text: "Next, let's activate your content calendar so your social posts publish automatically. Here's a sample of what's scheduled — approve to turn it on.",
        card: { kind: "calendar", title: "Content Calendar", posts, count: posts.length },
        // Routine: activating already-drafted posts is reversible and spends no
        // money, so a spoken "yes" is enough to run it.
        exec: { action: "activate_calendar", calendarId, risk: "routine" },
      };
    },
  },
];

// Run an approved action against the real controllers. Returns a confirmation
// sentence. Throws on failure (the caller records it as skipped, never blocks).
async function runExec(userId, exec) {
  if (!exec || !exec.action) return "Done.";
  if (exec.action === "launch_campaign") {
    const canLaunchCreative =
      exec.creativeId && process.env.FACEBOOK_PAGE_ID && process.env.FACEBOOK_LINK_URL;
    if (canLaunchCreative) {
      const launched = await invoke(adCreativeStudioController.launchCreative, userId, {
        body: { creativeId: exec.creativeId, packageIndex: 0, budget: exec.budget },
      });
      ensureOk(launched, "Failed to launch your campaign.");
      return `Your Facebook ad campaign is launched at $${exec.budget}/day (paused for Facebook's review, as required) — I'll monitor it and optimize weekly.`;
    }
    const brand = await getBrand(userId);
    if (!brand) throw new Error("No brand to launch a campaign for.");
    const result = await invoke(campaignController.createCampaign, userId, {
      body: { brandId: brand.brand_id, goal: "lead_generation", budget: exec.budget, targetAudience: {} },
    });
    ensureOk(result, "Failed to launch your campaign.");
    return `Your Facebook ad campaign is set up at $${exec.budget}/day (paused for review) — I'll monitor and optimize it for you.`;
  }
  if (exec.action === "activate_calendar") {
    const result = await invoke(contentCalendarController.activateCalendar, userId, {
      body: { calendarId: exec.calendarId },
    });
    ensureOk(result, "Failed to activate your content calendar.");
    return "Your content calendar is live — your social posts will now publish automatically on schedule.";
  }
  return "Done.";
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------
function modeFor(state) {
  if (state.pending_action) return "approval";
  if (state.activation_status === "active") return "idle";
  return "action";
}

async function getState(req, res) {
  try {
    const userId = req.user.userId;
    const state = await getOrCreateState(userId);
    const [brand, businesses] = await Promise.all([
      getBrand(userId),
      listBusinesses(userId),
    ]);
    return res.json({
      activationStatus: state.activation_status,
      mode: modeFor(state),
      messages: arr(state.messages),
      pendingAction: sanitizePending(state.pending_action),
      brandName: brand ? brand.brand_name : null,
      activeBrandId: brand ? brand.brand_id : null,
      businesses: businesses.map((b) => ({ brandId: b.brand_id, name: b.brand_name })),
    });
  } catch (err) {
    console.error("Echo getState error:", err.message);
    return res.status(500).json({ error: "Failed to load Echo." });
  }
}

async function advance(req, res) {
  try {
    const userId = req.user.userId;
    const state = await getOrCreateState(userId);

    // Already waiting on the user to Approve/Decline something.
    if (state.pending_action) {
      return res.json({
        waiting: true,
        more: false,
        pendingAction: sanitizePending(state.pending_action),
      });
    }
    if (state.activation_status === "active") {
      return res.json({ allComplete: true, more: false });
    }

    const brand = await getBrand(userId);
    const completed = arr(state.completed_actions);
    const step = ACTIVATION_STEPS.find((s) => !completed.includes(s.key));

    if (!step) {
      const msg = echoMsg(
        "info",
        "You're all set — Echo is now managing your marketing. I'll send you a briefing each morning and only interrupt you when I need approval for something important. Just tell me what you need any time.",
      );
      await persist(userId, {
        activation_status: "active",
        messages: pushMsg(state.messages, msg),
        pendingAction: null,
      });
      return res.json({ allComplete: true, message: msg, more: false });
    }

    let built;
    try {
      built = await step.build({ userId, brand, state });
    } catch (err) {
      // Never block the journey on a single failed step.
      console.error(`Echo step "${step.key}" failed (skipping):`, err.message);
      const msg = echoMsg(
        "info",
        step.skipMessage || "I couldn't finish that one automatically — you can set it up later from your dashboard. Moving on.",
      );
      await persist(userId, {
        activation_status: "in_progress",
        completed_actions: [...completed, step.key],
        messages: pushMsg(state.messages, msg),
        pendingAction: null,
      });
      return res.json({ step: step.key, status: "skipped", message: msg, more: true });
    }

    if (built.type === "info" || built.type === "skip") {
      const msg = echoMsg("info", built.text);
      await persist(userId, {
        activation_status: "in_progress",
        completed_actions: [...completed, step.key],
        messages: pushMsg(state.messages, msg),
        pendingAction: null,
      });
      return res.json({ step: step.key, status: "done", message: msg, more: true });
    }

    if (built.type === "connection") {
      // Do NOT complete — the step re-runs after the user connects (then it sees
      // the connection and returns an info result that completes it).
      const msg = echoMsg("connection", built.text, { connect: built.connect });
      await persist(userId, {
        activation_status: "in_progress",
        messages: pushMsg(state.messages, msg),
        pendingAction: null,
      });
      return res.json({
        step: step.key,
        status: "needs_connection",
        connect: built.connect,
        message: msg,
        more: false,
      });
    }

    // preview
    const pending = { key: step.key, card: built.card, exec: built.exec, text: built.text };
    const msg = echoMsg("preview", built.text, { card: built.card });
    await persist(userId, {
      activation_status: "in_progress",
      messages: pushMsg(state.messages, msg),
      pendingAction: pending,
    });
    return res.json({
      step: step.key,
      status: "preview",
      pendingAction: sanitizePending(pending),
      message: msg,
      more: false,
    });
  } catch (err) {
    console.error("Echo advance error:", err.message);
    return res.status(500).json({ error: "Echo hit a snag. Please try again." });
  }
}

async function approve(req, res) {
  try {
    const userId = req.user.userId;
    const state = await getOrCreateState(userId);
    const pending = state.pending_action;
    if (!pending) return res.status(400).json({ error: "Nothing is awaiting approval." });
    const completed = arr(state.completed_actions);

    let resultText;
    try {
      resultText = await runExec(userId, pending.exec);
    } catch (err) {
      console.error(`Echo approve "${pending.key}" failed (skipping):`, err.message);
      const msg = echoMsg(
        "info",
        "I hit a problem running that just now — I've noted it and you can retry from the dashboard. Let's keep going.",
      );
      await persist(userId, {
        completed_actions: [...completed, pending.key],
        messages: pushMsg(state.messages, msg),
        pendingAction: null,
      });
      return res.json({ status: "skipped", message: msg, more: true });
    }

    const msg = echoMsg("info", resultText);
    await persist(userId, {
      completed_actions: [...completed, pending.key],
      messages: pushMsg(state.messages, msg),
      pendingAction: null,
    });
    return res.json({ status: "done", message: msg, more: true });
  } catch (err) {
    console.error("Echo approve error:", err.message);
    return res.status(500).json({ error: "Failed to run that action. Please try again." });
  }
}

async function decline(req, res) {
  try {
    const userId = req.user.userId;
    const state = await getOrCreateState(userId);
    const pending = state.pending_action;
    if (!pending) return res.status(400).json({ error: "Nothing is awaiting approval." });
    const completed = arr(state.completed_actions);
    const msg = echoMsg(
      "info",
      "No problem — I'll skip that for now. You can do it any time from your dashboard. Let's keep going.",
    );
    await persist(userId, {
      completed_actions: [...completed, pending.key],
      messages: pushMsg(state.messages, msg),
      pendingAction: null,
    });
    return res.json({ status: "declined", message: msg, more: true });
  } catch (err) {
    console.error("Echo decline error:", err.message);
    return res.status(500).json({ error: "Failed to update. Please try again." });
  }
}

// Voice/typed approval of a pending action ("yes" / "confirm" / "cancel"),
// spoken or typed, instead of clicking. Routine actions run on any affirmation
// ("yes", "go ahead"); high-stakes actions (spending money, sending to
// customers) require the owner to explicitly say "confirm", so a stray "yes"
// can never trigger them. Returns { userMessage, message } when the utterance
// resolved the pending action, or null to fall through to normal chat.
async function resolvePendingAction(userId, state, text) {
  const decision = classifyApprovalUtterance(text);
  const pending = state.pending_action;
  const completed = arr(state.completed_actions);
  if (decision === "decline") {
    const uMsg = userMsg(text);
    const eMsg = echoMsg(
      "info",
      "No problem — I'll skip that for now. You can do it any time from your dashboard.",
    );
    await persist(userId, {
      completed_actions: [...completed, pending.key],
      messages: pushMsg(state.messages, uMsg, eMsg),
      pendingAction: null,
    });
    return { userMessage: uMsg, message: eMsg };
  }
  if (decision === "affirm" || decision === "confirm") {
    const risk = (pending.exec && pending.exec.risk) || "routine";
    if (risk === "high_stakes" && decision !== "confirm") {
      // A plain "yes" isn't enough for a high-stakes action — re-prompt for
      // the explicit word and keep the action pending.
      const reason = (pending.exec && pending.exec.confirmReason) || "is high-impact";
      const uMsg = userMsg(text);
      const eMsg = echoMsg(
        "text",
        `Just to be safe — that one ${reason}. Say "confirm" to run it now, or "cancel" to hold off.`,
      );
      await persist(userId, {
        messages: pushMsg(state.messages, uMsg, eMsg),
        pendingAction: pending,
      });
      return { userMessage: uMsg, message: eMsg };
    }
    // Routine affirmation, or an explicit confirm on a high-stakes action.
    const uMsg = userMsg(text);
    let resultText;
    try {
      resultText = await runExec(userId, pending.exec);
    } catch (execErr) {
      console.error(`Echo voice-approve "${pending.key}" failed (skipping):`, execErr.message);
      const eMsg = echoMsg(
        "info",
        "I hit a problem running that just now — I've noted it and you can retry from the dashboard.",
      );
      await persist(userId, {
        completed_actions: [...completed, pending.key],
        messages: pushMsg(state.messages, uMsg, eMsg),
        pendingAction: null,
      });
      return { userMessage: uMsg, message: eMsg };
    }
    const eMsg = echoMsg("info", resultText);
    await persist(userId, {
      completed_actions: [...completed, pending.key],
      messages: pushMsg(state.messages, uMsg, eMsg),
      pendingAction: null,
    });
    return { userMessage: uMsg, message: eMsg };
  }
  // decision === "none" → the owner said something else; fall through to chat.
  return null;
}

// The AI chat pipeline shared by the JSON and streaming endpoints. When
// `onSentence` is provided, complete sentences are pushed to it AS the model
// streams (so the voice engine can start speaking immediately); the full
// post-processed reply is still persisted and returned either way.
async function runEchoChat(userId, state, text, requestedBrandId, onSentence) {
  {
    // What Echo should call the owner: explicit preference → first name →
    // "Sir" for the platform admin account.
    async function loadOwnerName(id) {
      const r = await db.query(
        `SELECT first_name, preferred_name, role FROM users WHERE user_id = $1`,
        [id]
      );
      const u = r.rows[0];
      if (!u) return null;
      if (u.preferred_name && u.preferred_name.trim()) return u.preferred_name.trim();
      if (u.first_name && u.first_name.trim()) return u.first_name.trim();
      return u.role === "admin" ? "Sir" : null;
    }
    const [brand, businesses, ownerName] = await Promise.all([
      resolveChatBrand(userId, requestedBrandId),
      listBusinesses(userId),
      loadOwnerName(userId),
    ]);
    const isMultiBusiness = businesses.length > 1;

    // Everything Echo remembers about this owner + their key relationships, plus
    // a guardrail so Echo flags requests that conflict with the owner's values.
    const knowledge = await echoContext.buildKnowledgeContext(
      userId,
      brand ? brand.brand_id : null,
      { mode: "chat" },
    );
    const ownerProfile = await echoContext.getOwnerProfileRow(userId);
    const guardrail = echoContext.valuesGuardrail(ownerProfile);

    // Hermes 4 is Echo's reasoning brain: it decides the intent, which teammate
    // owns the request, and how to keep the reply on-topic and brand-locked.
    // Claude still writes the actual reply — the decision just steers it. This
    // is non-breaking: if Hermes is unconfigured/slow/down, decide() returns
    // null and Echo answers exactly as it did before.
    const decision = await echoOrchestrator.decide({
      userId,
      activeBrandName: brand ? brand.brand_name : null,
      businesses,
      pendingAction: state.pending_action || null,
      message: text,
    });
    const orchestration = echoOrchestrator.directiveForPrompt(
      decision,
      brand ? brand.brand_name : null,
    );

    const system = [
      "You are Echo, the AI marketing companion built into Zorecho — an AI marketing platform.",
      isMultiBusiness
        ? `The owner runs ${businesses.length} businesses: ${businesses
            .map((b) => b.brand_name)
            .join(", ")}. This conversation is currently about ${
            brand ? brand.brand_name : "their business"
          }. Keep your answers and any data scoped to that business unless they ask you to switch or compare.`
        : `The user's business is ${brand ? brand.brand_name : "their business"}.`,
      // BRAND LOCK (unconditional, holds even when the Hermes orchestrator is
      // offline and `orchestration` is empty): every reply must stay inside the
      // active brand unless the owner explicitly asks to switch or compare.
      brand
        ? `BRAND LOCK (critical): unless the owner explicitly asks to switch businesses or to compare, EVERY fact, number, name, lead, campaign, alert, and update in your reply must belong to ${brand.brand_name} — NOTHING from any of their other businesses may appear. If you are unsure whether something belongs to ${brand.brand_name}, leave it out.`
        : null,
      `Their activation status is "${state.activation_status}".`,
      state.pending_action
        ? 'There is an action awaiting their approval in the companion panel. They can approve it by clicking, or just tell you "yes" / "go ahead" — but if it is high-stakes (spends money or contacts customers) they must say "confirm".'
        : "There is nothing awaiting their approval right now.",
      "You run their marketing for them: you can launch Facebook ad campaigns, schedule social posts, send email campaigns, and report performance.",
      'The app handles voice navigation for you: when the user says things like "go to Atlas", "show me my leads", or "open Facebook setup", the dashboard navigates instantly on its own. NEVER say you cannot navigate, open pages, or take them somewhere — if they ask to go somewhere, respond as if you are taking them there (e.g. "Taking you to Atlas now.").',
      "Every action you take requires their one-click approval (or a Facebook password) first — if they ask you to do something, tell them you'll prepare a preview for them to approve.",
      'EMAIL ASSISTANT RULE: you can draft emails for the owner (sent from their own connected email account, only after they approve the draft in the Email tab). When the user asks you to write, draft, reply to, or send an email, output as the literal last line of your reply the marker [[EMAIL_DRAFT: recipient || what the email should say]] — recipient is the email address (or the sender\'s name if they said "reply to John"), and after the double pipe put a clear instruction of what to write. Include the double square brackets exactly; the marker is stripped before display. In your visible reply, say you\'re preparing the draft for their approval — NEVER claim an email was sent. Only use this marker for actual email-writing requests.',
      'CRITICAL FEATURE-REQUEST RULE: if the user asks you to DO something the platform cannot do yet (any capability outside ads, social posts, email campaigns, reminders/tasks, reporting, and navigation — e.g. "post to TikTok", "sync with QuickBooks", "book me a flight"), NEVER dead-end with a flat "I cannot do that". Instead you MUST do BOTH of these: (1) acknowledge it warmly as a good idea, and (2) output, as the literal last line of your reply, the marker [[FEATURE_REQUEST: short description of what they asked for]] — including the double square brackets exactly. The marker is MANDATORY, not optional: the platform parses it to record the request for the development team, and omitting it silently discards the user\'s idea. The user never sees the marker (it is stripped before display), so always include it. Do NOT claim the suggestion has been noted or logged — the system appends that confirmation itself. Only use the marker when they asked you to perform an unsupported action; never for questions, chit-chat, or things you CAN do.',
      ownerName
        ? `The owner likes to be addressed as "${ownerName}". Use their name naturally and sparingly — at key moments like delivering important news, asking a question, or celebrating a win — never in every sentence.`
        : null,
      "Be warm, concise, and action-oriented. Keep replies to 1-3 short sentences. Never invent results or data.",
      orchestration || null,
      knowledge,
      guardrail,
    ]
      .filter(Boolean)
      .join(" ");

    const params = {
      model: MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: text }],
    };
    let reply;
    // Raw prefix of the reply already pushed to `onSentence`, so the tail of
    // the post-processed reply (marker confirmations) can be emitted without
    // double-speaking what already played.
    let rawEmitted = "";
    try {
      if (onSentence) {
        // Stream: flush complete sentences as they arrive so the voice engine
        // starts speaking while the rest of the reply is still generating.
        // Emission halts the moment a "[[" marker starts — markers (and any
        // appended confirmations) are resolved on the full text afterwards.
        let buf = "";
        let halted = false;
        const flushSentences = () => {
          for (;;) {
            const m = buf.match(/[.!?]["')\]]*\s+/);
            if (!m) break;
            const end = m.index + m[0].length;
            const sentence = buf.slice(0, end);
            rawEmitted += sentence;
            buf = buf.slice(end);
            const spoken = sentence.trim();
            if (spoken) onSentence(spoken);
          }
        };
        reply = await streamMessage(params, { label: "Echo chat (stream)" }, (piece) => {
          if (halted) return;
          buf += piece;
          const mk = buf.indexOf("[[");
          if (mk !== -1) {
            buf = buf.slice(0, mk);
            flushSentences();
            halted = true;
            return;
          }
          flushSentences();
        });
      } else {
        const resp = await createMessage(params, { label: "Echo chat" });
        reply = extractText(resp);
      }
    } catch (err) {
      const e = new Error("Echo's assistant is temporarily unavailable. Please try again in a moment.");
      e.statusCode = 502;
      throw e;
    }
    if (!reply) {
      const e = new Error("Echo didn't get a response. Please try again.");
      e.statusCode = 502;
      throw e;
    }

    // Feature-suggestion capture: the prompt has Echo tag unsupported requests
    // with [[FEATURE_REQUEST: ...]]. Strip the marker, log the request, and
    // append the "noted" confirmation ONLY when logging really succeeded —
    // Echo never falsely claims a suggestion was recorded.
    const featureMatch = reply.match(/\[\[FEATURE_REQUEST:\s*([\s\S]*?)\]\]/);
    if (featureMatch) {
      reply = reply.replace(/\s*\[\[FEATURE_REQUEST:[\s\S]*?\]\]\s*/g, " ").trim();
      const summary = featureMatch[1].trim() || text;
      try {
        // Store the user's verbatim ask; the AI summary just guides dedup.
        await featureSuggestions.logFeatureSuggestion(userId, text, summary);
        const address = ownerName ? `, ${ownerName}` : "";
        reply = `${reply} I've noted that suggestion${address} — if enough people ask for the same thing, it moves to the top of the development priority list.`.trim();
      } catch (logErr) {
        // Honest failure: keep the warm acknowledgment, skip the "noted" claim.
        console.error("Feature suggestion logging failed:", logErr.message);
      }
      if (!reply) {
        reply = "That's not something I can do just yet — but I think it's a great idea.";
      }
    }

    // Email-draft capture: the prompt has Echo tag email-writing requests with
    // [[EMAIL_DRAFT: recipient || instruction]]. Strip the marker, create a
    // pending draft (never sent without approval), and confirm ONLY on success.
    const emailMatch = reply.match(/\[\[EMAIL_DRAFT:\s*([\s\S]*?)\]\]/);
    if (emailMatch) {
      reply = reply.replace(/\s*\[\[EMAIL_DRAFT:[\s\S]*?\]\]\s*/g, " ").trim();
      const raw = emailMatch[1];
      const sep = raw.indexOf("||");
      const recipient = (sep >= 0 ? raw.slice(0, sep) : raw).trim();
      const instruction = (sep >= 0 ? raw.slice(sep + 2) : "").trim() || text;
      try {
        const draftInfo = await createEchoEmailDraft(userId, recipient, instruction);
        reply =
          `${reply} Your draft to ${draftInfo.toName || draftInfo.toAddress} is ready in the Email tab — ` +
          `nothing goes out until you approve it.`.trim();
      } catch (draftErr) {
        console.error("Echo email draft failed:", draftErr.message);
        reply = `${reply} ${draftErr.friendly || "I couldn't prepare that draft just now — you can also compose it from the Email tab."}`.trim();
      }
      if (!reply) reply = "I'll get that email drafted for your approval.";
    }

    // Streamed replies: speak whatever the final post-processed reply added
    // beyond the sentences already emitted (the un-flushed tail, plus any
    // marker confirmation text). Prefix-match against the raw emitted text so
    // nothing is ever double-spoken; if the prefix no longer matches (marker
    // stripping reshaped the start — rare), skip rather than risk repeats.
    if (onSentence) {
      const prefix = rawEmitted.trimEnd();
      let leftover = null;
      if (!prefix) leftover = reply;
      else if (reply.startsWith(prefix)) leftover = reply.slice(prefix.length).trim();
      if (leftover) onSentence(leftover);
    }

    const uMsg = userMsg(text);
    const eMsg = echoMsg("text", reply);
    await persist(userId, {
      messages: pushMsg(state.messages, uMsg, eMsg),
      pendingAction: state.pending_action || null,
    });

    // Remember the exchange and learn durable facts from it — fire-and-forget so
    // the reply is never delayed and a capture failure never breaks the chat.
    echoContext
      .captureFromConversation(userId, brand ? brand.brand_id : null, text, reply)
      .catch((e) => console.error("Echo capture (background) failed:", e.message));

    return { userMessage: uMsg, message: eMsg };
  }
}

async function sendMessage(req, res) {
  try {
    const userId = req.user.userId;
    const text = req.body && typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "Please enter a message." });

    const state = await getOrCreateState(userId);
    if (state.pending_action) {
      const resolved = await resolvePendingAction(userId, state, text);
      if (resolved) return res.json(resolved);
    }
    const requestedBrandId =
      req.body && typeof req.body.brandId === "string" && req.body.brandId.trim()
        ? req.body.brandId.trim()
        : null;
    const result = await runEchoChat(userId, state, text, requestedBrandId, null);
    return res.json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Echo sendMessage error:", err.message);
    return res.status(status).json({ error: err.message || "Echo couldn't reply." });
  }
}

// Streaming variant of sendMessage for the voice engine. Responds with NDJSON:
//   { s: "sentence" }                       — speak this sentence now
//   { done: true, userMessage, message }    — final persisted messages
//   { error: "..." }                        — terminal failure mid-stream
// Same pipeline, same persistence, same markers — only the transport differs,
// so Echo starts speaking the first sentence while the rest still generates.
async function sendMessageStream(req, res) {
  try {
    const userId = req.user.userId;
    const text = req.body && typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "Please enter a message." });

    const state = await getOrCreateState(userId);

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    const send = (obj) => {
      res.write(`${JSON.stringify(obj)}\n`);
      if (typeof res.flush === "function") res.flush();
    };

    if (state.pending_action) {
      const resolved = await resolvePendingAction(userId, state, text);
      if (resolved) {
        send({ done: true, userMessage: resolved.userMessage, message: resolved.message });
        return res.end();
      }
    }
    const requestedBrandId =
      req.body && typeof req.body.brandId === "string" && req.body.brandId.trim()
        ? req.body.brandId.trim()
        : null;
    const result = await runEchoChat(userId, state, text, requestedBrandId, (s) => send({ s }));
    send({ done: true, userMessage: result.userMessage, message: result.message });
    return res.end();
  } catch (err) {
    console.error("Echo sendMessageStream error:", err.message);
    const message = err.message || "Echo couldn't reply.";
    if (res.headersSent) {
      try {
        res.write(`${JSON.stringify({ error: message })}\n`);
      } catch {
        /* connection already gone */
      }
      return res.end();
    }
    return res.status(err.statusCode || 500).json({ error: message });
  }
}

// Reuse the existing Whisper transcription controller (multipart audio → { text }).
const transcribe = voiceController.transcribeSpeech;

async function briefing(req, res) {
  try {
    const userId = req.user.userId;
    const brand = await getBrand(userId);
    const state = await getOrCreateState(userId);

    const countSafe = async (sql, params) => {
      try {
        const r = await db.query(sql, params);
        return Number(r.rows[0] && r.rows[0].n) || 0;
      } catch (_e) {
        return 0;
      }
    };

    const campaigns = await countSafe("SELECT COUNT(*)::int AS n FROM campaigns WHERE user_id = $1", [
      userId,
    ]);
    const scheduledPosts = brand
      ? await countSafe(
          `SELECT COUNT(*)::int AS n FROM social_posts sp
           JOIN content_calendars c ON sp.calendar_id = c.calendar_id
           WHERE c.brand_id = $1 AND sp.status = 'scheduled'`,
          [brand.brand_id],
        )
      : 0;
    const newLeads = brand
      ? await countSafe(
          `SELECT COUNT(*)::int AS n FROM leads
           WHERE brand_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
          [brand.brand_id],
        )
      : 0;
    const pending = state.pending_action ? 1 : 0;

    const text =
      `Here's your briefing: ${campaigns} ad campaign${campaigns === 1 ? "" : "s"} set up, ` +
      `${scheduledPosts} social post${scheduledPosts === 1 ? "" : "s"} scheduled, and ` +
      `${newLeads} new lead${newLeads === 1 ? "" : "s"} in the last 7 days. ` +
      (pending
        ? "You have 1 item waiting for your approval below."
        : "Nothing needs your approval right now.");

    const msg = echoMsg("briefing", text, {
      card: { kind: "briefing", stats: { campaigns, scheduledPosts, newLeads, pending } },
    });
    await persist(userId, {
      messages: pushMsg(state.messages, msg),
      pendingAction: state.pending_action || null,
    });
    return res.json({
      message: msg,
      briefing: { text, stats: { campaigns, scheduledPosts, newLeads, pending } },
    });
  } catch (err) {
    console.error("Echo briefing error:", err.message);
    return res.status(500).json({ error: "Failed to build your briefing. Please try again." });
  }
}

module.exports = {
  getState,
  advance,
  approve,
  decline,
  sendMessage,
  sendMessageStream,
  transcribe,
  briefing,
};
