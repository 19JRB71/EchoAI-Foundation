const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { anthropic, MODEL } = require("../config/anthropic");
const { SETUP_AGENT_SYSTEM_PROMPT } = require("../prompts/setupAgentPrompt");
const { getUserTier } = require("../middleware/featureGate");
const { FEATURES, meetsTier } = require("../config/tiers");

const brandDiscoveryController = require("../controllers/brandDiscoveryController");
const appointmentController = require("../controllers/appointmentController");
const contentCalendarController = require("../controllers/contentCalendarController");
const adCreativeStudioController = require("../controllers/adCreativeStudioController");
const emailMarketingController = require("../controllers/emailMarketingController");
const feedbackController = require("../controllers/feedbackController");

// ---------------------------------------------------------------------------
// AI helpers (real Anthropic; malformed output → 502, never guessed)
// ---------------------------------------------------------------------------

function extractText(response) {
  return (response.content || [])
    .map((block) => block.text || "")
    .join("")
    .trim();
}

function upstreamError(message) {
  const err = new Error(message);
  err.statusCode = 502;
  return err;
}

/**
 * Given the interview transcript so far, ask the AI for the next question (or a
 * completion signal). Returns a validated { message, suggestion, collects,
 * complete } object.
 */
async function askInterview(messages) {
  let response;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SETUP_AGENT_SYSTEM_PROMPT,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
  } catch (err) {
    throw upstreamError(
      "The AI provider could not continue the setup interview right now. Please try again shortly.",
    );
  }

  const text = extractText(response);
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw upstreamError("The setup agent returned an unreadable response. Please try again.");
  }

  if (
    !parsed ||
    typeof parsed.message !== "string" ||
    parsed.message.trim() === "" ||
    typeof parsed.complete !== "boolean"
  ) {
    throw upstreamError("The setup agent returned an incomplete response. Please try again.");
  }

  return {
    message: parsed.message.trim(),
    suggestion: typeof parsed.suggestion === "string" ? parsed.suggestion.trim() : "",
    collects: typeof parsed.collects === "string" ? parsed.collects.trim() : "",
    complete: parsed.complete === true,
  };
}

// ---------------------------------------------------------------------------
// In-process controller invocation (synthetic req/res), mirroring
// voiceController.invokeChatbot so the exact same pipelines are reused.
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

/** Throws (propagating status) when an invoked controller returned an error. */
function ensureOk(result, fallbackMessage) {
  if (result.statusCode >= 200 && result.statusCode < 300) return result.payload;
  const err = new Error((result.payload && result.payload.error) || fallbackMessage);
  err.statusCode = result.statusCode;
  throw err;
}

// ---------------------------------------------------------------------------
// Answer interpretation helpers (resilient to whatever keys the AI chose)
// ---------------------------------------------------------------------------

function answersBlob(answers) {
  return Object.values(answers || {})
    .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
    .join(" \n ")
    .toLowerCase();
}

function firstAnswer(answers, keySubstrings) {
  for (const [k, v] of Object.entries(answers || {})) {
    if (typeof v !== "string" || !v.trim()) continue;
    if (keySubstrings.some((s) => k.toLowerCase().includes(s))) return v.trim();
  }
  return "";
}

function pickPlatforms(answers) {
  const blob = answersBlob(answers);
  const supported = ["facebook", "instagram", "tiktok", "linkedin", "twitter", "youtube"];
  const found = supported.filter((p) => blob.includes(p));
  return found.length > 0 ? found : ["facebook", "instagram"];
}

function pickFrequency(answers) {
  const blob = answersBlob(answers);
  if (blob.includes("daily") || blob.includes("every day")) return "daily";
  if (blob.includes("five") || blob.includes("5 ") || blob.includes("5x")) return "five_per_week";
  return "three_per_week";
}

function pickCampaignGoal(answers) {
  const blob = answersBlob(answers);
  if (blob.includes("sale") || blob.includes("revenue")) return "sales";
  if (blob.includes("aware")) return "brand_awareness";
  if (blob.includes("traffic") || blob.includes("visit")) return "traffic";
  if (blob.includes("engage")) return "engagement";
  return "lead_generation";
}

function compiledBusinessSummary(answers) {
  const lines = Object.entries(answers || {})
    .filter(([, v]) => (typeof v === "string" ? v.trim() : v != null))
    .map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  return [
    "Here is everything I want you to know about my business, gathered from a setup interview. Use it to build my brand profile:",
    ...lines,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Setup action runner. Each action is atomic + idempotent (completed steps are
// recorded so re-runs skip finished work) and tier-gated (gated actions are
// skipped gracefully for lower tiers).
// ---------------------------------------------------------------------------

const DEFAULT_WEEKLY_HOURS = [1, 2, 3, 4, 5].map((day) => ({
  day,
  start: "09:00",
  end: "17:00",
}));

async function reloadSession(sessionId) {
  const { rows } = await db.query("SELECT * FROM setup_sessions WHERE session_id = $1", [sessionId]);
  return rows[0];
}

// Persist completed_steps for an in-flight run, but ONLY while the session is
// still 'in_progress'. A concurrent /pause or /dismiss (which flip status with a
// plain UPDATE that does not consult the execution lease) may commit while this
// step is genuinely mid-run; the status guard makes this write a no-op in that
// case so an in-flight step can never clobber a lifecycle change the user just
// made. Returns the updated row, or null when the session is no longer runnable.
async function writeCompletedSteps(sessionId, completed) {
  const { rows } = await db.query(
    `UPDATE setup_sessions SET completed_steps = $1::jsonb, updated_at = NOW()
       WHERE session_id = $2 AND status = 'in_progress'
       RETURNING *`,
    [JSON.stringify(completed), sessionId],
  );
  return rows[0] || null;
}

// Uniform response when a lifecycle change (pause/dismiss) raced an in-flight
// step and won: report the session's real current state instead of pretending
// the step advanced the run. 409 = the execute conflicted with that change.
async function respondCancelledMidStep(res, sessionId) {
  const current = await reloadSession(sessionId);
  return res.status(409).json({
    error: "This setup session was paused or dismissed while a step was running.",
    session: serializeSession(current),
  });
}

/**
 * Ordered action definitions. `feature` (a key in config/tiers FEATURES) gates the
 * action; null means baseline (available on every paid plan). Each `run` returns
 * { status: 'done'|'skipped', detail }.
 */
const ACTIONS = [
  {
    key: "create_brand_profile",
    label: "Creating your brand & profile",
    feature: null,
    async run({ userId, session, answers }) {
      if (session.brand_id) {
        return { status: "done", detail: "Your brand is already set up." };
      }
      // Crash-replay safety: this is the first action and it has an external side
      // effect (brand creation). We persist the brand-discovery session id BEFORE
      // confirming, so a retry after a crash can recover the already-created brand
      // (via the discovery row's brand_id) instead of creating a duplicate.
      let discoverySessionId = session.discovery_session_id || null;
      if (discoverySessionId) {
        const prior = await db.query(
          "SELECT brand_id FROM brand_discovery_sessions WHERE session_id = $1 AND user_id = $2",
          [discoverySessionId, userId],
        );
        const recoveredBrandId = prior.rows[0] && prior.rows[0].brand_id;
        if (recoveredBrandId) {
          await db.query("UPDATE setup_sessions SET brand_id = $1 WHERE session_id = $2", [
            recoveredBrandId,
            session.session_id,
          ]);
          session.brand_id = recoveredBrandId;
          return { status: "done", detail: "Your brand profile is already set up." };
        }
      } else {
        // Seed a brand-discovery session with the interview answers, then run the
        // existing discovery confirm path so the brand + full profile are created
        // through the exact same synthesis pipeline the UI uses.
        const seeded = [{ role: "user", content: compiledBusinessSummary(answers) }];
        const { rows } = await db.query(
          `INSERT INTO brand_discovery_sessions (user_id, brand_id, messages)
           VALUES ($1, NULL, $2::jsonb)
           RETURNING session_id`,
          [userId, JSON.stringify(seeded)],
        );
        discoverySessionId = rows[0].session_id;
        await db.query(
          "UPDATE setup_sessions SET discovery_session_id = $1 WHERE session_id = $2",
          [discoverySessionId, session.session_id],
        );
        session.discovery_session_id = discoverySessionId;
      }

      const result = await invoke(brandDiscoveryController.discovery, userId, {
        body: { sessionId: discoverySessionId, confirm: true },
      });
      const payload = ensureOk(result, "Failed to create your brand profile.");
      const brand = payload.brand;
      if (!brand || !brand.brand_id) {
        throw upstreamError("The brand profile could not be created. Please try again.");
      }

      await db.query("UPDATE setup_sessions SET brand_id = $1 WHERE session_id = $2", [
        brand.brand_id,
        session.session_id,
      ]);
      session.brand_id = brand.brand_id;
      return {
        status: "done",
        detail: `Created "${brand.brand_name}" with a full brand profile.`,
      };
    },
  },

  {
    key: "set_availability",
    label: "Setting your booking availability",
    feature: "appointments",
    async run({ userId, session, answers }) {
      if (!session.brand_id) return { status: "skipped", detail: "No brand to configure yet." };
      const timezone = firstAnswer(answers, ["timezone", "time_zone"]) || "America/New_York";
      const durationRaw = firstAnswer(answers, ["duration", "appointment"]);
      const parsedDuration = parseInt(durationRaw, 10);
      const slotDurationMinutes =
        Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 30;

      const result = await invoke(appointmentController.saveAvailabilityConfig, userId, {
        params: { brandId: session.brand_id },
        body: {
          timezone,
          slotDurationMinutes,
          bufferMinutes: 0,
          weeklyHours: DEFAULT_WEEKLY_HOURS,
        },
      });
      ensureOk(result, "Failed to set your availability.");
      return {
        status: "done",
        detail: `Set weekday hours (9–5) with ${slotDurationMinutes}-minute appointments.`,
      };
    },
  },

  {
    key: "connect_google",
    label: "Connecting Google Calendar",
    feature: null,
    async run({ userId }) {
      // OAuth is user-driven by design — we never capture Google credentials. We
      // only report whether it's already connected; the UI hands off to Google's
      // own consent screen when it isn't.
      try {
        const { rows } = await db.query(
          "SELECT 1 FROM google_integrations WHERE user_id = $1 AND connection_status = 'connected'",
          [userId],
        );
        if (rows.length > 0) {
          return { status: "done", detail: "Google Calendar is connected." };
        }
      } catch (err) {
        // Table/shape surprise — degrade to a connection handoff rather than fail.
      }
      return {
        status: "needs_connection",
        connect: "google",
        detail: "Connect Google Calendar so EchoAI can sync your bookings.",
      };
    },
  },

  {
    key: "content_calendar",
    label: "Building your content calendar",
    feature: "content_calendar",
    async run({ userId, session, answers }) {
      if (!session.brand_id) return { status: "skipped", detail: "No brand to configure yet." };
      // Idempotency: if a calendar already exists for this brand (e.g. a retry
      // after a crash between the side effect and the completed-steps write), don't
      // create a duplicate.
      const existingCal = await db.query(
        "SELECT 1 FROM content_calendars WHERE brand_id = $1 LIMIT 1",
        [session.brand_id],
      );
      if (existingCal.rows.length > 0) {
        return { status: "done", detail: "Your content calendar is already set up." };
      }
      const postingFrequency = pickFrequency(answers);
      const platforms = pickPlatforms(answers);
      const contentTheme =
        firstAnswer(answers, ["theme", "content"]) ||
        firstAnswer(answers, ["goal"]) ||
        "Brand awareness and lead generation";
      const businessType = firstAnswer(answers, ["business", "offering", "product", "service"]);

      const genResult = await invoke(contentCalendarController.generateCalendar, userId, {
        body: { brandId: session.brand_id, postingFrequency, platforms, contentTheme, businessType },
      });
      const gen = ensureOk(genResult, "Failed to generate your content calendar.");
      if (!Array.isArray(gen.posts) || gen.posts.length === 0) {
        throw upstreamError("The content calendar came back empty. Please try again.");
      }

      const saveResult = await invoke(contentCalendarController.saveCalendar, userId, {
        body: { brandId: session.brand_id, postingFrequency, contentTheme, posts: gen.posts },
      });
      ensureOk(saveResult, "Failed to save your content calendar.");
      return {
        status: "done",
        detail: `Drafted ${gen.posts.length} posts across ${platforms.join(", ")}.`,
      };
    },
  },

  {
    key: "ad_creatives",
    label: "Generating your first ad creatives",
    feature: "ad_studio",
    async run({ userId, session, answers }) {
      if (!session.brand_id) return { status: "skipped", detail: "No brand to configure yet." };
      // Idempotency: don't regenerate creatives if this brand already has some.
      const existingCreatives = await db.query(
        "SELECT 1 FROM ad_creatives WHERE brand_id = $1 LIMIT 1",
        [session.brand_id],
      );
      if (existingCreatives.rows.length > 0) {
        return { status: "done", detail: "Your ad creatives are already generated." };
      }
      const campaignGoal = pickCampaignGoal(answers);
      const budgetRange = firstAnswer(answers, ["budget"]);
      const productFocus = firstAnswer(answers, ["product", "offering", "focus", "service"]);

      const genResult = await invoke(adCreativeStudioController.generateCreatives, userId, {
        body: { brandId: session.brand_id, campaignGoal, budgetRange, productFocus },
      });
      const gen = ensureOk(genResult, "Failed to generate ad creatives.");
      if (!Array.isArray(gen.packages) || gen.packages.length === 0) {
        throw upstreamError("The ad creatives came back empty. Please try again.");
      }

      const saveResult = await invoke(adCreativeStudioController.saveCreative, userId, {
        body: {
          brandId: session.brand_id,
          campaignGoal,
          packages: gen.packages,
          budgetRange,
          productFocus,
        },
      });
      ensureOk(saveResult, "Failed to save ad creatives.");
      return {
        status: "done",
        detail: `Generated ${gen.packages.length} ad creative packages.`,
      };
    },
  },

  {
    key: "social_schedule",
    label: "Scheduling your social posts",
    feature: null,
    async run({ userId, session }) {
      if (!session.brand_id) return { status: "skipped", detail: "No brand to configure yet." };
      // Activate the most recent draft calendar (flips its draft posts to
      // scheduled). If none exists (lower tier skipped the calendar), skip gracefully.
      let calendarId = null;
      try {
        const { rows } = await db.query(
          `SELECT calendar_id FROM content_calendars
           WHERE brand_id = $1 AND status = 'draft'
           ORDER BY created_at DESC LIMIT 1`,
          [session.brand_id],
        );
        calendarId = rows[0] && rows[0].calendar_id;
      } catch (err) {
        // fall through to skip
      }
      if (!calendarId) {
        return {
          status: "skipped",
          detail: "Add a content calendar (Professional plan) to schedule posts.",
        };
      }
      const result = await invoke(contentCalendarController.activateCalendar, userId, {
        body: { calendarId },
      });
      ensureOk(result, "Failed to schedule your posts.");
      return { status: "done", detail: "Your drafted posts are now scheduled." };
    },
  },

  {
    key: "email_preferences",
    label: "Setting up your email campaigns",
    feature: "email_marketing",
    async run({ userId, session, answers }) {
      if (!session.brand_id) return { status: "skipped", detail: "No brand to configure yet." };
      // Idempotency: don't recreate the welcome series if one already exists.
      const existingSeries = await db.query(
        `SELECT 1 FROM email_marketing_campaigns
         WHERE brand_id = $1 AND campaign_name = 'Welcome Series' LIMIT 1`,
        [session.brand_id],
      );
      if (existingSeries.rows.length > 0) {
        return { status: "done", detail: "Your welcome email series is already set up." };
      }
      const goal =
        firstAnswer(answers, ["email"]) ||
        firstAnswer(answers, ["goal"]) ||
        "Welcome and nurture new leads";

      const genResult = await invoke(emailMarketingController.generateDripSequence, userId, {
        body: { brandId: session.brand_id, goal, audienceSegment: "all", numEmails: 3 },
      });
      const gen = ensureOk(genResult, "Failed to design your welcome emails.");
      if (!Array.isArray(gen.emails) || gen.emails.length < 2) {
        throw upstreamError("The welcome email sequence came back empty. Please try again.");
      }

      const saveResult = await invoke(emailMarketingController.createDripSequence, userId, {
        body: {
          brandId: session.brand_id,
          campaignName: "Welcome Series",
          goal,
          segment: "all",
          emails: gen.emails,
        },
      });
      ensureOk(saveResult, "Failed to save your welcome email sequence.");
      return { status: "done", detail: `Created a ${gen.emails.length}-email welcome series.` };
    },
  },

  {
    key: "create_survey",
    label: "Designing your first customer survey",
    feature: "feedback",
    async run({ userId, session }) {
      if (!session.brand_id) return { status: "skipped", detail: "No brand to configure yet." };
      // Idempotency: don't create a duplicate survey on a retry after a crash
      // between the side effect and the completed-steps write.
      const existingSurvey = await db.query(
        "SELECT 1 FROM surveys WHERE brand_id = $1 LIMIT 1",
        [session.brand_id],
      );
      if (existingSurvey.rows.length > 0) {
        return { status: "done", detail: "Your customer survey is already set up." };
      }

      const result = await invoke(feedbackController.createSurvey, userId, {
        body: { brandId: session.brand_id, surveyType: "general" },
      });
      const payload = ensureOk(result, "Failed to design your customer survey.");
      const survey = payload.survey;
      if (!survey || !Array.isArray(survey.questions) || survey.questions.length === 0) {
        throw upstreamError("The customer survey came back empty. Please try again.");
      }
      return {
        status: "done",
        detail: `Designed a ${survey.questions.length}-question customer satisfaction survey.`,
      };
    },
  },
];

function actionMeta() {
  return ACTIONS.map((a) => ({ key: a.key, label: a.label }));
}

// ---------------------------------------------------------------------------
// Session serialization
// ---------------------------------------------------------------------------

function serializeSession(session) {
  return {
    sessionId: session.session_id,
    status: session.status,
    answers: session.answers || {},
    completedSteps: session.completed_steps || [],
    currentField: session.current_field,
    interviewComplete: session.interview_complete,
    consentGranted: session.consent_granted,
    brandId: session.brand_id,
    steps: actionMeta(),
  };
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/setup-agent/session
 * Resumes the caller's active session if one exists; otherwise starts a fresh one
 * and returns the agent's first question.
 */
async function initiateSession(req, res) {
  const userId = req.user.userId;
  try {
    const existing = await db.query(
      `SELECT * FROM setup_sessions
       WHERE user_id = $1 AND status IN ('in_progress', 'paused')
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    if (existing.rows.length > 0) {
      // Resuming an existing run: stamp resumed_at and clear any paused state so
      // the lifecycle (started/paused/resumed) reflects reality.
      const resumed = await db.query(
        `UPDATE setup_sessions
           SET status = 'in_progress', resumed_at = NOW(), updated_at = NOW()
         WHERE session_id = $1
         RETURNING *`,
        [existing.rows[0].session_id],
      );
      const session = resumed.rows[0];
      const messages = Array.isArray(session.messages) ? session.messages : [];
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      let firstQuestion = null;
      if (lastAssistant) {
        try {
          firstQuestion = JSON.parse(lastAssistant.content);
        } catch (err) {
          firstQuestion = null;
        }
      }
      return res.json({
        session: serializeSession(session),
        question: firstQuestion,
        resumed: true,
      });
    }

    // New session — seed a kickoff turn and get the opening question.
    const kickoff = [
      { role: "user", content: "Please begin the setup interview with your first question." },
    ];
    const decision = await askInterview(kickoff);
    const messages = kickoff.concat([{ role: "assistant", content: JSON.stringify(decision) }]);

    const inserted = await db.query(
      `INSERT INTO setup_sessions (user_id, messages, current_field, interview_complete)
       VALUES ($1, $2::jsonb, $3, $4)
       RETURNING *`,
      [userId, JSON.stringify(messages), decision.collects || null, decision.complete],
    );
    const session = inserted.rows[0];
    return res.json({ session: serializeSession(session), question: decision, resumed: false });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Setup agent initiate error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to start the setup agent" });
  }
}

/**
 * POST /api/setup-agent/answer  { sessionId, answer }
 * Records the answer, asks the AI for the next question (or completion), and
 * returns it.
 */
async function submitAnswer(req, res) {
  const userId = req.user.userId;
  const { sessionId, answer } = req.body;
  if (!sessionId || typeof answer !== "string" || answer.trim() === "") {
    return res.status(400).json({ error: "sessionId and a non-empty answer are required" });
  }

  try {
    const result = await db.query(
      "SELECT * FROM setup_sessions WHERE session_id = $1 AND user_id = $2",
      [sessionId, userId],
    );
    const session = result.rows[0];
    if (!session) return res.status(404).json({ error: "Setup session not found" });
    if (session.status === "completed" || session.status === "dismissed") {
      return res.status(409).json({ error: "This setup session is already finished" });
    }
    if (session.interview_complete) {
      return res.status(409).json({ error: "The interview is already complete" });
    }

    const messages = Array.isArray(session.messages) ? session.messages : [];
    const answers = session.answers && typeof session.answers === "object" ? session.answers : {};

    if (session.current_field) {
      answers[session.current_field] = answer.trim();
    } else {
      answers[`answer_${Object.keys(answers).length + 1}`] = answer.trim();
    }

    messages.push({ role: "user", content: answer.trim() });
    const decision = await askInterview(messages);
    messages.push({ role: "assistant", content: JSON.stringify(decision) });

    const updated = await db.query(
      `UPDATE setup_sessions
         SET messages = $1::jsonb, answers = $2::jsonb, current_field = $3,
             interview_complete = $4, updated_at = NOW()
       WHERE session_id = $5
       RETURNING *`,
      [
        JSON.stringify(messages),
        JSON.stringify(answers),
        decision.complete ? null : decision.collects || null,
        decision.complete,
        sessionId,
      ],
    );

    return res.json({ session: serializeSession(updated.rows[0]), question: decision });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Setup agent answer error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to process your answer" });
  }
}

/**
 * POST /api/setup-agent/consent  { sessionId }
 * Records the explicit in-app consent required before any setup action runs.
 */
async function grantConsent(req, res) {
  const userId = req.user.userId;
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
  try {
    const result = await db.query(
      `UPDATE setup_sessions
         SET consent_granted = TRUE, consent_at = NOW(), updated_at = NOW()
       WHERE session_id = $1 AND user_id = $2
         AND status NOT IN ('completed', 'dismissed')
       RETURNING *`,
      [sessionId, userId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Active setup session not found" });
    }
    return res.json({ session: serializeSession(result.rows[0]) });
  } catch (err) {
    console.error("Setup agent consent error:", err.message);
    return res.status(500).json({ error: "Failed to record consent" });
  }
}

// ---------------------------------------------------------------------------
// Concurrency: renewable execution lease
// ---------------------------------------------------------------------------
// The /execute endpoint runs one setup action per call. Only one call may run a
// step for a given session at a time. We use a compare-and-swap "executing" claim
// backed by a renewable lease: while a step runs the lease is heartbeated, so a
// legitimately slow step (e.g. an unusually slow AI/provider call that exceeds the
// lease window) is never reclaimed out from under it. Only a truly dead claim —
// one whose lease expired with no heartbeat, i.e. a crashed process — becomes
// reclaimable, so a session can never deadlock permanently either.

// A held claim whose executing_at is older than this (no heartbeat) is dead and
// reclaimable. The heartbeat interval must be comfortably smaller than this.
const EXECUTION_LEASE_SECONDS = 300;
const EXECUTION_HEARTBEAT_MS = 60 * 1000;

// Atomically claim the execution slot. Returns a per-claim fencing token if the
// caller now holds the lease, or null if another live lease blocks it. The token
// must be presented to heartbeat/release so only the current owner can affect it.
async function claimExecution(sessionId) {
  const token = crypto.randomUUID();
  const claim = await db.query(
    `UPDATE setup_sessions SET executing = TRUE, executing_at = NOW(), executing_token = $3
       WHERE session_id = $1
         AND (executing = FALSE OR executing_at < NOW() - ($2 || ' seconds')::interval)
       RETURNING session_id`,
    [sessionId, String(EXECUTION_LEASE_SECONDS), token],
  );
  return claim.rows.length > 0 ? token : null;
}

// Refresh the lease we currently hold. Guarded on the fencing token so it can only
// refresh the lease this caller owns — never a released or reclaimed one.
async function heartbeatExecution(sessionId, token) {
  await db.query(
    "UPDATE setup_sessions SET executing_at = NOW() WHERE session_id = $1 AND executing = TRUE AND executing_token = $2",
    [sessionId, token],
  );
}

// Start heartbeating the lease on an interval. Returns the timer to clear on release.
function startHeartbeat(sessionId, token) {
  const timer = setInterval(() => {
    heartbeatExecution(sessionId, token).catch(() => {});
  }, EXECUTION_HEARTBEAT_MS);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

// Release the execution slot so the next /execute call can proceed. Token-guarded:
// a revived crashed executor whose lease was already reclaimed can never clear the
// new owner's live lease. Best-effort.
async function releaseExecution(sessionId, token) {
  await db
    .query(
      "UPDATE setup_sessions SET executing = FALSE, executing_at = NULL, executing_token = NULL WHERE session_id = $1 AND executing_token = $2",
      [sessionId, token],
    )
    .catch(() => {});
}

// Pure tier-gate decision for a setup action: admins bypass, baseline actions
// (no `feature`) are always allowed, otherwise the user's tier must meet the
// feature's required tier. Extracted so it is unit-testable without a DB.
function isActionAllowed(action, tier, role) {
  if (role === "admin") return true;
  if (!action.feature) return true;
  const feat = FEATURES[action.feature];
  if (!feat) return false; // fail closed: an unknown feature key never unlocks a gated action
  return meetsTier(tier, feat.tier);
}

/**
 * POST /api/setup-agent/execute  { sessionId, skip? }
 * Runs the NEXT pending setup action (consent-gated). Called repeatedly by the UI
 * until allComplete. `skip: true` marks the current pending action as skipped
 * (used to move past an optional OAuth handoff).
 */
async function executeNextAction(req, res) {
  const userId = req.user.userId;
  const session = req.setupSession; // attached by requireSetupConsent
  const skip = req.body && req.body.skip === true;

  // Claim the renewable execution lease (see helpers above). If another call holds
  // a live lease, refuse with 409; the client retries. The heartbeat keeps a slow
  // step's lease fresh so it is never reclaimed while genuinely running.
  const leaseToken = await claimExecution(session.session_id);
  if (!leaseToken) {
    return res.status(409).json({ error: "A setup step is already running. Please wait." });
  }
  const heartbeat = startHeartbeat(session.session_id, leaseToken);

  try {
    if (!session.interview_complete) {
      return res.status(409).json({ error: "Finish the interview before configuring your account" });
    }

    const completed = Array.isArray(session.completed_steps) ? session.completed_steps : [];
    const answers = session.answers && typeof session.answers === "object" ? session.answers : {};
    const nextAction = ACTIONS.find((a) => !completed.includes(a.key));

    if (!nextAction) {
      // Everything done — finalize and auto-revoke consent. Guarded on
      // status = 'in_progress' so a pause/dismiss that committed while this step
      // ran can never be resurrected back to 'completed' (the "dismissed → later
      // completed" flip). If the guard matched nothing, the session was cancelled
      // mid-flight; report its real state instead of a bogus completion.
      const finalized = await db.query(
        `UPDATE setup_sessions
           SET status = 'completed', consent_granted = FALSE, completed_at = NOW(), updated_at = NOW()
         WHERE session_id = $1 AND status = 'in_progress'
         RETURNING *`,
        [session.session_id],
      );
      if (finalized.rows.length === 0) {
        return respondCancelledMidStep(res, session.session_id);
      }
      return res.json({
        allComplete: true,
        session: serializeSession(finalized.rows[0]),
      });
    }

    // Explicit skip of the current pending action (e.g. user declines an OAuth handoff).
    if (skip) {
      completed.push(nextAction.key);
      const updatedRow = await writeCompletedSteps(session.session_id, completed);
      if (!updatedRow) return respondCancelledMidStep(res, session.session_id);
      const remaining = ACTIONS.filter((a) => !completed.includes(a.key)).map((a) => a.key);
      return res.json({
        allComplete: false,
        step: { key: nextAction.key, label: nextAction.label },
        status: "skipped",
        detail: "Skipped.",
        remaining,
        session: serializeSession(updatedRow),
      });
    }

    // Tier gate: skip gated actions gracefully for lower tiers (admins bypass).
    if (nextAction.feature) {
      const { tier, role } = await getUserTier(userId);
      const allowed = isActionAllowed(nextAction, tier, role);
      if (!allowed) {
        completed.push(nextAction.key);
        const updatedRow = await writeCompletedSteps(session.session_id, completed);
        if (!updatedRow) return respondCancelledMidStep(res, session.session_id);
        const feat = FEATURES[nextAction.feature] || { name: nextAction.label, tier: "a higher" };
        const remaining = ACTIONS.filter((a) => !completed.includes(a.key)).map((a) => a.key);
        return res.json({
          allComplete: false,
          step: { key: nextAction.key, label: nextAction.label },
          status: "skipped",
          detail: `Skipped — needs the ${feat.name} feature (${feat.tier} plan).`,
          remaining,
          session: serializeSession(updatedRow),
        });
      }
    }

    // Run the action. A fresh copy of the session row is passed so create_brand_profile
    // can persist and reuse brand_id within the run.
    const liveSession = await reloadSession(session.session_id);
    const outcome = await nextAction.run({ userId, session: liveSession, answers });

    // needs_connection does NOT mark the step complete — the UI resolves the OAuth
    // handoff and calls execute again (or sends skip:true to move on).
    if (outcome.status === "needs_connection") {
      const remaining = ACTIONS.filter((a) => !completed.includes(a.key)).map((a) => a.key);
      return res.json({
        allComplete: false,
        step: { key: nextAction.key, label: nextAction.label },
        status: "needs_connection",
        connect: outcome.connect || null,
        detail: outcome.detail,
        remaining,
        session: serializeSession(await reloadSession(session.session_id)),
      });
    }

    completed.push(nextAction.key);
    const updatedRow = await writeCompletedSteps(session.session_id, completed);
    if (!updatedRow) return respondCancelledMidStep(res, session.session_id);
    const remaining = ACTIONS.filter((a) => !completed.includes(a.key)).map((a) => a.key);
    return res.json({
      allComplete: false,
      step: { key: nextAction.key, label: nextAction.label },
      status: outcome.status,
      detail: outcome.detail,
      remaining,
      session: serializeSession(updatedRow),
    });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Setup agent execute error:", err.message);
    return res.status(status).json({ error: err.message || "A setup step failed" });
  } finally {
    // Stop the heartbeat and release the lease, even on error, so the next
    // /execute call (or a retry after a failed step) can proceed immediately.
    clearInterval(heartbeat);
    await releaseExecution(session.session_id, leaseToken);
  }
}

/**
 * POST /api/setup-agent/pause  { sessionId }
 * Marks an active (interview-phase) session paused when the user leaves the flow,
 * stamping paused_at. Resuming (via initiateSession) flips it back to in_progress
 * and stamps resumed_at. Best-effort: a no-op if the session isn't pausable.
 */
async function markSessionPaused(sessionId, userId) {
  // Best-effort, idempotent: only an in-progress row for this owner flips to
  // paused, so a repeat call (e.g. beacon then in-app unmount) is a harmless
  // no-op that never resurrects a completed/dismissed session.
  await db.query(
    `UPDATE setup_sessions
       SET status = 'paused', paused_at = NOW(), updated_at = NOW()
     WHERE session_id = $1 AND user_id = $2 AND status = 'in_progress'`,
    [sessionId, userId],
  );
}

async function pauseSession(req, res) {
  const userId = req.user.userId;
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
  try {
    await markSessionPaused(sessionId, userId);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Setup agent pause error:", err.message);
    return res.status(500).json({ error: "Failed to pause the setup session" });
  }
}

/**
 * POST /api/setup-agent/pause-beacon  { sessionId, token }
 * sendBeacon-friendly pause used on hard tab/window close, where a React unmount
 * effect and an Authorization header both can't be relied on. The Beacon API
 * can't set headers, so the JWT rides in the body and is verified here instead
 * of via the auth middleware. Always answers 204 (fire-and-forget; the browser
 * is unloading and won't read the response) and never resurrects a session that
 * isn't 'in_progress' for the token's owner.
 */
async function pauseSessionBeacon(req, res) {
  const { sessionId, token } = req.body || {};
  if (sessionId && token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded && decoded.userId) {
        await markSessionPaused(sessionId, decoded.userId);
      }
    } catch (err) {
      // Invalid/expired token or DB hiccup: swallow — the page is unloading and
      // a stale-timestamp session is preferable to blocking the unload.
    }
  }
  return res.status(204).end();
}

/**
 * POST /api/setup-agent/dismiss  { sessionId }
 * Marks the session dismissed so the agent doesn't auto-launch again.
 */
async function dismissSession(req, res) {
  const userId = req.user.userId;
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
  try {
    const result = await db.query(
      `UPDATE setup_sessions
         SET status = 'dismissed', consent_granted = FALSE, updated_at = NOW()
       WHERE session_id = $1 AND user_id = $2 AND status NOT IN ('completed', 'dismissed')
       RETURNING *`,
      [sessionId, userId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Active setup session not found" });
    }
    return res.json({ session: serializeSession(result.rows[0]) });
  } catch (err) {
    console.error("Setup agent dismiss error:", err.message);
    return res.status(500).json({ error: "Failed to dismiss the setup session" });
  }
}

/**
 * GET /api/setup-agent/latest
 * Returns a light summary of the caller's most recent session (or null) so the
 * client can decide whether to auto-launch the agent for a brand-new user.
 */
async function getLatestSession(req, res) {
  const userId = req.user.userId;
  try {
    const result = await db.query(
      "SELECT * FROM setup_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
      [userId],
    );
    if (result.rows.length === 0) return res.json({ session: null });
    return res.json({ session: serializeSession(result.rows[0]) });
  } catch (err) {
    console.error("Setup agent latest error:", err.message);
    return res.status(500).json({ error: "Failed to load setup status" });
  }
}

module.exports = {
  initiateSession,
  submitAnswer,
  grantConsent,
  executeNextAction,
  pauseSession,
  pauseSessionBeacon,
  dismissSession,
  getLatestSession,
  // Exported for the reliability test suite (tests/setupAgent.*.test.js).
  ACTIONS,
  isActionAllowed,
  claimExecution,
  heartbeatExecution,
  releaseExecution,
  EXECUTION_LEASE_SECONDS,
  EXECUTION_HEARTBEAT_MS,
};
