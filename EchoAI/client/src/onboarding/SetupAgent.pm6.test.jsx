// 026-C3-PM6 — failed/manual-review deferral rendering.
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
  FACEBOOK_CAMPAIGN_STEP as STEP,
  MANUAL_REVIEW_FAILURE as FAILURE,
  makeFailedExecuteError,
  makeSetupSession,
} from "./setupAgentResponseEnvelope.fixture.js";

const READY = makeSetupSession();
const DEFERRED = {
  ...FAILURE,
  journey_disposition: "deferred",
  deferred_reason: "pending_provider_review",
  deferred_at: "2026-08-19T20:00:00.000Z",
  owner_directed: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.pauseSetupSession.mockResolvedValue(undefined);
  api.startSetupSession.mockResolvedValue({ session: READY });
});

describe("SetupAgent PM6 deferral", () => {
  test("R8: only durable provider_manual_review renders Defer for now and the paused/not-running explanation", async () => {
    api.runSetupAction.mockRejectedValueOnce(makeFailedExecuteError());
    render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByTestId("failed-step-defer")).toHaveTextContent("Defer for now");
    expect(screen.getByText(/campaign draft stays paused at Meta and is not running/i)).toBeInTheDocument();
    expect(screen.queryByText("Skip this step")).not.toBeInTheDocument();
    expect(screen.queryByTestId("failed-step-retry")).not.toBeInTheDocument();
  });

  test("R8 negative: non-qualifying failures keep generic Skip and never gain the PM6 deferral action", async () => {
    api.runSetupAction.mockRejectedValueOnce(
      makeFailedExecuteError({
        durableOutcome: {
          ...FAILURE,
          code: "provider_permission",
          message: "Permission attention required.",
        },
      }),
    );
    const first = render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByText("Skip this step")).toBeInTheDocument();
    expect(screen.queryByTestId("failed-step-defer")).not.toBeInTheDocument();
    first.unmount();

    vi.clearAllMocks();
    api.pauseSetupSession.mockResolvedValue(undefined);
    api.startSetupSession.mockResolvedValue({ session: READY });
    api.runSetupAction.mockRejectedValueOnce(
      makeFailedExecuteError({
        durableOutcome: FAILURE,
        step: { key: "setup_google_ads", label: "Setting up Google Ads" },
      }),
    );
    const second = render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByText("Skip this step")).toBeInTheDocument();
    expect(screen.queryByTestId("failed-step-defer")).not.toBeInTheDocument();
    second.unmount();

    vi.clearAllMocks();
    api.pauseSetupSession.mockResolvedValue(undefined);
    api.startSetupSession.mockResolvedValue({ session: READY });
    api.runSetupAction.mockRejectedValueOnce(
      makeFailedExecuteError({ durableOutcome: { ...FAILURE, ref: "" } }),
    );
    render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByText("Skip this step")).toBeInTheDocument();
    expect(screen.queryByTestId("failed-step-defer")).not.toBeInTheDocument();
  });

  test("R9: the owner action sends skip=true, then authoritative state renders Deferred across reload", async () => {
    const deferredSession = {
      ...READY,
      completedSteps: [STEP.key],
      stepOutcomes: { [STEP.key]: DEFERRED },
    };
    api.runSetupAction
      .mockRejectedValueOnce(makeFailedExecuteError())
      .mockResolvedValueOnce({ status: "deferred", step: STEP, session: deferredSession })
      .mockResolvedValueOnce({ allComplete: true, session: { ...deferredSession, status: "completed" } });

    const { unmount } = render(<SetupAgent onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId("failed-step-defer"));
    await waitFor(() => expect(api.runSetupAction).toHaveBeenNthCalledWith(2, "sess-pm6", true));
    await waitFor(() => expect(api.runSetupAction.mock.calls[2].slice(0, 2)).toEqual(["sess-pm6", false]));
    expect(await screen.findByText("Deferred")).toBeInTheDocument();
    expect(screen.queryByText("Done.")).not.toBeInTheDocument();
    expect(screen.queryByText("Skipped.")).not.toBeInTheDocument();
    unmount();

    vi.clearAllMocks();
    api.pauseSetupSession.mockResolvedValue(undefined);
    api.startSetupSession.mockResolvedValue({ session: deferredSession });
    api.runSetupAction.mockResolvedValue({ allComplete: true, session: deferredSession });
    render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByText("Deferred")).toBeInTheDocument();
    expect(screen.getByLabelText("deferred")).toBeInTheDocument();
  });
});