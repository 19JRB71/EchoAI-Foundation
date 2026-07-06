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
