// Extracts the human-readable failure reason stored in a post's
// engagement_metrics JSON when publishing failed (platform error, or a
// server restart interrupting publishing). Returns null for posts without
// a stored error so their rendering stays unchanged.
export function postFailureReason(post) {
  if (!post || post.status !== "failed") return null;
  let metrics = post.engagement_metrics;
  if (!metrics) return null;
  if (typeof metrics === "string") {
    try {
      metrics = JSON.parse(metrics);
    } catch {
      return null;
    }
  }
  const error = metrics && typeof metrics.error === "string" ? metrics.error.trim() : "";
  return error || null;
}

// True when the failure came from a publish that was interrupted mid-flight
// (server restart between the platform call and the status write) — the post
// MAY already be live, so rescheduling risks a double post and the UI must ask
// for explicit confirmation first. Matches the marker text the scheduler's
// rescue sweep stores in engagement_metrics.error.
export function isInterruptedPublish(post) {
  const reason = postFailureReason(post);
  return !!reason && /may or may not have gone out/i.test(reason);
}

// Matches the credential/auth failure messages our publish path stores in
// engagement_metrics.error: platform API auth errors surfaced by socialApi's
// httpJson ("401 …", "Error validating access token: Session has expired",
// "Invalid OAuth access token"), missing-credential errors from
// requireFields ("Missing credentials for …", "Missing required … credential
// field(s)"), and loadConnectedAccount's "No connected <platform> account".
const CREDENTIAL_FAILURE_RE = new RegExp(
  [
    "access token",
    "\\btoken\\b",
    "credential",
    "unauthori[sz]ed",
    "\\b401\\b",
    "session (has )?expired",
    "revoked",
    "re-?authenticat",
    "log ?in (again|expired|required)",
    "invalid (grant|signature|session|login)",
    "\\boauth\\b",
    "no connected \\w+ account",
  ].join("|"),
  "i"
);

// True when the failure came from expired/revoked/invalid stored credentials
// (or a missing account connection) — rescheduling alone will just fail again,
// so the UI should offer a "Reconnect account" shortcut. Interrupted publishes
// are excluded: they are a double-post risk, not a credentials problem.
export function isCredentialFailure(post) {
  const reason = postFailureReason(post);
  if (!reason || isInterruptedPublish(post)) return false;
  return CREDENTIAL_FAILURE_RE.test(reason);
}

// Mirrors MAX_PUBLISH_ATTEMPTS in Zorecho/controllers/socialController.js: the
// total number of publish attempts the server gives a post before marking it
// 'failed' on a transient platform error. Keep in sync with the server.
export const MAX_PUBLISH_ATTEMPTS = 2;

// For a retrying post, describes where it is in its retry budget: how many
// attempts already failed and the total the server allows. The upcoming try is
// attempt (used + 1) of maxAttempts — capped so a stale row can never render
// "attempt 3 of 2". Returns null for posts that aren't retrying.
export function retryAttemptInfo(post) {
  if (!isRetryingPost(post)) return null;
  const used = Math.max(1, Number(post.publish_attempts) || 0);
  const nextAttempt = Math.min(used + 1, MAX_PUBLISH_ATTEMPTS);
  return { attemptsUsed: used, nextAttempt, maxAttempts: MAX_PUBLISH_ATTEMPTS };
}

// True when a scheduled post has already survived at least one failed publish
// attempt — the server hit a transient platform error and quietly pushed the
// post back to 'scheduled' a few minutes out. Surfacing this stops the moved
// time from looking like a glitch. Only applies to 'scheduled' posts; once a
// post publishes or permanently fails its rendering is unchanged.
export function isRetryingPost(post) {
  return (
    !!post &&
    post.status === "scheduled" &&
    Number(post.publish_attempts) > 0
  );
}
