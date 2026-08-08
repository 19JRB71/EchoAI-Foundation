/**
 * Prompt 022 — Sage pre-interview public research orchestrator.
 *
 * THE canonical entry point for pre-interview research (D-33 A4): the guided
 * wizard, reruns, and any future caller converge here. Produces an UNAPPROVED,
 * source-tagged draft business profile in sage_research_drafts. NEVER writes
 * authoritative brands columns.
 *
 * D-33 B1 — ZERO LOCAL FETCHES: this module performs no local URL fetches.
 * Website / public-web evidence comes from Anthropic's SERVER-SIDE
 * web_fetch / web_search tools (via prompts/sageResearchPrompt ->
 * config/anthropic createMessage); Facebook basics come only from the
 * existing fixed-host Graph API path (utils/facebookApi). Owner-supplied URLs
 * travel exclusively as data/text.
 *
 * D-33 B2 — HARD $0.50 AI BUDGET, PRE-CALL RESERVATION: before every AI call
 * the orchestrator reserves that call's conservative worst-case cost from the
 * live pricing table. spent(reserved) + next_reservation <= $0.50 or the call
 * is never issued. Reserved worst-case is what we count as spent — an upper
 * bound on actuals — so the cap is structural, not retrospective.
 *
 * D-33 B3 — HARD 90s WALL CLOCK: phases are admitted only while
 * remaining >= 10s; each admitted provider call races an in-orchestrator
 * deadline of (remaining - finalize reserve), after which its late result is
 * DISCARDED (the underlying call still settles and its usage is ledgered) and
 * the run finalizes honestly with whatever evidence it already holds.
 */

const crypto = require("crypto");
const db = require("../config/db");
const { PRICING } = require("./aiUsage");
const { decrypt } = require("./encryption");
const { graphRequest } = require("./facebookApi");
const research = require("../prompts/sageResearchPrompt");

const { FIELD_KEYS } = research;

// ---------------------------------------------------------------------------
// stop_reason CONTRACT (D-33 B5). Prompt 011 / Ops Dashboard may consume these.
// Additions require owner approval.
// ---------------------------------------------------------------------------
const STOP_REASONS = Object.freeze({
  AI_BLOCKED: "ai_blocked", // aiGate refused admission
  AI_BUDGET: "ai_budget", // $0.50 reservation could not admit the next call
  TIME_BUDGET: "time_budget", // 90s phase-admission deadline reached
  PROVIDER_ERROR: "provider_error", // provider/tool failure on every attempted source
  MALFORMED_OUTPUT: "malformed_output", // model output unusable after one bounded re-parse
  NO_PUBLIC_INFO: "no_public_info", // research ran but found nothing
  DB_ERROR: "db_error", // draft persistence failed
  STALE_CLAIM: "stale_claim", // running claim swept after the 10-minute rescue window
});

// ---------------------------------------------------------------------------
// Budgets.
// ---------------------------------------------------------------------------
// Env overrides exist ONLY so the test suite can exercise the deadline logic
// without a real 90-second wait; production never sets them.
const AI_BUDGET_USD = 0.5;
const RUN_BUDGET_MS = Number(process.env.SAGE_RESEARCH_BUDGET_MS) || 90_000;
const ADMISSION_FLOOR_MS = Number(process.env.SAGE_RESEARCH_FLOOR_MS) || 10_000;
const FINALIZE_RESERVE_MS = Number(process.env.SAGE_RESEARCH_FINALIZE_RESERVE_MS) || 5_000;
const STALE_CLAIM_MINUTES = 10;

// Conservative worst-case reservation per AI phase (attempts:1, so exactly one
// createMessage invocation — which may internally span up to 5 bounded
// pause_turn continuations, i.e. <= 6 provider requests). Reservations bound
// the WHOLE invocation:
//   - inputTokens: total billed input across all 6 possible requests
//     (tiny prompt + server-tool ingestion + re-sent context each round);
//   - outputTokens: max_tokens(1000) x 6 possible requests;
//   - webSearches: tool max_uses x 6 possible requests (each continuation
//     request carries the tool config again), $0.01 each. The website phase
//     uses web_fetch, which has no per-use fee.
// The re-parse call carries NO server tools, so pause_turn cannot occur:
// exactly one request (6k-char raw text in, max_tokens 800 out).
const RESERVATIONS = Object.freeze({
  website: { inputTokens: 36_000, outputTokens: 6_000, webSearches: 0 },
  public_web: { inputTokens: 36_000, outputTokens: 6_000, webSearches: 6 },
  reparse: { inputTokens: 6_000, outputTokens: 800, webSearches: 0 },
});

function reservationUsd(name) {
  const r = RESERVATIONS[name];
  const p = PRICING.anthropic;
  return (
    (r.inputTokens * p.inputPerM + r.outputTokens * p.outputPerM) / 1e6 +
    r.webSearches * p.perWebSearch
  );
}

// ---------------------------------------------------------------------------
// D-23 redaction — kept inside the 022 module (C7).
// ---------------------------------------------------------------------------

/** Strip credentials, query strings and fragments from a persisted source URL. */
function redactUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return null;
  }
}

/** Redact provider/tool error text before persisting (no URLs w/ queries, no tokens). */
function redactErrorText(raw) {
  if (!raw) return null;
  return String(raw)
    .replace(/https?:\/\/[^\s"']+/gi, (m) => redactUrl(m) || "[url]")
    .replace(/\bbearer\s+[^\s"']+/gi, "bearer [redacted]")
    .replace(/(token|key|secret|authorization)[=:\s]+[^\s"']+/gi, "$1=[redacted]")
    .slice(0, 300);
}

// ---------------------------------------------------------------------------
// PROPOSAL ORDERING (D-33 B4). This is NOT an authority rule: it only decides
// which candidate occupies the `value` slot of an UNAPPROVED draft field. It
// does not mean the website has been proven true. Recency-conditioned
// reordering is prohibited for 022.
// ---------------------------------------------------------------------------
const PROPOSAL_ORDER = Object.freeze(["website", "facebook", "public_web", "inferred"]);

function proposalRank(source) {
  const i = PROPOSAL_ORDER.indexOf(source);
  return i === -1 ? PROPOSAL_ORDER.length : i;
}

function normValue(v) {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Deterministic candidate ordering:
 *   1. proposal ordering class rank (website > facebook > public_web > inferred)
 *   2. INTRA-CLASS TIEBREAK: redacted source_url ascending (byte order),
 *   3. then normalized value ascending (byte order).
 * The same evidence therefore always yields the same proposed value on rerun.
 */
function compareCandidates(a, b) {
  const r = proposalRank(a.source) - proposalRank(b.source);
  if (r !== 0) return r;
  const ua = a.source_url || "";
  const ub = b.source_url || "";
  if (ua !== ub) return ua < ub ? -1 : 1;
  const va = normValue(a.value);
  const vb = normValue(b.value);
  return va < vb ? -1 : va > vb ? 1 : 0;
}

/**
 * Merge per-field evidence candidates into the persisted field contract.
 * Candidates: { field, value, source, source_url, retrieved_at, excerpt, basis }.
 * NO FIELD WITHOUT PROVENANCE: candidates missing value/source/source_url/
 * excerpt (or basis when inferred) are dropped, never patched.
 */
function mergeCandidates(candidates) {
  const byField = new Map();
  for (const c of candidates) {
    if (!c || !FIELD_KEYS.includes(c.field)) continue;
    if (typeof c.value !== "string" || !c.value.trim()) continue;
    if (!PROPOSAL_ORDER.includes(c.source)) continue;
    const url = redactUrl(c.source_url);
    if (!url) continue; // provenance is mandatory
    if (typeof c.excerpt !== "string" || !c.excerpt.trim()) continue;
    if (c.source === "inferred" && (typeof c.basis !== "string" || !c.basis.trim())) continue;
    if (!c.retrieved_at) continue;
    const list = byField.get(c.field) || [];
    list.push({ ...c, source_url: url, value: c.value.trim(), excerpt: c.excerpt.trim().slice(0, 300) });
    byField.set(c.field, list);
  }

  const fields = {};
  for (const [field, list] of byField.entries()) {
    list.sort(compareCandidates);

    // Group by normalized value: same value from several sources corroborates.
    const groups = new Map();
    for (const c of list) {
      const key = normValue(c.value);
      const g = groups.get(key) || [];
      g.push(c);
      groups.set(key, g);
    }

    const winner = list[0];
    const winnerKey = normValue(winner.value);
    const winnerGroup = groups.get(winnerKey);
    const losers = [...groups.entries()].filter(([k]) => k !== winnerKey);

    const conflict = losers.length > 0;
    const sourceEntry = (c) => ({
      source: c.source,
      source_url: c.source_url,
      retrieved_at: c.retrieved_at,
      excerpt: c.excerpt,
      ...(c.source === "inferred" ? { basis: c.basis } : {}),
    });

    let confidence;
    if (conflict || winner.source === "inferred") confidence = "low";
    else if (
      winnerGroup.length >= 2 ||
      winner.source === "website" ||
      winner.source === "facebook"
    ) confidence = "high";
    else confidence = "medium"; // single public_web source
    if (conflict) confidence = "low";

    fields[field] = {
      value: winner.value,
      confidence,
      sources: winnerGroup.map(sourceEntry), // ordered; [0] = primary evidence
      conflict,
      alternatives: losers.map(([, g]) => ({
        value: g[0].value,
        sources: g.map(sourceEntry),
      })),
    };
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Run lifecycle.
// ---------------------------------------------------------------------------

/** Sweep failed drafts and stale running claims (>10 min) for a brand. */
async function sweepStaleClaims(brandId) {
  await db.query(
    `UPDATE sage_research_drafts
        SET status = 'failed', stop_reason = $2, finished_at = NOW(),
            error_message = 'Research was interrupted (deploy or crash) and has been reset.'
      WHERE brand_id = $1 AND status = 'running'
        AND started_at < NOW() - INTERVAL '${STALE_CLAIM_MINUTES} minutes'`,
    [brandId, STOP_REASONS.STALE_CLAIM],
  );
  await db.query(
    `DELETE FROM sage_research_drafts WHERE brand_id = $1 AND status = 'failed'`,
    [brandId],
  );
}

/**
 * Claim a research run for the brand. Returns { draftId, runId } or throws
 * err.inProgress=true when another run holds the claim (23505 -> 409).
 */
async function claimRun(brandId, userId) {
  await module.exports.sweepStaleClaims(brandId);
  const runId = crypto.randomUUID();
  try {
    const { rows } = await db.query(
      `INSERT INTO sage_research_drafts (brand_id, user_id, run_id, status)
       VALUES ($1, $2, $3, 'running') RETURNING draft_id, run_id`,
      [brandId, userId, runId],
    );
    return { draftId: rows[0].draft_id, runId: rows[0].run_id };
  } catch (e) {
    if (e.code === "23505") {
      const err = new Error("Sage is already researching this business. Give it a moment.");
      err.inProgress = true;
      throw err;
    }
    throw e;
  }
}

/**
 * ONE guarded finalize write: supersede the previous active draft and land
 * this run's snapshot, only if our claim is still 'running' (row-count
 * branch). Fields from two runs can never interleave — all evidence lives in
 * this run's memory until this single write.
 */
async function finalizeRun({ runId, brandId, status, fields, summary, stopReason, aiCostCents, elapsedMs, errorMessage }) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    // Step 1: land the snapshot on our still-running claim (row-count guarded);
    // the row stays 'running' until the old active draft is superseded so the
    // one-active partial unique index can never collide mid-transaction.
    const updated = await client.query(
      `UPDATE sage_research_drafts
          SET fields = $2::jsonb, summary = $3, stop_reason = $4,
              ai_cost_cents = $5, elapsed_ms = $6, error_message = $7, finished_at = NOW()
        WHERE run_id = $1 AND status = 'running'
        RETURNING draft_id`,
      [
        runId,
        JSON.stringify(fields || {}),
        summary || null,
        stopReason || null,
        aiCostCents == null ? null : Math.round(aiCostCents),
        elapsedMs == null ? null : Math.round(elapsedMs),
        errorMessage || null,
      ],
    );
    if (!updated.rows.length) {
      await client.query("ROLLBACK");
      return false; // claim swept/superseded out-of-band — discard honestly
    }
    if (status !== "failed") {
      await client.query(
        `UPDATE sage_research_drafts SET status = 'superseded'
          WHERE brand_id = $1 AND status IN ('complete','partial','empty')`,
        [brandId],
      );
    }
    await client.query(
      `UPDATE sage_research_drafts SET status = $2 WHERE run_id = $1`,
      [runId, status],
    );
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Phases. Each returns candidates; failures degrade (remaining sources run).
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

/** Convert prompt-module findings into provenance candidates. */
function candidatesFromFindings(result, source, fallbackUrl) {
  if (!result || result.found !== true || !Array.isArray(result.findings)) return [];
  const retrievedAt = nowIso(); // stamped at ACTUAL retrieval (this phase), never at display
  return result.findings.map((f) => ({
    field: f && f.field,
    value: f && f.value,
    source,
    source_url: (f && f.url) || fallbackUrl,
    retrieved_at: retrievedAt,
    excerpt: f && f.excerpt,
  }));
}

/** Extract a Facebook Page username/id from a stored page URL. */
function pageRefFromUrl(pageUrl) {
  try {
    const u = new URL(pageUrl);
    if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
    const seg = u.pathname.split("/").filter(Boolean);
    if (!seg.length) return null;
    if (seg[0] === "profile.php") return u.searchParams.get("id");
    return seg[0];
  } catch {
    return null;
  }
}

/** Facebook basics via the existing fixed-host Graph path. No AI, no local fetch of user URLs. */
async function facebookPhase(brand) {
  const pageRef = pageRefFromUrl(brand.facebook_page_url || "");
  if (!pageRef) return { candidates: [], skipped: "no usable Facebook page URL" };
  const tok = await db.query(
    `SELECT api_token_encrypted, connection_status FROM api_integrations
      WHERE user_id = $1 AND platform = 'facebook'`,
    [brand.user_id],
  );
  if (!tok.rows.length || tok.rows[0].connection_status !== "connected") {
    return { candidates: [], skipped: "Facebook is not connected" };
  }
  const accessToken = decrypt(tok.rows[0].api_token_encrypted);
  const data = await graphRequest(pageRef, {
    params: { fields: "name,about,description,category,phone,emails,website,single_line_address" },
    accessToken,
  });
  const url = redactUrl(brand.facebook_page_url) || `https://facebook.com/${pageRef}`;
  const retrievedAt = nowIso();
  const cand = (field, value, excerpt) =>
    value && typeof value === "string"
      ? { field, value, source: "facebook", source_url: url, retrieved_at: retrievedAt, excerpt }
      : null;
  return {
    candidates: [
      cand("business_name", data.name, `Page name: ${data.name}`),
      cand("description", data.about || data.description, (data.about || data.description || "").slice(0, 200)),
      cand("phone", data.phone, `Listed phone: ${data.phone}`),
      cand(
        "email",
        Array.isArray(data.emails) && typeof data.emails[0] === "string" ? data.emails[0] : null,
        `Listed email: ${Array.isArray(data.emails) ? data.emails[0] : ""}`,
      ),
      cand("address", data.single_line_address, `Listed address: ${data.single_line_address}`),
    ].filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// The research run.
// ---------------------------------------------------------------------------

function raceDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error("research run deadline reached");
      err.runDeadline = true;
      reject(err);
    }, Math.max(1, ms));
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Execute the claimed run in the background. Never throws; every outcome
 * finalizes honestly. All evidence accumulates here in memory and lands in
 * one guarded write.
 */
async function runResearch(brand, { runId }) {
  const startedAt = Date.now();
  const deadline = startedAt + RUN_BUDGET_MS;
  let reservedSpentUsd = 0; // reserved worst-case counted as spent (upper bound)
  const candidates = [];
  const notes = [];
  let sawProviderError = false;
  let sawAiBlocked = false;
  let sawMalformed = false;
  let stopReason = null;
  let reparseUsed = false;

  const remaining = () => deadline - Date.now();

  /** Admission: time floor + hard budget reservation. Returns admit decision. */
  const admit = (reservationName) => {
    if (remaining() < ADMISSION_FLOOR_MS) {
      stopReason = stopReason || STOP_REASONS.TIME_BUDGET;
      return null;
    }
    const reserve = reservationUsd(reservationName);
    if (reservedSpentUsd + reserve > AI_BUDGET_USD) {
      stopReason = stopReason || STOP_REASONS.AI_BUDGET;
      return null;
    }
    return {
      reserve,
      timeout: Math.min(45_000, Math.max(ADMISSION_FLOOR_MS, remaining() - FINALIZE_RESERVE_MS)),
    };
  };

  /** Run one AI phase with admission, deadline race and one bounded re-parse. */
  const aiPhase = async (name, reservationName, call) => {
    let slot = admit(reservationName);
    if (!slot) return;
    reservedSpentUsd += slot.reserve;
    try {
      return await raceDeadline(call(slot.timeout), remaining() - FINALIZE_RESERVE_MS);
    } catch (err) {
      if (err && err.runDeadline) {
        stopReason = stopReason || STOP_REASONS.TIME_BUDGET;
        notes.push(`${name}: ran out of time`);
        return;
      }
      if (err && err.aiBlocked) {
        sawAiBlocked = true;
        notes.push(`${name}: AI is currently unavailable`);
        return;
      }
      if (err && err.aiInvalid && err.rawText && !reparseUsed) {
        // ONE bounded corrective re-parse across the whole run: a tool-free
        // JSON-extraction call over the malformed raw text, separately
        // admitted under the (cheaper) reparse reservation.
        reparseUsed = true;
        slot = admit("reparse");
        if (!slot) return;
        reservedSpentUsd += slot.reserve;
        try {
          return await raceDeadline(
            module.exports._reparseJson(brand, err.rawText, { timeout: slot.timeout }),
            remaining() - FINALIZE_RESERVE_MS,
          );
        } catch (err2) {
          if (err2 && err2.runDeadline) stopReason = stopReason || STOP_REASONS.TIME_BUDGET;
          else if (err2 && err2.aiInvalid) sawMalformed = true;
          else sawProviderError = true;
          notes.push(`${name}: could not read a usable result`);
          return;
        }
      }
      if (err && err.aiInvalid) sawMalformed = true;
      else sawProviderError = true;
      notes.push(`${name}: ${err && err.aiInvalid ? "unusable result" : "source unavailable"}`);
    }
  };

  try {
    // Phase 1 — the owner's own website (Anthropic server-side web_fetch).
    if (brand.website_url) {
      const result = await aiPhase("website", "website", (timeout) =>
        module.exports._researchWebsite(brand, brand.website_url, { timeout }),
      );
      if (result && result.found === false) notes.push(`website: ${redactErrorText(result.reason) || "nothing readable"}`);
      candidates.push(...candidatesFromFindings(result, "website", brand.website_url));
    } else {
      notes.push("website: none on file");
    }

    // Phase 2 — Facebook Page basics (existing fixed-host Graph path; no AI).
    if (remaining() >= ADMISSION_FLOOR_MS) {
      try {
        const fb = await raceDeadline(
          module.exports._facebookPhase(brand),
          Math.max(1, remaining() - FINALIZE_RESERVE_MS),
        );
        if (fb.skipped) notes.push(`facebook: ${fb.skipped}`);
        candidates.push(...fb.candidates);
      } catch (err) {
        if (err && err.runDeadline) stopReason = stopReason || STOP_REASONS.TIME_BUDGET;
        else {
          sawProviderError = true;
          notes.push("facebook: source unavailable");
        }
      }
    } else {
      stopReason = stopReason || STOP_REASONS.TIME_BUDGET;
    }

    // Phase 3 — public-web fallback, only when evidence is still thin.
    const fieldsSoFar = new Set(candidates.map((c) => c.field)).size;
    if (fieldsSoFar < 3) {
      const result = await aiPhase("public web", "public_web", (timeout) =>
        module.exports._researchPublicWeb(
          brand,
          {
            websiteUrl: brand.website_url,
            facebookPageUrl: brand.facebook_page_url,
            industry: brand.industry,
          },
          { timeout },
        ),
      );
      if (result && result.found === false) notes.push(`public web: ${redactErrorText(result.reason) || "nothing found"}`);
      candidates.push(...candidatesFromFindings(result, "public_web", null));
    }

    const fields = mergeCandidates(candidates);
    const fieldCount = Object.keys(fields).length;

    let status;
    if (fieldCount === 0) {
      status = "empty";
      if (sawAiBlocked) stopReason = STOP_REASONS.AI_BLOCKED;
      else if (stopReason == null && sawProviderError) stopReason = STOP_REASONS.PROVIDER_ERROR;
      else if (stopReason == null && sawMalformed) stopReason = STOP_REASONS.MALFORMED_OUTPUT;
      else if (stopReason == null) stopReason = STOP_REASONS.NO_PUBLIC_INFO;
    } else if (stopReason || sawProviderError || sawAiBlocked || sawMalformed) {
      status = "partial";
      if (!stopReason) stopReason = sawAiBlocked
        ? STOP_REASONS.AI_BLOCKED
        : sawMalformed && !sawProviderError
          ? STOP_REASONS.MALFORMED_OUTPUT
          : STOP_REASONS.PROVIDER_ERROR;
    } else {
      status = "complete";
    }

    const summary =
      fieldCount === 0
        ? "I could not find much publicly; I will ask a few more questions."
        : `Sage found ${fieldCount} thing${fieldCount === 1 ? "" : "s"} about your business publicly. Nothing is saved to your profile until you confirm it.${notes.length ? ` (${notes.join("; ")})` : ""}`;

    await module.exports.finalizeRun({
      runId,
      brandId: brand.brand_id,
      status,
      fields,
      summary,
      stopReason,
      aiCostCents: reservedSpentUsd * 100,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err) {
    // Persistence or unexpected failure: flip the claim honestly; never throw.
    console.error("Sage research run failed:", err.message);
    try {
      await module.exports.finalizeRun({
        runId,
        brandId: brand.brand_id,
        status: "failed",
        fields: {},
        summary: null,
        stopReason: STOP_REASONS.DB_ERROR,
        aiCostCents: reservedSpentUsd * 100,
        elapsedMs: Date.now() - startedAt,
        errorMessage: "Research could not be saved. You can continue — Sage will just ask a few more questions.",
      });
    } catch (e2) {
      console.error("Sage research finalize failed:", e2.message);
    }
  }
}

module.exports = {
  STOP_REASONS,
  PROPOSAL_ORDER,
  RESERVATIONS,
  AI_BUDGET_USD,
  RUN_BUDGET_MS,
  ADMISSION_FLOOR_MS,
  FINALIZE_RESERVE_MS,
  FIELD_KEYS,
  reservationUsd,
  redactUrl,
  redactErrorText,
  compareCandidates,
  mergeCandidates,
  pageRefFromUrl,
  sweepStaleClaims,
  claimRun,
  finalizeRun,
  runResearch,
  // Seams (stubbed by tests; production values below).
  _researchWebsite: research.researchWebsite,
  _researchPublicWeb: research.researchPublicWeb,
  _reparseJson: research.reparseJson,
  _facebookPhase: facebookPhase,
};
