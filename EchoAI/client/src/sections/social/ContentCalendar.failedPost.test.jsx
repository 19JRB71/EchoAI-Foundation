// A failed social post stores WHY it failed in engagement_metrics.error
// (platform error, or "publishing interrupted by a server restart"). The
// Content Calendar must surface that reason — inline in the day list and in
// the post detail modal — so the owner can tell a transient hiccup from a
// disconnected account and knows whether to reschedule. Posts without an
// error keep their current rendering unchanged.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../api.js", () => ({
  api: {
    getSocialCalendar: vi.fn(),
  },
}));

import { api } from "../../api.js";
import ContentCalendar from "./ContentCalendar.jsx";
import { postFailureReason } from "./postFailure.js";

const FAIL_MSG =
  "Publishing was interrupted by a server restart. The post may or may not have gone out — check the platform and reschedule if needed.";

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

describe("postFailureReason", () => {
  test("returns the stored error for a failed post (object metrics)", () => {
    expect(
      postFailureReason({ status: "failed", engagement_metrics: { error: FAIL_MSG } })
    ).toBe(FAIL_MSG);
  });

  test("parses string metrics defensively", () => {
    expect(
      postFailureReason({
        status: "failed",
        engagement_metrics: JSON.stringify({ error: FAIL_MSG }),
      })
    ).toBe(FAIL_MSG);
  });

  test("returns null when there is no error or the post is not failed", () => {
    expect(postFailureReason({ status: "failed", engagement_metrics: null })).toBeNull();
    expect(postFailureReason({ status: "failed", engagement_metrics: {} })).toBeNull();
    expect(
      postFailureReason({ status: "published", engagement_metrics: { error: FAIL_MSG } })
    ).toBeNull();
    expect(
      postFailureReason({ status: "failed", engagement_metrics: "not-json" })
    ).toBeNull();
  });
});

describe("ContentCalendar failed post reason", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("shows the failure reason inline and in the detail modal", async () => {
    api.getSocialCalendar.mockResolvedValue({
      posts: [
        {
          post_id: "p-fail",
          platform: "facebook",
          post_content: "Big summer sale!",
          scheduled_time: todayNoonIso(),
          published_time: null,
          status: "failed",
          engagement_metrics: { error: FAIL_MSG },
        },
      ],
    });

    render(<ContentCalendar brandId="b1" />);
    await waitFor(() => expect(api.getSocialCalendar).toHaveBeenCalled());

    // Open today's day cell (it shows the post count "1").
    const dayCell = await findDayCellWithPosts();
    fireEvent.click(dayCell);

    // Inline reason in the day list (also exposed as a hover tooltip).
    const listItem = (await screen.findByText("Big summer sale!")).closest("button");
    expect(listItem.getAttribute("title")).toBe(FAIL_MSG);
    expect(screen.getAllByText(FAIL_MSG).length).toBeGreaterThan(0);

    // Clicking the post opens the modal with the labeled explanation.
    fireEvent.click(listItem);
    expect(await screen.findByText("Why this post failed")).toBeInTheDocument();
    expect(screen.getAllByText(FAIL_MSG).length).toBeGreaterThan(0);
  });

  test("posts without an error render unchanged (no failure block)", async () => {
    api.getSocialCalendar.mockResolvedValue({
      posts: [
        {
          post_id: "p-ok",
          platform: "instagram",
          post_content: "Behind the scenes",
          scheduled_time: todayNoonIso(),
          published_time: todayNoonIso(),
          status: "published",
          engagement_metrics: { likes: 5, shares: 1, reach: 100 },
        },
      ],
    });

    render(<ContentCalendar brandId="b1" />);
    await waitFor(() => expect(api.getSocialCalendar).toHaveBeenCalled());

    const dayCell = await findDayCellWithPosts();
    fireEvent.click(dayCell);

    const listItem = (await screen.findByText("Behind the scenes")).closest("button");
    expect(listItem.getAttribute("title")).toBeNull();

    fireEvent.click(listItem);
    expect(screen.queryByText("Why this post failed")).not.toBeInTheDocument();
    // Metrics summary still renders for published posts.
    expect(await screen.findByText(/Likes 5/)).toBeInTheDocument();
  });
});
