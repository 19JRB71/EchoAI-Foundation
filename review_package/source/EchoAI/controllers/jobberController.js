/**
 * Jobber integration controller.
 *
 * Connects a customer's Jobber account (field-service CRM) via OAuth 2.0 and
 * gives the platform three real capabilities:
 *
 *  - importClients  — pulls Jobber clients into the CRM as leads (deduped in
 *                     app code by email/phone — the leads table is shared by
 *                     multiple insert paths, no unique index).
 *  - getSchedule    — reads the upcoming booked visits so Echo/owner can see
 *                     the real Jobber schedule. Read failure → 502, never a
 *                     fabricated empty calendar.
 *  - sendLeadToJobber — creates the lead as a client in Jobber (idempotent
 *                     via leads.jobber_client_id) and returns the Jobber web
 *                     link so quotes/jobs are finished in Jobber itself.
 *  - autoCreateClientForLead — best-effort hook fired when a lead converts:
 *                     if the brand owner has Jobber connected, the converted
 *                     lead becomes a Jobber client automatically.
 *
 * Patterns mirror googleController: session-CSRF OAuth, AES-256-GCM encrypted
 * tokens, refresh with rotation support, upstream failures → 502.
 */

const crypto = require("crypto");

const db = require("../config/db");
const { encrypt, decrypt } = require("../utils/encryption");
const {
  clientId,
  clientSecret,
  AUTH_ENDPOINT,
  TOKEN_ENDPOINT,
  GRAPHQL_ENDPOINT,
  API_VERSION,
  configured,
} = require("../config/jobber");

function getRedirectUri(req) {
  if (process.env.JOBBER_REDIRECT_URI) {
    return process.env.JOBBER_REDIRECT_URI;
  }
  let base;
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    base = `https://${domains.split(",")[0].trim()}`;
  } else if (process.env.REPLIT_DEV_DOMAIN) {
    base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  } else {
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
    base = `${proto}://${req.get("host")}`;
  }
  return `${base}/api/jobber/oauth/callback`;
}

function dashboardRedirect(status, message) {
  const params = new URLSearchParams({ jobber: status });
  if (message) params.set("jobber_message", message);
  return `/dashboard?${params.toString()}`;
}

/** Maps a thrown error to the right HTTP response. */
function fail(res, err, fallback) {
  if (err.notConnected) {
    return res.status(400).json({ error: "Connect your Jobber account first." });
  }
  if (err.jobberError) {
    return res.status(502).json({ error: `Jobber error: ${err.message}` });
  }
  console.error("Jobber error:", err);
  return res.status(500).json({ error: fallback });
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * Loads the user's Jobber grant and returns a valid (refreshed if needed)
 * access token. Jobber access tokens live ~60 minutes; refresh tokens may
 * rotate, so a rotated refresh token is always persisted.
 */
async function getValidAccessToken(userId) {
  const { rows } = await db.query(
    `SELECT access_token_encrypted, refresh_token_encrypted, token_expiry
       FROM jobber_integrations WHERE user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row || !row.refresh_token_encrypted) {
    const err = new Error("Jobber account is not connected");
    err.notConnected = true;
    throw err;
  }

  const expiry = row.token_expiry ? new Date(row.token_expiry).getTime() : 0;
  if (row.access_token_encrypted && expiry - Date.now() > 60_000) {
    return decrypt(row.access_token_encrypted);
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: decrypt(row.refresh_token_encrypted),
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    // A dead refresh token means the connection needs a re-consent — reflect
    // that honestly so the checklist shows "error", not "connected".
    await db
      .query(
        `UPDATE jobber_integrations SET connection_status = 'error' WHERE user_id = $1`,
        [userId],
      )
      .catch(() => {});
    const err = new Error(
      data.error_description || data.error || "Could not refresh the Jobber access token",
    );
    err.jobberError = true;
    throw err;
  }

  const newExpiry = new Date(Date.now() + (Number(data.expires_in) || 3600) * 1000);
  await db.query(
    `UPDATE jobber_integrations
        SET access_token_encrypted = $1,
            refresh_token_encrypted = COALESCE($2, refresh_token_encrypted),
            token_expiry = $3,
            connection_status = 'connected'
      WHERE user_id = $4`,
    [
      encrypt(data.access_token),
      data.refresh_token ? encrypt(data.refresh_token) : null,
      newExpiry,
      userId,
    ],
  );
  return data.access_token;
}

/** Executes a Jobber GraphQL request; GraphQL/user errors → tagged 502. */
async function jobberGraphQL(accessToken, query, variables = {}) {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-JOBBER-GRAPHQL-VERSION": API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (Array.isArray(data.errors) && data.errors.length > 0)) {
    const msg =
      data.errors?.[0]?.message || `Jobber API request failed (HTTP ${res.status})`;
    const err = new Error(msg);
    err.jobberError = true;
    throw err;
  }
  return data.data || {};
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

/** POST /api/jobber/oauth/initiate — returns { authUrl } (JWT in header). */
async function initiateOAuth(req, res) {
  if (!configured()) {
    return res
      .status(503)
      .json({ error: "Jobber connection is not configured on the server." });
  }

  const userId = req.user.userId;
  const state = crypto.randomBytes(16).toString("hex");
  req.session.jobberOAuth = { state, userId };

  req.session.save((err) => {
    if (err) {
      console.error("Jobber OAuth session save error:", err.message);
      return res.status(500).json({ error: "Could not start the Jobber connection." });
    }
    const authUrl = new URL(AUTH_ENDPOINT);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", getRedirectUri(req));
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);
    return res.status(200).json({ authUrl: authUrl.toString() });
  });
}

/** GET /api/jobber/oauth/callback?code=&state= — session CSRF, no auth header. */
async function oauthCallback(req, res) {
  const { code, state, error: jError } = req.query;
  const sessionState = req.session?.jobberOAuth?.state;
  const userId = req.session?.jobberOAuth?.userId;

  if (req.session) delete req.session.jobberOAuth;

  if (jError) {
    return res.redirect(dashboardRedirect("error", "Jobber authorization was cancelled."));
  }
  if (!code || !state || !sessionState || !userId) {
    return res.redirect(dashboardRedirect("error", "Invalid or expired Jobber authorization."));
  }
  if (state !== sessionState) {
    return res.redirect(dashboardRedirect("error", "Security check failed. Please try again."));
  }

  try {
    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: String(code),
      redirect_uri: getRedirectUri(req),
      grant_type: "authorization_code",
    });
    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData.access_token || !tokenData.refresh_token) {
      throw new Error(
        tokenData.error_description || tokenData.error || "Token exchange failed",
      );
    }

    // Fetch the connected Jobber account name (best-effort).
    let accountName = null;
    try {
      const data = await jobberGraphQL(
        tokenData.access_token,
        `query { account { name } }`,
      );
      accountName = data.account?.name || null;
    } catch {
      accountName = null;
    }

    const expiry = new Date(Date.now() + (Number(tokenData.expires_in) || 3600) * 1000);
    await db.query(
      `INSERT INTO jobber_integrations
         (user_id, jobber_account_name, access_token_encrypted,
          refresh_token_encrypted, token_expiry, connection_status)
       VALUES ($1, $2, $3, $4, $5, 'connected')
       ON CONFLICT (user_id)
       DO UPDATE SET jobber_account_name = EXCLUDED.jobber_account_name,
                     access_token_encrypted = EXCLUDED.access_token_encrypted,
                     refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
                     token_expiry = EXCLUDED.token_expiry,
                     connection_status = 'connected'`,
      [
        userId,
        accountName,
        encrypt(tokenData.access_token),
        encrypt(tokenData.refresh_token),
        expiry,
      ],
    );

    return res.redirect(dashboardRedirect("connected"));
  } catch (err) {
    console.error("Jobber OAuth callback error:", err.message);
    return res.redirect(
      dashboardRedirect("error", `Jobber connection failed: ${err.message}`),
    );
  }
}

/** GET /api/jobber/status */
async function getConnectionStatus(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT jobber_account_name, connection_status, updated_at
         FROM jobber_integrations WHERE user_id = $1`,
      [req.user.userId],
    );
    if (!rows[0]) {
      return res.json({ connected: false, configured: configured() });
    }
    return res.json({
      connected: rows[0].connection_status === "connected",
      status: rows[0].connection_status,
      accountName: rows[0].jobber_account_name,
      configured: configured(),
    });
  } catch (err) {
    console.error("Jobber status error:", err.message);
    return res.status(500).json({ error: "Failed to load the Jobber connection status" });
  }
}

/** POST /api/jobber/disconnect */
async function disconnect(req, res) {
  try {
    await db.query(`DELETE FROM jobber_integrations WHERE user_id = $1`, [
      req.user.userId,
    ]);
    return res.json({ message: "Jobber disconnected" });
  } catch (err) {
    console.error("Jobber disconnect error:", err.message);
    return res.status(500).json({ error: "Failed to disconnect Jobber" });
  }
}

// ---------------------------------------------------------------------------
// Clients → leads import
// ---------------------------------------------------------------------------

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : null;
}

function primaryOf(list, field) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const primary = list.find((e) => e && e.primary) || list[0];
  return primary?.[field] || null;
}

/**
 * POST /api/jobber/clients/import  { brandId }
 * Pulls Jobber clients (paged) into the brand's CRM as leads. Dedupe happens
 * in app code (email, then phone) — the shared leads table has no unique key.
 * Imported rows keep conversion_status 'new' on purpose: they are real
 * contacts, but crediting them as platform conversions would inflate ROI.
 */
async function importClients(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.body;
  if (!brandId) return res.status(400).json({ error: "brandId is required" });

  try {
    const brand = await db.query(
      `SELECT brand_id FROM brands WHERE brand_id = $1 AND user_id = $2`,
      [brandId, userId],
    );
    if (!brand.rows[0]) return res.status(404).json({ error: "Brand not found" });

    const accessToken = await getValidAccessToken(userId);

    // Existing dedup keys for this brand.
    const existing = await db.query(
      `SELECT email, phone, jobber_client_id FROM leads WHERE brand_id = $1`,
      [brandId],
    );
    const seenEmails = new Set();
    const seenPhones = new Set();
    const seenJobberIds = new Set();
    for (const l of existing.rows) {
      if (l.email) seenEmails.add(String(l.email).trim().toLowerCase());
      const p = normalizePhone(l.phone);
      if (p) seenPhones.add(p);
      if (l.jobber_client_id) seenJobberIds.add(l.jobber_client_id);
    }

    const QUERY = `
      query ImportClients($cursor: String) {
        clients(first: 50, after: $cursor) {
          nodes {
            id
            name
            emails { address primary }
            phones { number primary }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`;

    let cursor = null;
    let fetched = 0;
    let imported = 0;
    let skipped = 0;
    // Hard page cap keeps one request bounded; rerunning imports the rest.
    for (let page = 0; page < 20; page += 1) {
      const data = await jobberGraphQL(accessToken, QUERY, { cursor });
      const conn = data.clients || {};
      const nodes = Array.isArray(conn.nodes) ? conn.nodes : [];
      for (const c of nodes) {
        fetched += 1;
        const email = primaryOf(c.emails, "address");
        const phone = primaryOf(c.phones, "number");
        const emailKey = email ? email.trim().toLowerCase() : null;
        const phoneKey = normalizePhone(phone);
        const duplicate =
          (c.id && seenJobberIds.has(c.id)) ||
          (emailKey && seenEmails.has(emailKey)) ||
          (phoneKey && seenPhones.has(phoneKey));
        if (duplicate || (!c.name && !email && !phone)) {
          skipped += 1;
          continue;
        }
        await db.query(
          `INSERT INTO leads (brand_id, lead_name, email, phone, jobber_client_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [brandId, c.name || null, email, phone, c.id || null],
        );
        imported += 1;
        if (c.id) seenJobberIds.add(c.id);
        if (emailKey) seenEmails.add(emailKey);
        if (phoneKey) seenPhones.add(phoneKey);
      }
      if (!conn.pageInfo?.hasNextPage) {
        return res.json({ imported, skipped, fetched, complete: true });
      }
      cursor = conn.pageInfo.endCursor;
    }
    return res.json({ imported, skipped, fetched, complete: false });
  } catch (err) {
    return fail(res, err, "Failed to import Jobber clients");
  }
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/** GET /api/jobber/schedule — the next 14 days of booked Jobber visits. */
async function getSchedule(req, res) {
  try {
    const accessToken = await getValidAccessToken(req.user.userId);
    const now = new Date();
    const until = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const QUERY = `
      query UpcomingVisits($after: ISO8601DateTime, $before: ISO8601DateTime) {
        visits(
          first: 50,
          filter: { startAt: { after: $after, before: $before } },
          sort: { key: START_AT, direction: ASCENDING }
        ) {
          nodes {
            id
            title
            startAt
            endAt
            client { id name }
          }
          pageInfo { hasNextPage }
        }
      }`;
    const data = await jobberGraphQL(accessToken, QUERY, {
      after: now.toISOString(),
      before: until.toISOString(),
    });
    const nodes = Array.isArray(data.visits?.nodes) ? data.visits.nodes : [];
    return res.json({
      visits: nodes.map((v) => ({
        id: v.id,
        title: v.title || null,
        startAt: v.startAt || null,
        endAt: v.endAt || null,
        clientName: v.client?.name || null,
      })),
      hasMore: Boolean(data.visits?.pageInfo?.hasNextPage),
      rangeDays: 14,
    });
  } catch (err) {
    return fail(res, err, "Failed to load the Jobber schedule");
  }
}

// ---------------------------------------------------------------------------
// Lead → Jobber client
// ---------------------------------------------------------------------------

const CLIENT_CREATE_MUTATION = `
  mutation CreateClient($input: ClientCreateInput!) {
    clientCreate(input: $input) {
      client { id name jobberWebUri }
      userErrors { message }
    }
  }`;

function clientInputFromLead(lead) {
  const name = String(lead.lead_name || "").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "Unknown";
  const lastName = parts.slice(1).join(" ") || null;
  const input = { firstName };
  if (lastName) input.lastName = lastName;
  if (lead.email) {
    input.emails = [
      { description: "MAIN", primary: true, address: String(lead.email).trim() },
    ];
  }
  if (lead.phone) {
    input.phones = [
      { description: "MAIN", primary: true, number: String(lead.phone).trim() },
    ];
  }
  return input;
}

/**
 * Creates the lead as a Jobber client and stores the link (idempotent AND
 * race-safe): a per-lead Postgres advisory lock is held for the duration of
 * the external clientCreate call, so two concurrent sends can never create
 * two Jobber clients. The link is re-read under the lock before creating.
 */
async function createJobberClientForLead(userId, lead) {
  if (lead.jobber_client_id) {
    return { jobberClientId: lead.jobber_client_id, alreadyLinked: true };
  }
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize concurrent sends for the same lead (uuid → 64-bit lock key).
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('jobber_send:' || $1::text, 0))`,
      [lead.lead_id],
    );
    // Re-read under the lock: a concurrent send may have linked it already.
    const fresh = await client.query(
      `SELECT jobber_client_id FROM leads WHERE lead_id = $1`,
      [lead.lead_id],
    );
    const existing = fresh.rows[0]?.jobber_client_id;
    if (existing) {
      await client.query("COMMIT");
      return { jobberClientId: existing, alreadyLinked: true };
    }

    const accessToken = await getValidAccessToken(userId);
    const data = await jobberGraphQL(accessToken, CLIENT_CREATE_MUTATION, {
      input: clientInputFromLead(lead),
    });
    const payload = data.clientCreate || {};
    if (Array.isArray(payload.userErrors) && payload.userErrors.length > 0) {
      const err = new Error(payload.userErrors.map((e) => e.message).join("; "));
      err.jobberError = true;
      throw err;
    }
    const created = payload.client;
    if (!created?.id) {
      const err = new Error("Jobber did not return the created client");
      err.jobberError = true;
      throw err;
    }
    await client.query(
      `UPDATE leads SET jobber_client_id = $1 WHERE lead_id = $2`,
      [created.id, lead.lead_id],
    );
    await client.query("COMMIT");
    return {
      jobberClientId: created.id,
      jobberWebUri: created.jobberWebUri || null,
      alreadyLinked: false,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      /* connection already broken */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * POST /api/jobber/leads/:leadId/send
 * Pushes a lead into Jobber as a client. Quotes and jobs are then finished in
 * Jobber itself — the response carries the direct Jobber link.
 */
async function sendLeadToJobber(req, res) {
  const userId = req.user.userId;
  const { leadId } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT l.* FROM leads l
        JOIN brands b ON b.brand_id = l.brand_id
       WHERE l.lead_id = $1 AND b.user_id = $2`,
      [leadId, userId],
    );
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!lead.lead_name && !lead.email && !lead.phone) {
      return res
        .status(400)
        .json({ error: "This lead has no name, email, or phone to send to Jobber." });
    }

    const result = await createJobberClientForLead(userId, lead);
    return res.json({
      message: result.alreadyLinked
        ? "This lead is already in Jobber."
        : "Lead created in Jobber.",
      ...result,
    });
  } catch (err) {
    return fail(res, err, "Failed to send the lead to Jobber");
  }
}

/**
 * Best-effort conversion hook: when a lead converts and the brand owner has
 * Jobber connected, create the client in Jobber automatically. Never throws,
 * never blocks the caller.
 */
async function autoCreateClientForLead(leadId) {
  try {
    const { rows } = await db.query(
      `SELECT l.*, b.user_id AS owner_user_id
         FROM leads l JOIN brands b ON b.brand_id = l.brand_id
        WHERE l.lead_id = $1`,
      [leadId],
    );
    const lead = rows[0];
    if (!lead || lead.jobber_client_id) return;
    if (!lead.lead_name && !lead.email && !lead.phone) return;

    const conn = await db.query(
      `SELECT 1 FROM jobber_integrations
        WHERE user_id = $1 AND connection_status = 'connected' LIMIT 1`,
      [lead.owner_user_id],
    );
    if (!conn.rows[0]) return;

    await createJobberClientForLead(lead.owner_user_id, lead);
  } catch (err) {
    // Best-effort by design — the conversion itself must never fail on Jobber.
    console.error("Jobber auto-create on convert failed:", err.message);
  }
}

module.exports = {
  initiateOAuth,
  oauthCallback,
  getConnectionStatus,
  disconnect,
  importClients,
  getSchedule,
  sendLeadToJobber,
  autoCreateClientForLead,
  // exported for tests
  getValidAccessToken,
  jobberGraphQL,
  clientInputFromLead,
  normalizePhone,
  primaryOf,
  createJobberClientForLead,
};
