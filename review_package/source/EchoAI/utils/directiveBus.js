/**
 * Sage V2 Phase 5 — Directive Bus.
 *
 * Structured handoff of an APPROVED opportunity to an execution department
 * (Nova/Atlas/Forge/Pulse/Voice) — implemented as rows, not a message bus.
 * A directive is work-in-an-inbox: departments consume it through their
 * EXISTING entry points and approval flows; Sage never bypasses a gate and
 * never executes anything itself.
 *
 * Constraint enforcement point #2 (of exactly two — see constraintClamp.js
 * header): Atlas directive budgets are clamped to the brand's remaining
 * monthly budget. Original ask + clamp reason stored in clamp_applied. A
 * fully-clamped-to-zero budget BLOCKS the directive with a visible reason
 * instead of issuing a $0 instruction.
 *
 * Flag: SAGE_V2_DIRECTIVES (default OFF => issueForOpportunity no-ops with
 * an honest {enabled:false}).
 */

const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");
const { clampBudget } = require("./constraintClamp");

// Department-specific instruction schemas: field -> validator.
const isStr = (v) => typeof v === "string" && v.trim().length > 0;
const isOptStr = (v) => v == null || typeof v === "string";
const isPosInt = (v) => Number.isInteger(v) && v > 0;
const isOptObj = (v) => v == null || (typeof v === "object" && !Array.isArray(v));

const INSTRUCTION_SCHEMAS = {
  nova: { theme: isStr, cadence: isOptStr, hooks: (v) => v == null || Array.isArray(v) },
  atlas: { budget_cents: isPosInt, audience: isOptStr, geo: isOptObj, creative_brief_ref: isOptStr, window: isOptObj },
  forge: { creative_brief: isStr, formats: (v) => v == null || Array.isArray(v) },
  pulse: { task: isStr, due_note: isOptStr },
  voice: { script_focus: isStr, notes: isOptStr },
};

function validateInstruction(department, instruction) {
  const schema = INSTRUCTION_SCHEMAS[department];
  if (!schema) return `Unknown department "${department}".`;
  if (!instruction || typeof instruction !== "object" || Array.isArray(instruction)) {
    return "Instruction must be an object.";
  }
  for (const [field, check] of Object.entries(schema)) {
    if (!check(instruction[field])) return `Instruction field "${field}" is missing or invalid for ${department}.`;
  }
  for (const key of Object.keys(instruction)) {
    if (!schema[key]) return `Instruction field "${key}" is not allowed for ${department}.`;
  }
  return null;
}

/** Sum of active Atlas directive budgets this calendar month (committed spend proxy). */
async function committedThisMonthCents(brandId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM((instruction->>'budget_cents')::bigint), 0) AS total
       FROM sage_directives
      WHERE brand_id = $1 AND department = 'atlas'
        AND status IN ('issued', 'acknowledged')
        AND issued_at >= date_trunc('month', NOW())`,
    [brandId],
  );
  return Number(rows[0]?.total || 0);
}

/**
 * Issue a directive for an approved opportunity. Atomic status guard: the
 * parent opportunity must be 'approved' (flips to 'directed' in the same
 * transaction). Returns { ok, directive } or { ok:false, error, status }.
 */
async function issueForOpportunity(opportunityId, userId) {
  if (!(await getSwitch("SAGE_V2_DIRECTIVES"))) {
    return { ok: false, status: 200, enabled: false };
  }
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT o.*, b.user_id
         FROM sage_opportunities o
         JOIN brands b ON b.brand_id = o.brand_id
        WHERE o.opportunity_id = $1 AND b.user_id = $2
        FOR UPDATE OF o`,
      [opportunityId, userId],
    );
    const opp = rows[0];
    if (!opp) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, error: "Opportunity not found." };
    }
    if (opp.status !== "approved") {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: `Only approved opportunities can be assigned (current: ${opp.status}).` };
    }
    const department = opp.recommended_department;
    if (department === "owner") {
      await client.query("ROLLBACK");
      return { ok: false, status: 400, error: "Owner-directed opportunities are yours to act on — no department handoff is issued." };
    }

    const instruction = buildInstructionFromOpportunity(opp);
    let clampApplied = null;

    if (department === "atlas") {
      const cRes = await client.query(
        "SELECT monthly_budget_cents FROM brand_constraints WHERE brand_id = $1",
        [opp.brand_id],
      );
      const monthly = cRes.rows[0]?.monthly_budget_cents ?? null;
      const committed = await committedThisMonthCents(opp.brand_id);
      const clamp = clampBudget(instruction.budget_cents, monthly == null ? null : Number(monthly), committed);
      if (clamp.clamped) {
        clampApplied = {
          original_budget_cents: instruction.budget_cents,
          allowed_cents: clamp.allowedCents,
          reason: clamp.reason,
        };
        if (clamp.allowedCents <= 0) {
          await client.query("ROLLBACK");
          return {
            ok: false,
            status: 409,
            error: "This month's budget is fully committed — the directive was not issued. Raise the monthly budget in Business Constraints or wait for the new month.",
          };
        }
        instruction.budget_cents = clamp.allowedCents;
      }
    }

    const schemaError = validateInstruction(department, instruction);
    if (schemaError) {
      await client.query("ROLLBACK");
      return { ok: false, status: 422, error: schemaError };
    }

    const ins = await client.query(
      `INSERT INTO sage_directives (opportunity_id, brand_id, department, instruction, clamp_applied)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [opportunityId, opp.brand_id, department, JSON.stringify(instruction), clampApplied ? JSON.stringify(clampApplied) : null],
    );
    if (!ins.rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "An active directive already exists for this opportunity." };
    }
    await client.query(
      `UPDATE sage_opportunities SET status = 'directed'
        WHERE opportunity_id = $1 AND status = 'approved'`,
      [opportunityId],
    );
    await client.query("COMMIT");
    return { ok: true, directive: ins.rows[0] };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Deterministic instruction built from the opportunity row (no AI at issue
 * time — the synthesis already produced the thesis/brief content).
 */
function buildInstructionFromOpportunity(opp) {
  const rationale = opp.rationale || {};
  switch (opp.recommended_department) {
    case "nova":
      return { theme: `${opp.title} — ${opp.thesis}`.slice(0, 500), cadence: null, hooks: rationale.hooks || null };
    case "atlas":
      return {
        budget_cents: Number(opp.cost_estimate_cents) > 0 ? Number(opp.cost_estimate_cents) : 1,
        audience: null,
        geo: null,
        creative_brief_ref: null,
        window: null,
      };
    case "forge":
      return { creative_brief: `${opp.title} — ${opp.thesis}`.slice(0, 800), formats: null };
    case "pulse":
      return { task: `${opp.title} — ${opp.thesis}`.slice(0, 500), due_note: null };
    case "voice":
      return { script_focus: `${opp.title} — ${opp.thesis}`.slice(0, 500), notes: null };
    default:
      return {};
  }
}

/** Department writes back. Status-guarded (house rule: no resurrection). */
async function completeDirective(directiveId, { ok = true, result = null, error = null } = {}) {
  const r = await db.query(
    `UPDATE sage_directives
        SET status = $2, result = $3::jsonb, error = $4, completed_at = NOW()
      WHERE directive_id = $1 AND status IN ('issued', 'acknowledged')
      RETURNING opportunity_id`,
    [directiveId, ok ? "done" : "failed", result ? JSON.stringify(result) : null, error],
  );
  const row = r.rows[0];
  if (!row) return false;
  await db.query(
    `UPDATE sage_opportunities SET status = $2
      WHERE opportunity_id = $1 AND status IN ('directed', 'in_progress')`,
    [row.opportunity_id, ok ? "executed" : "in_progress"],
  );
  return true;
}

async function acknowledgeDirective(directiveId) {
  const r = await db.query(
    `UPDATE sage_directives SET status = 'acknowledged', acknowledged_at = NOW()
      WHERE directive_id = $1 AND status = 'issued'
      RETURNING opportunity_id`,
    [directiveId],
  );
  const row = r.rows[0];
  if (!row) return false;
  await db.query(
    `UPDATE sage_opportunities SET status = 'in_progress'
      WHERE opportunity_id = $1 AND status = 'directed'`,
    [row.opportunity_id],
  );
  return true;
}

/**
 * Nightly deterministic measurement join (zero AI): executed opportunities
 * with done directives get measured_result from analytics deltas since the
 * directive completed. Unlinked performance is never claimed; when analytics
 * are absent the result honestly says so.
 */
async function runMeasurementJoin() {
  if (!(await getSwitch("SAGE_V2_DIRECTIVES"))) return { measured: 0 };
  const { rows } = await db.query(
    `SELECT o.opportunity_id, o.brand_id, d.completed_at
       FROM sage_opportunities o
       JOIN sage_directives d ON d.opportunity_id = o.opportunity_id AND d.status = 'done'
      WHERE o.status = 'executed'
        AND d.completed_at < NOW() - INTERVAL '7 days'`,
  );
  let measured = 0;
  for (const row of rows) {
    try {
      const a = await db.query(
        `SELECT week_date, total_leads, total_spend, conversions
           FROM analytics
          WHERE brand_id = $1 AND week_date >= ($2::timestamptz)::date
          ORDER BY week_date`,
        [row.brand_id, row.completed_at],
      );
      const result = a.rows.length
        ? {
            weeks_observed: a.rows.length,
            leads: a.rows.reduce((s, r) => s + Number(r.total_leads || 0), 0),
            conversions: a.rows.reduce((s, r) => s + Number(r.conversions || 0), 0),
            note: "brand-level weekly analytics since directive completion; directive-level attribution not claimed",
          }
        : { weeks_observed: 0, note: "no analytics rows recorded since completion — result unknown" };
      const upd = await db.query(
        `UPDATE sage_opportunities SET status = 'measuring', measured_result = $2::jsonb
          WHERE opportunity_id = $1 AND status = 'executed'`,
        [row.opportunity_id, JSON.stringify(result)],
      );
      if (upd.rowCount > 0) {
        measured += 1;
        await db.query(
          `UPDATE sage_decisions SET executed = TRUE, measured_result = $2::jsonb
            WHERE subject_type = 'opportunity' AND subject_id = $1`,
          [row.opportunity_id, JSON.stringify(result)],
        );
      }
    } catch (err) {
      console.error(`Measurement join failed for opportunity ${row.opportunity_id}:`, err.message);
    }
  }
  return { measured };
}

module.exports = {
  INSTRUCTION_SCHEMAS,
  validateInstruction,
  buildInstructionFromOpportunity,
  committedThisMonthCents,
  issueForOpportunity,
  acknowledgeDirective,
  completeDirective,
  runMeasurementJoin,
};
