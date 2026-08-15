// Prompt 035 Stage 2 — Section D1 client regression: UNATTRIBUTED candidate
// rendering. Name-only research runs return `_candidates` (possible matches),
// which must render as a disambiguation list with confirm buttons — never as
// facts — and confirming one saves the URL as a real brand anchor via
// api.updateBrand (the server orchestrator picks it up as an anchor arrival).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import SageResearchPanel from "./SageResearchPanel.jsx";
import { api } from "../../api";

vi.mock("../../api", () => ({
  api: {
    getBrands: vi.fn(),
    getBrandResearch: vi.fn(),
    startBrandResearch: vi.fn(),
    updateBrand: vi.fn(),
  },
}));

const BRAND_ID = "11111111-1111-1111-1111-111111111111";

const CANDIDATE_DRAFT = {
  draftId: "d1",
  runId: "r1",
  status: "partial",
  summary: "Sage found a few businesses that might be yours.",
  fields: {
    _candidates: [
      { kind: "website", url: "https://joes-plumbing.com", excerpt: "Joe's Plumbing" },
      { kind: "facebook", url: "https://facebook.com/joesplumbing", excerpt: null },
      { kind: "source", url: "https://directory.example.com/joes", excerpt: null },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SageResearchPanel candidates (P035)", () => {
  it("renders candidates as unattributed possibilities with confirm buttons (no FieldCard, no UNAPPROVED fact chrome)", async () => {
    api.getBrandResearch.mockResolvedValue({ draft: CANDIDATE_DRAFT });
    render(<SageResearchPanel brandId={BRAND_ID} />);
    const box = await screen.findByTestId("research-candidates");
    expect(box.textContent).toMatch(/might be yours/i);
    expect(box.textContent).toMatch(/nothing is attributed until you confirm/i);
    // website + facebook get confirm buttons; a bare source does not.
    expect(screen.getByTestId("research-candidate-confirm-0")).toBeTruthy();
    expect(screen.getByTestId("research-candidate-confirm-1")).toBeTruthy();
    expect(screen.queryByTestId("research-candidate-confirm-2")).toBeNull();
    // `_candidates` must never render as a fact field card.
    expect(screen.queryByTestId("research-field-_candidates")).toBeNull();
  });

  it("confirming a website candidate saves it as a brand anchor and re-polls the new run", async () => {
    api.getBrandResearch.mockResolvedValue({ draft: CANDIDATE_DRAFT });
    api.updateBrand.mockResolvedValue({ brand_id: BRAND_ID });
    render(<SageResearchPanel brandId={BRAND_ID} />);
    fireEvent.click(await screen.findByTestId("research-candidate-confirm-0"));
    await waitFor(() =>
      expect(api.updateBrand).toHaveBeenCalledWith(BRAND_ID, {
        websiteUrl: "https://joes-plumbing.com",
      }),
    );
    // The panel flips to the running state (the server started a fresh run).
    expect(await screen.findByTestId("research-running")).toBeTruthy();
  });

  it("confirming a facebook candidate saves facebookPageUrl", async () => {
    api.getBrandResearch.mockResolvedValue({ draft: CANDIDATE_DRAFT });
    api.updateBrand.mockResolvedValue({ brand_id: BRAND_ID });
    render(<SageResearchPanel brandId={BRAND_ID} />);
    fireEvent.click(await screen.findByTestId("research-candidate-confirm-1"));
    await waitFor(() =>
      expect(api.updateBrand).toHaveBeenCalledWith(BRAND_ID, {
        facebookPageUrl: "https://facebook.com/joesplumbing",
      }),
    );
  });

  it("a failed confirm shows honest copy and never blocks the wizard", async () => {
    api.getBrandResearch.mockResolvedValue({ draft: CANDIDATE_DRAFT });
    api.updateBrand.mockRejectedValue(new Error("nope"));
    render(<SageResearchPanel brandId={BRAND_ID} />);
    fireEvent.click(await screen.findByTestId("research-candidate-confirm-0"));
    await waitFor(() =>
      expect(screen.getByText(/couldn't save that link/i)).toBeTruthy(),
    );
  });
});
