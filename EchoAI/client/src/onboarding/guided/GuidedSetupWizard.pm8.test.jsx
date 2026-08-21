import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import GuidedSetupWizard, { shouldRecoverSocialPageHandoff } from "./GuidedSetupWizard.jsx";
import { api } from "../../api.js";

vi.mock("../../api.js", () => ({
  api: {
    getGuidedSetupState: vi.fn(),
    getSetupLatest: vi.fn(),
    saveGuidedSetupProgress: vi.fn(),
    reportGuidedSetupConnectionError: vi.fn(),
    updateOnboarding: vi.fn(),
    getOnboardingStatus: vi.fn(),
    claimFirstWinCelebration: vi.fn(),
  },
}));

vi.mock("./useEchoSpeak.js", () => ({
  useEchoSpeak: () => ({ speak: vi.fn(), stop: vi.fn() }),
}));

const setupAgentSpy = vi.fn();
vi.mock("../SetupAgent.jsx", () => ({
  default: (props) => {
    setupAgentSpy(props);
    return (
      <div data-testid="setup-agent">
        <button
          type="button"
          onClick={() => props.onExitToSection("social", "accounts")}
        >
          Choose a Page
        </button>
        <button type="button" onClick={props.onClose}>
          Complete profile setup
        </button>
      </div>
    );
  },
}));
vi.mock("../steps/StepSubscription.jsx", () => ({ default: () => <div>plan-step</div> }));
vi.mock("../steps/StepTeam.jsx", () => ({ default: () => null }));
vi.mock("./FirstWinStep.jsx", () => ({
  default: () => <div data-testid="firstwin-step">firstwin-step</div>,
  CONSENT_COPY_UNBOUND: "p024-v1-destination-unbound",
}));
vi.mock("./ConnectionsStep.jsx", () => ({ default: () => null }));
vi.mock("./OnlineLinksPanel.jsx", () => ({ default: () => null }));
vi.mock("./SageResearchPanel.jsx", () => ({ default: () => null }));

const DEFERRED_CAMPAIGN = Object.freeze({
  status: "failed",
  code: "provider_manual_review",
  retryable: false,
  message: "Facebook needs manual review.",
  ref: "73f3eef0-e65f-4795-a497-57efddaab508",
  journey_disposition: "deferred",
  deferred_reason: "pending_provider_review",
  owner_directed: true,
  deferred_at: "2026-08-20T16:33:19.917Z",
});

const RECOVERY_SESSION = Object.freeze({
  sessionId: "session-pm8",
  status: "in_progress",
  interviewComplete: true,
  consentGranted: true,
  brandId: "brand-pm8",
  completedSteps: Object.freeze(["create_facebook_campaign"]),
  stepOutcomes: Object.freeze({ create_facebook_campaign: DEFERRED_CAMPAIGN }),
  steps: Object.freeze([
    Object.freeze({ key: "create_facebook_campaign", label: "Create campaign" }),
    Object.freeze({ key: "connect_social", label: "Connect social" }),
    Object.freeze({ key: "finish_setup", label: "Finish setup" }),
  ]),
});

const EXISTING_RECOVERY = Object.freeze({
  clobbered: true,
  at: "2026-08-21T12:00:00.000Z",
  ref: "pm8b-11111111-1111-4111-8111-111111111111",
  note: "historical_connections_state_irrecoverable",
});

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  api.getGuidedSetupState.mockResolvedValue({
    progress: { currentStep: "profile", connections: {} },
    connectionStatus: {},
  });
  api.getSetupLatest.mockResolvedValue({ session: RECOVERY_SESSION });
  api.saveGuidedSetupProgress.mockResolvedValue({});
  api.getOnboardingStatus.mockResolvedValue({
    won: false,
    celebrated: false,
    authorization: null,
  });
});

describe("GuidedSetupWizard PM8 Page-picker handoff", () => {
  it("honors social/accounts inline and never turns Choose a Page into First Win", async () => {
    render(<GuidedSetupWizard onComplete={vi.fn()} />);
    fireEvent.click(await screen.findByText(/Continue where I left off/i));
    expect(await screen.findByTestId("setup-agent")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Choose a Page" }));
    await waitFor(() =>
      expect(setupAgentSpy.mock.calls.at(-1)[0].inlineExitDestination).toEqual({
        section: "social",
        tab: "accounts",
      }),
    );

    expect(screen.queryByTestId("firstwin-step")).not.toBeInTheDocument();
    expect(api.updateOnboarding).not.toHaveBeenCalled();
    expect(api.saveGuidedSetupProgress).not.toHaveBeenCalledWith("firstwin", expect.anything());

    // The genuine SetupAgent completion callback retains its original path.
    fireEvent.click(screen.getByRole("button", { name: "Complete profile setup" }));
    expect(await screen.findByTestId("firstwin-step")).toBeInTheDocument();
    expect(api.saveGuidedSetupProgress).toHaveBeenCalledWith("firstwin", {});
    expect(api.saveGuidedSetupProgress).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ _recovery: expect.anything() }),
    );
  });

  it("heals stale firstwin from authoritative active-session truth and pre-opens the inline destination", async () => {
    const connections = {
      facebook: { skipped: false },
      _recovery: { ...EXISTING_RECOVERY, clobbered: false },
    };
    api.getGuidedSetupState.mockResolvedValue({
      progress: { currentStep: "firstwin", connections },
      connectionStatus: { facebook: "connected" },
    });

    render(<GuidedSetupWizard onComplete={vi.fn()} />);

    expect(await screen.findByTestId("setup-agent")).toBeInTheDocument();
    expect(setupAgentSpy.mock.calls.at(-1)[0]).toMatchObject({
      embedded: true,
      inlineExitDestination: { section: "social", tab: "accounts" },
    });
    expect(screen.queryByTestId("firstwin-step")).not.toBeInTheDocument();
    expect(api.saveGuidedSetupProgress).toHaveBeenCalledWith("profile", {
      ...connections,
      _recovery: {
        clobbered: true,
        at: expect.stringMatching(/Z$/),
        ref: expect.stringMatching(/^pm8b-/),
        note: "historical_connections_state_irrecoverable",
      },
    });
    expect(api.updateOnboarding).not.toHaveBeenCalled();
    expect(RECOVERY_SESSION.stepOutcomes.create_facebook_campaign).toBe(DEFERRED_CAMPAIGN);
  });

  it("keeps an existing recovery marker byte-equivalent on repeated bootstrap healing", async () => {
    const connections = {
      facebook: { skipped: false },
      _recovery: EXISTING_RECOVERY,
    };
    api.getGuidedSetupState.mockResolvedValue({
      progress: { currentStep: "firstwin", connections },
      connectionStatus: { facebook: "connected" },
    });

    render(<GuidedSetupWizard onComplete={vi.fn()} />);

    expect(await screen.findByTestId("setup-agent")).toBeInTheDocument();
    expect(api.saveGuidedSetupProgress).toHaveBeenCalledWith("profile", connections);
    expect(api.saveGuidedSetupProgress.mock.calls.at(-1)[1]._recovery).toBe(EXISTING_RECOVERY);
  });

  it("does not override a genuine First Win projection without an active pending social step", () => {
    expect(
      shouldRecoverSocialPageHandoff("firstwin", {
        ...RECOVERY_SESSION,
        status: "completed",
      }),
    ).toBe(false);
    expect(
      shouldRecoverSocialPageHandoff("firstwin", {
        ...RECOVERY_SESSION,
        completedSteps: [],
      }),
    ).toBe(false);
  });

  it.each([
    ["completed", { ...RECOVERY_SESSION, status: "completed" }],
    ["non-social", { ...RECOVERY_SESSION, completedSteps: [] }],
  ])("does not mark a %s session", async (_label, session) => {
    api.getGuidedSetupState.mockResolvedValue({
      progress: { currentStep: "firstwin", connections: {} },
      connectionStatus: {},
    });
    api.getSetupLatest.mockResolvedValue({ session });

    render(<GuidedSetupWizard onComplete={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Welcome back!" })).toBeInTheDocument();
    expect(api.saveGuidedSetupProgress).not.toHaveBeenCalled();
  });
});