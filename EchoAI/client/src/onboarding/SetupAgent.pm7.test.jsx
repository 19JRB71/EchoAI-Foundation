// 026-C3-PM7 — durable session outcome authority over reduced execute errors.
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../api.js", () => ({
  api: {
    startSetupSession: vi.fn(),
    runSetupAction: vi.fn(),
    grantSetupConsent: vi.fn(),
    submitSetupAnswer: vi.fn(),
    pauseSetupSession: vi.fn(),
    pauseSetupSessionBeacon: vi.fn(),
    dismissSetupSession: vi.fn(),
    startGoogleOAuth: vi.fn(),
    startFacebookOAuth: vi.fn(),
  },
}));

import { api } from "../api.js";
import SetupAgent from "./SetupAgent.jsx";
import {
  FACEBOOK_CAMPAIGN_STEP,
  MANUAL_REVIEW_FAILURE,
  makeFailedExecuteError,
  makeSetupSession,
  reducedImmediateOutcome,
} from "./setupAgentResponseEnvelope.fixture.js";

const PROVIDER_PERMISSION = {
  ...MANUAL_REVIEW_FAILURE,
  code: "provider_permission",
  message: "The connected ad account needs permission attention.",
};
const PROVIDER_UNAVAILABLE = {
  ...MANUAL_REVIEW_FAILURE,
  code: "provider_unavailable",
  message: "The provider is temporarily unavailable.",
  retryable: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.pauseSetupSession.mockResolvedValue(undefined);
  api.startSetupSession.mockResolvedValue({ session: makeSetupSession() });
});

async function renderFailed(options = {}) {
  api.runSetupAction.mockRejectedValueOnce(makeFailedExecuteError(options));
  render(<SetupAgent onClose={vi.fn()} />);
  await screen.findByTestId("failed-step-panel");
}

describe("SetupAgent PM7 durable failed-outcome authority", () => {
  test("real reduced envelope uses durable campaign truth and renders Defer, never Skip", async () => {
    await renderFailed();

    expect(screen.getByTestId("failed-step-defer")).toHaveTextContent("Defer for now");
    expect(screen.queryByText("Skip this step")).not.toBeInTheDocument();
    expect(screen.getByText(/campaign draft stays paused at Meta and is not running/i)).toBeInTheDocument();
  });

  test("durable provider_permission keeps ordinary Skip and never gains Defer", async () => {
    await renderFailed({ durableOutcome: PROVIDER_PERMISSION });

    expect(screen.getByText("Skip this step")).toBeInTheDocument();
    expect(screen.queryByTestId("failed-step-defer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("failed-step-retry")).not.toBeInTheDocument();
  });

  test("non-campaign provider_manual_review keeps ordinary behavior", async () => {
    await renderFailed({
      step: { key: "setup_google_ads", label: "Setting up Google Ads" },
      durableOutcome: MANUAL_REVIEW_FAILURE,
    });

    expect(screen.getByText("Skip this step")).toBeInTheDocument();
    expect(screen.queryByTestId("failed-step-defer")).not.toBeInTheDocument();
  });

  test.each([
    ["blank ref", { ...MANUAL_REVIEW_FAILURE, ref: "" }],
    ["blank message", { ...MANUAL_REVIEW_FAILURE, message: "" }],
  ])("malformed durable manual-review truth (%s) fails closed to Skip", async (_name, outcome) => {
    await renderFailed({ durableOutcome: outcome });

    expect(screen.getByText("Skip this step")).toBeInTheDocument();
    expect(screen.queryByTestId("failed-step-defer")).not.toBeInTheDocument();
  });

  test("durable session truth wins unconditionally when the immediate projection disagrees", async () => {
    const immediate = reducedImmediateOutcome(PROVIDER_PERMISSION);
    await renderFailed({
      durableOutcome: MANUAL_REVIEW_FAILURE,
      immediateOutcome: immediate,
      errorMessage: "The reduced projection must lose.",
    });

    expect(screen.getByTestId("failed-step-defer")).toBeInTheDocument();
    expect(screen.getAllByText(MANUAL_REVIEW_FAILURE.message).length).toBeGreaterThan(0);
    expect(screen.queryByText("The reduced projection must lose.")).not.toBeInTheDocument();
  });

  test("missing durable truth uses reduced fallback without synthesizing Defer eligibility", async () => {
    await renderFailed({
      includeDurableOutcome: false,
      immediateOutcome: reducedImmediateOutcome(MANUAL_REVIEW_FAILURE),
      errorMessage: MANUAL_REVIEW_FAILURE.message,
    });

    expect(screen.getByText("Skip this step")).toBeInTheDocument();
    expect(screen.queryByTestId("failed-step-defer")).not.toBeInTheDocument();
    expect(screen.getByText("Your ad account needs attention")).toBeInTheDocument();
  });

  test("non-campaign provider_unavailable panel and Retry behavior remain unchanged", async () => {
    await renderFailed({
      step: { key: "setup_google_ads", label: "Setting up Google Ads" },
      durableOutcome: PROVIDER_UNAVAILABLE,
    });

    expect(screen.getByText("This step couldn't finish")).toBeInTheDocument();
    expect(screen.getAllByText(PROVIDER_UNAVAILABLE.message).length).toBeGreaterThan(0);
    expect(screen.getByTestId("failed-step-retry")).toHaveTextContent("Retry this step");
    expect(screen.getByText("Skip this step")).toBeInTheDocument();
    expect(screen.queryByTestId("failed-step-defer")).not.toBeInTheDocument();
  });
});