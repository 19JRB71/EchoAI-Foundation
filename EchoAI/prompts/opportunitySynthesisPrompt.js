/**
 * Sage V2 Phase 5 — weekly Opportunity Synthesis prompt.
 *
 * One AI call per brand per week (W7). The model receives ONLY real,
 * pre-gathered facts (diagnostics terms, evidence items, coverage, open
 * queue, recent declines) and returns strict JSON. Hard rules baked into the
 * prompt AND re-enforced in code (utils/opportunitySynthesis.js): every
 * opportunity must cite provided evidence ids; impact needs a stated basis;
 * no numeric confidence scores — code recomputes the tier from evidence.
 */

function buildOpportunitySynthesisPrompt({
  brand,
  diagnostics,
  evidenceItems,
  coverage,
  openOpportunities,
  recentDeclines,
  constraints,
}) {
  const evidenceBlock = evidenceItems.length
    ? evidenceItems
        .map(
          (it) =>
            `- id:${it.item_id} [${it.confidence}] (${it.source}, ${String(it.created_at).slice(0, 10)}) ${it.summary} — ${it.why_it_matters}`,
        )
        .join("\n")
    : "(none this week)";

  const openBlock = openOpportunities.length
    ? openOpportunities.map((o) => `- ${o.title} (${o.status})`).join("\n")
    : "(none)";

  const declinedBlock = recentDeclines.length
    ? recentDeclines
        .map((o) => `- "${o.title}" declined ${String(o.decided_at).slice(0, 10)}${o.owner_decision_note ? ` — owner said: ${o.owner_decision_note}` : ""}`)
        .join("\n")
    : "(none)";

  const diagBlock = diagnostics && diagnostics.terms && !diagnostics.terms.unavailable
    ? JSON.stringify(diagnostics.terms)
    : "(insufficient weekly analytics to decompose — do not speculate about causes)";

  const constraintsBlock = constraints
    ? JSON.stringify(constraints)
    : "(owner has not provided constraints)";

  return `You are Sage, the strategy director for the business "${brand.brand_name}"${brand.industry ? ` (${brand.industry})` : ""}.

Your weekly job has two parts, returned as ONE JSON object.

PART 1 — narrate this week's deterministic change decomposition in 2-4 plain
sentences an owner understands. The numbers below were computed by arithmetic,
not by you; NEVER invent numbers that are not present.
DECOMPOSITION TERMS: ${diagBlock}

PART 2 — propose the best NEW opportunities (0 to 3) for this business.

EVIDENCE ITEMS (the ONLY permitted sources — cite by id):
${evidenceBlock}

OUTCOME DATA COVERAGE: ${coverage.coveragePct}% of leads have recorded outcomes (${coverage.withOutcome}/${coverage.totalLeads}).
OWNER CONSTRAINTS: ${constraintsBlock}
ALREADY OPEN (never re-propose these): 
${openBlock}
RECENTLY DECLINED BY THE OWNER (do not re-propose unless the evidence above is materially NEW):
${declinedBlock}

HARD RULES:
1. Every opportunity MUST cite at least one evidence id from the list above in
   "evidence_item_ids". An opportunity without evidence is forbidden — return
   fewer (or zero) opportunities instead of inventing support.
2. Never state a confidence score or percentage. Confidence is computed by the
   platform from your cited evidence.
3. "expected_impact_cents" may only be set when you can state its basis in
   "impact_basis" using the coverage/diagnostics facts above; otherwise use null
   for both. Never guess revenue.
4. Departments: nova (social/content), atlas (paid ads), forge (creative),
   pulse (CRM/ops task), voice (phone scripts), owner (only the owner can act).
5. Respect the owner constraints; if an idea conflicts with them, either adapt
   it or note the conflict in "constraint_flags".
6. Zero opportunities is a valid, honest answer for a quiet week.

Return ONLY this JSON (no markdown):
{
  "diagnostics_narrative": "2-4 sentences or null when terms were unavailable",
  "opportunities": [
    {
      "title": "short imperative title",
      "thesis": "2-3 sentences: what to do and why now, grounded in the cited evidence",
      "category": "growth|efficiency|risk|retention|positioning",
      "evidence_item_ids": ["uuid", "..."],
      "expected_impact_cents": null,
      "impact_basis": null,
      "cost_estimate_cents": null,
      "effort": "s|m|l",
      "risk": "one sentence on what could go wrong",
      "recommended_department": "nova|atlas|forge|pulse|voice|owner",
      "success_metric": {"metric": "leads|conversions|spend_efficiency|other", "target_note": "plain-English success condition"},
      "failure_metric": {"metric": "same options", "stop_note": "plain-English stop condition"},
      "constraint_flags": []
    }
  ]
}`;
}

module.exports = { buildOpportunitySynthesisPrompt };
