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
