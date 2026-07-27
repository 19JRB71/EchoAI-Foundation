/**
 * Sage V2 Phase 5 — Change Diagnostics (the deterministic "why" engine).
 *
 * Week-over-week decomposition computed with ARITHMETIC ONLY from existing
 * `analytics` weekly rows + `leads` outcomes. AI never computes these
 * numbers; the optional narrative is generated INSIDE the weekly Opportunity
 * Synthesis call (W7: no separate recurring AI job) and stored afterwards
 * via saveNarrative(). When narration is unavailable the terms still render.
 *
 * Decomposition (leads = spend / cost-per-lead):
 *   Δleads = spend effect  (Δspend at last week's efficiency)
 *          + efficiency effect (ΔCPL at this week's spend)
 *          + interaction/rounding residual (shown honestly, never hidden)
 * Conversion is decomposed separately: Δconversions = Δleads effect at last
 * week's conversion rate + Δrate effect at this week's leads.
 *
 * Honesty rules: a missing week => that term is null with data_coverage
 * saying why; zeros are never fabricated for absent data.
 */

const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(v) {
  return v == null ? null : Math.round(v * 10) / 10;
}

/**
 * Pure decomposition over two weekly analytics rows (either may be null).
 * Exported for tests. Rows: { total_spend, total_leads, conversions, cost_per_lead }.
 */
function decomposeWeeks(prevRow, currRow) {
  const coverage = {
    previous_week: Boolean(prevRow),
    current_week: Boolean(currRow),
  };
  if (!prevRow || !currRow) {
    return {
      terms: null,
      coverage: {
        ...coverage,
        reason: !currRow ? "no_current_week_analytics" : "no_previous_week_analytics",
      },
    };
  }

  const pSpend = num(prevRow.total_spend) ?? 0;
  const cSpend = num(currRow.total_spend) ?? 0;
  const pLeads = num(prevRow.total_leads) ?? 0;
  const cLeads = num(currRow.total_leads) ?? 0;
  const pConv = num(prevRow.conversions) ?? 0;
  const cConv = num(currRow.conversions) ?? 0;

  const deltaLeads = cLeads - pLeads;
  const deltaConversions = cConv - pConv;

  // Efficiency = leads per dollar (guard zero spend honestly).
  const pEff = pSpend > 0 ? pLeads / pSpend : null;
  const cEff = cSpend > 0 ? cLeads / cSpend : null;

  let spendEffect = null;
  let efficiencyEffect = null;
  let residual = null;
  if (pEff != null && cEff != null) {
    spendEffect = (cSpend - pSpend) * pEff;
    efficiencyEffect = (cEff - pEff) * cSpend;
    residual = deltaLeads - spendEffect - efficiencyEffect;
  }

  // Conversion decomposition (rates guard zero leads).
  const pRate = pLeads > 0 ? pConv / pLeads : null;
  const cRate = cLeads > 0 ? cConv / cLeads : null;
  let leadsEffectOnConv = null;
  let rateEffect = null;
  if (pRate != null && cRate != null) {
    leadsEffectOnConv = (cLeads - pLeads) * pRate;
    rateEffect = (cRate - pRate) * cLeads;
  }

  return {
    terms: {
      delta_leads: deltaLeads,
      spend_effect: round1(spendEffect),
      efficiency_effect: round1(efficiencyEffect),
      residual: round1(residual),
      delta_conversions: deltaConversions,
      leads_effect_on_conversions: round1(leadsEffectOnConv),
      conversion_rate_effect: round1(rateEffect),
      inputs: {
        prev: { spend: pSpend, leads: pLeads, conversions: pConv },
        curr: { spend: cSpend, leads: cLeads, conversions: cConv },
      },
    },
    coverage: {
      ...coverage,
      spend_decomposition: spendEffect != null,
      conversion_decomposition: rateEffect != null,
      reason:
        spendEffect == null
          ? "zero_spend_week_cannot_decompose_efficiency"
          : null,
    },
  };
}

/** Monday of the week containing `date` (UTC), as YYYY-MM-DD. */
function weekStartOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Compute + upsert this week's diagnostics row for a brand (deterministic,
 * zero AI). Returns the stored row's terms/coverage or null when the flag is
 * off. Uses the two most recent analytics weeks strictly before weekStart.
 */
async function runDiagnosticsForBrand(brandId, now = new Date()) {
  if (!(await getSwitch("SAGE_V2_CHANGE_DIAGNOSTICS"))) return null;
  const weekStart = weekStartOf(now);
  const { rows } = await db.query(
    `SELECT week_date, total_spend, total_leads, conversions, cost_per_lead
       FROM analytics
      WHERE brand_id = $1 AND week_date < $2
      ORDER BY week_date DESC
      LIMIT 2`,
    [brandId, weekStart],
  );
  const [currRow, prevRow] = rows; // newest first
  const { terms, coverage } = decomposeWeeks(prevRow || null, currRow || null);
  const payload = {
    terms: terms || { unavailable: true },
    coverage: {
      ...coverage,
      weeks_used: rows.map((r) => String(r.week_date).slice(0, 10)),
    },
  };
  await db.query(
    `INSERT INTO sage_change_diagnostics (brand_id, week_start, terms, data_coverage)
     VALUES ($1, $2, $3::jsonb, $4::jsonb)
     ON CONFLICT (brand_id, week_start)
     DO UPDATE SET terms = EXCLUDED.terms, data_coverage = EXCLUDED.data_coverage`,
    [brandId, weekStart, JSON.stringify(payload.terms), JSON.stringify(payload.coverage)],
  );
  return { weekStart, ...payload };
}

/** Store the synthesis-produced narrative (never overwrites terms). */
async function saveNarrative(brandId, weekStart, narrative) {
  const text = typeof narrative === "string" ? narrative.trim() : "";
  if (!text) return false;
  const r = await db.query(
    `UPDATE sage_change_diagnostics SET narrative = $3
      WHERE brand_id = $1 AND week_start = $2`,
    [brandId, weekStart, text.slice(0, 4000)],
  );
  return r.rowCount > 0;
}

async function getDiagnostics(brandId, weekStart) {
  const params = [brandId];
  let where = "brand_id = $1";
  if (weekStart) {
    params.push(weekStart);
    where += " AND week_start = $2";
  }
  const { rows } = await db.query(
    `SELECT week_start, terms, data_coverage, narrative, created_at
       FROM sage_change_diagnostics
      WHERE ${where}
      ORDER BY week_start DESC
      LIMIT 1`,
    params,
  );
  return rows[0] || null;
}

module.exports = {
  decomposeWeeks,
  weekStartOf,
  runDiagnosticsForBrand,
  saveNarrative,
  getDiagnostics,
};
