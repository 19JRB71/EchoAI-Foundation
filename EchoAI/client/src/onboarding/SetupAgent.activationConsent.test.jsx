// 026-C1 Stage 2 — the Setup Agent's posting-schedule approval panel.
//
// Server-side, social_schedule pauses with `needs_connection` type
// `activate_calendar` and the exact preview artifact. These tests pin the
// client half of the consent loop:
//   - the panel shows the truthful artifact (count, destinations, exclusions)
//   - "Approve & schedule" sends the digest-bound confirm on the NEXT run call
//   - a changed schedule (changed:true) re-renders without the "repeated" notice,
//     while an identical re-pause shows it
//   - reload seeding is outcome-aware: skipped steps resume as "Skipped."
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

const STEPS = [
  { key: "content_calendar", label: "Building your content calendar" },
  { key: "social_schedule", label: "Scheduling your social posts" },
];

const READY_SESSION = {
  sessionId: "sess-1",
  interviewComplete: true,
  consentGranted: true,
  steps: STEPS,
  completedSteps: [],
};

const PREVIEW = {
  digest: "d".repeat(64),
  eligibleCount: 3,
  firstScheduledTime: "2026-08-20T14:00:00.000Z",
  lastScheduledTime: "2026-08-28T18:30:00.000Z",
  destinations: { facebook: "page-777" },
  excludedStaleCount: 2,
  excludedUnboundCount: 1,
};

function pausedResponse(overrides = {}) {
  return {
    step: { key: "social_schedule", label: "Scheduling your social posts" },
    status: "needs_connection",
    detail: "Your posting schedule is ready — approve it to start auto-posting.",
    connect: { type: "activate_calendar", calendarId: "cal-1", preview: PREVIEW, ...overrides },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.startSetupSession.mockResolvedValue({ session: READY_SESSION });
  api.pauseSetupSession.mockResolvedValue(undefined);
});

describe("SetupAgent activation consent panel", () => {
  test("shows the truthful artifact: count, destination, and both exclusion reasons", async () => {
    api.runSetupAction.mockResolvedValueOnce(pausedResponse());

    render(<SetupAgent onClose={vi.fn()} />);

    expect(await screen.findByText("Approve your posting schedule")).toBeInTheDocument();
    // The count is a nested <span>, so match on the paragraph's textContent.
    expect(
      screen.getByText((_c, el) => el.tagName === "P" && /3 posts will be scheduled/.test(el.textContent)),
    ).toBeInTheDocument();
    expect(screen.getByText(/page-777/)).toBeInTheDocument();
    expect(screen.getByText(/2 posts will stay as drafts — their times have already passed/)).toBeInTheDocument();
    expect(
      screen.getByText(/1 post will stay as drafts — their platform has no connected destination/),
    ).toBeInTheDocument();
    // First pause: no "repeated" notice.
    expect(screen.queryByText(/same approval as before/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approve & schedule/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skip — keep everything as drafts/i })).toBeInTheDocument();
  });

  test("Approve & schedule sends the digest-bound confirm exactly once, then setup completes", async () => {
    api.runSetupAction
      .mockResolvedValueOnce(pausedResponse())
      .mockResolvedValueOnce({
        step: { key: "social_schedule", label: "Scheduling your social posts" },
        status: "done",
        detail: "Scheduled 3 posts. 2 stayed as drafts (their times had passed).",
      })
      .mockResolvedValueOnce({ allComplete: true, session: { ...READY_SESSION, status: "completed" } });

    render(<SetupAgent onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /approve & schedule/i }));

    await waitFor(() =>
      expect(api.runSetupAction).toHaveBeenCalledWith("sess-1", false, {
        step: "social_schedule",
        digest: PREVIEW.digest,
      }),
    );
    // The confirm is one-shot: the NEXT loop call must not resend it.
    await waitFor(() => expect(api.runSetupAction).toHaveBeenCalledTimes(3));
    expect(api.runSetupAction.mock.calls[2][2] ?? null).toBeNull();
    // Truthful step detail rendered.
    expect(await screen.findByText(/Scheduled 3 posts\./)).toBeInTheDocument();
  });

  test("a changed schedule re-pauses with the fresh artifact and NO repeated notice; an identical re-pause shows it", async () => {
    const freshPreview = { ...PREVIEW, digest: "e".repeat(64), eligibleCount: 4 };
    api.runSetupAction
      .mockResolvedValueOnce(pausedResponse())
      // Approval raced a calendar change: server re-pauses with changed:true.
      .mockResolvedValueOnce(pausedResponse({ preview: freshPreview, changed: true }))
      // A later re-run pauses again with the SAME artifact (no change).
      .mockResolvedValueOnce(pausedResponse({ preview: freshPreview }));

    render(<SetupAgent onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /approve & schedule/i }));

    // changed:true → fresh artifact, no "repeated" notice.
    await waitFor(() => expect(screen.getByText(/4/)).toBeInTheDocument());
    expect(screen.queryByText(/same approval as before/)).not.toBeInTheDocument();

    // Approving again returns the same pause → NOW the repeated notice shows.
    fireEvent.click(screen.getByRole("button", { name: /approve & schedule/i }));
    expect(await screen.findByText(/same approval as before — nothing has been scheduled yet/)).toBeInTheDocument();
  });

  test("reload seeding is outcome-aware: a skipped step resumes as Skipped., a completed one as Done.", async () => {
    api.startSetupSession.mockResolvedValue({
      session: {
        ...READY_SESSION,
        completedSteps: ["content_calendar", "social_schedule"],
        stepOutcomes: { content_calendar: "completed", social_schedule: "skipped" },
        status: "completed",
      },
    });
    api.runSetupAction.mockResolvedValue({ allComplete: true });

    render(<SetupAgent onClose={vi.fn()} />);

    expect(await screen.findByText("Done.")).toBeInTheDocument();
    expect(screen.getByText("Skipped.")).toBeInTheDocument();
  });
});
