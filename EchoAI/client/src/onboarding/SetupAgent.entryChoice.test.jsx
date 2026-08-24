// Prompt 035 Stage 2 — Section H client regression: second-business entry
// choice. When a real brand already exists AND there is no open session to
// resume, SetupAgent shows an explicit choice before starting anything:
// continue the existing business, or set up a different one (which starts a
// fresh session with intent "new_business"). An open session, no brands, or
// a probe failure all skip the choice — setup is never blocked on it.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import SetupAgent from "./SetupAgent.jsx";
import { api } from "../api.js";

vi.mock("../api.js", () => ({
  api: {
    startSetupSession: vi.fn(),
    probeSetupSession: vi.fn(),
    getBrands: vi.fn(),
    echoVoiceGetSettings: vi.fn().mockResolvedValue(null),
    pauseSetupSession: vi.fn().mockResolvedValue({}),
    pauseSetupSessionBeacon: vi.fn(),
    recordOnboardingTiming: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("./useVoiceInput.js", () => ({
  useVoiceInput: () => ({
    supported: false,
    method: null,
    listening: false,
    transcribing: false,
    error: null,
    start: () => {},
    stop: () => {},
  }),
  detectIsMobile: () => false,
}));

const BRAND = { brand_id: "b-1", brand_name: "Joe's Plumbing", is_demo: false };

const INTERVIEW_SESSION = {
  sessionId: "s-1",
  interviewComplete: false,
  consentGranted: false,
  steps: [],
  completedSteps: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("echoai_calibration_offered", "1");
  api.echoVoiceGetSettings.mockResolvedValue(null);
  api.startSetupSession.mockResolvedValue({
    session: INTERVIEW_SESSION,
    question: { message: "What are you setting up?" },
  });
});

describe("SetupAgent entry choice (P035 Section H)", () => {
  test("R22: embedded onboarding keeps continuation but suppresses the different-business option", async () => {
    api.getBrands.mockResolvedValue([BRAND]);
    api.probeSetupSession.mockResolvedValue({ openSession: false });
    render(<SetupAgent embedded onClose={() => {}} />);
    expect(await screen.findByTestId("entry-choice-continue")).toBeInTheDocument();
    expect(screen.queryByTestId("entry-choice-new")).toBeNull();
    expect(api.startSetupSession).not.toHaveBeenCalled();
  });

  test("brand exists + no open session → the choice renders and 'different business' starts with intent new_business", async () => {
    api.getBrands.mockResolvedValue([BRAND]);
    api.probeSetupSession.mockResolvedValue({ openSession: false });
    render(<SetupAgent onClose={() => {}} />);
    const choice = await screen.findByTestId("entry-choice");
    expect(choice.textContent).toMatch(/Joe's Plumbing/);
    expect(api.startSetupSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("entry-choice-new"));
    await waitFor(() =>
      expect(api.startSetupSession).toHaveBeenCalledWith({ intent: "new_business" }),
    );
  });

  test("'continue' resumes the default path (no intent)", async () => {
    api.getBrands.mockResolvedValue([BRAND]);
    api.probeSetupSession.mockResolvedValue({ openSession: false });
    render(<SetupAgent onClose={() => {}} />);
    fireEvent.click(await screen.findByTestId("entry-choice-continue"));
    await waitFor(() => expect(api.startSetupSession).toHaveBeenCalledWith(undefined));
  });

  test("an open session skips the choice entirely (resume is never interrupted)", async () => {
    api.getBrands.mockResolvedValue([BRAND]);
    api.probeSetupSession.mockResolvedValue({ openSession: true });
    render(<SetupAgent onClose={() => {}} />);
    await waitFor(() => expect(api.startSetupSession).toHaveBeenCalledWith(undefined));
    expect(screen.queryByTestId("entry-choice")).toBeNull();
  });

  test("no brands → plain start, no choice", async () => {
    api.getBrands.mockResolvedValue([]);
    api.probeSetupSession.mockResolvedValue({ openSession: false });
    render(<SetupAgent onClose={() => {}} />);
    await waitFor(() => expect(api.startSetupSession).toHaveBeenCalled());
    expect(screen.queryByTestId("entry-choice")).toBeNull();
  });

  test("demo brands never trigger the choice", async () => {
    api.getBrands.mockResolvedValue([{ ...BRAND, is_demo: true }]);
    api.probeSetupSession.mockResolvedValue({ openSession: false });
    render(<SetupAgent onClose={() => {}} />);
    await waitFor(() => expect(api.startSetupSession).toHaveBeenCalled());
    expect(screen.queryByTestId("entry-choice")).toBeNull();
  });

  test("a probe failure degrades to a plain start (never blocks setup)", async () => {
    api.getBrands.mockRejectedValue(new Error("boom"));
    api.probeSetupSession.mockRejectedValue(new Error("boom"));
    render(<SetupAgent onClose={() => {}} />);
    await waitFor(() => expect(api.startSetupSession).toHaveBeenCalled());
    expect(screen.queryByTestId("entry-choice")).toBeNull();
  });
});
