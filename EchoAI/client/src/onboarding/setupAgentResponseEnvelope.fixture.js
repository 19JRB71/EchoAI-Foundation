// Shared setup-agent failure envelope fixture for PM6/PM7 client regressions.
// Its reduced immediate outcome + complete serialized session shape is bound by
// the server test named "PM7 response envelope keeps immediate outcome reduced
// while serializing durable truth" in tests/setupAgent.pm6Deferral.test.js.

export const FACEBOOK_CAMPAIGN_STEP = {
  key: "create_facebook_campaign",
  label: "Creating your first Facebook ad campaign",
};

export const MANUAL_REVIEW_FAILURE = {
  status: "failed",
  code: "provider_manual_review",
  message: "The campaign needs manual review.",
  retryable: false,
  ref: "original-ref",
  at: "2026-08-19T14:38:15.312Z",
};

export function makeSetupSession({
  step = FACEBOOK_CAMPAIGN_STEP,
  stepOutcomes = {},
  ...overrides
} = {}) {
  return {
    sessionId: "sess-pm6",
    interviewComplete: true,
    consentGranted: true,
    steps: [step],
    completedSteps: [],
    stepOutcomes,
    ...overrides,
  };
}

export function reducedImmediateOutcome(outcome) {
  return {
    code: outcome && outcome.code,
    retryable: outcome && outcome.retryable,
    ref: outcome && outcome.ref,
    at: outcome && outcome.at,
  };
}

export function makeFailedExecuteEnvelope({
  step = FACEBOOK_CAMPAIGN_STEP,
  durableOutcome = MANUAL_REVIEW_FAILURE,
  includeDurableOutcome = true,
  immediateOutcome,
  errorMessage,
  sessionOverrides = {},
} = {}) {
  const stepOutcomes = includeDurableOutcome
    ? { ...(sessionOverrides.stepOutcomes || {}), [step.key]: durableOutcome }
    : { ...(sessionOverrides.stepOutcomes || {}) };
  const session = makeSetupSession({
    step,
    ...sessionOverrides,
    stepOutcomes,
  });
  const responseMessage =
    errorMessage !== undefined
      ? errorMessage
      : typeof durableOutcome?.message === "string" && durableOutcome.message.length > 0
        ? durableOutcome.message
        : "This step couldn't finish.";

  return {
    error: responseMessage,
    failedStep: step,
    outcome:
      immediateOutcome === undefined
        ? reducedImmediateOutcome(durableOutcome)
        : immediateOutcome,
    session,
  };
}

export function makeFailedExecuteError(options = {}) {
  const data = makeFailedExecuteEnvelope(options);
  return Object.assign(new Error(data.error), {
    status: data.outcome && data.outcome.retryable ? 502 : 400,
    data,
  });
}