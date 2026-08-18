// 026-C3-PM5 — post-launch honesty corrective (client rendering).
//
// Binds, against the real <SetupAgent> with a mocked api:
//   R10 a provider-permission failure NEVER renders "AI service unavailable"
//       (or any AI-outage wording)
//   R11 provider_permission / provider_manual_review render NO immediate
//       Retry control (Skip remains — an owner-mediated choice)
//   R13 an unknown terminal failure renders the server's neutral copy + the
//       reference id — the client invents no cause
//   R14 a genuinely classified AI-unavailability failure still renders its
//       AI-specific copy (server-classified, so permitted)
//   R16 PROPERTY: the UI never names a cause it has not classified — the
//       rendered message is EXACTLY the server's classified template text,
//       and the heading is selected only by outcome.code.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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

const READY_SESSION = {
  sessionId: "sess-pm5",
  interviewComplete: true,
  consentGranted: true,
  steps: [{ key: "create_facebook_campaign", label: "Creating your first Facebook ad campaign" }],
  completedSteps: [],
};

// The exact server template for a terminal provider-permission failure
// (STEP_FAILURE_TEMPLATES.provider_permission). The client must render this
// text verbatim — it never substitutes its own cause.
const PERMISSION_MESSAGE =
  "Facebook couldn't accept this ad campaign because the connected ad account needs attention on Facebook's side (a permission or account restriction). Everything Echo prepared is saved, and Echo will not retry automatically — resolve the restriction in Meta Business Manager, and this can be picked up from there.";

const MANUAL_REVIEW_MESSAGE =
  "Your first ad campaign didn't finish launching and needs a manual review. Everything from the earlier attempt is saved, and Echo will not retry automatically until it's resolved.";

function failedExecuteError({ code, retryable, message, ref = "ref-pm5-1" }) {
  return Object.assign(new Error(message), {
    status: retryable ? 502 : 400,
    data: {
      error: message,
      failedStep: { key: "create_facebook_campaign", label: "Creating your first Facebook ad campaign" },
      outcome: { code, retryable, ref, at: new Date().toISOString() },
      session: READY_SESSION,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.startSetupSession.mockResolvedValue({ session: READY_SESSION });
  api.pauseSetupSession.mockResolvedValue(undefined);
});

describe("SetupAgent PM5 — provider-permission / manual-review presentation", () => {
  test("R10/R11/R16: provider_permission renders the server's exact copy, the provider-attention heading, the ref — and NO Retry control", async () => {
    api.runSetupAction.mockRejectedValue(
      failedExecuteError({ code: "provider_permission", retryable: false, message: PERMISSION_MESSAGE }),
    );

    render(<SetupAgent onClose={vi.fn()} />);
    const panel = await screen.findByTestId("failed-step-panel");

    // R16: exact server-classified template text, verbatim.
    expect(panel.textContent).toContain(PERMISSION_MESSAGE);
    // Heading selected ONLY by outcome.code.
    expect(screen.getByText("Your ad account needs attention")).toBeInTheDocument();
    // Reference id remains visible for correlation.
    expect(panel.textContent).toContain("Reference: ref-pm5-1");
    // R10: no AI-outage wording anywhere in the panel.
    expect(panel.textContent).not.toMatch(/AI service/i);
    expect(panel.textContent).not.toMatch(/temporarily unavailable/i);
    // R11: no immediate Retry affordance; Skip (owner-mediated) remains.
    expect(screen.queryByTestId("failed-step-retry")).not.toBeInTheDocument();
    expect(screen.getByText("Skip this step")).toBeInTheDocument();
  });

  test("R11: provider_manual_review (dirty prior evidence) also renders without a Retry control and without AI-outage copy", async () => {
    api.runSetupAction.mockRejectedValue(
      failedExecuteError({ code: "provider_manual_review", retryable: false, message: MANUAL_REVIEW_MESSAGE, ref: "ref-pm5-2" }),
    );

    render(<SetupAgent onClose={vi.fn()} />);
    const panel = await screen.findByTestId("failed-step-panel");

    expect(panel.textContent).toContain(MANUAL_REVIEW_MESSAGE);
    expect(screen.getByText("Your ad account needs attention")).toBeInTheDocument();
    expect(panel.textContent).toContain("Reference: ref-pm5-2");
    expect(panel.textContent).not.toMatch(/AI service/i);
    expect(screen.queryByTestId("failed-step-retry")).not.toBeInTheDocument();
  });

  test("R13: an unknown terminal failure renders the server's NEUTRAL copy + reference — the client invents no AI or provider cause", async () => {
    const neutral = "Something went wrong while running this step. Your progress is saved — you can retry.";
    api.runSetupAction.mockRejectedValue(
      failedExecuteError({ code: "internal_error", retryable: true, message: neutral, ref: "ref-pm5-3" }),
    );

    render(<SetupAgent onClose={vi.fn()} />);
    const panel = await screen.findByTestId("failed-step-panel");

    expect(panel.textContent).toContain(neutral);
    expect(panel.textContent).toContain("Reference: ref-pm5-3");
    // Neutral heading — not the provider heading, not the billing heading.
    expect(screen.getByText("This step couldn't finish")).toBeInTheDocument();
    // No invented cause: no AI-outage wording, and no provider-attention
    // heading. (The step LABEL naming Facebook is identity, not a cause.)
    expect(panel.textContent).not.toMatch(/AI service|temporarily unavailable/i);
    expect(screen.queryByText("Your ad account needs attention")).not.toBeInTheDocument();
    // Retryable classes keep their Retry control.
    expect(screen.getByTestId("failed-step-retry")).toBeInTheDocument();
  });

  test("R14: a genuinely classified AI-unavailability failure still renders its AI-specific copy (and keeps Retry)", async () => {
    const aiCopy =
      "The AI service was temporarily unavailable while running this step. Your progress is saved — you can retry now.";
    api.runSetupAction.mockRejectedValue(
      failedExecuteError({ code: "provider_unavailable", retryable: true, message: aiCopy, ref: "ref-pm5-4" }),
    );

    render(<SetupAgent onClose={vi.fn()} />);
    const panel = await screen.findByTestId("failed-step-panel");

    expect(panel.textContent).toContain(aiCopy);
    expect(screen.getByTestId("failed-step-retry")).toBeInTheDocument();
  });

  test("R16 property: the heading never upgrades an unclassified failure — a failed outcome with an unknown code gets the neutral heading", async () => {
    const msg = "A future failure class the client does not know.";
    api.runSetupAction.mockRejectedValue(
      failedExecuteError({ code: "future_unknown_class", retryable: false, message: msg, ref: "ref-pm5-5" }),
    );

    render(<SetupAgent onClose={vi.fn()} />);
    const panel = await screen.findByTestId("failed-step-panel");

    expect(panel.textContent).toContain(msg);
    expect(screen.getByText("This step couldn't finish")).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/AI service/i);
    // Unknown codes are NOT in the no-retry provider set; server said
    // retryable:false but the class is unrecognized — the button renders and
    // the server remains the authority on whether a retry re-executes.
    await waitFor(() => expect(screen.getByTestId("failed-step-retry")).toBeInTheDocument());
  });
});
