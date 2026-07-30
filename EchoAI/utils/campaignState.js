/**
 * Prompt 005 — the campaigns.status state machine (single source of truth).
 *
 * Legal states:
 *   draft, approved, created_paused, live, completed, failed, launch_failed
 *
 * Legal transitions:
 *   draft          -> approved
 *   approved       -> created_paused        (successful launch / retry)
 *   approved       -> launch_failed         (launch failed mid-chain)
 *   launch_failed  -> approved              (explicit retry/reset only)
 *   created_paused -> live                  (VERIFICATION ONLY — read-back)
 *   live           -> created_paused        (VERIFICATION ONLY — read-back)
 *   created_paused -> failed                (future writer — none exists yet)
 *   live           -> failed                (future writer — none exists yet)
 *   live           -> completed             (future writer — none exists yet)
 *
 * HARD RULES (owner-binding, Prompt 005 addendum v3):
 *  - No code anywhere may write campaigns.status directly. Every domain-state
 *    change goes through transitionCampaignStatus().
 *  - Transitions into or out of 'live' are the exclusive authority of the
 *    verification helper (utils/campaignVerification.js). It passes the
 *    private VERIFICATION_AUTHORITY token; any other caller throws.
 *  - Illegal transitions throw — never silently no-op.
 *  - Prompt 005 ships NO writers for the future states (completed/failed);
 *    they are declared here so the machine is complete, but nothing calls
 *    them yet.
 */
const db = require("../config/db");

const LEGAL_STATES = Object.freeze([
  "draft",
  "approved",
  "created_paused",
  "live",
  "completed",
  "failed",
  "launch_failed",
]);

// Rows that represent a successfully launched Facebook chain (the set most
// "does this brand run ads?" consumers care about). Pre-005 these were the
// rows with status = 'active'.
const LAUNCHED_STATES = Object.freeze(["created_paused", "live"]);

// Rows whose daily budget counts as committed spend. Owner-binding rule
// (addendum G): committed spend counts ONLY live campaigns — a paused-at-
// Facebook chain cannot spend a cent.
const SPENDING_STATES = Object.freeze(["live"]);

const TRANSITIONS = Object.freeze({
  draft: ["approved"],
  approved: ["created_paused", "launch_failed"],
  launch_failed: ["approved"],
  created_paused: ["live", "failed"],
  live: ["created_paused", "failed", "completed"],
  completed: [],
  failed: [],
});

// Only utils/campaignVerification.js holds a reference to this token.
const VERIFICATION_AUTHORITY = Symbol("campaign-verification-authority");
const VERIFICATION_ONLY = new Set(["created_paused->live", "live->created_paused"]);

function isLegalState(state) {
  return LEGAL_STATES.includes(state);
}

/**
 * Throws unless from -> to is a legal transition. Verification-only
 * transitions additionally require the verification authority token.
 */
function assertLegalTransition(from, to, authority) {
  if (!isLegalState(from)) {
    throw new Error(`Illegal campaign state transition: unknown source state '${from}'`);
  }
  if (!isLegalState(to)) {
    throw new Error(`Illegal campaign state transition: unknown target state '${to}'`);
  }
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`Illegal campaign state transition: '${from}' -> '${to}'`);
  }
  if (VERIFICATION_ONLY.has(`${from}->${to}`) && authority !== VERIFICATION_AUTHORITY) {
    throw new Error(
      `Campaign state transition '${from}' -> '${to}' is reserved for the verification helper (Facebook read-back) and may not be written directly.`
    );
  }
}

/**
 * Atomically transitions one campaign row from -> to. The UPDATE is guarded
 * on the expected source state (WHERE status = from) and branches on the row
 * count, so a concurrent out-of-band change can never be overwritten.
 *
 * Returns true when the row was transitioned; throws if the transition is
 * illegal or the row was not in the expected source state.
 */
async function transitionCampaignStatus(campaignId, from, to, authority) {
  assertLegalTransition(from, to, authority);
  const result = await db.query(
    `UPDATE campaigns SET status = $1, updated_at = NOW()
      WHERE campaign_id = $2 AND status = $3`,
    [to, campaignId, from]
  );
  if (result.rowCount !== 1) {
    throw new Error(
      `Campaign ${campaignId} was not in state '${from}' (concurrent change?) — transition to '${to}' not applied.`
    );
  }
  return true;
}

module.exports = {
  LEGAL_STATES,
  LAUNCHED_STATES,
  SPENDING_STATES,
  TRANSITIONS,
  isLegalState,
  assertLegalTransition,
  transitionCampaignStatus,
  // Exported ONLY for utils/campaignVerification.js. Do not import elsewhere.
  _VERIFICATION_AUTHORITY: VERIFICATION_AUTHORITY,
};
