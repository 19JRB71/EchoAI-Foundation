const db = require("../config/db");

/**
 * Setup-consent guard.
 *
 * Any endpoint that actually configures the user's account (the setup action
 * runner) must sit behind this. It loads the caller's own setup session and
 * refuses to proceed unless the user has explicitly granted setup consent and the
 * session is still active. Consent is auto-revoked when setup completes, so a
 * finished session can never be re-run without a fresh grant.
 *
 * On success it attaches the loaded row as `req.setupSession` so the handler does
 * not have to reload it.
 */
async function requireSetupConsent(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const sessionId = req.body && req.body.sessionId;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const { rows } = await db.query(
      "SELECT * FROM setup_sessions WHERE session_id = $1 AND user_id = $2",
      [sessionId, userId],
    );
    const session = rows[0];
    if (!session) {
      return res.status(404).json({ error: "Setup session not found" });
    }

    if (session.status === "completed" || session.status === "dismissed") {
      return res.status(409).json({ error: "This setup session is already finished" });
    }

    if (!session.consent_granted) {
      return res.status(403).json({
        error: "Setup consent is required before EchoAI can configure your account.",
        consentRequired: true,
      });
    }

    req.setupSession = session;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireSetupConsent };
