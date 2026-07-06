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
import { postFailureReason, isCredentialFailure } from "./postFailure.js";

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

describe("isCredentialFailure", () => {
  const failed = (error) => ({ status: "failed", engagement_metrics: { error } });

  test("recognizes the credential/auth failure messages the publish path stores", () => {
    expect(isCredentialFailure(failed("400 Error validating access token: Session has expired"))).toBe(true);
    expect(isCredentialFailure(failed("401 Invalid OAuth access token"))).toBe(true);
    expect(isCredentialFailure(failed("The access token expired"))).toBe(true);
    expect(isCredentialFailure(failed("Missing credentials for facebook"))).toBe(true);
    expect(isCredentialFailure(failed("Missing required linkedin credential field(s): accessToken"))).toBe(true);
    expect(isCredentialFailure(failed("No connected twitter account for this brand"))).toBe(true);
    expect(isCredentialFailure(failed("403 Unauthorized"))).toBe(true);
    expect(isCredentialFailure(failed("Token has been revoked"))).toBe(true);
  });

  test("ignores non-credential failures", () => {
    expect(isCredentialFailure(failed("Network error contacting platform: fetch failed"))).toBe(false);
    expect(
      isCredentialFailure(failed("Platform did not return a post id; treating publish as failed"))
    ).toBe(false);
    expect(isCredentialFailure(failed("500 Internal server error"))).toBe(false);
    expect(isCredentialFailure(failed(FAIL_MSG))).toBe(false); // interrupted publish
    expect(isCredentialFailure({ status: "failed", engagement_metrics: null })).toBe(false);
    expect(isCredentialFailure({ status: "published", engagement_metrics: { error: "401" } })).toBe(false);
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

  test("credential failure shows a Reconnect account shortcut that jumps to the connect flow", async () => {
    api.getSocialCalendar.mockResolvedValue({
      posts: [
        {
          post_id: "p-cred",
          platform: "facebook",
          post_content: "Flash sale!",
          scheduled_time: todayNoonIso(),
          published_time: null,
          status: "failed",
          engagement_metrics: { error: "401 Invalid OAuth access token" },
        },
      ],
    });

    const onReconnect = vi.fn();
    render(<ContentCalendar brandId="b1" onReconnect={onReconnect} />);
    await waitFor(() => expect(api.getSocialCalendar).toHaveBeenCalled());

    const dayCell = await findDayCellWithPosts();
    fireEvent.click(dayCell);
    const listItem = (await screen.findByText("Flash sale!")).closest("button");
    fireEvent.click(listItem);

    // The failure box explains the fix and the shortcut sits next to Reschedule.
    expect(await screen.findByText(/expired or revoked account login/)).toBeInTheDocument();
    expect(screen.getByText("Reschedule")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Reconnect account"));
    expect(onReconnect).toHaveBeenCalledWith("facebook");
    // The modal closes so the accounts tab is visible after the jump.
    expect(screen.queryByText("Why this post failed")).not.toBeInTheDocument();
  });

  test("non-credential failure shows Reschedule but no Reconnect shortcut", async () => {
    api.getSocialCalendar.mockResolvedValue({
      posts: [
        {
          post_id: "p-generic",
          platform: "facebook",
          post_content: "Weekend hours",
          scheduled_time: todayNoonIso(),
          published_time: null,
          status: "failed",
          engagement_metrics: { error: "500 Internal server error" },
        },
      ],
    });

    render(<ContentCalendar brandId="b1" onReconnect={vi.fn()} />);
    await waitFor(() => expect(api.getSocialCalendar).toHaveBeenCalled());

    const dayCell = await findDayCellWithPosts();
    fireEvent.click(dayCell);
    fireEvent.click((await screen.findByText("Weekend hours")).closest("button"));

    expect(await screen.findByText("Why this post failed")).toBeInTheDocument();
    expect(screen.getByText("Reschedule")).toBeInTheDocument();
    expect(screen.queryByText("Reconnect account")).not.toBeInTheDocument();
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
