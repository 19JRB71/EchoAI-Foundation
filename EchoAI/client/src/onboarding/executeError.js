// Classifies an error thrown by `api.runSetupAction` during the setup /execute
// loop. This is a subtle, race-dependent contract: a 409 that carries the real
// session is a user-initiated pause/dismiss that raced this step and won
// server-side (see `respondCancelledMidStep`) — it must resolve to the true
// lifecycle state, NOT the scary red error screen. Any other rejection —
// including a 409 WITHOUT a session body (e.g. "A setup step is already
// running") — is a normal retryable error.
//
// Kept as a standalone, dependency-free pure function so the fragile branching
// stays refactor-safe and can be unit-tested without a React renderer.
//
// Returns one of:
//   { type: "dismissed" }              → close the agent cleanly (no banner)
//   { type: "paused", session }        → show the resumable "Setup paused" panel
//   { type: "error", message }         → surface the normal retryable error
export function classifyExecuteError(err) {
  const session = err && err.status === 409 && err.data && err.data.session;
  if (session) {
    if (session.status === "dismissed") return { type: "dismissed" };
    if (session.status === "paused") return { type: "paused", session };
  }
  return {
    type: "error",
    message: (err && err.message) || "A setup step failed. You can retry.",
  };
}
