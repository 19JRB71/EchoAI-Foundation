// ---------------------------------------------------------------------------
// 026-C1 Ruling A — calendar activation artifact + consent digest (pure).
//
// Activation (DRAFT -> SCHEDULED) is an authorization boundary: the owner
// approves an exact artifact — which posts, at which times, to which
// destinations — and that approval is bound to a digest of that artifact.
// The server recomputes the digest inside the activation transaction; any
// change (edit, regeneration, re-slot, binding change, staleness change)
// invalidates the confirmation.
//
// Pure module: no db, no clock of its own (callers pass `now`), so every rule
// is unit-testable in isolation.
// ---------------------------------------------------------------------------

const crypto = require("crypto");

// A draft scheduled less than this far in the future can't honestly be
// "scheduled": the publisher sweep could pick it up before the owner's
// approval round-trips. Such drafts are classified stale, never activated.
const ACTIVATION_LEAD_MS = 5 * 60 * 1000;

/**
 * Classify a calendar's draft posts against the brand's connected bindings.
 *
 * drafts:   rows { post_id, platform, scheduled_time }
 * bindings: [{ platform, destination }] — one per CONNECTED social_accounts
 *           row (AM-C1-1: only an explicit social_accounts row makes a
 *           platform bound; user-level credentials alone never do).
 *
 * Returns { eligible, excludedStale, excludedUnbound } where each entry is
 * { postId, scheduledTime (ISO), platform, destination? }.
 * Unbound wins over stale: a post with nowhere to go is excluded as unbound
 * even if its time has also passed — the missing destination is the truer
 * (and actionable) reason.
 */
function classifyDrafts({ drafts, bindings, now = new Date(), leadMs = ACTIVATION_LEAD_MS }) {
  const boundByPlatform = new Map();
  for (const b of bindings || []) {
    boundByPlatform.set(String(b.platform), String(b.destination || ""));
  }
  const cutoff = now.getTime() + leadMs;
  const eligible = [];
  const excludedStale = [];
  const excludedUnbound = [];
  for (const d of drafts || []) {
    const platform = String(d.platform);
    const scheduledTime = new Date(d.scheduled_time).toISOString();
    const entry = { postId: String(d.post_id), scheduledTime, platform };
    if (!boundByPlatform.has(platform)) {
      excludedUnbound.push(entry);
      continue;
    }
    if (new Date(d.scheduled_time).getTime() <= cutoff) {
      excludedStale.push(entry);
      continue;
    }
    eligible.push({ ...entry, destination: boundByPlatform.get(platform) });
  }
  return { eligible, excludedStale, excludedUnbound };
}

/**
 * Deterministic, input-order-independent digest over the eligible set.
 * One line per post — postId|scheduledTimeISO|platform|destination — sorted,
 * then sha256. The empty set has a well-defined constant digest (a calendar
 * with no drafts may still be re-activated: resume semantics).
 */
function computeActivationDigest(eligible) {
  const lines = (eligible || [])
    .map(
      (e) =>
        `${e.postId}|${new Date(e.scheduledTime).toISOString()}|${e.platform}|${e.destination || ""}`,
    )
    .sort();
  return crypto.createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

/**
 * The owner-facing artifact summary: digest + truthful counts, date range,
 * platforms, per-platform destinations, and both exclusion lists. The full
 * eligible set rides along for the activation transaction (it flips exactly
 * these ids — never a broad status predicate).
 */
function summarizeArtifact({ eligible, excludedStale, excludedUnbound }) {
  const times = eligible.map((e) => new Date(e.scheduledTime).getTime()).sort((a, b) => a - b);
  const platforms = [...new Set(eligible.map((e) => e.platform))].sort();
  const destinations = {};
  for (const e of eligible) {
    if (!(e.platform in destinations)) destinations[e.platform] = e.destination;
  }
  return {
    digest: computeActivationDigest(eligible),
    // The full eligible set rides along (internal use): the activation
    // transaction flips exactly these ids — never a broad status predicate.
    eligible,
    eligibleCount: eligible.length,
    firstScheduledTime: times.length ? new Date(times[0]).toISOString() : null,
    lastScheduledTime: times.length ? new Date(times[times.length - 1]).toISOString() : null,
    platforms,
    destinations,
    excludedStaleCount: excludedStale.length,
    excludedStale,
    excludedUnboundCount: excludedUnbound.length,
    excludedUnbound,
  };
}

module.exports = {
  ACTIVATION_LEAD_MS,
  classifyDrafts,
  computeActivationDigest,
  summarizeArtifact,
};
