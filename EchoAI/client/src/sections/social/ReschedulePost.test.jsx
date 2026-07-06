// One-click recovery for a failed post: the Reschedule form must flip a failed
// post back to scheduled via the API with a future time, and an
// interrupted-publish failure ("may or may not have gone out") must require an
// explicit double-post confirmation before the button unlocks.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../api.js", () => ({
  api: {
    rescheduleSocialPost: vi.fn(),
  },
}));

import { api } from "../../api.js";
import ReschedulePost from "./ReschedulePost.jsx";
import { isInterruptedPublish } from "./postFailure.js";

const INTERRUPTED_MSG =
  "Publishing was interrupted by a server restart. The post may or may not have gone out — check the platform and reschedule if needed.";

function failedPost(error) {
  return {
    post_id: "p-fail",
    platform: "facebook",
    post_content: "Big summer sale!",
    status: "failed",
    engagement_metrics: error ? { error } : null,
  };
}

describe("isInterruptedPublish", () => {
  test("detects the interrupted-publish marker; plain failures stay false", () => {
    expect(isInterruptedPublish(failedPost(INTERRUPTED_MSG))).toBe(true);
    expect(isInterruptedPublish(failedPost("Facebook token expired"))).toBe(false);
    expect(isInterruptedPublish(failedPost(null))).toBe(false);
  });
});

describe("ReschedulePost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("reschedules a plain failed post and reports the updated post", async () => {
    const updated = { post_id: "p-fail", status: "scheduled" };
    api.rescheduleSocialPost.mockResolvedValue({ post: updated });
    const onRescheduled = vi.fn();

    render(
      <ReschedulePost
        post={failedPost("Facebook token expired")}
        onRescheduled={onRescheduled}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    // No interrupted warning for a plain failure.
    expect(screen.queryByText(/may already be live/i)).not.toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: /confirm reschedule/i });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(onRescheduled).toHaveBeenCalledWith(updated));
    const [postId, iso] = api.rescheduleSocialPost.mock.calls[0];
    expect(postId).toBe("p-fail");
    expect(new Date(iso).getTime()).toBeGreaterThan(Date.now());
  });

  test("interrupted publish keeps the button locked until the double-post checkbox is ticked", async () => {
    api.rescheduleSocialPost.mockResolvedValue({ post: {} });

    render(
      <ReschedulePost post={failedPost(INTERRUPTED_MSG)} onRescheduled={vi.fn()} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    expect(screen.getByText(/may already be live/i)).toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: /confirm reschedule/i });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() => expect(api.rescheduleSocialPost).toHaveBeenCalled());
  });

  test("a past time is rejected client-side without calling the API", async () => {
    render(
      <ReschedulePost post={failedPost("token expired")} onRescheduled={vi.fn()} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    const input = document.querySelector('input[type="datetime-local"]');
    fireEvent.change(input, { target: { value: "2020-01-01T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm reschedule/i }));

    expect(await screen.findByText(/must be in the future/i)).toBeInTheDocument();
    expect(api.rescheduleSocialPost).not.toHaveBeenCalled();
  });
});
