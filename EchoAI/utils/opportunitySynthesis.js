/**
 * Sage V2 Phase 5 — weekly Opportunity Synthesis.
 *
 * ONE AI call per brand per week (W7). The call produces BOTH the
 * diagnostics narrative and the proposed opportunities; deterministic
 * decomposition runs FIRST (zero AI) so the numbers exist even when the AI
 * fails — a failed call leaves the queue unchanged and the narrative NULL,
 * never fabricated content.
 *
 * Chokepoint rules re-enforced in code (never trusted from the model):
 *  - no evidence → no opportunity (cited ids must exist in the provided set)
 *  - confidence = min of cited evidence tiers, recomputed here
 *  - expected_impact requires impact_basis AND outcome coverage ≥ 30%
 *  - max 5 open per brand, enforced under a per-brand advisory lock
 *  - open-content dedup via content_key partial unique index (23505 → skip)
 *  - declined within 90 days re-proposed ONLY with newer evidence
 *  - constraint clamp point #1: blackout/capacity flags attached post-
 *    validation (clampBudget lives at directive issue time, point #2)
 *  - demo brands are excluded by the caller (scheduler realBrands sweep)
 */

const crypto = require("crypto");
const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");
const { createMessage, MODEL } = require("../config/anthropic");
const { extractJsonObject } = require("../prompts/voiceContentPrompt");
const { buildOpportunitySynthesisPrompt } = require("../prompts/opportunitySynthesisPrompt");
const { runDiagnosticsForBrand, saveNarrative, weekStartOf } = require("./changeDiagnostics");
const { computeConfidence, buildConfidenceExplanation } = require("./confidenceExplanation");
const { coverageForBrand } = require("./leadOutcome");
const { checkCapacity, isBlackedOut } = require("./constraintClamp");

const MAX_OPEN_PER_BRAND = 5;
const MAX_PER_RUN = 3;
const OPEN_STATUSES = ["proposed", "approved", "directed", "in_progress", "executed", "measuring"];
const CATEGORIES = ["growth", "efficiency", "risk", "retention", "positioning"];
const DEPARTMENTS = ["nova", "atlas", "forge", "pulse", "voice", "owner"];
const DECLINE_BLOCK_DAYS = 90;
const PROPOSAL_TTL_DAYS = 21;

function contentKeyOf(category, title) {
  const stem = `${category}:${String(title).toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 8).join(" ")}`;
  return crypto.createHash("sha256").update(stem).digest("hex").slice(0, 32);
}

async function gatherInputs(brand) {
  const [evidence, coverage, open, declines, constraints] = await Promise.all([
    db.query(
      `SELECT item_id, source, source_type, confidence, summary, why_it_matters, created_at
         FROM sage_intel_items
        WHERE brand_id = $1 AND dismissed_at IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
          AND created_at > NOW() - INTERVAL '30 days'
        ORDER BY created_at DESC
        LIMIT 40`,
      [brand.brand_id],
    ),
    coverageForBrand(brand.brand_id),
    db.query(
      `SELECT opportunity_id, title, status, content_key
         FROM sage_opportunities
        WHERE brand_id = $1 AND status = ANY($2)`,
      [brand.brand_id, OPEN_STATUSES],
    ),
    db.query(
      `SELECT opportunity_id, title, content_key, decided_at, owner_decision_note
         FROM sage_opportunities
        WHERE brand_id = $1 AND status = 'declined'
          AND decided_at > NOW() - ($2 || ' days')::interval`,
      [brand.brand_id, String(DECLINE_BLOCK_DAYS)],
    ),
    db.query("SELECT * FROM brand_constraints WHERE brand_id = $1", [brand.brand_id]),
  ]);
  return {
    evidenceItems: evidence.rows,
    coverage,
    openOpportunities: open.rows,
    recentDeclines: declines.rows,
    constraints: constraints.rows[0] || null,
  };
}

/**
 * Validate one AI-proposed opportunity against the chokepoint rules.
 * Returns { ok, reason } and (on ok) the normalized record.
 */
function validateProposal(p, ctx) {
  const { evidenceById, coverage, recentDeclines } = ctx;
  if (!p || typeof p !== "object") return { ok: false, reason: "not_an_object" };
  const title = typeof p.title === "string" ? p.title.trim().slice(0, 200) : "";
  const thesis = typeof p.thesis === "string" ? p.thesis.trim().slice(0, 2000) : "";
  if (!title || !thesis) return { ok: false, reason: "missing_title_or_thesis" };
  const category = CATEGORIES.includes(p.category) ? p.category : null;
  if (!category) return { ok: false, reason: "bad_category" };
  const department = DEPARTMENTS.includes(p.recommended_department) ? p.recommended_department : null;
  if (!department) return { ok: false, reason: "bad_department" };

  // Chokepoint: cited evidence must exist in the provided set.
  const ids = Array.isArray(p.evidence_item_ids) ? [...new Set(p.evidence_item_ids)] : [];
  const cited = ids.map((id) => evidenceById.get(String(id))).filter(Boolean);
  if (!cited.length) return { ok: false, reason: "no_valid_evidence" };

  const confidence = computeConfidence(cited);
  if (!confidence) return { ok: false, reason: "unknown_evidence_confidence" };

  // Impact honesty: needs a basis AND sufficient coverage; else null both.
  let impactCents = null;
  let impactBasis = null;
  if (
    Number.isInteger(p.expected_impact_cents) &&
    p.expected_impact_cents > 0 &&
    typeof p.impact_basis === "string" &&
    p.impact_basis.trim() &&
    coverage.coveragePct >= 30
  ) {
    impactCents = p.expected_impact_cents;
    impactBasis = p.impact_basis.trim().slice(0, 1000);
  }

  const contentKey = contentKeyOf(category, title);
  // Declined <90d: only re-propose with evidence newer than the decline.
  const priorDecline = recentDeclines.find((d) => d.content_key === contentKey);
  if (priorDecline) {
    const declinedAt = new Date(priorDecline.decided_at).getTime();
    const hasNewer = cited.some((e) => new Date(e.created_at).getTime() > declinedAt);
    if (!hasNewer) return { ok: false, reason: "declined_recently_no_new_evidence" };
  }

  return {
    ok: true,
    record: {
      title,
      thesis,
      category,
      confidence,
      expected_impact_cents: impactCents,
      impact_basis: impactBasis,
      cost_estimate_cents:
        Number.isInteger(p.cost_estimate_cents) && p.cost_estimate_cents >= 0 ? p.cost_estimate_cents : null,
      effort: ["s", "m", "l"].includes(p.effort) ? p.effort : null,
      risk: typeof p.risk === "string" ? p.risk.trim().slice(0, 1000) || null : null,
      recommended_department: department,
      success_metric: p.success_metric && typeof p.success_metric === "object" ? p.success_metric : null,
      failure_metric: p.failure_metric && typeof p.failure_metric === "object" ? p.failure_metric : null,
      constraint_flags: Array.isArray(p.constraint_flags) ? p.constraint_flags.filter((f) => typeof f === "string").slice(0, 10) : [],
      content_key: contentKey,
      cited,
    },
  };
}

/**
 * Clamp point #1 (advisory flags only — nothing is blocked at proposal
 * time): attach deterministic constraint facts the owner should see.
 */
function attachConstraintFlags(record, constraints) {
  if (!constraints) return record;
  const flags = [...record.constraint_flags];
  // Demand-generating work implies at least one extra job/lead per week; an
  // owner-stated capacity it cannot fit is a fact the owner must see.
  const demandDepts = ["nova", "atlas", "forge"];
  if (constraints.weekly_capacity != null && demandDepts.includes(record.recommended_department)) {
    const cap = checkCapacity(1, Number(constraints.weekly_capacity));
    if (!cap.fits) {
      flags.push("Owner-stated weekly capacity is 0 — demand-generating work will exceed capacity.");
    }
  }
  const blackouts = Array.isArray(constraints.blackout_dates) ? constraints.blackout_dates : [];
  const today = new Date().toISOString().slice(0, 10);
  if (isBlackedOut(today, blackouts)) {
    flags.push("The brand is currently in an owner-declared blackout window.");
  }
  if (
    record.cost_estimate_cents != null &&
    constraints.monthly_budget_cents != null &&
    Number(record.cost_estimate_cents) > Number(constraints.monthly_budget_cents)
  ) {
    flags.push("Estimated cost exceeds the owner's stated monthly budget.");
  }
  return { ...record, constraint_flags: [...new Set(flags)] };
}

/**
 * Deterministic bucket ranking (NO numeric scores): sort by confidence tier,
 * then has-impact-basis, then effort (small first), then category order.
 */
function bucketRank(records) {
  const confRank = { verified: 0, reported: 1, inferred: 2 };
  const effRank = { s: 0, m: 1, l: 2 };
  return [...records].sort((a, b) => {
    const c = confRank[a.confidence] - confRank[b.confidence];
    if (c) return c;
    const i = (a.impact_basis ? 0 : 1) - (b.impact_basis ? 0 : 1);
    if (i) return i;
    const e = (effRank[a.effort] ?? 3) - (effRank[b.effort] ?? 3);
    if (e) return e;
    return CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category);
  });
}

/** Insert ranked records under the per-brand advisory lock; cap at 5 open. */
async function insertOpportunities(brand, records, runKey, coverage, diagnostics) {
  const inserted = [];
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 5))", [
      `sage-opps:${brand.brand_id}`,
    ]);
    const openRes = await client.query(
      `SELECT COUNT(*)::int AS n FROM sage_opportunities
        WHERE brand_id = $1 AND status = ANY($2)`,
      [brand.brand_id, OPEN_STATUSES],
    );
    let slots = Math.max(0, MAX_OPEN_PER_BRAND - openRes.rows[0].n);
    for (const rec of records) {
      if (slots <= 0) break;
      const explanation = buildConfidenceExplanation(rec.cited, {
        outcome_coverage_pct: coverage.totalLeads > 0 ? coverage.coveragePct : undefined,
        diagnostics_fact:
          diagnostics && diagnostics.terms && !diagnostics.terms.unavailable
            ? `This week's lead change (${diagnostics.terms.delta_leads >= 0 ? "+" : ""}${diagnostics.terms.delta_leads}) was decomposed deterministically from weekly analytics.`
            : null,
      });
      const rationale = {
        confidence_explanation: explanation,
        evidence_item_ids: rec.cited.map((e) => e.item_id),
        week_start: weekStartOf(),
      };
      let row;
      try {
        const ins = await client.query(
          `INSERT INTO sage_opportunities
             (brand_id, title, thesis, category, confidence, expected_impact_cents, impact_basis,
              cost_estimate_cents, effort, risk, recommended_department, success_metric, failure_metric,
              constraint_flags, rationale, content_key, expires_at, synthesis_run_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,
                   NOW() + ($17 || ' days')::interval, $18)
           RETURNING opportunity_id`,
          [
            brand.brand_id, rec.title, rec.thesis, rec.category, rec.confidence,
            rec.expected_impact_cents, rec.impact_basis, rec.cost_estimate_cents, rec.effort,
            rec.risk, rec.recommended_department,
            rec.success_metric ? JSON.stringify(rec.success_metric) : null,
            rec.failure_metric ? JSON.stringify(rec.failure_metric) : null,
            JSON.stringify(rec.constraint_flags), JSON.stringify(rationale), rec.content_key,
            String(PROPOSAL_TTL_DAYS), runKey,
          ],
        );
        row = ins.rows[0];
      } catch (err) {
        if (err.code === "23505") continue; // open-content dedup — expected, skip
        throw err;
      }
      for (const e of rec.cited) {
        await client.query(
          `INSERT INTO sage_opportunity_evidence (opportunity_id, item_id, claim)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [row.opportunity_id, e.item_id, (e.summary || "").slice(0, 300) || null],
        );
      }
      inserted.push(row.opportunity_id);
      slots -= 1;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return inserted;
}

/**
 * The weekly per-brand synthesis. Diagnostics first (deterministic, stored
 * even if AI fails); then one AI call; then validation + insert. AI failure
 * throws (job marked failed upstream) — nothing fabricated.
 */
async function runSynthesisForBrand(brand) {
  if (!(await getSwitch("SAGE_V2_OPPORTUNITIES"))) return { enabled: false };

  const diagnostics = await runDiagnosticsForBrand(brand.brand_id).catch((err) => {
    console.error(`Change diagnostics failed for brand ${brand.brand_id}:`, err.message);
    return null;
  });

  const inputs = await gatherInputs(brand);
  const runKey = `opps:${weekStartOf()}`;

  // No evidence at all → honest empty week, zero AI spend.
  if (!inputs.evidenceItems.length) {
    return { inserted: 0, reason: "no_evidence_this_window" };
  }

  const prompt = buildOpportunitySynthesisPrompt({
    brand,
    diagnostics,
    evidenceItems: inputs.evidenceItems,
    coverage: inputs.coverage,
    openOpportunities: inputs.openOpportunities,
    recentDeclines: inputs.recentDeclines,
    constraints: inputs.constraints
      ? {
          monthly_budget_cents: inputs.constraints.monthly_budget_cents,
          weekly_capacity: inputs.constraints.weekly_capacity,
          blackout_dates: inputs.constraints.blackout_dates,
        }
      : null,
  });

  const response = await createMessage(
    {
      model: MODEL,
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    },
    {
      label: "Sage opportunity synthesis",
      feature: "sage_opportunity_synthesis",
      brandId: brand.brand_id,
      contextAudience: "internal",
      timeout: 120000,
    },
  );

  const text = response.content?.map((b) => b.text || "").join("") || "";
  const parsed = extractJsonObject(text);
  if (!parsed || !Array.isArray(parsed.opportunities)) {
    const err = new Error("Opportunity synthesis returned no valid JSON.");
    err.aiInvalid = true;
    throw err;
  }

  // Narrative rides the same call; only stored when diagnostics terms exist.
  if (diagnostics && diagnostics.terms && !diagnostics.terms.unavailable && typeof parsed.diagnostics_narrative === "string") {
    await saveNarrative(brand.brand_id, diagnostics.weekStart, parsed.diagnostics_narrative).catch((err) =>
      console.error(`Narrative save failed for brand ${brand.brand_id}:`, err.message),
    );
  }

  const evidenceById = new Map(inputs.evidenceItems.map((e) => [String(e.item_id), e]));
  const valid = [];
  const rejected = [];
  for (const p of parsed.opportunities.slice(0, MAX_PER_RUN)) {
    const v = validateProposal(p, {
      evidenceById,
      coverage: inputs.coverage,
      recentDeclines: inputs.recentDeclines,
    });
    if (v.ok) valid.push(attachConstraintFlags(v.record, inputs.constraints));
    else rejected.push(v.reason);
  }
  if (rejected.length) {
    console.log(`Opportunity synthesis (brand ${brand.brand_id}): rejected ${rejected.length} proposal(s): ${rejected.join(", ")}`);
  }

  const ranked = bucketRank(valid);
  const inserted = await insertOpportunities(brand, ranked, runKey, inputs.coverage, diagnostics);
  return { inserted: inserted.length, rejected: rejected.length };
}

/**
 * Deterministic expiry sweep (zero AI): stale proposals expire; expired and
 * old terminal rows archive (lifecycle "Archived").
 */
async function runExpirySweep() {
  if (!(await getSwitch("SAGE_V2_OPPORTUNITIES"))) return { expired: 0, archived: 0 };
  const exp = await db.query(
    `UPDATE sage_opportunities SET status = 'expired'
      WHERE status = 'proposed' AND expires_at IS NOT NULL AND expires_at < NOW()
      RETURNING opportunity_id`,
  );
  const arch = await db.query(
    `UPDATE sage_opportunities SET status = 'archived'
      WHERE (status = 'expired' AND updated_at < NOW() - INTERVAL '30 days')
         OR (status IN ('succeeded','failed','inconclusive','declined') AND updated_at < NOW() - INTERVAL '60 days')
      RETURNING opportunity_id`,
  );
  return { expired: exp.rowCount, archived: arch.rowCount };
}

module.exports = {
  runSynthesisForBrand,
  runExpirySweep,
  validateProposal,
  attachConstraintFlags,
  bucketRank,
  contentKeyOf,
  insertOpportunities,
  gatherInputs,
  MAX_OPEN_PER_BRAND,
  MAX_PER_RUN,
  OPEN_STATUSES,
};
