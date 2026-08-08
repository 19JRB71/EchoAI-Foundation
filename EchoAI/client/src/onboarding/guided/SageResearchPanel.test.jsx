// Prompt 022 — D4 client regression: the wizard research panel must render
// UNAPPROVED + confidence + source provenance on every field, a visible
// CONTESTED marker (with alternatives) when sources disagree, and honest
// empty/failed copy — and must never block the wizard (no modal, no gating).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import SageResearchPanel from "./SageResearchPanel.jsx";
import { api } from "../../api";

vi.mock("../../api", () => ({
  api: {
    getBrands: vi.fn(),
    getBrandResearch: vi.fn(),
    startBrandResearch: vi.fn(),
  },
}));

const BRAND_ID = "11111111-1111-1111-1111-111111111111";

function draft(overrides = {}) {
  return {
    draftId: "d1",
    runId: "r1",
    status: "complete",
    fields: {},
    summary: null,
    stopReason: null,
    errorMessage: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SageResearchPanel", () => {
  it("renders a contested field with UNAPPROVED, confidence, CONTESTED marker and alternatives", async () => {
    api.getBrandResearch.mockResolvedValue({
      draft: draft({
        status: "complete",
        summary: "Sage found 1 thing about your business publicly.",
        fields: {
          phone: {
            value: "555-0100",
            confidence: "low",
            conflict: true,
            sources: [
              { source: "website", source_url: "https://example.com/contact", retrieved_at: "2026-08-08T00:00:00Z", excerpt: "Call 555-0100" },
            ],
            alternatives: [
              {
                value: "555-0200",
                sources: [
                  { source: "facebook", source_url: "https://facebook.com/p", retrieved_at: "2026-08-08T00:00:00Z", excerpt: "555-0200" },
                ],
              },
            ],
          },
        },
      }),
    });

    render(<SageResearchPanel brandId={BRAND_ID} />);

    await waitFor(() => expect(screen.getByTestId("research-field-phone")).toBeInTheDocument());
    expect(screen.getByText("UNAPPROVED")).toBeInTheDocument();
    expect(screen.getByText("confidence: low")).toBeInTheDocument();
    expect(screen.getByTestId("research-contested-phone")).toHaveTextContent("CONTESTED");
    expect(screen.getByTestId("research-alternative-phone-0")).toHaveTextContent("555-0200");
    expect(screen.getByText(/example\.com\/contact/)).toBeInTheDocument();
  });

  it("renders uncontested fields without a CONTESTED marker", async () => {
    api.getBrandResearch.mockResolvedValue({
      draft: draft({
        fields: {
          address: {
            value: "1 Main St",
            confidence: "high",
            conflict: false,
            sources: [
              { source: "website", source_url: "https://example.com/", retrieved_at: "2026-08-08T00:00:00Z", excerpt: "1 Main St" },
            ],
            alternatives: [],
          },
        },
      }),
    });

    render(<SageResearchPanel brandId={BRAND_ID} />);

    await waitFor(() => expect(screen.getByTestId("research-field-address")).toBeInTheDocument());
    expect(screen.queryByTestId("research-contested-address")).not.toBeInTheDocument();
  });

  it("shows the honest empty copy when research found nothing", async () => {
    api.getBrandResearch.mockResolvedValue({
      draft: draft({
        status: "empty",
        summary: "I could not find much publicly; I will ask a few more questions.",
      }),
    });

    render(<SageResearchPanel brandId={BRAND_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId("research-summary")).toHaveTextContent(
        /could not find much publicly/i,
      ),
    );
  });

  it("shows a non-blocking running state after starting research", async () => {
    api.getBrandResearch.mockResolvedValue({ draft: null });
    api.startBrandResearch.mockResolvedValue({ runId: "r2", status: "running" });

    render(<SageResearchPanel brandId={BRAND_ID} />);

    const btn = await screen.findByTestId("research-start");
    fireEvent.click(btn);

    await waitFor(() => expect(screen.getByTestId("research-running")).toBeInTheDocument());
    expect(screen.getByTestId("research-running")).toHaveTextContent(/keep going/i);
  });

  it("failed research shows honest copy and still lets the owner retry", async () => {
    api.getBrandResearch.mockResolvedValue({
      draft: draft({ status: "failed", errorMessage: null }),
    });

    render(<SageResearchPanel brandId={BRAND_ID} />);

    await waitFor(() => expect(screen.getByTestId("research-failed")).toBeInTheDocument());
    expect(screen.getByTestId("research-failed")).toHaveTextContent(/ask a few more questions/i);
    expect(screen.getByTestId("research-start")).toBeInTheDocument();
  });
});
