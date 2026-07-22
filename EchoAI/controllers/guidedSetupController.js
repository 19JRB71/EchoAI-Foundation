/**
 * Guided Setup wizard controller.
 *
 * Backs the new-customer front-door wizard (Welcome → Plan → Business Profile
 * → Connect Accounts → Team → Done):
 *
 *  - getState        — resume data: saved wizard position + LIVE connection
 *                      probes (never fabricated; probe failure → "unknown") +
 *                      the latest Setup Agent session status.
 *  - saveProgress    — upserts the user's wizard position and per-connection
 *                      skip/connecting flags (whitelisted; real status is
 *                      never stored, only probed).
 *  - reportConnectionError — logs the RAW OAuth failure detail server-side so
 *                      the client only ever shows the plain-English version.
 *  - helpAnalyze     — the "Help Me" screenshot rescue: stores the screenshot
 *                      (reusing the support-screenshot pipeline) and asks the
 *                      vision agent what screen it is + what to click next.
 *                      AI failure → 502; low confidence is passed through
 *                      honestly so the client offers support instead.
 */

const db = require("../config/db");
const { persistScreenshot } = require("./healthMonitorController");
const { analyzeSetupHelpScreenshot } = require("../prompts/guidedSetupPrompt");

const GUIDED_STEPS = ["welcome", "plan", "profile", "connections", "team", "done"];
const CONNECTION_KEYS = ["facebook", "google"];

// --- Live connection probes (same sources of truth as utils/setupStatus.js) --

async function probeFacebook(userId) {
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM api_integrations
        WHERE user_id = $1 AND platform = 'facebook' AND connection_status = 'connected' LIMIT 1`,
      [userId],
    );
    return rows.length > 0 ? "connected" : "not_connected";
  } catch {
    return "unknown"; // honest: never guess a connection state
  }
}

async function probeGoogle(userId) {
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM google_integrations
        WHERE user_id = $1 AND connection_status = 'connected' LIMIT 1`,
      [userId],
    );
    return rows.length > 0 ? "connected" : "not_connected";
  } catch {
    return "unknown";
  }
}

/** GET /api/guided-setup/state */
async function getState(req, res) {
  try {
    const userId = req.user.userId;

    const { rows } = await db.query(
      `SELECT current_step, connections, updated_at
         FROM guided_setup_progress WHERE user_id = $1`,
      [userId],
    );
    const progress = rows[0]
      ? {
          currentStep: GUIDED_STEPS.includes(rows[0].current_step)
            ? rows[0].current_step
            : "welcome",
          connections:
            rows[0].connections && typeof rows[0].connections === "object"
              ? rows[0].connections
              : {},
          updatedAt: rows[0].updated_at,
        }
      : null;

    const facebook = await probeFacebook(userId);
    const google = await probeGoogle(userId);

    // Latest Setup Agent session (drives "Continue previous setup" and the
    // profile step's resume behavior). Probe failure is reported honestly.
    let setupSession = null;
    try {
      const s = await db.query(
        `SELECT session_id, status, interview_complete
           FROM setup_sessions WHERE user_id = $1
          ORDER BY created_at DESC LIMIT 1`,
        [userId],
      );
      if (s.rows[0]) {
        setupSession = {
          sessionId: s.rows[0].session_id,
          status: s.rows[0].status,
          interviewComplete: Boolean(s.rows[0].interview_complete),
        };
      }
    } catch {
      setupSession = { status: "unknown" };
    }

    return res.json({
      progress,
      connectionStatus: { facebook, google },
      setupSession,
    });
  } catch (err) {
    console.error("guidedSetup getState error:", err);
    return res.status(500).json({ error: "Failed to load your setup progress" });
  }
}

// Whitelist the connection flags the client may persist. Real connection
// status is intentionally NOT storable — it is always probed live.
function sanitizeConnections(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const key of CONNECTION_KEYS) {
    const v = input[key];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const entry = {};
    if (typeof v.skipped === "boolean") entry.skipped = v.skipped;
    if (typeof v.connecting === "boolean") entry.connecting = v.connecting;
    if (typeof v.errorKey === "string" && v.errorKey.trim()) {
      entry.errorKey = v.errorKey.trim().slice(0, 64);
    }
    out[key] = entry;
  }
  return out;
}

/** PUT /api/guided-setup/progress */
async function saveProgress(req, res) {
  try {
    const { currentStep, connections } = req.body || {};
    if (!GUIDED_STEPS.includes(currentStep)) {
      return res.status(400).json({ error: "Invalid setup step" });
    }
    const sanitized = sanitizeConnections(connections);
    await db.query(
      `INSERT INTO guided_setup_progress (user_id, current_step, connections)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (user_id) DO UPDATE
         SET current_step = EXCLUDED.current_step,
             connections  = EXCLUDED.connections,
             updated_at   = NOW()`,
      [req.user.userId, currentStep, JSON.stringify(sanitized)],
    );
    return res.json({ currentStep, connections: sanitized });
  } catch (err) {
    console.error("guidedSetup saveProgress error:", err);
    return res.status(500).json({ error: "Failed to save your setup progress" });
  }
}

/**
 * POST /api/guided-setup/connection-error
 * The client shows only plain-English failure explanations; the raw provider
 * error detail is logged here server-side so support can diagnose it.
 */
async function reportConnectionError(req, res) {
  const provider = String(req.body?.provider || "unknown").slice(0, 32);
  const raw = String(req.body?.raw || "").slice(0, 1000);
  console.warn(
    `guidedSetup connection error [user ${req.user.userId}] provider=${provider}: ${raw || "(no detail)"}`,
  );
  return res.status(204).end();
}

/** POST /api/guided-setup/help — screenshot rescue. */
async function helpAnalyze(req, res) {
  try {
    let stored;
    try {
      stored = await persistScreenshot(req.body?.screenshot);
    } catch (err) {
      if (err.tooLarge) {
        return res
          .status(413)
          .json({ error: "That screenshot is too large. Please try a smaller one." });
      }
      throw err;
    }
    if (!stored.base64) {
      return res
        .status(400)
        .json({ error: "Please attach a screenshot so I can see what you're seeing." });
    }

    const context =
      typeof req.body?.context === "string" ? req.body.context.slice(0, 300) : "";

    const analysis = await analyzeSetupHelpScreenshot({
      imageBase64: stored.base64,
      mediaType: stored.mediaType,
      context,
    });

    return res.json({ ...analysis, screenshotUrl: stored.url });
  } catch (err) {
    if (err.aiInvalid || (typeof err.status === "number" && err.status >= 400)) {
      // Honest failure — never fabricate guidance the AI didn't give.
      return res.status(502).json({
        error:
          "I couldn't read that screenshot right now. Let's get you to a person who can help.",
      });
    }
    console.error("guidedSetup helpAnalyze error:", err);
    return res.status(500).json({ error: "Failed to analyze the screenshot" });
  }
}

// ---------------------------------------------------------------------------
// Setup Checklist — powers the Mission Control "Company Setup" card. Every
// status is a LIVE probe (probe failure → "unknown", never guessed). Items the
// platform can't probe (CRM, Google Business Profile) are plain links.
// ---------------------------------------------------------------------------

async function probeExists(sql, params) {
  try {
    const { rows } = await db.query(sql, params);
    return rows.length > 0 ? "connected" : "not_connected";
  } catch {
    return "unknown";
  }
}

/** GET /api/guided-setup/checklist */
async function getChecklist(req, res) {
  try {
    const userId = req.user.userId;

    const [profile, facebook, google, phone, chatbot, email, jobber] = await Promise.all([
      probeExists(
        `SELECT 1 FROM brands
          WHERE user_id = $1 AND COALESCE(TRIM(brand_name), '') <> '' LIMIT 1`,
        [userId],
      ),
      probeFacebook(userId),
      probeGoogle(userId),
      probeExists(
        `SELECT 1 FROM twilio_config t JOIN brands b ON b.brand_id = t.brand_id
          WHERE b.user_id = $1 LIMIT 1`,
        [userId],
      ),
      probeExists(
        `SELECT 1 FROM chatbot_config c JOIN brands b ON b.brand_id = c.brand_id
          WHERE b.user_id = $1 LIMIT 1`,
        [userId],
      ),
      probeExists(`SELECT 1 FROM email_accounts WHERE user_id = $1 LIMIT 1`, [userId]),
      probeExists(
        `SELECT 1 FROM jobber_integrations
          WHERE user_id = $1 AND connection_status = 'connected' LIMIT 1`,
        [userId],
      ),
    ]);

    const items = [
      { key: "profile", label: "Business profile", status: profile, section: "campaigns" },
      { key: "facebook", label: "Facebook", status: facebook, section: "settings" },
      {
        key: "instagram",
        label: "Instagram",
        status: facebook,
        section: "settings",
        note: "Included with your Facebook login",
      },
      { key: "google", label: "Google", status: google, section: "settings" },
      {
        key: "calendar",
        label: "Calendar",
        status: google,
        section: "appointments",
        note: "Comes with your Google connection",
      },
      { key: "phone", label: "Phone agent", status: phone, section: "phone" },
      { key: "chatbot", label: "Website chatbot", status: chatbot, section: "chatbot" },
      { key: "email", label: "Email assistant", status: email, section: "echoemail" },
      { key: "jobber", label: "Jobber", status: jobber, section: "leads" },
      { key: "crm", label: "CRM & leads", status: "link", section: "leads" },
      { key: "gbp", label: "Google Business Profile", status: "link", section: "googleseo" },
    ];

    const probed = items.filter((i) => i.status !== "link");
    const completedCount = probed.filter((i) => i.status === "connected").length;

    return res.json({
      items,
      completedCount,
      probedTotal: probed.length,
      allDone: probed.every((i) => i.status === "connected"),
    });
  } catch (err) {
    console.error("guidedSetup getChecklist error:", err);
    return res.status(500).json({ error: "Failed to load your setup checklist" });
  }
}

module.exports = {
  getState,
  saveProgress,
  getChecklist,
  reportConnectionError,
  helpAnalyze,
  // exported for tests
  GUIDED_STEPS,
  CONNECTION_KEYS,
  sanitizeConnections,
};
