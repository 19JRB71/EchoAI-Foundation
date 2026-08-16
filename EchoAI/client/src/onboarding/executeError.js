// Classifies an error thrown by `api.runSetupAction` during the setup /execute
// loop. This is a subtle, race-dependent contract: a 409 that carries the real
// session tells us exactly what happened server-side, and each variant needs a
// different, honest surface — never the scary red terminal error screen for a
// state the loop can recover from.
//
// Kept as a standalone, dependency-free pure function so the fragile branching
// stays refactor-safe and can be unit-tested without a React renderer.
//
// Returns one of:
//   { type: "dismissed" }                       → close the agent cleanly (no banner)
//   { type: "paused", session }                 → show the resumable "Setup paused" panel
//   { type: "reconcile", session? }             → another execute holds the lease (or a
//                                                  legacy 409 without a body): adopt any
//                                                  server truth, then bounded re-attempt
//                                                  (026-C2 / AM-C2-2) — NEVER terminal
//   { type: "failed", failedStep, outcome,      → the step failed durably server-side;
//     session, message }                           render the persistent STEP FAILED
//                                                  state with Retry (026-C2)
//   { type: "error", message }                  → surface the normal retryable error
export function classifyExecuteError(err) {
  const data = (err && err.data) || {};
  const session = err && err.status === 409 && data.session;
  if (session) {
    if (session.status === "dismissed") return { type: "dismissed" };
    if (session.status === "paused") return { type: "paused", session };
    // 026-C2: a 409 whose session is still in_progress is a live lease
    // conflict — another execute (this tab seconds ago, another tab, or a
    // remount race) is running the step right now. Reconcile, don't die.
    return { type: "reconcile", session };
  }
  // 026-C2: the server now records thrown steps as durable failed outcomes and
  // answers with the failed step + owner-safe outcome + authoritative session.
  if (err && data.failedStep && data.outcome) {
    return {
      type: "failed",
      failedStep: data.failedStep,
      outcome: data.outcome,
      session: data.session || null,
      message: (data.error || err.message) || "This step couldn't finish. You can retry.",
    };
  }
  // 026-C2: a bare 409 (legacy server, or a body that didn't survive the
  // network) still means "an execute is in flight" — reconcile with a bounded
  // re-attempt instead of a terminal "Please wait" over a dead loop.
  if (err && err.status === 409) {
    return { type: "reconcile", session: null };
  }
  return {
    type: "error",
    message: (err && err.message) || "A setup step failed. You can retry.",
  };
}
