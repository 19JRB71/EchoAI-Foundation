// Prompt 011 corrective FIX 2 — mandated client coverage for the Business
// Profile review screen: approved/current rendering, pending proposals,
// CONTESTED marker, provenance/alternatives visibility, Approve/Reject/Edit
// actions, owner-edit immediate-effect messaging, legacy unversioned state,
// projection refresh after action, error state, and the guarantee that no
// proposal is ever rendered as the authoritative current value.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

vi.mock("../api.js", () => ({
  api: {
    getBrandKnowledge: vi.fn(),
    getKnowledgeHistory: vi.fn(),
    approveKnowledgeRevision: vi.fn(),
    rejectKnowledgeRevision: vi.fn(),
    ownerEditKnowledge: vi.fn(),
  },
}));

import { api } from "../api.js";
import ProfileReview from "./ProfileReview.jsx";

const BRAND = "b-1";

function knowledgePayload({ approved = {}, legacy = {}, pending = [] } = {}) {
  return {
    fieldKeys: [
      "business_name", "tagline", "brand_personality", "voice_description",
      "target_audience", "description", "email", "phone", "address",
      "hours", "services", "service_area",
    ],
    approved,
    legacy,
    pending,
    orderingNote:
      "Proposal ordering is deterministic candidate selection for an UNAPPROVED draft; it is not an authority or truth ranking.",
  };
}

const APPROVED_TAGLINE = {
  versionId: "v-10",
  version_no: 1,
  value: "Built-to-last pole barn kits, delivered.",
  provenance: { sources: [{ source: "stated", basis: "Owner typed it." }] },
};

const PENDING_DESC = {
  revision_id: "r-1",
  field_key: "description",
  kind: "field",
  proposed_by: "sage_draft",
  proposed_value: "A company that sells complete pole barn home kits.",
  provenance: {
    conflict: false,
    sources: [{ source: "public_web", url: "https://example.com/about", excerpt: "kits include premium lumber" }],
    alternatives: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProfileReview (Prompt 011 corrective coverage)", () => {
  test("renders the approved current value with its version badge and provenance", async () => {
    api.getBrandKnowledge.mockResolvedValue(knowledgePayload({ approved: { tagline: APPROVED_TAGLINE } }));
    render(<ProfileReview brandId={BRAND} />);
    expect(await screen.findByText("Built-to-last pole barn kits, delivered.")).toBeInTheDocument();
    expect(screen.getByText(/current \(v1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/stated/i)).toBeInTheDocument();
  });

  test("renders a pending proposal as a proposal — never as the authoritative current value", async () => {
    api.getBrandKnowledge.mockResolvedValue(knowledgePayload({ pending: [PENDING_DESC] }));
    render(<ProfileReview brandId={BRAND} />);
    expect(await screen.findByText(/proposed change/i)).toBeInTheDocument();
    expect(screen.getByText("A company that sells complete pole barn home kits.")).toBeInTheDocument();
    // The field itself has no current value: no Current (vN) badge anywhere,
    // and the description card still says nothing is on file.
    expect(screen.queryByText(/current \(v\d+\)/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/nothing on file for this field yet/i).length).toBeGreaterThan(0);
  });

  test("shows the CONTESTED marker when provenance.conflict is true, with alternatives visible", async () => {
    const contested = {
      ...PENDING_DESC,
      provenance: {
        conflict: true,
        sources: [{ source: "website", url: "https://example.com", excerpt: "says A" }],
        alternatives: [{ value: "A different description", source: "facebook" }],
      },
    };
    api.getBrandKnowledge.mockResolvedValue(knowledgePayload({ pending: [contested] }));
    render(<ProfileReview brandId={BRAND} />);
    expect(await screen.findByText(/contested/i)).toBeInTheDocument();
    const details = screen.getByText(/where this came from/i);
    fireEvent.click(details);
    expect(screen.getByText(/a different description/i)).toBeInTheDocument();
  });

  test("Approve calls the approve endpoint and refreshes the projection", async () => {
    api.getBrandKnowledge
      .mockResolvedValueOnce(knowledgePayload({ pending: [PENDING_DESC] }))
      .mockResolvedValueOnce(
        knowledgePayload({
          approved: {
            description: {
              versionId: "v-20", version_no: 1,
              value: PENDING_DESC.proposed_value,
              provenance: PENDING_DESC.provenance,
            },
          },
        })
      );
    api.approveKnowledgeRevision.mockResolvedValue({ ok: true });
    render(<ProfileReview brandId={BRAND} />);
    fireEvent.click(await screen.findByRole("button", { name: /approve/i }));
    await waitFor(() =>
      expect(api.approveKnowledgeRevision).toHaveBeenCalledWith(BRAND, "r-1"));
    // Projection refetched and now renders the approved state.
    await waitFor(() => expect(api.getBrandKnowledge).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/current \(v1\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/proposed change/i)).not.toBeInTheDocument();
  });

  test("Reject calls the reject endpoint, refreshes, and nothing becomes current", async () => {
    api.getBrandKnowledge
      .mockResolvedValueOnce(knowledgePayload({ pending: [PENDING_DESC] }))
      .mockResolvedValueOnce(knowledgePayload({}));
    api.rejectKnowledgeRevision.mockResolvedValue({ ok: true });
    render(<ProfileReview brandId={BRAND} />);
    fireEvent.click(await screen.findByRole("button", { name: /reject/i }));
    await waitFor(() =>
      expect(api.rejectKnowledgeRevision).toHaveBeenCalledWith(BRAND, "r-1"));
    await waitFor(() => expect(api.getBrandKnowledge).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/proposed change/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/current \(v\d+\)/i)).not.toBeInTheDocument();
  });

  test("Edit Myself saves through ownerEditKnowledge with immediate-effect messaging", async () => {
    api.getBrandKnowledge
      .mockResolvedValueOnce(knowledgePayload({ approved: { tagline: APPROVED_TAGLINE } }))
      .mockResolvedValueOnce(
        knowledgePayload({
          approved: {
            tagline: { ...APPROVED_TAGLINE, version_no: 2, value: "New tagline." },
          },
        })
      );
    api.ownerEditKnowledge.mockResolvedValue({ ok: true });
    render(<ProfileReview brandId={BRAND} />);
    const card = (await screen.findByText(/tagline/i, { selector: "h3" })).closest("div").parentElement;
    fireEvent.click(within(card).getByRole("button", { name: /edit/i }));
    // Immediate-effect messaging shown before saving.
    expect(screen.getByText(/takes effect immediately/i)).toBeInTheDocument();
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "New tagline." } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(api.ownerEditKnowledge).toHaveBeenCalledWith(BRAND, { tagline: "New tagline." }));
    expect(await screen.findByText(/saved — your edit is now the current value/i)).toBeInTheDocument();
    expect(await screen.findByText("New tagline.")).toBeInTheDocument();
  });

  test("legacy values render as Current (unversioned — never reviewed)", async () => {
    api.getBrandKnowledge.mockResolvedValue(
      knowledgePayload({ legacy: { business_name: { value: "Pole Barn Kits" } } })
    );
    render(<ProfileReview brandId={BRAND} />);
    expect(await screen.findByText("Pole Barn Kits")).toBeInTheDocument();
    expect(screen.getByText(/unversioned — never reviewed/i)).toBeInTheDocument();
  });

  test("a load failure renders the error state with a retry", async () => {
    api.getBrandKnowledge.mockRejectedValue(new Error("boom"));
    render(<ProfileReview brandId={BRAND} />);
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
