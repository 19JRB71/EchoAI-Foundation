// Regression coverage: Sage's Marketing Insights and Intelligence Input tabs must
// render the backend's real insight object shapes. The backend returns
// marketing_insights as { insight, action, why } and submission insights as
// { insight, why }. A code review caught that the UI only read title/body/detail,
// so real Sage payloads rendered as blank cards. These tests render the real
// <Sage> with a mocked api and assert the actual insight text is visible.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../api.js", () => ({
  api: {
    getSageBrief: vi.fn(),
    refreshSageBrief: vi.fn(),
    getSageFeed: vi.fn(),
    getSageInsights: vi.fn(),
    getSageCompetitors: vi.fn(),
    getSageSubmissions: vi.fn(),
  },
}));

import { api } from "../api.js";
import Sage from "./Sage.jsx";

beforeEach(() => {
  vi.clearAllMocks();
});

test("Insights tab renders { insight, action, why } objects", async () => {
  api.getSageInsights.mockResolvedValue({
    insights: [
      {
        insight: "Video ads are outperforming static creative",
        action: "Shift 30% of ad budget to short-form video",
        why: "Competitors doubled video spend this quarter",
      },
    ],
    lastRefreshedAt: null,
  });

  render(<Sage brandId="b1" initialTab="insights" />);

  await waitFor(() => {
    expect(
      screen.getByText("Video ads are outperforming static creative"),
    ).toBeInTheDocument();
  });
  expect(
    screen.getByText(/Shift 30% of ad budget to short-form video/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Competitors doubled video spend this quarter/),
  ).toBeInTheDocument();
});

test("Intelligence Input history renders { insight, why } submission insights", async () => {
  api.getSageSubmissions.mockResolvedValue({
    submissions: [
      {
        submission_id: "s1",
        input_type: "link",
        input_ref: "https://example.com/article",
        title: "Competitor pricing page",
        summary: "They raised prices 15%",
        insights: [
          {
            insight: "Room to undercut on the mid tier",
            why: "Their mid tier is now $80 vs our $50",
          },
        ],
        created_at: new Date().toISOString(),
      },
    ],
  });

  render(<Sage brandId="b1" initialTab="input" />);

  await waitFor(() => {
    expect(
      screen.getByText("Room to undercut on the mid tier"),
    ).toBeInTheDocument();
  });
  expect(
    screen.getByText(/Their mid tier is now \$80 vs our \$50/),
  ).toBeInTheDocument();
});
