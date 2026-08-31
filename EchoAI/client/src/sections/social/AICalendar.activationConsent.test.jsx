// 026-C1 Stage 2 — the AI Content Calendar's two-phase activation.
//
// "Activate" no longer flips anything: it fetches the activation preview
// (the exact artifact), renders it for review, and only "Approve & schedule"
// sends the digest back. A 409 (schedule changed) re-fetches a fresh preview
// instead of dying on an error.
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../api.js", () => ({
  api: {
    getContentCalendar: vi.fn(),
    previewCalendarActivation: vi.fn(),
    activateContentCalendar: vi.fn(),
    pauseContentCalendar: vi.fn(),
    updateCalendarPost: vi.fn(),
  },
}));

import { api } from "../../api.js";
import AICalendar from "./AICalendar.jsx";

const PREVIEW = {
  calendarId: "cal-1",
  digest: "a".repeat(64),
  eligibleCount: 5,
  firstScheduledTime: "2026-08-20T14:00:00.000Z",
  lastScheduledTime: "2026-08-30T18:00:00.000Z",
  destinations: { facebook: "page-42" },
  excludedStaleCount: 1,
  excludedUnboundCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getContentCalendar.mockResolvedValue({
    calendar: {
      calendar_id: "cal-1",
      status: "draft",
      posting_frequency: "daily",
      content_theme: null,
    },
    posts: [],
  });
});

describe("AICalendar two-phase activation", () => {
  test("Activate fetches and renders the preview; nothing activates yet", async () => {
    api.previewCalendarActivation.mockResolvedValue(PREVIEW);

    render(<AICalendar brandId="b1" onReconnect={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Activate" }));

    expect(await screen.findByText("Approve your posting schedule")).toBeInTheDocument();
    expect(api.previewCalendarActivation).toHaveBeenCalledWith("cal-1");
    expect(api.activateContentCalendar).not.toHaveBeenCalled();
    // The count is a nested <span>, so match on the paragraph's textContent.
    expect(
      screen.getByText((_c, el) => el.tagName === "P" && /5 posts will be scheduled/.test(el.textContent)),
    ).toBeInTheDocument();
    expect(screen.getByText(/page-42/)).toBeInTheDocument();
    expect(screen.getByText(/1 post will stay as drafts — their times have already passed/)).toBeInTheDocument();
  });

  test("Approve & schedule sends the digest and reports the truthful outcome", async () => {
    api.previewCalendarActivation.mockResolvedValue(PREVIEW);
    api.activateContentCalendar.mockResolvedValue({
      calendarId: "cal-1",
      status: "active",
      activatedCount: 5,
      excludedStaleCount: 1,
      excludedUnboundCount: 0,
    });

    render(<AICalendar brandId="b1" onReconnect={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Activate" }));
    fireEvent.click(await screen.findByRole("button", { name: /approve & schedule/i }));

    await waitFor(() =>
      expect(api.activateContentCalendar).toHaveBeenCalledWith("cal-1", PREVIEW.digest),
    );
    expect(await screen.findByText(/Calendar activated — 5 posts scheduled\./)).toBeInTheDocument();
    expect(screen.getByText(/1 stayed as drafts \(times already passed\)\./)).toBeInTheDocument();
    // The review card closes after a successful activation.
    expect(screen.queryByText("Approve your posting schedule")).not.toBeInTheDocument();
  });

  test("a 409 on approval re-fetches a FRESH preview with a 'schedule changed' message", async () => {
    const fresh = { ...PREVIEW, digest: "b".repeat(64), eligibleCount: 6 };
    api.previewCalendarActivation
      .mockResolvedValueOnce(PREVIEW)
      .mockResolvedValueOnce(fresh);
    api.activateContentCalendar.mockRejectedValue(
      Object.assign(new Error("The calendar changed after you reviewed it"), { status: 409 }),
    );

    render(<AICalendar brandId="b1" onReconnect={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Activate" }));
    fireEvent.click(await screen.findByRole("button", { name: /approve & schedule/i }));

    // The fresh artifact renders (6 eligible) with the changed message.
    await waitFor(() => expect(api.previewCalendarActivation).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/The schedule changed since you reviewed it/)).toBeInTheDocument();
    expect(
      screen.getByText((_c, el) => el.tagName === "P" && /6 posts will be scheduled/.test(el.textContent)),
    ).toBeInTheDocument();
    // Still reviewable — no activation happened.
    expect(screen.getByRole("button", { name: /approve & schedule/i })).toBeInTheDocument();
  });

  test("Cancel closes the review card without activating", async () => {
    api.previewCalendarActivation.mockResolvedValue(PREVIEW);

    render(<AICalendar brandId="b1" onReconnect={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Activate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Approve your posting schedule")).not.toBeInTheDocument();
    expect(api.activateContentCalendar).not.toHaveBeenCalled();
  });

  test("edits with the shared form only on Save, then refreshes before a separate approval", async () => {
    const editable = {
      ...PREVIEW,
      posts: [{ postId: "post-1", postContent: "Original draft" }],
    };
    const refreshed = {
      ...editable,
      digest: "c".repeat(64),
      posts: [{ postId: "post-1", postContent: "Updated draft" }],
    };
    api.previewCalendarActivation
      .mockResolvedValueOnce(editable)
      .mockResolvedValueOnce(refreshed);
    api.updateCalendarPost.mockResolvedValue({
      post: { post_id: "post-1", post_content: "Updated draft", status: "draft" },
    });

    render(<AICalendar brandId="b1" onReconnect={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Activate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.getByTestId("calendar-post-editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approve & schedule/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "Not saved" } });
    expect(api.updateCalendarPost).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByTestId("calendar-post-editor").querySelector('button[type="button"]'),
    );
    expect(api.updateCalendarPost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "Updated draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.updateCalendarPost).toHaveBeenCalledWith("post-1", "Updated draft", "draft"),
    );
    await screen.findByTestId("activation-review-again");
    expect(api.previewCalendarActivation).toHaveBeenCalledTimes(2);
    expect(api.activateContentCalendar).not.toHaveBeenCalled();
  });
});
