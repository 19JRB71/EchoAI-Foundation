// Coverage for surfacing a goal's muted-alerts state everywhere goals appear:
// the shared <GoalRow> (used by Mission Control, department dashboards, and
// the ROI dashboard) must show a "Muted" badge when goal.alertsMuted is true,
// so a quiet "behind" goal reads as silenced-on-purpose, not broken alerts.

import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { GoalRow } from "./GoalsPanel.jsx";

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

describe("GoalRow muted indicator", () => {
  test("shows a Muted badge when alertsMuted is true", () => {
    render(<GoalRow goal={goal({ alertsMuted: true })} />);
    const badge = screen.getByText("Muted");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute(
      "title",
      "Voice & push alerts are muted for this goal"
    );
    // The rest of the row still renders normally.
    expect(screen.getByText("Monthly revenue")).toBeInTheDocument();
  });

  test("no Muted badge when alertsMuted is false", () => {
    render(<GoalRow goal={goal()} />);
    expect(screen.queryByText("Muted")).not.toBeInTheDocument();
    expect(screen.getByText("Monthly revenue")).toBeInTheDocument();
  });

  test("no Muted badge when alertsMuted is absent from the payload", () => {
    const g = goal();
    delete g.alertsMuted;
    render(<GoalRow goal={g} />);
    expect(screen.queryByText("Muted")).not.toBeInTheDocument();
  });
});
