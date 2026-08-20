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
import { makeFailedExecuteEnvelope } from "./setupAgentResponseEnvelope.fixture.js";

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

// ---------------------------------------------------------------------------
// 026-C3-PM2 — pause-lifecycle regressions (R1–R16).
//
// Binding invariant (§C): an owner-action pause is a RESTING state of the
// client loop. Any loop pass, however triggered, that encounters an active
// pause must terminate in that pause, re-rendered from authoritative state.
// A pause is never "done", never "failed", never an invitation to continue.
//
// These tests model a REAL second loop pass (fresh mount → startSetupSession
// adoption → runLoop → execute → pause re-derived from server truth), assert
// visible UI truth (panel present, no later-step "Working on it…"), and
// assert explicit owner action is still required — per §Q, never a bare
// double-render with no runLoop/adoption behavior exercised.
// ---------------------------------------------------------------------------
import { classifyStepStatus } from "./executeError.js";

const TWO_STEPS = [
  { key: "create_facebook_campaign", label: "Creating your first Facebook ad campaign" },
  { key: "setup_google_ads", label: "Setting up your Google Ads campaign" },
];

const TWO_STEP_SESSION = { ...READY_SESSION, steps: TWO_STEPS };

function needsConnectionPause() {
  return {
    step: STEP,
    status: "needs_connection",
    detail: "Connect Facebook so I can continue.",
    connect: "facebook",
  };
}

describe("026-C3-PM2 shared pause-class classification (R3, R15, R16)", () => {
  test("R15: no non-completed status ever classifies as done — the `status !== \"failed\" ⇒ done` lie-class is closed", () => {
    // The whole pause class plus unknown/future strings.
    for (const status of [
      "owner_action_required",
      "needs_connection",
      "failed",
      "running",
      "mystery_future_status_v9",
      "",
      undefined,
      null,
    ]) {
      expect(classifyStepStatus(status)).not.toBe("done");
    }
    // Only authoritative completion classifies as done.
    expect(classifyStepStatus("done")).toBe("done");
    expect(classifyStepStatus("skipped")).toBe("done");
    expect(classifyStepStatus("failed")).toBe("failed");
  });

  test("R16: missing_ad_destination, confirm_campaign_launch, and needs_connection all classify through the shared awaiting-owner path", () => {
    // Both owner_action_required pauses (missing_ad_destination and
    // confirm_campaign_launch arrive under this status) and needs_connection
    // flow through ONE classification: awaiting_owner — a resting state.
    expect(classifyStepStatus(missingDestinationPause().status)).toBe("awaiting_owner");
    expect(classifyStepStatus(confirmLaunchPause().status)).toBe("awaiting_owner");
    expect(classifyStepStatus(needsConnectionPause().status)).toBe("awaiting_owner");
    // Future pause/action codes fail safely as awaiting-owner too (§H).
    expect(classifyStepStatus("some_new_pause_kind")).toBe("awaiting_owner");
  });
});

describe("026-C3-PM2 pause is a resting state across loop re-entry (R1, R2, R4, R6, R7, R14)", () => {
  test("R1+R4: the pause renders AND the later step never shows 'Working on it…' while server truth is paused at Step 6", async () => {
    api.startSetupSession.mockResolvedValue({ session: TWO_STEP_SESSION });
    api.runSetupAction.mockResolvedValue(missingDestinationPause());

    render(<SetupAgent onClose={vi.fn()} />);

    expect(await screen.findByTestId("owner-action-panel")).toBeInTheDocument();
    // The later step must NOT be predicted as running (§E): the row exists,
    // but carries no "Working on it…" and no running dot.
    expect(screen.getByText("Setting up your Google Ads campaign")).toBeInTheDocument();
    expect(screen.queryByText("Working on it…")).not.toBeInTheDocument();
    // Step 6 is not shown as completed either (R3, rendered form).
    expect(screen.queryAllByLabelText("done")).toHaveLength(0);
    // Exactly one execute happened — the loop RESTED in the pause instead of
    // continuing to the next step.
    expect(api.runSetupAction).toHaveBeenCalledTimes(1);
  });

  test("R2+R6+R7+R14: a full second loop pass (remount → authoritative re-adoption → re-execute) converges to the SAME pause, never a blanked panel or a predicted-running later step", async () => {
    api.startSetupSession.mockResolvedValue({ session: TWO_STEP_SESSION });
    api.runSetupAction.mockResolvedValue(missingDestinationPause());

    const first = render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByTestId("owner-action-panel")).toBeInTheDocument();
    expect(api.runSetupAction).toHaveBeenCalledTimes(1);
    first.unmount();

    // Second legal pass: fresh mount re-reads authoritative truth
    // (startSetupSession → adoptSession) and re-enters runLoop, which
    // re-derives the pause from the server's execute response.
    render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByTestId("owner-action-panel")).toBeInTheDocument();
    await waitFor(() => expect(api.runSetupAction).toHaveBeenCalledTimes(2));

    // Same pause, re-rendered from authoritative state: capture inline, Skip
    // available, explicit owner action still required.
    expect(screen.getByTestId("capture-stub")).toBeInTheDocument();
    expect(screen.getByTestId("owner-action-skip")).toBeInTheDocument();
    // R4/R14: no predicted-running lie, no blanked pause, no completion.
    expect(screen.queryByText("Working on it…")).not.toBeInTheDocument();
    expect(screen.queryAllByLabelText("done")).toHaveLength(0);
    expect(screen.queryByTestId("failed-step-panel")).not.toBeInTheDocument();
  });

  test("R5: owner re-entry that does NOT change server truth cannot advance past the pause — the panel is REPLACED, never blanked, and no later step runs", async () => {
    api.startSetupSession.mockResolvedValue({ session: TWO_STEP_SESSION });
    // The capture reports configured, but authoritative truth still answers
    // with the SAME pause (e.g. the save didn't stick server-side).
    api.runSetupAction
      .mockResolvedValueOnce(missingDestinationPause())
      .mockResolvedValueOnce(missingDestinationPause());

    render(<SetupAgent onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText("stub-configured"));

    // The re-entered loop terminates in the re-derived pause.
    await waitFor(() => expect(api.runSetupAction).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("owner-action-panel")).toBeInTheDocument();
    expect(screen.getByTestId("capture-stub")).toBeInTheDocument();
    expect(screen.queryByText("Working on it…")).not.toBeInTheDocument();
    expect(screen.queryAllByLabelText("done")).toHaveLength(0);
  });
});

describe("026-C3-PM2 launch-confirm and connection pauses get the same lifecycle protection (R9, R10)", () => {
  test("R9: confirm_campaign_launch survives remount/re-entry — the SAME authorization panel re-renders from server truth and no confirm is ever auto-sent", async () => {
    api.startSetupSession.mockResolvedValue({ session: TWO_STEP_SESSION });
    api.runSetupAction.mockResolvedValue(confirmLaunchPause());

    const first = render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByTestId("owner-action-authorize")).toBeInTheDocument();
    first.unmount();

    render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByTestId("owner-action-authorize")).toBeInTheDocument();
    await waitFor(() => expect(api.runSetupAction).toHaveBeenCalledTimes(2));

    // Server-truth summary re-rendered; explicit authorization still required.
    expect(screen.getByText("Main Street Storage")).toBeInTheDocument();
    expect(screen.getByText("$0 is spent at creation.")).toBeInTheDocument();
    expect(screen.queryByText("Working on it…")).not.toBeInTheDocument();
    // NO call ever carried a confirm — remount/re-entry can never authorize.
    const withConfirm = api.runSetupAction.mock.calls.filter((c) => c[2]);
    expect(withConfirm).toHaveLength(0);
  });

  test("R10: needs_connection is a resting owner-action state — it never advances local progress and survives a second pass", async () => {
    api.startSetupSession.mockResolvedValue({ session: TWO_STEP_SESSION });
    api.runSetupAction.mockResolvedValue(needsConnectionPause());

    const first = render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /connect facebook/i })).toBeInTheDocument();
    expect(api.runSetupAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Working on it…")).not.toBeInTheDocument();
    expect(screen.queryAllByLabelText("done")).toHaveLength(0);
    first.unmount();

    render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /connect facebook/i })).toBeInTheDocument();
    await waitFor(() => expect(api.runSetupAction).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Working on it…")).not.toBeInTheDocument();
    expect(screen.queryAllByLabelText("done")).toHaveLength(0);
  });
});

describe("026-C3-PM2 unknown statuses rest safely (R15 integration)", () => {
  test("an unknown/future step status rests as an awaiting-owner pause: one execute, no runaway loop, no advancement, owner action offered", async () => {
    api.startSetupSession.mockResolvedValue({ session: TWO_STEP_SESSION });
    api.runSetupAction.mockResolvedValue({
      step: STEP,
      status: "mystery_future_status_v9",
      detail: "Something new the client does not recognize.",
      action: { code: "mystery_future_action" },
    });

    render(<SetupAgent onClose={vi.fn()} />);

    // The generic honest pause renders (unknown owner-action surface).
    expect(await screen.findByTestId("owner-action-panel")).toBeInTheDocument();
    // The honest detail shows in BOTH surfaces: the checklist row and the
    // generic awaiting-owner panel.
    expect(
      screen.getAllByText("Something new the client does not recognize.").length,
    ).toBeGreaterThanOrEqual(2);
    // The loop RESTED: exactly one execute — an unknown status is never an
    // invitation to continue (and never an infinite re-execute either).
    expect(api.runSetupAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Working on it…")).not.toBeInTheDocument();
    expect(screen.queryAllByLabelText("done")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 026-C3-PM2 CITATION 3 — composed lifecycle: owner-action pause → legitimate
// owner re-entry → REAL C2-style durable failure on the next execute.
//
// Binds, in one continuous run against actual runLoop/adoption behavior:
//   a. the pause existed first (capture panel visibly rendered);
//   b. the later execution failed durably (502 + C2 outcome body);
//   c. the pause UI disappeared/was replaced — never left stale;
//   d. the durable failed panel rendered with the safe owner message;
//   e. the authoritative failed outcome (from the failure body's serialized
//      session) was adopted — the step rail shows failed, not awaiting-owner;
// and that no blank intermediate terminal state is accepted: the terminal
// render IS the failed panel with its Retry per the durable-failure contract,
// while the later step never shows "Working on it…".
// ---------------------------------------------------------------------------
describe("026-C3-PM2 Citation 3 — pause → owner re-entry → durable failure composition", () => {
  test("an active capture pause is REPLACED by the durable failed panel when the re-entered step fails durably — no stale pause, no lost failure, no blank state", async () => {
    const safeMessage =
      "The AI service was temporarily unavailable while running this step. Your progress is saved — you can retry now.";
    const failedBody = makeFailedExecuteEnvelope({
      step: STEP,
      durableOutcome: {
        status: "failed",
        code: "provider_unavailable",
        message: safeMessage,
        retryable: true,
        ref: "ref-77",
        at: "2026-08-17T00:00:00Z",
      },
      sessionOverrides: TWO_STEP_SESSION,
    });

    api.startSetupSession.mockResolvedValue({ session: TWO_STEP_SESSION });
    api.runSetupAction
      // (a) authoritative pause first.
      .mockResolvedValueOnce(missingDestinationPause())
      // (b) the owner-triggered re-entry then fails durably (real C2 shape).
      .mockRejectedValueOnce(
        Object.assign(new Error("Request failed"), { status: 502, data: failedBody }),
      );

    render(<SetupAgent onClose={vi.fn()} />);

    // (a) The pause panel is visibly present before anything else happens.
    expect(await screen.findByTestId("owner-action-panel")).toBeInTheDocument();
    expect(screen.getByTestId("capture-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("failed-step-panel")).not.toBeInTheDocument();

    // (c) Legitimate owner action: the capture reports configured, which
    // re-enters the loop and re-executes the step — which now fails durably.
    fireEvent.click(screen.getByText("stub-configured"));

    // (d) The durable failed panel renders with the safe owner message and
    // the C2 reference line.
    const failedPanel = await screen.findByTestId("failed-step-panel");
    expect(failedPanel.textContent).toMatch(
      /The AI service was temporarily unavailable while running this step/,
    );
    expect(screen.getByText(/Reference: ref-77/)).toBeInTheDocument();
    // Retry appears exactly per the durable-failure contract (retryable).
    expect(screen.getByTestId("failed-step-retry")).toBeInTheDocument();

    // (c) The old pause did NOT remain stale — replaced, not co-rendered.
    expect(screen.queryByTestId("owner-action-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("capture-stub")).not.toBeInTheDocument();

    // (e) The authoritative failed outcome was adopted: the step rail shows
    // the failed state, not a lingering awaiting-owner record, and the later
    // step is not predicted as running or done.
    expect(screen.getAllByLabelText("failed").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Working on it…")).not.toBeInTheDocument();
    expect(screen.queryAllByLabelText("done")).toHaveLength(0);

    // No blank intermediate terminal state was accepted: exactly the two
    // executes happened (pause, then the failed re-entry) and the terminal
    // render is the failed panel above.
    expect(api.runSetupAction).toHaveBeenCalledTimes(2);
  });
});
