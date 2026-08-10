// Prompt 023 acceptance fix 5 — dedicated client coverage for the interview
// affordances added in Prompt 023: candidate/confirm presentation, arbitrate
// two-candidate rendering, notice display, continue-anyway, and deferred-gap
// honesty. These render the real <SetupAgent> with a mocked `api` and assert
// both the visible UI and the exact structured payloads sent to the server —
// the client must never infer a resolution the owner didn't click.

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

import { api } from "../api.js";
import SetupAgent from "./SetupAgent.jsx";

const INTERVIEW_SESSION = {
  sessionId: "sess-i",
  interviewComplete: false,
  consentGranted: false,
  steps: [{ key: "brand", label: "Set up your brand" }],
  completedSteps: [],
};

function boot(question) {
  api.startSetupSession.mockResolvedValue({ session: INTERVIEW_SESSION, question });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.pauseSetupSession.mockResolvedValue(undefined);
  api.submitSetupAnswer.mockResolvedValue({
    session: INTERVIEW_SESSION,
    question: { message: "Next question?" },
  });
});

describe("confirm affordance (candidate presentation)", () => {
  test("renders the unconfirmed candidate question and sends a structured confirm with revisionId", async () => {
    boot({
      message: "I have your tagline on file as 'Barns built right'. Is that still right?",
      action: "confirm",
      targetField: "tagline",
      reason: "pending_revision",
      candidate: { value: "Barns built right", revisionId: "rev-42" },
    });
    render(<SetupAgent onClose={() => {}} />);
    await screen.findByText(/Is that still right\?/);
    fireEvent.click(screen.getByRole("button", { name: /yes, that.s right/i }));
    await waitFor(() => expect(api.submitSetupAnswer).toHaveBeenCalledTimes(1));
    const [sid, answer, extras] = api.submitSetupAnswer.mock.calls[0];
    expect(sid).toBe("sess-i");
    expect(answer).toBe("Yes, that's correct.");
    expect(extras).toEqual({ resolution: { kind: "confirm", revisionId: "rev-42" } });
  });

  test("'Skip for now' on a confirm sends an explicit defer resolution, never a confirm", async () => {
    boot({
      message: "Does this phone number look right?",
      action: "confirm",
      targetField: "phone",
      reason: "legacy_unreviewed",
      candidate: { value: "555-000-1111" },
    });
    render(<SetupAgent onClose={() => {}} />);
    await screen.findByText(/phone number/);
    const skips = screen.getAllByRole("button", { name: /skip for now/i });
    // The affordance skip (inside the question card), not the header skip.
    fireEvent.click(skips[skips.length - 1]);
    await waitFor(() => expect(api.submitSetupAnswer).toHaveBeenCalledTimes(1));
    const [, answer, extras] = api.submitSetupAnswer.mock.calls[0];
    expect(answer).toBe("Skip this one for now.");
    expect(extras).toEqual({ resolution: { kind: "defer" } });
  });
});

describe("arbitrate affordance (two-candidate rendering)", () => {
  test("renders BOTH candidate values as choices and sends the chosen value with kind:'choose'", async () => {
    boot({
      message: "I have two different service areas on file — which is right?",
      action: "arbitrate",
      targetField: "service_area",
      reason: "draft_conflict",
      candidates: [
        { value: "Kalona and Washington County", source: "pending" },
        { value: "All of eastern Iowa", source: "draft" },
      ],
    });
    render(<SetupAgent onClose={() => {}} />);
    await screen.findByText(/which is right\?/);
    // Both sources' values are visible to the owner.
    const a = screen.getByRole("button", { name: "Kalona and Washington County" });
    const b = screen.getByRole("button", { name: "All of eastern Iowa" });
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    fireEvent.click(b);
    await waitFor(() => expect(api.submitSetupAnswer).toHaveBeenCalledTimes(1));
    const [, answer, extras] = api.submitSetupAnswer.mock.calls[0];
    expect(answer).toBe("All of eastern Iowa");
    expect(extras).toEqual({ resolution: { kind: "choose" } });
  });

  test("blank/null candidates are filtered out, never rendered as empty buttons", async () => {
    boot({
      message: "Which description fits best?",
      action: "arbitrate",
      targetField: "description",
      reason: "draft_conflict",
      candidates: [{ value: "Real description" }, { value: "   " }, { value: null }],
    });
    render(<SetupAgent onClose={() => {}} />);
    await screen.findByText(/fits best\?/);
    expect(screen.getByRole("button", { name: "Real description" })).toBeTruthy();
    // Exactly one candidate button + skip + continue-anyway + header controls;
    // no empty-labelled candidate buttons.
    const empties = screen
      .getAllByRole("button")
      .filter((btn) => btn.textContent.trim() === "" && btn.type === "button");
    expect(empties.length).toBe(0);
  });
});

describe("notice display (honest relay, no hidden state)", () => {
  test("a draft_differs notice phrased by the AI is shown verbatim to the owner", async () => {
    boot({
      message:
        "Heads up — research found a slightly different description, but your approved version stays in charge. Now, what's your phone number?",
      action: "ask",
      targetField: "phone",
      reason: "missing",
      notice: "draft_differs",
    });
    render(<SetupAgent onClose={() => {}} />);
    // The notice text reaches the owner inside the question message.
    await screen.findByText(/your approved version stays in charge/);
    // An ask with a notice still renders the plain answer box (no candidate buttons).
    expect(screen.queryByRole("button", { name: /yes, that.s right/i })).toBeNull();
  });

  test("a pending_review_exists notice never renders save-claiming UI for the pending value", async () => {
    boot({
      message:
        "You have a suggested tagline waiting for review in Brand Knowledge — nothing is saved until you approve it. Meanwhile, what's your email?",
      action: "ask",
      targetField: "email",
      reason: "missing",
      notice: "pending_review_exists",
    });
    render(<SetupAgent onClose={() => {}} />);
    await screen.findByText(/nothing is saved until you approve it/);
    expect(screen.queryByRole("button", { name: /yes, that.s right/i })).toBeNull();
  });
});

describe("continue-anyway flow and deferred-gap honesty", () => {
  test("the continue link sends continueAnyway:true and the UI names skipped items honestly", async () => {
    boot({
      message: "What's your business address?",
      action: "ask",
      targetField: "address",
      reason: "missing",
    });
    render(<SetupAgent onClose={() => {}} />);
    await screen.findByText(/business address/);
    // The honesty caption is visible next to the escape hatch.
    expect(screen.getByText(/stays honestly marked as unanswered/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /continue setup with what we have/i }));
    await waitFor(() => expect(api.submitSetupAnswer).toHaveBeenCalledTimes(1));
    const [, answer, extras] = api.submitSetupAnswer.mock.calls[0];
    expect(answer).toBe("Let's continue with setup anyway.");
    expect(extras).toEqual({ continueAnyway: true });
  });

  test("a plain typed answer still submits with NO extras (exact pre-023 call shape)", async () => {
    boot({
      message: "What does your business do?",
      action: "ask",
      targetField: "description",
      reason: "missing",
    });
    render(<SetupAgent onClose={() => {}} />);
    await screen.findByText(/What does your business do\?/);
    fireEvent.change(screen.getByPlaceholderText(/type your answer/i), {
      target: { value: "We build pole barns." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await waitFor(() => expect(api.submitSetupAnswer).toHaveBeenCalledTimes(1));
    // Exactly two arguments — a spurious third arg regressed 16 tests in 023.
    expect(api.submitSetupAnswer.mock.calls[0].length).toBe(2);
    expect(api.submitSetupAnswer.mock.calls[0][1]).toBe("We build pole barns.");
  });
});
