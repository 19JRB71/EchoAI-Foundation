// When a scheduled post hits a transient platform error, the server pushes it
// back to 'scheduled' ~5 minutes out and bumps publish_attempts. The calendar
// must show a subtle "retrying" badge on such posts so the quietly-moved time
// reads as an automatic retry, not a glitch. Published/failed posts and
// first-attempt scheduled posts render unchanged.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../api.js", () => ({
  api: {
    getSocialCalendar: vi.fn(),
  },
}));

import { api } from "../../api.js";
import ContentCalendar from "./ContentCalendar.jsx";
import { isRetryingPost } from "./postFailure.js";

const BADGE_TEXT = "retrying after a platform hiccup";

function todayNoonIso() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

async function findDayCellWithPosts() {
  const counts = await screen.findAllByText("1", { selector: "span" });
  const count = counts.find((el) => el.className.includes("text-[10px]"));
  expect(count).toBeTruthy();
  return count.closest("button");
}

describe("isRetryingPost", () => {
  test("true only for scheduled posts with attempts > 0", () => {
    expect(isRetryingPost({ status: "scheduled", publish_attempts: 1 })).toBe(true);
    expect(isRetryingPost({ status: "scheduled", publish_attempts: 2 })).toBe(true);
    expect(isRetryingPost({ status: "scheduled", publish_attempts: "1" })).toBe(true);
  });

  test("false for first-attempt scheduled, published, failed, and missing data", () => {
    expect(isRetryingPost({ status: "scheduled", publish_attempts: 0 })).toBe(false);
    expect(isRetryingPost({ status: "scheduled" })).toBe(false);
    expect(isRetryingPost({ status: "published", publish_attempts: 1 })).toBe(false);
    expect(isRetryingPost({ status: "failed", publish_attempts: 3 })).toBe(false);
    expect(isRetryingPost(null)).toBe(false);
  });
});

describe("ContentCalendar retry badge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("shows the retry badge inline and in the detail modal for a retrying post", async () => {
    api.getSocialCalendar.mockResolvedValue({
      posts: [
        {
          post_id: "p-retry",
          platform: "facebook",
          post_content: "Flash sale tomorrow!",
          scheduled_time: todayNoonIso(),
          published_time: null,
          status: "scheduled",
          publish_attempts: 1,
          engagement_metrics: null,
        },
      ],
    });

    render(<ContentCalendar brandId="b1" />);
    await waitFor(() => expect(api.getSocialCalendar).toHaveBeenCalled());

    const dayCell = await findDayCellWithPosts();
    fireEvent.click(dayCell);

    // Inline badge in the day list.
    const listItem = (await screen.findByText("Flash sale tomorrow!")).closest("button");
    expect(listItem.textContent).toContain(BADGE_TEXT);

    // Also visible in the detail modal.
    fireEvent.click(listItem);
    expect(screen.getAllByText(BADGE_TEXT).length).toBeGreaterThan(1);
  });

  test("no badge on first-attempt scheduled or published posts", async () => {
    api.getSocialCalendar.mockResolvedValue({
      posts: [
        {
          post_id: "p-fresh",
          platform: "instagram",
          post_content: "Behind the scenes",
          scheduled_time: todayNoonIso(),
          published_time: null,
          status: "scheduled",
          publish_attempts: 0,
          engagement_metrics: null,
        },
      ],
    });

    render(<ContentCalendar brandId="b1" />);
    await waitFor(() => expect(api.getSocialCalendar).toHaveBeenCalled());

    const dayCell = await findDayCellWithPosts();
    fireEvent.click(dayCell);

    await screen.findByText("Behind the scenes");
    expect(screen.queryByText(BADGE_TEXT)).not.toBeInTheDocument();
  });
});
