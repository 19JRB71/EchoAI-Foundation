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
const { createMessage, MODEL } = require("../config/anthropic");

const adCreativeStudioController = require("./adCreativeStudioController");
const campaignController = require("./campaignController");
const contentCalendarController = require("./contentCalendarController");
const voiceController = require("./voiceController");

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
    `SELECT brand_id, brand_name FROM brands WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
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
        exec: { action: "launch_campaign", creativeId: creative.creative_id, budget: DEFAULT_DAILY_BUDGET },
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
        exec: { action: "activate_calendar", calendarId },
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
    const brand = await getBrand(userId);
    return res.json({
      activationStatus: state.activation_status,
      mode: modeFor(state),
      messages: arr(state.messages),
      pendingAction: sanitizePending(state.pending_action),
      brandName: brand ? brand.brand_name : null,
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

async function sendMessage(req, res) {
  try {
    const userId = req.user.userId;
    const text = req.body && typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "Please enter a message." });

    const state = await getOrCreateState(userId);
    const brand = await getBrand(userId);

    const system = [
      "You are Echo, the AI marketing companion built into EchoAI — an AI marketing platform.",
      `The user's business is ${brand ? brand.brand_name : "their business"}.`,
      `Their activation status is "${state.activation_status}".`,
      state.pending_action
        ? "There is an action awaiting their one-click approval in the companion panel."
        : "There is nothing awaiting their approval right now.",
      "You run their marketing for them: you can launch Facebook ad campaigns, schedule social posts, send email campaigns, and report performance.",
      "Every action you take requires their one-click approval (or a Facebook password) first — if they ask you to do something, tell them you'll prepare a preview for them to approve.",
      "Be warm, concise, and action-oriented. Keep replies to 1-3 short sentences. Never invent results or data.",
    ].join(" ");

    let reply;
    try {
      const resp = await createMessage(
        { model: MODEL, max_tokens: 400, system, messages: [{ role: "user", content: text }] },
        { label: "Echo chat" },
      );
      reply = extractText(resp);
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

    const uMsg = userMsg(text);
    const eMsg = echoMsg("text", reply);
    await persist(userId, {
      messages: pushMsg(state.messages, uMsg, eMsg),
      pendingAction: state.pending_action || null,
    });
    return res.json({ userMessage: uMsg, message: eMsg });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Echo sendMessage error:", err.message);
    return res.status(status).json({ error: err.message || "Echo couldn't reply." });
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
  transcribe,
  briefing,
};
