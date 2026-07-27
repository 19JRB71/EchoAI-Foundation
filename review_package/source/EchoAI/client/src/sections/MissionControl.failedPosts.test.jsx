// Regression coverage: posts stuck in 'failed' status must be flagged in
// Mission Control's attention area, not only pushed to installed-PWA owners.
// Renders the real <MissionControl> with a mocked api whose getMissionControl
// payload carries failedPosts, and asserts render (platform, brand, reason) +
// the click-through to the Social Media calendar section.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../api.js", () => ({
  api: {
    getMissionControl: vi.fn(),
    getGoalsOverview: vi.fn(),
    dismissGoalAlert: vi.fn(),
    muteGoalAlerts: vi.fn(),
  },
}));

import { api } from "../api.js";
import MissionControl from "./MissionControl.jsx";

const FAILED_POST = {
  postId: "p1",
  platform: "facebook",
  brandId: "b1",
  brandName: "Acme",
  reason: "Facebook session expired. Reconnect the account.",
  scheduledTime: "2026-07-06T09:00:00Z",
  failedAt: "2026-07-06T09:01:00Z",
};

function payload(failedPosts) {
  return {
    brandName: "Acme",
    briefing: "Good morning.",
    agents: [],
    stats: {},
    upcoming: [],
    goalAlerts: [],
    failedPosts,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getGoalsOverview.mockResolvedValue(null);
});

describe("MissionControl failed posts", () => {
  test("lists failed posts with platform, brand, and failure reason", async () => {
    api.getMissionControl.mockResolvedValue(payload([FAILED_POST]));

    render(<MissionControl onNavigate={() => {}} onOpenDepartment={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("1 post failed to publish")).toBeInTheDocument();
    });
    expect(screen.getByText("facebook")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(
      screen.getByText("Facebook session expired. Reconnect the account.")
    ).toBeInTheDocument();
  });

  test("pluralizes the banner for multiple failed posts", async () => {
    api.getMissionControl.mockResolvedValue(
      payload([
        FAILED_POST,
        { ...FAILED_POST, postId: "p2", platform: "instagram", brandName: "Globex" },
      ])
    );

    render(<MissionControl onNavigate={() => {}} onOpenDepartment={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("2 posts failed to publish")).toBeInTheDocument();
    });
    expect(screen.getByText("instagram")).toBeInTheDocument();
    expect(screen.getByText("Globex")).toBeInTheDocument();
  });

  test("omits the panel when there are no failed posts", async () => {
    api.getMissionControl.mockResolvedValue(payload([]));

    render(<MissionControl onNavigate={() => {}} onOpenDepartment={() => {}} />);

    await waitFor(() => {
      expect(
        screen.queryByText(/failed to publish/)
      ).not.toBeInTheDocument();
    });
  });

  test("omits the panel when the payload has no failedPosts field (old server)", async () => {
    const p = payload([]);
    delete p.failedPosts;
    api.getMissionControl.mockResolvedValue(p);

    render(<MissionControl onNavigate={() => {}} onOpenDepartment={() => {}} />);

    await waitFor(() => {
      expect(
        screen.queryByText(/failed to publish/)
      ).not.toBeInTheDocument();
    });
  });

  test("clicking a failed post entry jumps to the Social Media calendar", async () => {
    api.getMissionControl.mockResolvedValue(payload([FAILED_POST]));
    const onNavigate = vi.fn();

    render(<MissionControl onNavigate={onNavigate} onOpenDepartment={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("facebook")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("facebook"));

    expect(onNavigate).toHaveBeenCalledWith("social");
  });

  test("the panel's Open calendar button also navigates to social", async () => {
    api.getMissionControl.mockResolvedValue(payload([FAILED_POST]));
    const onNavigate = vi.fn();

    render(<MissionControl onNavigate={onNavigate} onOpenDepartment={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Open calendar →")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Open calendar →"));

    expect(onNavigate).toHaveBeenCalledWith("social");
  });
});
