/**
 * Sage V2 Phase 5 — deterministic confidence explanation (CEO refinement,
 * July 19, 2026).
 *
 * Assembles "Confidence: <tier> — because: …" from the evidence graph. NO AI
 * writes this text: every line is rendered from junction rows + stored
 * rationale facts. Per the locked plan (W4) there is deliberately no numeric
 * percentage — tiers are verified/reported/inferred, and the reasons make the
 * tier understandable.
 */

const TIER_LABEL = { verified: "Verified", reported: "Reported", inferred: "Inferred" };
const TIER_RANK = { verified: 3, reported: 2, inferred: 1 };

/** min-of-evidence tier; null when no evidence (caller must reject that). */
function computeConfidence(evidenceRows) {
  if (!Array.isArray(evidenceRows) || evidenceRows.length === 0) return null;
  let min = null;
  for (const row of evidenceRows) {
    const c = String(row.confidence || "").toLowerCase();
    if (!TIER_RANK[c]) return null; // unknown tier => cannot claim confidence
    if (min == null || TIER_RANK[c] < TIER_RANK[min]) min = c;
  }
  return min;
}

function fmtDate(d) {
  if (!d) return null;
  const s = d instanceof Date ? d.toISOString() : String(d);
  return s.slice(0, 10);
}

/**
 * Build the explanation object stored in rationale.confidence_explanation
 * and rendered by the UI.
 *
 * @param {Array} evidenceRows [{item_id, source, confidence, created_at, claim, summary}]
 * @param {object|null} extras  { outcome_coverage_pct, diagnostics_fact } — deterministic facts only
 */
function buildConfidenceExplanation(evidenceRows, extras = {}) {
  const tier = computeConfidence(evidenceRows);
  if (!tier) return null;
  const reasons = evidenceRows.map((row) => {
    const bits = [];
    if (row.claim) bits.push(String(row.claim));
    else if (row.summary) bits.push(String(row.summary).slice(0, 140));
    const meta = [row.source, fmtDate(row.created_at), TIER_LABEL[String(row.confidence).toLowerCase()]]
      .filter(Boolean)
      .join(", ");
    return meta ? `${bits.join(" ")} (${meta})` : bits.join(" ");
  });
  if (extras && typeof extras.outcome_coverage_pct === "number") {
    reasons.push(
      `Based on recorded outcomes covering ${Math.round(extras.outcome_coverage_pct)}% of leads`,
    );
  }
  if (extras && extras.diagnostics_fact) {
    reasons.push(String(extras.diagnostics_fact));
  }
  return {
    tier,
    label: TIER_LABEL[tier],
    reasons,
    method: "min_of_evidence",
  };
}

module.exports = { computeConfidence, buildConfidenceExplanation, TIER_RANK, TIER_LABEL };
