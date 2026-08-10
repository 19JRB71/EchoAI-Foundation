/**
 * Prompt 023 — Deterministic interview gap engine.
 *
 * "Interview action precedence is question selection, not an authority ranking."
 *
 * This module is PURE: no database, no AI, no I/O. Given the four-state
 * knowledge projection for a brand (approved versions, pending revisions,
 * legacy unversioned brands values, active Prompt-022 research draft) it
 * deterministically decides, per closed field key:
 *
 *   action  ∈ { skip, confirm, ask, arbitrate }
 *   reason  ∈ REASONS       (closed 9-code vocabulary — owner-approved)
 *   notice  ∈ NOTICES       (closed 3-value vocabulary — owner-approved)
 *
 * Authority NEVER lives here. Prompt 011's canonical knowledge boundary
 * (utils/brandKnowledge.js) is the only authority system: the approved
 * current version remains authoritative; pending revisions and research
 * drafts affect question selection only until the owner acts through the
 * canonical knowledge boundary. No AI decides precedence — the AI only
 * phrases the question this engine selected.
 *
 * Closed vocabularies are regression-tested (tests/interviewGapEngine.test.js);
 * additions require owner approval.
 */

const ACTIONS = Object.freeze({
  SKIP: "skip",
  CONFIRM: "confirm",
  ASK: "ask",
  ARBITRATE: "arbitrate",
});

// Owner-approved 9-code closed reason vocabulary (Prompt 023 / D-36 A1).
const REASONS = Object.freeze({
  APPROVED_CURRENT: "approved_current",
  PENDING_REVISION: "pending_revision",
  DRAFT_HIGH_CONFIDENCE: "draft_high_confidence",
  DRAFT_LOW_CONFIDENCE: "draft_low_confidence",
  DRAFT_CONFLICT: "draft_conflict",
  LEGACY_UNREVIEWED: "legacy_unreviewed",
  MISSING: "missing",
  PREMISE_CHANGED: "premise_changed",
  DEFERRED_BY_OWNER: "deferred_by_owner",
});

// Owner-approved closed notice vocabulary (Prompt 023 / D-36 B1). A notice
// rides on an approved-field SKIP so contradictions are never hidden; the
// approved value stays authoritative and only the OWNER may escalate.
const NOTICES = Object.freeze({
  NONE: "none",
  PENDING_REVIEW_EXISTS: "pending_review_exists",
  DRAFT_DIFFERS: "draft_differs",
});

// The closed 12-field interview universe (mirrors brandKnowledge.FIELD_KEYS),
// ordered so identity/location context comes early enough to support business
// disambiguation (I-38a) before any optional research re-run.
const FIELD_ORDER = Object.freeze([
  "business_name",
  "address",
  "service_area",
  "description",
  "services",
  "hours",
  "email",
  "phone",
  "tagline",
  "brand_personality",
  "voice_description",
  "target_audience",
]);

// Owner-accepted field intent (D-36 A6).
const REQUIRED_FIELDS = Object.freeze(["business_name", "description", "services"]);
const STRATEGIC_FIELDS = Object.freeze(["service_area", "address", "email", "phone"]);

// Bounded interview: a field may surface at most twice — the initial question
// plus one clarification / changed-premise re-presentation. With the closed
// 12-field set this is a hard deterministic ceiling regardless of AI behavior.
const MAX_SURFACES_PER_FIELD = 2;
const HARD_QUESTION_CEILING = FIELD_ORDER.length * MAX_SURFACES_PER_FIELD;

// ---------------------------------------------------------------------------
// Deterministic normalized comparison (D-36 B2).
//
// Exact rule, by stored field type:
//  - null/undefined/"" normalize to "" (absent).
//  - objects/arrays: canonical JSON with recursively sorted object keys.
//  - phone: keep digits only (a leading + is dropped; "(555) 010-2030" and
//    "555.010.2030" compare equal). If no digits exist, fall back to the
//    generic string rule.
//  - email: lowercase + trim.
//  - all other strings (and non-string scalars, stringified): trim, collapse
//    internal whitespace runs to one space, lowercase.
//
// This removes only harmless formatting. NO semantic/AI equivalence: values
// that cannot be safely normalized as equivalent are treated as DIFFERENT.
// ---------------------------------------------------------------------------

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeForComparison(fieldKey, value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return canonicalJson(value);
  let s = String(value).trim();
  if (s === "") return "";
  if (fieldKey === "phone") {
    const digits = s.replace(/\D+/g, "");
    if (digits !== "") return digits;
  }
  if (fieldKey === "email") return s.toLowerCase();
  return s.replace(/\s+/g, " ").toLowerCase();
}

/** True when the two values MATERIALLY differ under the normalization above. */
function materiallyDiffers(fieldKey, a, b) {
  const na = normalizeForComparison(fieldKey, a);
  const nb = normalizeForComparison(fieldKey, b);
  if (na === "" && nb === "") return false;
  return na !== nb;
}

// ---------------------------------------------------------------------------
// Per-field decision.
// ---------------------------------------------------------------------------

function present(v) {
  return !(v === null || v === undefined || (typeof v === "string" && v.trim() === ""));
}

/**
 * Decide the interview action for one field.
 *
 * @param {object} input
 *   fieldKey  — one of FIELD_ORDER
 *   approved  — { value, versionId, provenance, ... } | null   (getApprovedKnowledge)
 *   pending   — { revisionId, proposedValue, provenance, sourceKind, baseVersionId } | null
 *   legacy    — { value } | null   (unversioned brands value, "never reviewed")
 *   draft     — { value, confidence, sources, conflict, alternatives } | null
 * @returns {{ fieldKey, action, reason, notice, evidence }}
 */
function evaluateField({ fieldKey, approved = null, pending = null, legacy = null, draft = null }) {
  const hasApproved = approved != null && present(approved.value);
  const hasPending = pending != null && present(pending.proposedValue);
  const hasLegacy = legacy != null && present(legacy.value);
  const hasDraft = draft != null && present(draft.value);

  // Approved truth always skips — the engine never re-litigates approved owner
  // truth (D-36 B1/B4). Contradictions surface as a closed notice only; the
  // owner may choose to escalate, the engine never forces it.
  if (hasApproved) {
    let notice = NOTICES.NONE;
    if (hasPending) notice = NOTICES.PENDING_REVIEW_EXISTS;
    else if (hasDraft && materiallyDiffers(fieldKey, approved.value, draft.value)) {
      notice = NOTICES.DRAFT_DIFFERS;
    }
    return {
      fieldKey,
      action: ACTIONS.SKIP,
      reason: REASONS.APPROVED_CURRENT,
      notice,
      evidence: {
        approvedValue: approved.value,
        pendingValue: hasPending ? pending.proposedValue : undefined,
        draftValue: notice === NOTICES.DRAFT_DIFFERS ? draft.value : undefined,
      },
    };
  }

  // A pending revision is always an UNAPPROVED proposal. It may generate a
  // confirm (or, against differing draft evidence, an arbitrate) — never an
  // unconditional skip as though it were approved truth.
  if (hasPending) {
    if (hasDraft && materiallyDiffers(fieldKey, pending.proposedValue, draft.value)) {
      return {
        fieldKey,
        action: ACTIONS.ARBITRATE,
        reason: REASONS.DRAFT_CONFLICT,
        notice: NOTICES.NONE,
        evidence: {
          candidates: [
            { value: pending.proposedValue, origin: "pending_revision", sourceKind: pending.sourceKind, provenance: pending.provenance },
            { value: draft.value, origin: "research_draft", sources: draft.sources },
          ],
          incumbentLegacyValue: hasLegacy ? legacy.value : undefined,
        },
      };
    }
    return {
      fieldKey,
      action: ACTIONS.CONFIRM,
      reason: REASONS.PENDING_REVISION,
      notice: NOTICES.NONE,
      evidence: {
        pendingValue: pending.proposedValue,
        sourceKind: pending.sourceKind,
        provenance: pending.provenance,
        incumbentLegacyValue: hasLegacy ? legacy.value : undefined,
      },
    };
  }

  if (hasDraft) {
    if (draft.conflict === true) {
      const alternatives = Array.isArray(draft.alternatives) ? draft.alternatives : [];
      return {
        fieldKey,
        action: ACTIONS.ARBITRATE,
        reason: REASONS.DRAFT_CONFLICT,
        notice: NOTICES.NONE,
        evidence: {
          candidates: [
            { value: draft.value, origin: "research_draft", sources: draft.sources },
            ...alternatives.map((alt) => ({ value: alt && alt.value, origin: "research_draft_alternative", sources: alt && alt.sources })),
          ],
          incumbentLegacyValue: hasLegacy ? legacy.value : undefined,
        },
      };
    }
    const high = draft.confidence === "high";
    return {
      fieldKey,
      action: high ? ACTIONS.CONFIRM : ACTIONS.ASK,
      reason: high ? REASONS.DRAFT_HIGH_CONFIDENCE : REASONS.DRAFT_LOW_CONFIDENCE,
      notice: NOTICES.NONE,
      evidence: {
        draftValue: draft.value,
        confidence: draft.confidence,
        sources: draft.sources,
        incumbentLegacyValue: hasLegacy ? legacy.value : undefined,
      },
    };
  }

  if (hasLegacy) {
    return {
      fieldKey,
      action: ACTIONS.CONFIRM,
      reason: REASONS.LEGACY_UNREVIEWED,
      notice: NOTICES.NONE,
      evidence: { legacyValue: legacy.value },
    };
  }

  return { fieldKey, action: ACTIONS.ASK, reason: REASONS.MISSING, notice: NOTICES.NONE, evidence: {} };
}

/**
 * Build the full ordered gap plan from a four-state inventory.
 * inventory: { approved: {fieldKey: {...}}, pending: {fieldKey: {...}},
 *              legacy: {fieldKey: {...}}, draft: {fieldKey: {...}} }
 */
function buildPlan(inventory = {}) {
  const { approved = {}, pending = {}, legacy = {}, draft = {} } = inventory;
  return FIELD_ORDER.map((fieldKey) =>
    evaluateField({
      fieldKey,
      approved: approved[fieldKey] || null,
      pending: pending[fieldKey] || null,
      legacy: legacy[fieldKey] || null,
      draft: draft[fieldKey] || null,
    }),
  );
}

// ---------------------------------------------------------------------------
// Deterministic completion (D-36 A6). The AI's `complete` boolean is ADVISORY
// only — this engine decides whether the interview STEP is finished.
//
// state: {
//   resolved: { fieldKey: true },   // canonically answered/confirmed/skipped
//   deferred: { fieldKey: true },   // owner chose to defer (deferred_by_owner)
//   surfaces: { fieldKey: n },      // how many times the field was surfaced
// }
// ---------------------------------------------------------------------------

function fieldSettled(entry, state) {
  if (entry.action === ACTIONS.SKIP) return true; // approved — nothing to ask
  if (state.resolved && state.resolved[entry.fieldKey]) return true;
  if (state.deferred && state.deferred[entry.fieldKey]) return true;
  // Ceiling: a field that already surfaced its maximum is honestly exhausted —
  // it is NOT marked resolved; it simply may not surface again.
  const n = (state.surfaces && state.surfaces[entry.fieldKey]) || 0;
  return n >= MAX_SURFACES_PER_FIELD;
}

/** The next plan entry the interview should surface, or null when none may. */
function nextField(plan, state = {}) {
  for (const entry of plan) {
    if (entry.action === ACTIONS.SKIP) continue;
    if (fieldSettled(entry, state)) continue;
    return entry;
  }
  return null;
}

/**
 * Deterministic interview-step completion: complete when every field is
 * settled (approved-skip, canonically resolved, owner-deferred, or surface
 * ceiling reached). Never turn-count based; never AI-decided.
 */
function interviewComplete(plan, state = {}) {
  return plan.every((entry) => fieldSettled(entry, state));
}

/**
 * Owner "continue onboarding anyway": returns the honest record for exiting
 * the interview step now — remaining gaps become deferred_by_owner; required/
 * strategic gaps are listed as unresolved (never fabricated as resolved).
 */
function continueAnyway(plan, state = {}) {
  const deferred = [];
  const unresolvedImportant = [];
  for (const entry of plan) {
    if (fieldSettled(entry, state)) continue;
    deferred.push({ fieldKey: entry.fieldKey, reason: REASONS.DEFERRED_BY_OWNER });
    if (REQUIRED_FIELDS.includes(entry.fieldKey) || STRATEGIC_FIELDS.includes(entry.fieldKey)) {
      unresolvedImportant.push(entry.fieldKey);
    }
  }
  return { deferred, unresolvedImportant };
}

module.exports = {
  ACTIONS,
  REASONS,
  NOTICES,
  FIELD_ORDER,
  REQUIRED_FIELDS,
  STRATEGIC_FIELDS,
  MAX_SURFACES_PER_FIELD,
  HARD_QUESTION_CEILING,
  normalizeForComparison,
  materiallyDiffers,
  evaluateField,
  buildPlan,
  nextField,
  interviewComplete,
  continueAnyway,
};
