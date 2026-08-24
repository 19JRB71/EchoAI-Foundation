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
const { oauthConfigured: googleOauthConfigured } = require("../config/google");
const { oauthConfigured: facebookOauthConfigured } = require("./facebookOAuthController");
const { configured: jobberConfigured } = require("../config/jobber");
const {
  writeOnboardingProgress,
  sendWelcomeEmailOnCompletion,
} = require("./authController");
const { isTerminalSetupJourney } = require("./setupAgentController");

/**
 * "No green button without a green backend": server-side readiness per
 * provider, derived from the SAME predicates the OAuth initiate endpoints
 * use. When a provider is not configured, the client renders "Setup
 * Required" instead of a Connect button — the customer is never sent into a
 * provider flow the server already knows cannot succeed. Email is
 * user-supplied (app password), so it is always available.
 */
function providerReadiness() {
  const facebook = Boolean(facebookOauthConfigured());
  return {
    google: Boolean(googleOauthConfigured()),
    facebook,
    instagram: facebook, // Instagram connects through the same Facebook app
    jobber: Boolean(jobberConfigured()),
    email: true,
  };
}

/**
 * Provider VERIFICATION: has a full authorization round trip ever succeeded
 * on THIS deployment? Credentials being present (readiness) is not the same
 * as the connection being proven end-to-end (verification). Until a provider
 * is verified, the client shows "Configured but awaiting verification" so a
 * customer is never shown a connection the platform hasn't proven works.
 * Fails closed (false) on query errors — never claims verified by accident.
 */
async function providerVerification() {
  async function exists(sql) {
    try {
      const r = await db.query(sql);
      return r.rows.length > 0;
    } catch {
      return false;
    }
  }
  const google = await exists(
    "SELECT 1 FROM google_integrations WHERE connection_status = 'connected' LIMIT 1",
  );
  const facebook = await exists(
    "SELECT 1 FROM api_integrations WHERE platform = 'facebook' AND connection_status = 'connected' LIMIT 1",
  );
  const jobber = await exists(
    "SELECT 1 FROM jobber_integrations WHERE connection_status = 'connected' LIMIT 1",
  );
  return {
    google,
    facebook,
    instagram: facebook, // rides on the Facebook connection
    jobber,
    email: true, // user-supplied credentials; the connect flow verifies itself
  };
}

const GUIDED_STEPS = [
  "welcome",
  "plan",
  "profile",
  "firstwin",
  "connections",
  "team",
  "done",
];
const CONNECTION_KEYS = ["facebook", "google", "email"];
// First-win choices the client may record (Milestone 1 of the first hour).
const FIRST_WIN_CHOICES = ["post", "ad", "email", "lead"];
const RECOVERY_NOTE = "historical_connections_state_irrecoverable";
const CONVERGENCE_OPERATION = "__converge_completed_journey__";
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

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

async function probeEmail(userId) {
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM email_accounts WHERE user_id = $1 LIMIT 1`,
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
          connections: sanitizeConnections(rows[0].connections),
          updatedAt: rows[0].updated_at,
        }
      : null;

    const facebook = await probeFacebook(userId);
    const google = await probeGoogle(userId);
    const email = await probeEmail(userId);

    // Latest Setup Agent session (drives "Continue previous setup" and the
    // profile step's resume behavior). Probe failure is reported honestly.
    let setupSession = null;
    try {
      const s = await db.query(
        `SELECT session_id, status, interview_complete
           FROM setup_sessions WHERE user_id = $1
          ORDER BY (status = 'completed') DESC, created_at DESC LIMIT 1`,
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
      connectionStatus: { facebook, google, email },
      providerReadiness: providerReadiness(),
      providerVerification: await providerVerification(),
      setupSession,
    });
  } catch (err) {
    console.error("guidedSetup getState error:", err);
    return res.status(500).json({ error: "Failed to load your setup progress" });
  }
}

// Whitelist the connection flags the client may persist. Real connection
// status is intentionally NOT storable — it is always probed live.
// preserveClears is used only while building a patch; null never reaches storage.
function sanitizeConnections(input, { preserveClears = false } = {}) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const key of CONNECTION_KEYS) {
    const v = input[key];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const entry = {};
    if (typeof v.skipped === "boolean") entry.skipped = v.skipped;
    if (typeof v.connecting === "boolean") entry.connecting = v.connecting;
    if (hasOwn(v, "errorKey")) {
      if (preserveClears && v.errorKey === null) entry.errorKey = null;
      else if (typeof v.errorKey === "string" && v.errorKey.trim()) {
        entry.errorKey = v.errorKey.trim().slice(0, 64);
      }
    }
    out[key] = entry;
  }
  // Milestone 1 "first win" record — {choice, done} only, whitelisted.
  const fw = input.firstwin;
  if (fw && typeof fw === "object" && !Array.isArray(fw)) {
    const entry = {};
    if (typeof fw.choice === "string" && FIRST_WIN_CHOICES.includes(fw.choice)) {
      entry.choice = fw.choice;
    }
    if (typeof fw.done === "boolean") entry.done = fw.done;
    if (typeof fw.skipped === "boolean") entry.skipped = fw.skipped;
    if (Object.keys(entry).length > 0) out.firstwin = entry;
  }
  // Prompt 024 PARK checkpoint (Section E): "Do this later" now saves the
  // owner's place WITHOUT completing onboarding. {parked, at} only.
  const pk = input.parked;
  if (pk && typeof pk === "object" && !Array.isArray(pk)) {
    const entry = {};
    if (typeof pk.parked === "boolean") entry.parked = pk.parked;
    if (typeof pk.at === "string" && pk.at.trim()) {
      entry.at = pk.at.trim().slice(0, 40);
    }
    if (Object.keys(entry).length > 0) out.parked = entry;
  }
  // PM8b: one bounded provenance marker for the known stale-firstwin clobber.
  // It records no reconstructed history and accepts no arbitrary values.
  const recovery = input._recovery;
  if (recovery && typeof recovery === "object" && !Array.isArray(recovery)) {
    const at = typeof recovery.at === "string" ? recovery.at.trim() : "";
    const ref = typeof recovery.ref === "string" ? recovery.ref.trim() : "";
    if (
      recovery.clobbered === true &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(at) &&
      /^pm8b-[a-z0-9-]{6,80}$/i.test(ref) &&
      recovery.note === RECOVERY_NOTE
    ) {
      out._recovery = {
        clobbered: true,
        at: at.slice(0, 40),
        ref: ref.slice(0, 85),
        note: RECOVERY_NOTE,
      };
    }
  }
  return out;
}

function mergeConnections(existingInput, incomingInput) {
  const merged = sanitizeConnections(existingInput);
  const patch = sanitizeConnections(incomingInput, { preserveClears: true });

  for (const [section, values] of Object.entries(patch)) {
    // The first valid provenance marker is immutable.
    if (section === "_recovery" && merged._recovery) continue;
    const next = { ...(merged[section] || {}) };
    for (const [key, value] of Object.entries(values)) {
      if (value === null) delete next[key];
      else next[key] = value;
    }

    if (CONNECTION_KEYS.includes(section)) {
      // Existing OAuth return semantics clear transient state by omission:
      // success supplies skipped=false; failure supplies errorKey.
      if (
        !hasOwn(values, "connecting") &&
        (values.skipped === false || typeof values.errorKey === "string")
      ) {
        delete next.connecting;
      }
      if (
        values.skipped === false &&
        !hasOwn(values, "connecting") &&
        !hasOwn(values, "errorKey")
      ) {
        delete next.errorKey;
      }
    }
    merged[section] = next;
  }

  return sanitizeConnections(merged);
}

async function conflict(client, res, code, error, details = {}) {
  await client.query("ROLLBACK");
  return res.status(409).json({ error, code, ...details });
}

async function convergeCompletedJourney(req, res) {
  let client;
  try {
    const userId = req.user.actualUserId || req.user.userId;
    client = await db.getClient();
    await client.query("BEGIN");
    const lockedUser = await client.query(
      `SELECT user_id, onboarding_completed
         FROM users WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    if (lockedUser.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }
    if (lockedUser.rows[0].onboarding_completed === true) {
      await client.query("COMMIT");
      return res.json({
        converged: false,
        onboardingCompleted: true,
        reason: "already_completed",
      });
    }

    const brands = await client.query(
      `SELECT brand_id FROM brands
        WHERE user_id = $1 AND is_demo IS NOT TRUE
        ORDER BY brand_id FOR SHARE`,
      [userId],
    );
    if (brands.rows.length !== 1) {
      return conflict(client, res, "onboarding_brand_ambiguous",
        "Guided Setup could not identify exactly one onboarding business.", { brandCount: brands.rows.length });
    }
    const brandId = brands.rows[0].brand_id;
    const candidates = await client.query(
      `SELECT * FROM setup_sessions
        WHERE user_id = $1 AND brand_id = $2 AND status = 'completed'
        ORDER BY completed_at, session_id
        FOR UPDATE`,
      [userId, brandId],
    );
    if (candidates.rows.length !== 1) {
      return conflict(client, res, "setup_session_cardinality",
        "Guided Setup requires exactly one completed setup journey.", { completedSessionCount: candidates.rows.length });
    }
    const session = candidates.rows[0];
    const entryIntent = session.answers?._interview?.entryIntent ?? null;
    if (entryIntent === "new_business") {
      return conflict(client, res, "setup_entry_intent_new_business",
        "A second-business setup journey cannot complete initial onboarding.");
    }
    if (!isTerminalSetupJourney(session)) {
      return conflict(client, res, "setup_journey_not_terminal",
        "The completed setup journey does not have terminal outcomes for every planned action.");
    }

    const user = await writeOnboardingProgress({
      userId,
      onboardingStep: 5,
      onboardingCompleted: true,
      query: client.query.bind(client),
    });
    await client.query("COMMIT");
    sendWelcomeEmailOnCompletion(user, userId);
    return res.json({
      converged: true,
      onboardingCompleted: true,
      onboardingStep: user.onboarding_step,
      sessionId: session.session_id,
      brandId,
    });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("guidedSetup convergence error:", err);
    return res.status(500).json({ error: "Failed to reconcile your completed setup" });
  } finally {
    if (client) client.release();
  }
}

/** PUT /api/guided-setup/progress */
async function saveProgress(req, res) {
  const { currentStep, connections } = req.body || {};
  if (currentStep === CONVERGENCE_OPERATION) {
    return convergeCompletedJourney(req, res);
  }
  if (!GUIDED_STEPS.includes(currentStep)) {
    return res.status(400).json({ error: "Invalid setup step" });
  }
  let client;
  try {
    client = await db.getClient();
    await client.query("BEGIN");
    // Serialize even the first insert by locking the parent user row.
    await client.query("SELECT user_id FROM users WHERE user_id = $1 FOR UPDATE", [
      req.user.userId,
    ]);
    const current = await client.query(
      "SELECT connections FROM guided_setup_progress WHERE user_id = $1 FOR UPDATE",
      [req.user.userId],
    );
    const merged = mergeConnections(current.rows[0]?.connections, connections);
    await client.query(
      `INSERT INTO guided_setup_progress (user_id, current_step, connections)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (user_id) DO UPDATE
         SET current_step = EXCLUDED.current_step,
             connections  = EXCLUDED.connections,
             updated_at   = NOW()`,
      [req.user.userId, currentStep, JSON.stringify(merged)],
    );
    await client.query("COMMIT");
    return res.json({ currentStep, connections: merged });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("guidedSetup saveProgress error:", err);
    return res.status(500).json({ error: "Failed to save your setup progress" });
  } finally {
    if (client) client.release();
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
      providerReadiness: providerReadiness(),
      providerVerification: await providerVerification(),
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
  providerVerification,
  GUIDED_STEPS,
  CONNECTION_KEYS,
  sanitizeConnections,
  mergeConnections,
  convergeCompletedJourney,
  CONVERGENCE_OPERATION,
  // Prompt 024: the onboarding status projection reuses the SAME live probes
  // the wizard checklist uses — one source of connection truth.
  probeFacebook,
  probeGoogle,
  probeEmail,
};
