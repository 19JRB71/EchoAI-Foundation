/**
 * Sage V2 Phase 6 — strategy draft + Executive Debate prompt.
 *
 * ONE Claude call per owner-initiated draft: the model receives ONLY real,
 * pre-gathered facts (approved/open opportunities, Company Truth summary,
 * Executive Memory, constraints, scorecard facts) and returns strict JSON
 * containing BOTH the debate options (≥3, incl. a mandatory "do nothing"
 * baseline) and the Top-3 bets. Every rule is re-enforced in code
 * (utils/sageStrategy.js) — validation failure rejects the whole result
 * (502), nothing partial is stored.
 *
 * CEO refinement (July 19, 2026): every bet must carry objective,
 * expected_timeframe, primary_kpi, success_threshold, review_date.
 */

function buildStrategyDraftPrompt({ brand, opportunities, companyTruth, memories, constraints, scorecardFacts, triggerEvent }) {
  const oppBlock = opportunities.length
    ? opportunities
        .map(
          (o) =>
            `- id:${o.opportunity_id} [${o.status}] (${o.category}, confidence:${o.confidence}) "${o.title}" — ${o.thesis}`,
        )
        .join("\n")
    : "(none)";

  const memoryBlock = memories.length
    ? memories.map((m) => `- [${m.kind}] ${m.content}`).join("\n")
    : "(none)";

  const constraintsBlock = constraints
    ? JSON.stringify({
        monthly_budget_cents: constraints.monthly_budget_cents,
        weekly_capacity: constraints.weekly_capacity,
        blackout_dates: constraints.blackout_dates,
      })
    : "(owner has not provided constraints)";

  return `You are Sage, the strategy director for the business "${brand.brand_name}"${brand.industry ? ` (${brand.industry})` : ""}.

The owner asked for a strategy ${triggerEvent === "budget_change" ? "revision (the budget changed materially)" : triggerEvent === "quarterly_review" ? "review (quarterly review date arrived)" : "draft"}. Produce an Executive Debate and a Top-3-bets strategy, as ONE JSON object.

FACTS (the only things you may rely on — never invent data):

Company Truth (owner-approved):
${companyTruth || "(no approved Company Truth yet)"}

Available opportunities (bets MUST cite these ids — no id, no bet):
${oppBlock}

Executive Memory (owner-stated facts and preferences):
${memoryBlock}

Owner constraints:
${constraintsBlock}

Recent performance facts:
${scorecardFacts || "(no analytics history)"}

HARD RULES (code re-checks every one; violations reject the whole output):
1. "options" must contain AT LEAST 3 options. Each option: { "title", "description", "tradeoffs", "risks", "expected_effect" } — all non-empty strings.
2. EXACTLY ONE option must be the do-nothing baseline: set "is_baseline": true on it and state the honest cost of inaction in its description.
3. "chosen_option_title" must equal the title of one non-baseline option (or the baseline, if doing nothing genuinely wins), and "chosen_because" must explain why it beat the alternatives.
4. "bets": 1 to 3 bets. Each bet: {
     "title": short name,
     "thesis": why this bet, grounded in the facts above,
     "objective": what the bet is trying to achieve, plain English,
     "expected_timeframe": when results should show (e.g. "6-8 weeks"),
     "primary_kpi": the ONE metric that judges it (e.g. "cost per lead"),
     "success_threshold": the concrete pass/fail line on that KPI (e.g. "cost per lead under $40"),
     "review_date": "YYYY-MM-DD" — a realistic future date when the bet is re-examined against its threshold,
     "opportunity_ids": array of ≥1 opportunity ids from the list above
   }. ALL fields required, all non-empty.
5. "budget_line": { "statement": one plain-English allocation sentence, "channels": [{ "channel", "amount_cents" (integer) }] }. Stay within the owner's constraints; if no budget constraint exists, propose conservatively from the performance facts.
6. If the available opportunities cannot support even one honest bet, return { "insufficient": true, "reason": "..." } instead — never force a bet.

Return ONLY the JSON object, no other text.`;
}

module.exports = { buildStrategyDraftPrompt };
