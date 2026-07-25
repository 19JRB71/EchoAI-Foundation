/**
 * Sage V2 Phase 6 — Top-3-bets strategy + Executive Debate (§6–§9).
 *
 * ONE strategy object per brand (partial unique live index: at most one
 * proposed-or-approved). Drafting is ONE Claude call (owner-initiated, never
 * scheduled) that returns both the debate options and the bets; everything
 * is re-validated in code AFTER generation, at the single write chokepoint —
 * the AI cannot talk its way past it.
 *
 * Hard rules enforced here:
 *  - Debate: ≥3 options, exactly one do-nothing baseline, all fields
 *    non-empty, chosen option must reference a real option. Failure →
 *    err.aiInvalid → 502; nothing partial stored.
 *  - Debate cost cap: max 2 per brand per month, counted under the per-brand
 *    advisory lock BEFORE any AI call. Input-hash skip gate on top.
 *  - Bets (CEO refinement July 19, 2026): objective, expected_timeframe,
 *    primary_kpi, success_threshold, review_date ALL required per bet —
 *    plus title, thesis, and ≥1 evidence ref. Evidence refs must be real
 *    sage_opportunities rows of the SAME brand, not expired / declined /
 *    archived ("no evidence, no bet" — junction table, no uuid[] arrays).
 *  - options_considered is write-once: set at insert, never UPDATEd.
 *  - Status transitions are row-count-branched (WHERE carries prior status).
 *  - Approval validates the budget line against brand_constraints — a
 *    violation BLOCKS approval with a plain-English explanation; nothing is
 *    silently altered. Approval executes nothing (§10).
 */

const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");
const { createMessage, MODEL } = require("../config/anthropic");
const { extractJsonObject } = require("../prompts/voiceContentPrompt");
const { buildStrategyDraftPrompt } = require("../prompts/strategyDraftPrompt");
const { shouldRun, recordRun } = require("./inputHash");

const DEBATE_MONTHLY_CAP = 2;
const MAX_BETS = 3;
const BET_REQUIRED_FIELDS = [
  "title",
  "thesis",
  "objective",
  "expected_timeframe",
  "primary_kpi",
  "success_threshold",
];
const OPTION_REQUIRED_FIELDS = ["title", "description", "tradeoffs", "risks", "expected_effect"];
// Evidence must still be live-ish: not expired, not declined, not archived.
const INVALID_EVIDENCE_STATUSES = ["expired", "declined", "archived"];

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isValidDateString(v) {
  return isNonEmptyString(v) && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) && !Number.isNaN(Date.parse(v));
}

/** Validate the debate options array (pure; exported for tests). Returns error string or null. */
function validateDebateOptions(parsed) {
  const options = parsed && parsed.options;
  if (!Array.isArray(options) || options.length < 3) return "fewer than 3 options";
  for (const opt of options) {
    for (const f of OPTION_REQUIRED_FIELDS) {
      if (!isNonEmptyString(opt && opt[f])) return `option missing ${f}`;
    }
  }
  const baselines = options.filter((o) => o.is_baseline === true);
  if (baselines.length !== 1) return "must have exactly one do-nothing baseline option";
  if (!isNonEmptyString(parsed.chosen_option_title)) return "missing chosen_option_title";
  if (!options.some((o) => o.title.trim() === parsed.chosen_option_title.trim())) {
    return "chosen option does not match any option";
  }
  if (!isNonEmptyString(parsed.chosen_because)) return "missing chosen_because";
  return null;
}

/**
 * Validate the bets array shape (pure; exported for tests). The CEO
 * refinement fields are REQUIRED. Returns error string or null.
 */
function validateBets(bets) {
  if (!Array.isArray(bets) || bets.length < 1 || bets.length > MAX_BETS) {
    return `bets must be 1 to ${MAX_BETS}`;
  }
  for (let i = 0; i < bets.length; i++) {
    const bet = bets[i];
    for (const f of BET_REQUIRED_FIELDS) {
      if (!isNonEmptyString(bet && bet[f])) return `bet ${i + 1} missing required field: ${f}`;
    }
    if (!isValidDateString(bet.review_date)) return `bet ${i + 1} missing valid review_date (YYYY-MM-DD)`;
    const refs = bet.opportunity_ids;
    if (!Array.isArray(refs) || refs.length < 1 || !refs.every(isNonEmptyString)) {
      return `bet ${i + 1} cites no evidence (opportunity_ids required)`;
    }
  }
  return null;
}

/** Validate budget_line shape (pure). Returns error string or null. */
function validateBudgetLine(budgetLine) {
  if (budgetLine == null) return null; // budget line optional at draft; checked at approval
  if (!isNonEmptyString(budgetLine.statement)) return "budget_line missing statement";
  if (!Array.isArray(budgetLine.channels)) return "budget_line missing channels array";
  for (const ch of budgetLine.channels) {
    if (!isNonEmptyString(ch && ch.channel)) return "budget channel missing name";
    if (!Number.isInteger(ch.amount_cents) || ch.amount_cents < 0) {
      return "budget amounts must be non-negative integer cents";
    }
  }
  return null;
}

function budgetTotalCents(budgetLine) {
  if (!budgetLine || !Array.isArray(budgetLine.channels)) return null;
  return budgetLine.channels.reduce((sum, ch) => sum + (Number.isInteger(ch.amount_cents) ? ch.amount_cents : 0), 0);
}

/**
 * Evidence chokepoint (§8): inside the write transaction, verify every cited
 * opportunity exists, belongs to the brand, and is not expired/declined/
 * archived. Returns error string or null.
 */
async function verifyBetEvidence(client, brandId, bets) {
  const ids = [...new Set(bets.flatMap((b) => b.opportunity_ids))];
  const { rows } = await client.query(
    `SELECT opportunity_id::text AS id FROM sage_opportunities
      WHERE brand_id = $1 AND opportunity_id = ANY($2::uuid[])
        AND status <> ALL($3)`,
    [brandId, ids, INVALID_EVIDENCE_STATUSES],
  );
  const valid = new Set(rows.map((r) => r.id));
  for (let i = 0; i < bets.length; i++) {
    for (const ref of bets[i].opportunity_ids) {
      if (!valid.has(String(ref))) {
        return `bet ${i + 1} cites an opportunity that does not exist for this brand or is expired/declined/archived`;
      }
    }
  }
  return null;
}

function strategyView(row, junctions = []) {
  if (!row) return null;
  const bets = Array.isArray(row.bets) ? row.bets : [];
  return {
    strategyId: row.strategy_id,
    bets: bets.map((b, i) => ({
      ...b,
      opportunity_ids: junctions.filter((j) => j.bet_index === i).map((j) => String(j.opportunity_id)),
    })),
    budgetLine: row.budget_line || null,
    optionsConsidered: row.options_considered || null,
    status: row.status,
    origin: row.origin,
    reviewAt: row.review_at,
    decidedAt: row.decided_at,
    ownerNote: row.owner_note,
    createdAt: row.created_at,
  };
}

async function fetchStrategyWithJunctions(strategyId, client = db) {
  const { rows } = await client.query(`SELECT * FROM sage_strategies WHERE strategy_id = $1`, [strategyId]);
  if (!rows.length) return null;
  const j = await client.query(
    `SELECT bet_index, opportunity_id FROM sage_strategy_bet_opportunities WHERE strategy_id = $1`,
    [strategyId],
  );
  return strategyView(rows[0], j.rows);
}

/** Current live (proposed/approved) strategy + debate budget remaining. */
async function getStrategyState(brandId) {
  const live = await db.query(
    `SELECT * FROM sage_strategies
      WHERE brand_id = $1 AND status IN ('proposed','approved')
      ORDER BY created_at DESC LIMIT 1`,
    [brandId],
  );
  const debates = await db.query(
    `SELECT COUNT(*)::int AS n FROM sage_debates
      WHERE brand_id = $1 AND created_at >= date_trunc('month', NOW())`,
    [brandId],
  );
  let strategy = null;
  if (live.rows.length) {
    const j = await db.query(
      `SELECT bet_index, opportunity_id FROM sage_strategy_bet_opportunities WHERE strategy_id = $1`,
      [live.rows[0].strategy_id],
    );
    strategy = strategyView(live.rows[0], j.rows);
  }
  return {
    strategy,
    debatesUsedThisMonth: debates.rows[0].n,
    debatesRemainingThisMonth: Math.max(0, DEBATE_MONTHLY_CAP - debates.rows[0].n),
  };
}

/** Gather the real facts the draft prompt is allowed to see. */
async function gatherDraftFacts(brand) {
  const [opps, constraints, memories, analytics] = await Promise.all([
    db.query(
      `SELECT opportunity_id, title, thesis, category, confidence, status
         FROM sage_opportunities
        WHERE brand_id = $1 AND status <> ALL($2)
        ORDER BY created_at DESC LIMIT 15`,
      [brand.brand_id, INVALID_EVIDENCE_STATUSES],
    ),
    db.query(`SELECT * FROM brand_constraints WHERE brand_id = $1`, [brand.brand_id]),
    db
      .query(
        `SELECT kind, content FROM sage_memory
          WHERE brand_id = $1 AND status = 'active'
          ORDER BY created_at DESC LIMIT 10`,
        [brand.brand_id],
      )
      .catch(() => ({ rows: [] })),
    db.query(
      `SELECT week_date, total_spend, total_leads, cost_per_lead, conversions
         FROM analytics WHERE brand_id = $1 ORDER BY week_date DESC LIMIT 8`,
      [brand.brand_id],
    ),
  ]);

  let companyTruth = null;
  try {
    const { getApprovedCompanyTruth } = require("../controllers/companyTruthController");
    const truth = await getApprovedCompanyTruth(brand.brand_id);
    companyTruth = truth && truth.plainSummary ? truth.plainSummary : null;
  } catch (err) {
    companyTruth = null; // no approved truth (or module unavailable) — prompt says so honestly
  }

  const scorecardFacts = analytics.rows.length
    ? analytics.rows
        .map(
          (r) =>
            `${String(r.week_date).slice(0, 10)}: spend $${r.total_spend}, leads ${r.total_leads}, cpl ${r.cost_per_lead ?? "n/a"}, conversions ${r.conversions}`,
        )
        .join("\n")
    : null;

  return {
    opportunities: opps.rows,
    constraints: constraints.rows[0] || null,
    memories: memories.rows,
    companyTruth,
    scorecardFacts,
  };
}

function reject(message, { status = 409, code } = {}) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function aiInvalid(message) {
  const err = new Error(message);
  err.aiInvalid = true;
  return err;
}

/**
 * Draft a strategy: cap check under advisory lock → skip gate → ONE Claude
 * call → validate everything → persist atomically. Throws:
 *  - err.status 409 for live-strategy / cap / unchanged-inputs refusals
 *  - err.aiInvalid for AI-output validation failures (controller → 502)
 */
async function generateStrategy(brand, { triggerEvent = "new_strategy" } = {}) {
  // Debate cost guard + live-strategy check under the per-brand advisory
  // lock BEFORE any AI call (atomic under concurrent requests): two racing
  // drafts serialize here, so the loser refuses cheaply instead of paying
  // for a second AI call and failing at insert.
  const capClient = await db.pool.connect();
  try {
    await capClient.query("BEGIN");
    await capClient.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 6))", [
      `sage-debate:${brand.brand_id}`,
    ]);
    const live = await capClient.query(
      `SELECT 1 FROM sage_strategies
        WHERE brand_id = $1 AND status IN ('proposed','approved') LIMIT 1`,
      [brand.brand_id],
    );
    if (live.rows.length) {
      throw reject(
        "A strategy is already proposed or approved for this brand — decide on it (approve, revise, or decline) before drafting a new one.",
        { code: "live_strategy_exists" },
      );
    }
    const { rows } = await capClient.query(
      `SELECT COUNT(*)::int AS n FROM sage_debates
        WHERE brand_id = $1 AND created_at >= date_trunc('month', NOW())`,
      [brand.brand_id],
    );
    if (rows[0].n >= DEBATE_MONTHLY_CAP) {
      throw reject(
        `Debate limit reached this month (${DEBATE_MONTHLY_CAP}). Sage runs at most ${DEBATE_MONTHLY_CAP} executive debates per brand per month to keep costs honest — try again next month.`,
        { code: "debate_limit" },
      );
    }
    await capClient.query("COMMIT");
  } catch (err) {
    await capClient.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    capClient.release();
  }

  const facts = await gatherDraftFacts(brand);
  if (!facts.opportunities.length) {
    throw reject(
      "Sage has no live opportunities to build a strategy from yet. Bets require real evidence — no evidence, no bet.",
      { code: "no_evidence" },
    );
  }

  // Input-hash skip gate: identical inputs since the last draft = no second call.
  const gateInputs = {
    opportunityIds: facts.opportunities.map((o) => String(o.opportunity_id)).sort(),
    companyTruth: facts.companyTruth,
    constraints: facts.constraints
      ? {
          budget: facts.constraints.monthly_budget_cents,
          capacity: facts.constraints.weekly_capacity,
        }
      : null,
    scorecardFacts: facts.scorecardFacts,
    triggerEvent,
  };
  const gate = await shouldRun("strategy_draft", brand.brand_id, gateInputs);
  if (!gate.run) {
    throw reject(
      "Nothing has changed since Sage's last strategy draft (same opportunities, same performance data). A new draft would reach the same conclusion.",
      { code: "inputs_unchanged" },
    );
  }

  const prompt = buildStrategyDraftPrompt({ brand, ...facts, triggerEvent });
  const response = await createMessage(
    {
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    },
    {
      label: "Sage strategy draft + executive debate",
      feature: "sage_strategy_draft",
      brandId: brand.brand_id,
      contextAudience: "internal",
      timeout: 120000,
    },
  );
  const text = response.content && response.content[0] && response.content[0].text;
  const parsed = extractJsonObject(text || "");
  if (!parsed) throw aiInvalid("Strategy draft returned no parseable JSON");

  if (parsed.insufficient === true) {
    await recordRun("strategy_draft", brand.brand_id, gate.hash, "success").catch(() => {});
    throw reject(
      `Sage declined to force a strategy: ${isNonEmptyString(parsed.reason) ? parsed.reason : "the available evidence cannot support an honest bet yet."}`,
      { code: "insufficient_evidence" },
    );
  }

  const optErr = validateDebateOptions(parsed);
  if (optErr) throw aiInvalid(`Debate validation failed: ${optErr}`);
  const betErr = validateBets(parsed.bets);
  if (betErr) throw aiInvalid(`Bet validation failed: ${betErr}`);
  const budErr = validateBudgetLine(parsed.budget_line);
  if (budErr) throw aiInvalid(`Budget validation failed: ${budErr}`);

  const optionsConsidered = {
    options: parsed.options,
    chosen_option_title: parsed.chosen_option_title,
    chosen_because: parsed.chosen_because,
    trigger_event: triggerEvent,
  };

  // Single write chokepoint: strategy + junction + debate in one transaction;
  // evidence verified INSIDE the transaction.
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 6))", [
      `sage-debate:${brand.brand_id}`,
    ]);
    // Re-check under the lock: the AI call above ran outside the lock, so a
    // concurrent draft may have landed while this one was thinking.
    const liveNow = await client.query(
      `SELECT 1 FROM sage_strategies
        WHERE brand_id = $1 AND status IN ('proposed','approved') LIMIT 1`,
      [brand.brand_id],
    );
    if (liveNow.rows.length) {
      throw reject(
        "Another strategy draft finished first — review that one instead of drafting again.",
        { code: "live_strategy_exists" },
      );
    }
    const evErr = await verifyBetEvidence(client, brand.brand_id, parsed.bets);
    if (evErr) throw aiInvalid(`Evidence chokepoint rejected the draft: ${evErr}`);

    // Earliest bet review_date drives review_at.
    const reviewDates = parsed.bets.map((b) => b.review_date).sort();
    const ins = await client.query(
      `INSERT INTO sage_strategies
         (brand_id, bets, budget_line, options_considered, status, origin, review_at, input_hash)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, 'proposed', 'ai_draft', $5::date, $6)
       RETURNING strategy_id`,
      [
        brand.brand_id,
        JSON.stringify(parsed.bets.map(({ opportunity_ids, ...bet }) => bet)),
        parsed.budget_line ? JSON.stringify(parsed.budget_line) : null,
        JSON.stringify(optionsConsidered),
        reviewDates[0],
        gate.hash,
      ],
    );
    const strategyId = ins.rows[0].strategy_id;
    for (let i = 0; i < parsed.bets.length; i++) {
      for (const oppId of [...new Set(parsed.bets[i].opportunity_ids)]) {
        await client.query(
          `INSERT INTO sage_strategy_bet_opportunities (strategy_id, bet_index, opportunity_id)
           VALUES ($1, $2, $3)`,
          [strategyId, i, oppId],
        );
      }
    }
    await client.query(
      `INSERT INTO sage_debates (brand_id, strategy_id, trigger_event, options, chosen_option, input_hash)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        brand.brand_id,
        strategyId,
        triggerEvent,
        JSON.stringify(parsed.options),
        parsed.chosen_option_title,
        gate.hash,
      ],
    );
    await client.query("COMMIT");
    await recordRun("strategy_draft", brand.brand_id, gate.hash, "success").catch(() => {});
    return await fetchStrategyWithJunctions(strategyId);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // Unique-index backstop (uniq_sage_strategies_live): a concurrent draft
    // slipped in — surface it as the same honest 409, never a raw 500.
    if (err && err.code === "23505") {
      throw reject(
        "Another strategy draft finished first — review that one instead of drafting again.",
        { code: "live_strategy_exists" },
      );
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Approve a proposed strategy. Budget is validated against brand_constraints
 * (clamp point 1): a violation BLOCKS approval with a plain-English
 * explanation — never silently altered. Approval executes nothing.
 */
async function approveStrategy(brand, strategyId, ownerNote) {
  const { rows } = await db.query(
    `SELECT s.* FROM sage_strategies s
       JOIN brands b ON b.brand_id = s.brand_id
      WHERE s.strategy_id = $1 AND s.brand_id = $2 AND b.user_id = $3`,
    [strategyId, brand.brand_id, brand.user_id],
  );
  if (!rows.length) throw reject("Strategy not found", { status: 404 });
  const strat = rows[0];

  const total = budgetTotalCents(strat.budget_line);
  if (total != null) {
    const cRes = await db.query(`SELECT monthly_budget_cents FROM brand_constraints WHERE brand_id = $1`, [
      brand.brand_id,
    ]);
    const monthly = cRes.rows[0] ? cRes.rows[0].monthly_budget_cents : null;
    if (monthly != null && total > Number(monthly)) {
      throw reject(
        `This strategy's budget ($${(total / 100).toFixed(2)}/month) exceeds your stated monthly budget limit ($${(Number(monthly) / 100).toFixed(2)}). Revise the budget line or raise your limit — Sage never silently changes your numbers.`,
        { status: 422, code: "constraint_violation" },
      );
    }
  }

  const upd = await db.query(
    `UPDATE sage_strategies
        SET status = 'approved', decided_at = NOW(), owner_note = $3
      WHERE strategy_id = $1 AND brand_id = $2 AND status = 'proposed'`,
    [strategyId, brand.brand_id, ownerNote || null],
  );
  if (upd.rowCount === 0) {
    throw reject("This strategy is not awaiting a decision (it may have been decided already).", {
      code: "invalid_transition",
    });
  }
  return await fetchStrategyWithJunctions(strategyId);
}

/** Decline a proposed strategy (proposed → declined, row-count branched). */
async function declineStrategy(brand, strategyId, ownerNote) {
  const upd = await db.query(
    `UPDATE sage_strategies s
        SET status = 'declined', decided_at = NOW(), owner_note = $3
       FROM brands b
      WHERE s.strategy_id = $1 AND s.brand_id = $2 AND b.brand_id = s.brand_id
        AND b.user_id = $4 AND s.status = 'proposed'`,
    [strategyId, brand.brand_id, ownerNote || null, brand.user_id],
  );
  if (upd.rowCount === 0) {
    throw reject("This strategy is not awaiting a decision (it may have been decided already).", {
      code: "invalid_transition",
    });
  }
  return await fetchStrategyWithJunctions(strategyId);
}

/**
 * Owner revision: re-validate bets + evidence + budget (400 on failure —
 * owner-edited, not AI), then atomically supersede the old strategy with a
 * new 'proposed' row (options_considered carried over — write-once, the
 * debate is what was considered when the strategy was drafted).
 */
async function reviseStrategy(brand, strategyId, { bets, budgetLine, ownerNote }) {
  const betErr = validateBets(bets);
  if (betErr) throw reject(`Revision rejected: ${betErr}`, { status: 400, code: "invalid_bets" });
  const budErr = validateBudgetLine(budgetLine);
  if (budErr) throw reject(`Revision rejected: ${budErr}`, { status: 400, code: "invalid_budget" });

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 6))", [
      `sage-debate:${brand.brand_id}`,
    ]);
    const { rows } = await client.query(
      `SELECT s.* FROM sage_strategies s
         JOIN brands b ON b.brand_id = s.brand_id
        WHERE s.strategy_id = $1 AND s.brand_id = $2 AND b.user_id = $3
          AND s.status IN ('proposed','approved')
        FOR UPDATE OF s`,
      [strategyId, brand.brand_id, brand.user_id],
    );
    if (!rows.length) {
      throw reject("No live strategy found to revise.", { status: 404 });
    }
    const old = rows[0];

    const evErr = await verifyBetEvidence(client, brand.brand_id, bets);
    if (evErr) throw reject(`Revision rejected: ${evErr}`, { status: 400, code: "invalid_evidence" });

    const supersede = await client.query(
      `UPDATE sage_strategies SET status = 'superseded'
        WHERE strategy_id = $1 AND status = $2`,
      [strategyId, old.status],
    );
    if (supersede.rowCount === 0) throw reject("Strategy changed underneath the revision — try again.");

    const reviewDates = bets.map((b) => b.review_date).sort();
    const ins = await client.query(
      `INSERT INTO sage_strategies
         (brand_id, bets, budget_line, options_considered, status, origin, review_at, owner_note)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, 'proposed', 'owner_revision', $5::date, $6)
       RETURNING strategy_id`,
      [
        brand.brand_id,
        JSON.stringify(bets.map(({ opportunity_ids, ...bet }) => bet)),
        budgetLine ? JSON.stringify(budgetLine) : old.budget_line ? JSON.stringify(old.budget_line) : null,
        old.options_considered ? JSON.stringify(old.options_considered) : null,
        reviewDates[0],
        ownerNote || null,
      ],
    );
    const newId = ins.rows[0].strategy_id;
    await client.query(`UPDATE sage_strategies SET superseded_by = $2 WHERE strategy_id = $1`, [
      strategyId,
      newId,
    ]);
    for (let i = 0; i < bets.length; i++) {
      for (const oppId of [...new Set(bets[i].opportunity_ids)]) {
        await client.query(
          `INSERT INTO sage_strategy_bet_opportunities (strategy_id, bet_index, opportunity_id)
           VALUES ($1, $2, $3)`,
          [newId, i, oppId],
        );
      }
    }
    await client.query("COMMIT");
    return await fetchStrategyWithJunctions(newId);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getStrategyState,
  generateStrategy,
  approveStrategy,
  declineStrategy,
  reviseStrategy,
  validateDebateOptions,
  validateBets,
  validateBudgetLine,
  budgetTotalCents,
  verifyBetEvidence,
  DEBATE_MONTHLY_CAP,
};
