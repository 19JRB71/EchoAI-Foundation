// The "Reconnect account" shortcut for credential-type publish failures is
// covered in the Post Schedule view (ContentCalendar.failedPost.test.jsx), but
// the AI Content Calendar's PostPanel renders its OWN copy of the button and
// hint. This guards that copy: a credential-failed post must offer the
// shortcut (calling onReconnect with the platform and closing the panel),
// while non-credential failures show Reschedule only.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../api.js", () => ({
  api: {
    getContentCalendar: vi.fn(),
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

// The day cell showing a post count ("1" can also be a day number, so match
// the count span by its distinct class).
async function findDayCellWithPosts() {
  const counts = await screen.findAllByText("1", { selector: "span" });
  const count = counts.find((el) => el.className.includes("text-[10px]"));
  expect(count).toBeTruthy();
  return count.closest("button");
}

function mockCalendarWith(post) {
  api.getContentCalendar.mockResolvedValue({
    calendar: {
      calendar_id: "cal-1",
      status: "active",
      posting_frequency: "daily",
      content_theme: null,
    },
    posts: [post],
  });
}

async function openPostPanel(postContent) {
  const dayCell = await findDayCellWithPosts();
  fireEvent.click(dayCell);
  // The day list shows the post; clicking it opens the PostPanel.
  const listItem = (await screen.findByText(postContent)).closest("button");
  fireEvent.click(listItem);
  expect(await screen.findByText("Why this post failed")).toBeInTheDocument();
}

describe("AICalendar PostPanel reconnect shortcut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("credential failure shows Reconnect account, calls onReconnect(platform) and closes the panel", async () => {
    mockCalendarWith({
      post_id: "cp-cred",
      platform: "facebook",
      post_content: "Flash sale!",
      scheduled_time: todayNoonIso(),
      published_time: null,
      status: "failed",
      engagement_metrics: { error: "401 Invalid OAuth access token" },
    });

    const onReconnect = vi.fn();
    render(<AICalendar brandId="b1" onReconnect={onReconnect} />);
    await waitFor(() => expect(api.getContentCalendar).toHaveBeenCalled());

    await openPostPanel("Flash sale!");

    // The failure box explains the fix and the shortcut sits above Reschedule.
    expect(
      screen.getByText(/expired or revoked account login/)
    ).toBeInTheDocument();
    expect(screen.getByText("Reschedule")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Reconnect account"));
    expect(onReconnect).toHaveBeenCalledWith("facebook");
    // The panel closes so the accounts tab is visible after the jump.
    expect(screen.queryByText("Why this post failed")).not.toBeInTheDocument();
    expect(screen.queryByText("Reconnect account")).not.toBeInTheDocument();
  });

  test("non-credential failure shows Reschedule but no Reconnect shortcut", async () => {
    mockCalendarWith({
      post_id: "cp-generic",
      platform: "facebook",
      post_content: "Weekend hours",
      scheduled_time: todayNoonIso(),
      published_time: null,
      status: "failed",
      engagement_metrics: { error: "500 Internal server error" },
    });

    render(<AICalendar brandId="b1" onReconnect={vi.fn()} />);
    await waitFor(() => expect(api.getContentCalendar).toHaveBeenCalled());

    await openPostPanel("Weekend hours");

    expect(screen.getByText("Reschedule")).toBeInTheDocument();
    expect(screen.queryByText("Reconnect account")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/expired or revoked account login/)
    ).not.toBeInTheDocument();
  });
});
