// 026-C3 — SetupAgent's handling of the two owner_action_required pauses
// (§J/§K/§L/§M): the Step-6 ads-destination capture pause and the explicit
// campaign-launch authorization pause.
//
// Pins, with the api module mocked and the shared capture stubbed at the
// component boundary:
//   - missing_ad_destination renders as a PAUSE: the shared capture mounts
//     inline, there is NO Retry control and no failure/provider copy; Skip
//     stays available and sends skip:true
//   - after the capture reports configured, the loop re-executes and the
//     server's next pause (confirm_campaign_launch) renders the server-truth
//     summary including Page, ad account, destination, "PAUSED", and "$0"
//   - Authorize sends the digest-bound confirm exactly once (one-shot
//     confirmRef, cleared before the call) and the loop proceeds
//   - a changed:true re-pause shows the updated-summary notice
//   - Skip at the launch pause is an honest skip (skip:true, no confirm ever)
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

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

// Stub the shared capture at the component boundary: this suite pins the
// HOST behavior (pause rendering, loop re-entry), not the capture's internals
// (covered by AdsDestinationCapture.test.jsx).
vi.mock("./guided/AdsDestinationCapture.jsx", () => ({
  default: ({ onConfigured }) => (
    <div data-testid="capture-stub">
      <button onClick={() => onConfigured({ pageId: "p-1", adLinkUrl: "https://x.example/" })}>
        stub-configured
      </button>
    </div>
  ),
}));

import { api } from "../api.js";
import SetupAgent from "./SetupAgent.jsx";

const STEPS = [{ key: "create_facebook_campaign", label: "Creating your first Facebook ad campaign" }];

const READY_SESSION = {
  sessionId: "sess-1",
  interviewComplete: true,
  consentGranted: true,
  steps: STEPS,
  completedSteps: [],
  brandId: "brand-1",
};

const STEP = { key: "create_facebook_campaign", label: "Creating your first Facebook ad campaign" };

function missingDestinationPause() {
  return {
    step: STEP,
    status: "owner_action_required",
    detail: "Before I can set up your first ad campaign, choose the Facebook Page your ads will run from.",
    action: {
      code: "missing_ad_destination",
      missing: { page: true, destination: true },
    },
  };
}

const DIGEST = "a".repeat(64);

function confirmLaunchPause(overrides = {}) {
  return {
    step: STEP,
    status: "owner_action_required",
    detail:
      "Everything is configured. Review the summary and authorize creating your first campaign — it will be created PAUSED with $0 spent.",
    action: {
      code: "confirm_campaign_launch",
      digest: DIGEST,
      changed: false,
      summary: {
        pageId: "p-1",
        pageName: "Main Street Storage",
        adAccount: "act_987654",
        destination: "https://x.example/",
        dailyBudget: 10,
        createdPaused: true,
        initialSpend: 0,
      },
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.startSetupSession.mockResolvedValue({ session: READY_SESSION });
  api.pauseSetupSession.mockResolvedValue(undefined);
});

describe("SetupAgent owner_action_required pauses", () => {
  test("missing_ad_destination renders the capture pause: no Retry, no failure copy, Skip available", async () => {
    api.runSetupAction.mockResolvedValueOnce(missingDestinationPause());

    render(<SetupAgent onClose={vi.fn()} />);

    expect(await screen.findByTestId("owner-action-panel")).toBeInTheDocument();
    expect(screen.getByTestId("capture-stub")).toBeInTheDocument();
    // A pause, not a failure: no Retry control, no failed-step panel, no
    // provider/AI failure copy.
    expect(screen.queryByTestId("failed-step-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("failed-step-retry")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/AI service/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("owner-action-skip")).toBeInTheDocument();
  });

  test("Skip at the capture pause sends skip:true and never a confirm", async () => {
    api.runSetupAction
      .mockResolvedValueOnce(missingDestinationPause())
      .mockResolvedValueOnce({ step: STEP, status: "skipped", detail: "Skipped." })
      .mockResolvedValueOnce({ allComplete: true, session: { ...READY_SESSION, status: "completed" } });

    render(<SetupAgent onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId("owner-action-skip"));

    await waitFor(() => expect(api.runSetupAction).toHaveBeenCalledWith("sess-1", true));
    const confirms = api.runSetupAction.mock.calls.map((c) => c[2]).filter(Boolean);
    expect(confirms).toEqual([]);
  });

  test("configured capture re-enters the loop; the launch pause renders the SERVER-truth summary (PAUSED, $0)", async () => {
    api.runSetupAction
      .mockResolvedValueOnce(missingDestinationPause())
      .mockResolvedValueOnce(confirmLaunchPause());

    render(<SetupAgent onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText("stub-configured"));

    expect(await screen.findByText(/authorize your first ad campaign/i)).toBeInTheDocument();
    expect(screen.getByText("Main Street Storage")).toBeInTheDocument();
    expect(screen.getByText("act_987654")).toBeInTheDocument();
    expect(screen.getByText("https://x.example/")).toBeInTheDocument();
    expect(
      screen.getByText("The campaign is created PAUSED — it will not run ads yet."),
    ).toBeInTheDocument();
    expect(screen.getByText("$0 is spent at creation.")).toBeInTheDocument();
    // The second execute (after configuration) carried NO confirm —
    // configuration alone never authorizes a launch.
    expect(api.runSetupAction).toHaveBeenLastCalledWith("sess-1", false, null);
    expect(screen.queryByTestId("failed-step-retry")).not.toBeInTheDocument();
  });

  test("Authorize sends the digest-bound confirm exactly once; subsequent calls carry none (one-shot)", async () => {
    api.runSetupAction
      .mockResolvedValueOnce(confirmLaunchPause())
      .mockResolvedValueOnce({ step: STEP, status: "done", detail: "Launched a paused campaign." })
      .mockResolvedValueOnce({ allComplete: true, session: { ...READY_SESSION, status: "completed" } });

    render(<SetupAgent onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId("owner-action-authorize"));

    await waitFor(() =>
      expect(api.runSetupAction).toHaveBeenCalledWith("sess-1", false, {
        step: "create_facebook_campaign",
        digest: DIGEST,
      }),
    );
    await waitFor(() => expect(screen.getByText(/your account is ready/i)).toBeInTheDocument());
    // One-shot: exactly ONE call carried a confirm; the loop's next calls did not.
    const withConfirm = api.runSetupAction.mock.calls.filter((c) => c[2]);
    expect(withConfirm).toHaveLength(1);
  });

  test("changed:true re-pause shows the updated-summary notice with the fresh values", async () => {
    api.runSetupAction.mockResolvedValueOnce(
      confirmLaunchPause({
        changed: true,
        digest: "b".repeat(64),
        summary: {
          pageId: "p-1",
          pageName: "Main Street Storage",
          adAccount: "act_987654",
          destination: "https://changed.example/",
          dailyBudget: 10,
          createdPaused: true,
          initialSpend: 0,
        },
      }),
    );

    render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByText(/setup changed since the last review/i)).toBeInTheDocument();
    expect(screen.getByText("https://changed.example/")).toBeInTheDocument();
  });

  test("Skip at the launch pause is an honest skip: skip:true, no confirm, nothing launched", async () => {
    api.runSetupAction
      .mockResolvedValueOnce(confirmLaunchPause())
      .mockResolvedValueOnce({ step: STEP, status: "skipped", detail: "Skipped." })
      .mockResolvedValueOnce({ allComplete: true, session: { ...READY_SESSION, status: "completed" } });

    render(<SetupAgent onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId("owner-action-skip"));

    await waitFor(() => expect(api.runSetupAction).toHaveBeenCalledWith("sess-1", true));
    const withConfirm = api.runSetupAction.mock.calls.filter((c) => c[2]);
    expect(withConfirm).toHaveLength(0);
  });
});
