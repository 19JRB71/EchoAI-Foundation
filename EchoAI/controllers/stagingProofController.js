require("dotenv").config();

/**
 * Staging external-proof runner (Prompt 006).
 *
 * Admin-only endpoints that record real provider actions into the
 * external_proofs evidence substrate. Design (owner terms 9–14, binding):
 *
 *   - PREFLIGHT IS READ-ONLY (term 9): GET /preflight performs no provider
 *     mutation — it reports the exact Page id + name (Graph read), tenant,
 *     SMTP configuration state, the proposed public post text, and any
 *     existing proof rows for the run key, then the operator STOPS for
 *     owner approval.
 *   - PARTIAL-PROOF HONESTY (term 11): publish, read-back and deletion are
 *     separate proof rows; a stage that fails writes NO row and the response
 *     reports exactly which stages completed. A published-but-not-deleted
 *     post is reported with its real id, never claimed complete.
 *   - IDEMPOTENCY (term 12): all writes go through recordExternalProof's
 *     (run_key, provider, action) uniqueness; re-running a stage that
 *     already has a row is a no-op that returns the existing row. The
 *     publish stage records an ALREADY-published social_posts row (written
 *     by the real publishPostNow machinery from the Graph response) — it
 *     never publishes anything itself, so a retry can never double-post.
 *   - REDACTION (term 10): evidence passes through redactEvidence before
 *     persisting; responses from these endpoints carry the same redacted
 *     payloads.
 */

const db = require("../config/db");
const {
  recordExternalProof,
  getRunProofs,
  redactEvidence,
  currentEnvironment,
} = require("../utils/externalProofs");
const { loadConnectedAccount } = require("./socialController");
// Required as a module object (not destructured) so tests can stub sendEmail.
const emailTransport = require("../utils/email");

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

// Owner-approved public test copy (term 14). The runner may override it only
// with text the owner approved at preflight.
const DEFAULT_PROOF_POST_TEXT =
  "South Dixie Storage is testing an internal publishing connection. This post will be removed shortly.";

/** Fetch + JSON-parse a Graph call, throwing the raw error body on failure. */
async function graphJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_e) {
    data = { raw: text };
  }
  if (!response.ok) {
    const err = new Error(
      (data && data.error && data.error.message) ||
        `Graph request failed with HTTP ${response.status}`
    );
    err.providerResponse = data;
    err.statusCode = response.status;
    throw err;
  }
  return data;
}

/**
 * GET /api/staging-proof/preflight?brandId=&runKey=&to=
 * Read-only. No provider mutation of any kind.
 */
async function preflight(req, res) {
  const { brandId, runKey, to } = req.query;
  if (!brandId) return res.status(400).json({ error: "brandId is required" });
  try {
    const brandResult = await db.query(
      `SELECT b.brand_id, b.brand_name, b.is_demo, b.user_id, u.email AS owner_email
         FROM brands b JOIN users u ON u.user_id = b.user_id
        WHERE b.brand_id = $1`,
      [brandId]
    );
    if (brandResult.rows.length === 0) {
      return res.status(404).json({ error: "Brand not found" });
    }
    const brand = brandResult.rows[0];
    if (brand.is_demo) {
      return res.status(409).json({ error: "Demo brands cannot carry external proofs" });
    }

    // Facebook: resolve the brand's connected Page and read its name back
    // from Graph (a GET — read-only). Failures are reported honestly.
    let facebook;
    try {
      const account = await loadConnectedAccount(brandId, "facebook");
      const pageId = account.credentials.pageId;
      const hasPageToken = Boolean(account.credentials.accessToken);
      let page = null;
      let pageReadError = null;
      if (pageId && hasPageToken) {
        try {
          page = await graphJson(
            `${GRAPH_BASE}/${pageId}?fields=id,name,link&access_token=${encodeURIComponent(account.credentials.accessToken)}`
          );
        } catch (err) {
          pageReadError = redactEvidence(err.providerResponse || { message: err.message });
        }
      }
      facebook = {
        connected: true,
        connectionStatus: account.status,
        pageId: pageId || null,
        pageTokenPresent: hasPageToken,
        page: page ? redactEvidence(page) : null,
        pageReadError,
      };
    } catch (err) {
      facebook = { connected: false, error: err.message };
    }

    const proposedRunKey = runKey || null;
    return res.json({
      readOnly: true,
      environment: currentEnvironment(),
      brand: {
        brandId: brand.brand_id,
        brandName: brand.brand_name,
        ownerEmail: brand.owner_email,
        userId: brand.user_id,
      },
      facebook,
      email: {
        smtpConfigured: Boolean(process.env.SMTP_HOST),
        smtpHost: process.env.SMTP_HOST || null,
        fromAddress: process.env.EMAIL_FROM || null,
        proposedRecipient: to || null,
      },
      proposedPostText: DEFAULT_PROOF_POST_TEXT,
      runKey: proposedRunKey,
      existingProofs: proposedRunKey ? await getRunProofs(proposedRunKey) : [],
    });
  } catch (err) {
    console.error("Staging-proof preflight error:", err.message);
    return res.status(500).json({ error: "Preflight failed", detail: err.message });
  }
}

/**
 * Guards run/tenant consistency: every proof row already written under this
 * run key must carry the same brand. Prevents cross-brand run-key collisions
 * from mixing evidence (architect finding).
 */
async function assertRunBrandConsistent(runKey, brandId) {
  const rows = await getRunProofs(runKey);
  const conflicting = rows.find((r) => r.brand_id && brandId && r.brand_id !== brandId);
  if (conflicting) {
    const err = new Error(
      `Run key '${runKey}' already carries evidence for a different brand — one run key, one tenant`
    );
    err.statusCode = 409;
    throw err;
  }
}

/**
 * POST /api/staging-proof/post  { runKey, brandId, text? }
 *
 * Claims (or returns) THE one social_posts row for this run — the atomic
 * claim that makes retries double-post-proof (owner term 12): the row is
 * bound to the run key via a unique partial index BEFORE any publish, so
 * even a crash between publish and proof-row write cannot lead a retry to
 * schedule a second post. Creates a 'scheduled' row only; publishing still
 * goes through the real POST /api/social/posts/:id/publish-now machinery.
 */
async function createProofPost(req, res) {
  const { runKey, brandId, text } = req.body || {};
  if (!runKey || !brandId) {
    return res.status(400).json({ error: "runKey and brandId are required" });
  }
  try {
    const brandResult = await db.query(
      `SELECT brand_id, is_demo, user_id FROM brands WHERE brand_id = $1`,
      [brandId]
    );
    if (brandResult.rows.length === 0) {
      return res.status(404).json({ error: "Brand not found" });
    }
    if (brandResult.rows[0].is_demo) {
      return res.status(409).json({ error: "Demo brands cannot carry external proofs" });
    }
    await assertRunBrandConsistent(runKey, brandId);

    // Atomic claim: the unique partial index on proof_run_key makes this a
    // get-or-create — concurrent/retried runners converge on one row.
    await db.query(
      `INSERT INTO social_posts
         (brand_id, platform, post_content, scheduled_time, status, proof_run_key)
       VALUES ($1, 'facebook', $2, NOW(), 'scheduled', $3)
       ON CONFLICT (proof_run_key) WHERE proof_run_key IS NOT NULL DO NOTHING`,
      [brandId, text || DEFAULT_PROOF_POST_TEXT, runKey]
    );
    const existing = await db.query(
      `SELECT post_id, brand_id, status, post_content, external_post_id
         FROM social_posts WHERE proof_run_key = $1`,
      [runKey]
    );
    const post = existing.rows[0];
    if (!post) {
      return res.status(500).json({ error: "Proof post claim failed" });
    }
    if (post.brand_id !== brandId) {
      return res.status(409).json({
        error: `Run key '${runKey}' is already bound to a different brand's post`,
      });
    }
    return res.json({ runKey, post, reused: post.status !== "scheduled" || undefined });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Staging-proof post claim error:", err.message);
    return res.status(status).json({ error: err.message });
  }
}

/**
 * POST /api/staging-proof/facebook  { runKey, postId }
 *
 * Records the three Facebook evidence stages for a post that the REAL
 * publish machinery (POST /api/social/posts/:id/publish-now) has already
 * published:
 *   1. publish  — proof row from the social_posts row (external_post_id was
 *                 written by publishStoredPost from the Graph response; if
 *                 the post never published there is nothing to record — 409).
 *   2. readback — live Graph GET of the post, verbatim body.
 *   3. delete   — live Graph DELETE, verbatim body.
 * Stops at the first failing stage; completed stages keep their rows.
 */
async function runFacebook(req, res) {
  const { runKey, postId } = req.body || {};
  if (!runKey || !postId) {
    return res.status(400).json({ error: "runKey and postId are required" });
  }
  const environment = currentEnvironment();
  const stages = [];
  try {
    const postResult = await db.query(
      `SELECT sp.post_id, sp.brand_id, sp.status, sp.post_content,
              sp.external_post_id, sp.published_time, sp.proof_run_key, b.user_id
         FROM social_posts sp JOIN brands b ON b.brand_id = sp.brand_id
        WHERE sp.post_id = $1 AND b.is_demo = false`,
      [postId]
    );
    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }
    const post = postResult.rows[0];
    // Run binding: evidence may only be filed under the run the post was
    // claimed for (architect finding — no cross-run/cross-tenant mixing).
    if (post.proof_run_key !== runKey) {
      return res.status(409).json({
        error: "Post is not bound to this run key — claim it via /api/staging-proof/post first",
      });
    }
    await assertRunBrandConsistent(runKey, post.brand_id);
    if (post.status !== "published" || !post.external_post_id) {
      // Never write a proof row before the provider accepted the action.
      return res.status(409).json({
        error: `Post is '${post.status}' without an external id — publish it via the real publish machinery first; no proof row written`,
      });
    }

    // Stage 1: publish evidence (from the machinery-written provider id).
    const publishProof = await recordExternalProof({
      runKey,
      provider: "facebook",
      action: "publish",
      externalId: post.external_post_id,
      brandId: post.brand_id,
      userId: post.user_id,
      environment,
      evidence: {
        source:
          "social_posts row written by publishStoredPost from the Graph publish response",
        post_id: post.post_id,
        external_post_id: post.external_post_id,
        published_time: post.published_time,
        post_content: post.post_content,
      },
    });
    stages.push({ stage: "publish", created: publishProof.created, proof: publishProof.row });

    // Page token for the read-only + delete Graph calls.
    const account = await loadConnectedAccount(post.brand_id, "facebook");
    const token = account.credentials.accessToken;
    if (!token) {
      return res.status(502).json({
        error: "No Facebook page token available for read-back",
        stages,
      });
    }

    // If deletion already proven for this run, don't touch Graph again.
    const existing = await getRunProofs(runKey);
    const alreadyDeleted = existing.some(
      (r) => r.provider === "facebook" && r.action === "delete"
    );

    // Stage 2: read-back (skipped only when the run already proved deletion —
    // the post no longer exists on the Page).
    if (!alreadyDeleted) {
      let readback;
      try {
        readback = await graphJson(
          `${GRAPH_BASE}/${post.external_post_id}?fields=id,message,created_time,permalink_url&access_token=${encodeURIComponent(token)}`
        );
      } catch (err) {
        return res.status(502).json({
          error: `Graph read-back failed: ${err.message}`,
          providerResponse: redactEvidence(err.providerResponse || null),
          stages,
          livePostId: post.external_post_id,
          cleanupIncomplete: true,
        });
      }
      const readbackProof = await recordExternalProof({
        runKey,
        provider: "facebook",
        action: "readback",
        externalId: post.external_post_id,
        brandId: post.brand_id,
        userId: post.user_id,
        environment,
        evidence: readback,
      });
      stages.push({ stage: "readback", created: readbackProof.created, proof: readbackProof.row });

      // Stage 3: delete.
      let deletion;
      try {
        deletion = await graphJson(`${GRAPH_BASE}/${post.external_post_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (err) {
        return res.status(502).json({
          error: `Graph delete failed: ${err.message}`,
          providerResponse: redactEvidence(err.providerResponse || null),
          stages,
          livePostId: post.external_post_id,
          cleanupIncomplete: true,
        });
      }
      const deleteProof = await recordExternalProof({
        runKey,
        provider: "facebook",
        action: "delete",
        externalId: post.external_post_id,
        brandId: post.brand_id,
        userId: post.user_id,
        environment,
        evidence: deletion,
      });
      stages.push({ stage: "delete", created: deleteProof.created, proof: deleteProof.row });
    } else {
      stages.push({ stage: "readback", skipped: "deletion already proven for this run" });
      stages.push({ stage: "delete", skipped: "already proven for this run" });
    }

    return res.json({ runKey, environment, stages, complete: true });
  } catch (err) {
    console.error("Staging-proof facebook error:", err.message);
    return res.status(500).json({ error: err.message, stages });
  }
}

/**
 * POST /api/staging-proof/email  { runKey, to, brandId }
 * Sends ONE email through utils/email.sendEmail (the app's real transport)
 * and records the proof row from the SMTP response. Failure writes no row.
 */
async function runEmail(req, res) {
  const { runKey, to, brandId } = req.body || {};
  if (!runKey || !to) {
    return res.status(400).json({ error: "runKey and to are required" });
  }
  const environment = currentEnvironment();
  try {
    if (brandId) await assertRunBrandConsistent(runKey, brandId);
    let result;
    try {
      result = await emailTransport.sendEmail({
        to,
        subject: `Zorecho external proof ${runKey}`,
        html:
          `<p>This is a one-off staging proof email for run <strong>${runKey}</strong>.</p>` +
          `<p>Sent from the ${environment} environment via the application's own email transport.</p>`,
      });
    } catch (err) {
      // No provider acceptance -> no proof row.
      return res.status(502).json({
        error: `Email send failed: ${err.message}`,
        proofWritten: false,
      });
    }
    const proof = await recordExternalProof({
      runKey,
      provider: "email",
      action: "send",
      externalId: result.messageId || null,
      brandId: brandId || null,
      userId: req.user ? req.user.userId : null,
      environment,
      evidence: {
        source: "utils/email.sendEmail SMTP response",
        messageId: result.messageId || null,
        to: result.to,
        success: result.success === true,
      },
    });
    return res.json({ runKey, environment, created: proof.created, proof: proof.row });
  } catch (err) {
    console.error("Staging-proof email error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

/** GET /api/staging-proof/runs/:runKey — all proof rows for a run. */
async function getRun(req, res) {
  try {
    const rows = await getRunProofs(req.params.runKey);
    return res.json({ runKey: req.params.runKey, proofs: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = {
  preflight,
  createProofPost,
  runFacebook,
  runEmail,
  getRun,
  DEFAULT_PROOF_POST_TEXT,
};
