// Coverage for pre-muting a noisy goal from the goals management UI: each goal
// row in <GoalEditorCard> must show its alerts-muted state and a mute/unmute
// toggle wired to api.muteGoalAlerts — so an owner can silence a goal BEFORE
// its first alert ever fires (previously only reachable from the Mission
// Control feed after an alert existed).

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../api.js", () => ({
  api: {
    getGoals: vi.fn(),
    getGoalCatalog: vi.fn(),
    updateBrand: vi.fn(),
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    deleteGoal: vi.fn(),
    muteGoalAlerts: vi.fn(),
  },
}));

import { api } from "../api.js";
import GoalEditorCard from "./GoalEditorCard.jsx";

function goal(overrides = {}) {
  return {
    goalId: "g1",
    brandId: "b1",
    metricKey: "revenue",
    category: "revenue",
    label: "Monthly revenue",
    unit: "currency",
    direction: "increase",
    aggregation: "cumulative",
    targetValue: 5000,
    currentValue: 1200,
    percentToGoal: 24,
    status: "behind",
    alertsMuted: false,
    ...overrides,
  };
}

function goalsPayload(goals) {
  return {
    brandId: "b1",
    brandType: "local_service",
    score: 24,
    goalCount: goals.length,
    goals,
    catalog: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GoalEditorCard alert muting", () => {
  test("an unmuted goal row offers a Mute alerts toggle and no muted badge", async () => {
    api.getGoals.mockResolvedValue(goalsPayload([goal()]));

    render(<GoalEditorCard brandId="b1" />);

    await waitFor(() => {
      expect(screen.getByText("Monthly revenue")).toBeInTheDocument();
    });
    expect(screen.getByText("Mute alerts")).toBeInTheDocument();
    expect(screen.queryByText("Alerts muted")).not.toBeInTheDocument();
  });

  test("muting calls the API and flips the row to muted + Unmute alerts", async () => {
    api.getGoals.mockResolvedValue(goalsPayload([goal()]));
    api.muteGoalAlerts.mockResolvedValue({ goalId: "g1", muted: true });

    render(<GoalEditorCard brandId="b1" />);

    await waitFor(() => {
      expect(screen.getByText("Mute alerts")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Mute alerts"));

    await waitFor(() => {
      expect(api.muteGoalAlerts).toHaveBeenCalledWith("b1", "g1", true);
      expect(screen.getByText("Alerts muted")).toBeInTheDocument();
      expect(screen.getByText("Unmute alerts")).toBeInTheDocument();
    });
  });

  test("an already-muted goal shows the badge and unmutes via the API", async () => {
    api.getGoals.mockResolvedValue(goalsPayload([goal({ alertsMuted: true })]));
    api.muteGoalAlerts.mockResolvedValue({ goalId: "g1", muted: false });

    render(<GoalEditorCard brandId="b1" />);

    await waitFor(() => {
      expect(screen.getByText("Alerts muted")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Unmute alerts"));

    await waitFor(() => {
      expect(api.muteGoalAlerts).toHaveBeenCalledWith("b1", "g1", false);
      expect(screen.queryByText("Alerts muted")).not.toBeInTheDocument();
      expect(screen.getByText("Mute alerts")).toBeInTheDocument();
    });
  });

  test("a failed mute keeps the row unmuted and shows an error", async () => {
    api.getGoals.mockResolvedValue(goalsPayload([goal()]));
    api.muteGoalAlerts.mockRejectedValue(new Error("nope"));

    render(<GoalEditorCard brandId="b1" />);

    await waitFor(() => {
      expect(screen.getByText("Mute alerts")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Mute alerts"));

    await waitFor(() => {
      expect(screen.getByText("nope")).toBeInTheDocument();
    });
    expect(screen.queryByText("Alerts muted")).not.toBeInTheDocument();
    expect(screen.getByText("Mute alerts")).toBeInTheDocument();
  });
});
