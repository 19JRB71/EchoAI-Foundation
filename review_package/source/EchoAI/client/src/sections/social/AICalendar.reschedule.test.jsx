// The AI Content Calendar's PostPanel renders the shared ReschedulePost
// component for failed posts, but ReschedulePost's own tests exercise it
// standalone and via the Post Schedule view only. This guards the FULL
// AI-calendar path — open a failed post, click Reschedule, pick a time,
// confirm — asserting AICalendar's onRescheduled/onChanged wiring: the panel
// must swap to the updated post and the calendar must reload. The
// interrupted-publish checkbox gating is asserted through this same path.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("../../api.js", () => ({
  api: {
    getContentCalendar: vi.fn(),
    rescheduleSocialPost: vi.fn(),
  },
}));

import { api } from "../../api.js";
import AICalendar from "./AICalendar.jsx";

// Deterministic date within the currently displayed month (today, noon local).
function todayNoonIso() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

// Local YYYY-MM-DDTHH:MM value ~2h in the future for the datetime-local input.
function futureLocalValue() {
  const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

// The day cell showing a post count ("1" can also be a day number, so match
// the count span by its distinct class).
async function findDayCellWithPosts() {
  const counts = await screen.findAllByText("1", { selector: "span" });
  const count = counts.find((el) => el.className.includes("text-[10px]"));
  expect(count).toBeTruthy();
  return count.closest("button");
}

function calendarResponse(post) {
  return {
    calendar: {
      calendar_id: "cal-1",
      status: "active",
      posting_frequency: "daily",
      content_theme: null,
    },
    posts: [post],
  };
}

async function openPostPanel(postContent) {
  const dayCell = await findDayCellWithPosts();
  fireEvent.click(dayCell);
  const listItem = (await screen.findByText(postContent)).closest("button");
  fireEvent.click(listItem);
  expect(await screen.findByText("Why this post failed")).toBeInTheDocument();
}

describe("AICalendar PostPanel reschedule flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("full flow: reschedule a failed post, panel shows the updated post and the calendar reloads", async () => {
    const failedPost = {
      post_id: "cp-fail",
      platform: "facebook",
      post_content: "Flash sale!",
      scheduled_time: todayNoonIso(),
      published_time: null,
      status: "failed",
      engagement_metrics: { error: "500 Internal server error" },
    };
    const rescheduledPost = {
      ...failedPost,
      status: "scheduled",
      engagement_metrics: null,
    };

    api.getContentCalendar
      .mockResolvedValueOnce(calendarResponse(failedPost))
      .mockResolvedValue(calendarResponse(rescheduledPost));
    api.rescheduleSocialPost.mockResolvedValue({ post: rescheduledPost });

    render(<AICalendar brandId="b1" onReconnect={vi.fn()} />);
    await waitFor(() => expect(api.getContentCalendar).toHaveBeenCalledTimes(1));

    await openPostPanel("Flash sale!");

    // Open the reschedule form and pick a new future time.
    fireEvent.click(screen.getByText("Reschedule"));
    const input = document.querySelector('input[type="datetime-local"]');
    expect(input).toBeTruthy();
    const newTime = futureLocalValue();
    fireEvent.change(input, { target: { value: newTime } });
    fireEvent.click(screen.getByText("Confirm reschedule"));

    // The API is called with the post id and the ISO version of the picked time.
    await waitFor(() => expect(api.rescheduleSocialPost).toHaveBeenCalledTimes(1));
    const [postId, iso] = api.rescheduleSocialPost.mock.calls[0];
    expect(postId).toBe("cp-fail");
    expect(iso).toBe(new Date(newTime).toISOString());

    // AICalendar's onChanged wiring reloads the calendar…
    await waitFor(() =>
      expect(api.getContentCalendar).toHaveBeenCalledTimes(2)
    );

    // …and setActivePost swaps the panel to the updated post: the failure box
    // and reschedule button are gone, the panel badge now reads "scheduled".
    await waitFor(() =>
      expect(screen.queryByText("Why this post failed")).not.toBeInTheDocument()
    );
    expect(screen.queryByText("Reschedule")).not.toBeInTheDocument();
    const panel = screen
      .getByText("Edit before it goes live")
      .closest("div.max-w-md");
    expect(panel).toBeTruthy();
    expect(within(panel).getByText("scheduled")).toBeInTheDocument();
  });

  test("interrupted publish: Confirm stays disabled until the checkbox is ticked, then the flow completes", async () => {
    const interruptedPost = {
      post_id: "cp-int",
      platform: "facebook",
      post_content: "Weekend hours",
      scheduled_time: todayNoonIso(),
      published_time: null,
      status: "failed",
      engagement_metrics: {
        error:
          "Publishing was interrupted by a restart — this post may or may not have gone out.",
      },
    };
    const rescheduledPost = {
      ...interruptedPost,
      status: "scheduled",
      engagement_metrics: null,
    };

    api.getContentCalendar
      .mockResolvedValueOnce(calendarResponse(interruptedPost))
      .mockResolvedValue(calendarResponse(rescheduledPost));
    api.rescheduleSocialPost.mockResolvedValue({ post: rescheduledPost });

    render(<AICalendar brandId="b1" onReconnect={vi.fn()} />);
    await waitFor(() => expect(api.getContentCalendar).toHaveBeenCalledTimes(1));

    await openPostPanel("Weekend hours");

    fireEvent.click(screen.getByText("Reschedule"));

    // Double-post warning is shown and Confirm is gated on the checkbox.
    expect(
      screen.getByText("Careful — this post may already be live")
    ).toBeInTheDocument();
    const confirmBtn = screen.getByText("Confirm reschedule");
    expect(confirmBtn).toBeDisabled();

    fireEvent.click(confirmBtn);
    expect(api.rescheduleSocialPost).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByLabelText(/I checked the platform — this post did not go out/)
    );
    expect(confirmBtn).not.toBeDisabled();

    const input = document.querySelector('input[type="datetime-local"]');
    fireEvent.change(input, { target: { value: futureLocalValue() } });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(api.rescheduleSocialPost).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(api.getContentCalendar).toHaveBeenCalledTimes(2)
    );
    await waitFor(() =>
      expect(screen.queryByText("Why this post failed")).not.toBeInTheDocument()
    );
  });
});
