// Competitor Website Analysis (Scout): the section must render Scout's real
// analysis payload shape, show an HONEST "couldn't read" state for blocked sites
// (never a fabricated analysis), and surface flagged changes. These render the
// real <CompetitorSites> with a mocked api.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../api.js", () => ({
  api: {
    listCompetitorSites: vi.fn(),
    getCompetitorSiteDigest: vi.fn(),
    addCompetitorSite: vi.fn(),
    removeCompetitorSite: vi.fn(),
    recheckCompetitorSite: vi.fn(),
  },
}));

import { api } from "../api.js";
import CompetitorSites from "./CompetitorSites.jsx";

beforeEach(() => {
  vi.clearAllMocks();
});

test("renders an analyzed site's structured analysis and flagged changes", async () => {
  api.listCompetitorSites.mockResolvedValue({
    sites: [
      {
        siteId: "s1",
        url: "https://rival.com",
        label: "Rival Co",
        status: "analyzed",
        lastError: null,
        analysis: {
          pricing: "Pro plan $99/mo",
          offers: null,
          messaging: "The fastest CRM for agencies",
          products: "CRM, email, dialer",
          ctas: "Start free trial",
          positioning: "Premium, agency-focused",
          summary: "They target agencies with a premium CRM.",
        },
        lastCheckedAt: new Date().toISOString(),
        lastChangedAt: null,
        changes: [
          {
            changeId: "c1",
            changeType: "pricing",
            summary: "Raised the Pro plan to $99",
            detail: "was $79",
            detectedAt: new Date().toISOString(),
          },
        ],
      },
    ],
  });

  render(<CompetitorSites brandId="b1" />);

  await waitFor(() => {
    expect(screen.getByText("They target agencies with a premium CRM.")).toBeInTheDocument();
  });
  expect(screen.getByText("Pro plan $99/mo")).toBeInTheDocument();
  expect(screen.getByText("Raised the Pro plan to $99")).toBeInTheDocument();
});

test("shows an honest 'couldn't read' message for a blocked site", async () => {
  api.listCompetitorSites.mockResolvedValue({
    sites: [
      {
        siteId: "s2",
        url: "https://blocked.com",
        label: null,
        status: "error",
        lastError: "the site blocked automated reading",
        analysis: {},
        lastCheckedAt: new Date().toISOString(),
        lastChangedAt: null,
        changes: [],
      },
    ],
  });

  render(<CompetitorSites brandId="b1" />);

  await waitFor(() => {
    expect(screen.getByText(/couldn't read this site/i)).toBeInTheDocument();
  });
  expect(screen.getByText(/blocked automated reading/i)).toBeInTheDocument();
});

test("renders the empty state when no sites are tracked", async () => {
  api.listCompetitorSites.mockResolvedValue({ sites: [] });

  render(<CompetitorSites brandId="b1" />);

  await waitFor(() => {
    expect(screen.getByText(/No competitor websites yet/i)).toBeInTheDocument();
  });
});
