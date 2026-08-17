// 026-C3 (I-62) — shared ads-destination capture component contract (§F/§G/§H).
//
// Pins, with the api module fully mocked (no network, no real writes):
//   - zero granted Pages → honest state + reconnect affordance, Save disabled
//   - one granted Page → VISIBLY preselected but NO write happens before Save
//   - many Pages → explicit pick required (nothing preselected, Save errors)
//   - website_url prefill is labeled "suggested" and is never silently saved
//   - Save & continue: selectFacebookPage → updateBrand → authoritative
//     reread; onConfigured fires ONLY when the reread shows both values
//   - partial failure is honest: the saved Page stays saved, only the
//     destination is re-solicited, and the second Save does NOT repeat the
//     Page write (no duplicate writes)
//   - already-configured server truth renders the honest "set up" line
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../../api.js", () => ({
  api: {
    getBrand: vi.fn(),
    getBrands: vi.fn(),
    getActiveBrand: vi.fn(),
    updateBrand: vi.fn(),
    selectFacebookPage: vi.fn(),
    verifyFacebookConnection: vi.fn(),
  },
}));

import { api } from "../../api.js";
import AdsDestinationCapture from "./AdsDestinationCapture.jsx";

const BRAND_ID = "brand-1";
const PAGES = [
  { id: "p-100", name: "Main Street Storage" },
  { id: "p-200", name: "Second Page" },
];

function stageBrand(brand) {
  api.getBrand.mockResolvedValue({ brand });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.verifyFacebookConnection.mockResolvedValue({ pages: PAGES });
  stageBrand({ brand_id: BRAND_ID, facebook_page_id: null, ad_link_url: null, website_url: null });
  api.selectFacebookPage.mockResolvedValue({ success: true });
  api.updateBrand.mockResolvedValue({ success: true });
});

describe("AdsDestinationCapture", () => {
  test("zero granted Pages: honest state, reconnect affordance, Save disabled, nothing written", async () => {
    api.verifyFacebookConnection.mockResolvedValue({ pages: [] });
    const onReconnect = vi.fn();
    render(
      <AdsDestinationCapture brandId={BRAND_ID} onConfigured={vi.fn()} onReconnectFacebook={onReconnect} />,
    );

    expect(await screen.findByTestId("ads-capture-zero-pages")).toBeInTheDocument();
    expect(screen.getByText(/no Pages Echo can use/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reconnect facebook/i }));
    expect(onReconnect).toHaveBeenCalled();
    expect(screen.getByTestId("ads-destination-save")).toBeDisabled();
    expect(api.selectFacebookPage).not.toHaveBeenCalled();
    expect(api.updateBrand).not.toHaveBeenCalled();
  });

  test("single Page: visibly preselected, but NO write until explicit Save", async () => {
    api.verifyFacebookConnection.mockResolvedValue({ pages: [PAGES[0]] });
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={vi.fn()} />);

    expect(await screen.findByTestId("ads-capture-single-page-note")).toBeInTheDocument();
    expect(screen.getByTestId(`ads-page-option-${PAGES[0].id}`)).toBeChecked();
    // Preselection alone writes nothing.
    expect(api.selectFacebookPage).not.toHaveBeenCalled();
    expect(api.updateBrand).not.toHaveBeenCalled();
  });

  test("many Pages: nothing auto-selected; Save without a pick errors honestly and writes nothing", async () => {
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={vi.fn()} />);
    await screen.findByTestId(`ads-page-option-${PAGES[0].id}`);
    expect(screen.getByTestId(`ads-page-option-${PAGES[0].id}`)).not.toBeChecked();
    expect(screen.getByTestId(`ads-page-option-${PAGES[1].id}`)).not.toBeChecked();

    fireEvent.change(screen.getByTestId("ads-destination-input"), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(screen.getByTestId("ads-destination-save"));
    expect(await screen.findByText(/choose the facebook page/i)).toBeInTheDocument();
    expect(api.selectFacebookPage).not.toHaveBeenCalled();
    expect(api.updateBrand).not.toHaveBeenCalled();
  });

  test("website suggestion is labeled 'suggested' and never silently copied — save writes it only explicitly", async () => {
    stageBrand({
      brand_id: BRAND_ID,
      facebook_page_id: null,
      ad_link_url: null,
      website_url: "https://mysite.example",
    });
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={vi.fn()} />);

    expect(await screen.findByTestId("ads-capture-suggestion-note")).toBeInTheDocument();
    expect(screen.getByTestId("ads-destination-input")).toHaveValue("https://mysite.example");
    // Merely rendering the suggestion writes nothing.
    expect(api.updateBrand).not.toHaveBeenCalled();
  });

  test("happy path: Save → selectFacebookPage then updateBrand then reread; onConfigured only from server truth", async () => {
    const onConfigured = vi.fn();
    // Reread after save shows both values (server truth).
    api.getBrand
      .mockResolvedValueOnce({
        brand: { brand_id: BRAND_ID, facebook_page_id: null, ad_link_url: null, website_url: null },
      })
      .mockResolvedValueOnce({
        brand: {
          brand_id: BRAND_ID,
          facebook_page_id: PAGES[1].id,
          ad_link_url: "https://example.com/offer",
        },
      });
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={onConfigured} />);

    fireEvent.click(await screen.findByTestId(`ads-page-option-${PAGES[1].id}`));
    fireEvent.change(screen.getByTestId("ads-destination-input"), {
      target: { value: "https://example.com/offer" },
    });
    fireEvent.click(screen.getByTestId("ads-destination-save"));

    await waitFor(() =>
      expect(onConfigured).toHaveBeenCalledWith({
        pageId: PAGES[1].id,
        adLinkUrl: "https://example.com/offer",
      }),
    );
    expect(api.selectFacebookPage).toHaveBeenCalledWith(PAGES[1].id, BRAND_ID);
    expect(api.updateBrand).toHaveBeenCalledWith(BRAND_ID, { adLinkUrl: "https://example.com/offer" });
    // Configuration only — the capture never launches anything and calls no
    // execute/campaign API (it doesn't even import one).
  });

  test("partial failure is honest: page stays saved, destination re-solicited, second Save skips the Page write", async () => {
    const onConfigured = vi.fn();
    api.updateBrand.mockRejectedValueOnce(new Error("That link looks malformed."));
    api.getBrand
      // initial load
      .mockResolvedValueOnce({
        brand: { brand_id: BRAND_ID, facebook_page_id: null, ad_link_url: null },
      })
      // reread after first (partially failed) save: page saved, link missing
      .mockResolvedValueOnce({
        brand: { brand_id: BRAND_ID, facebook_page_id: PAGES[0].id, ad_link_url: null },
      })
      // reread after second save: both present
      .mockResolvedValueOnce({
        brand: { brand_id: BRAND_ID, facebook_page_id: PAGES[0].id, ad_link_url: "https://ok.example/" },
      });

    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={onConfigured} />);
    fireEvent.click(await screen.findByTestId(`ads-page-option-${PAGES[0].id}`));
    fireEvent.change(screen.getByTestId("ads-destination-input"), {
      target: { value: "https://ok.example/" },
    });
    fireEvent.click(screen.getByTestId("ads-destination-save"));

    // Honest partial: an error shows, success is NOT declared.
    expect(await screen.findByText(/malformed/i)).toBeInTheDocument();
    expect(onConfigured).not.toHaveBeenCalled();
    expect(api.selectFacebookPage).toHaveBeenCalledTimes(1);

    // Second Save: destination succeeds now; the Page write is NOT repeated.
    api.updateBrand.mockResolvedValueOnce({ success: true });
    fireEvent.click(screen.getByTestId("ads-destination-save"));
    await waitFor(() => expect(onConfigured).toHaveBeenCalled());
    expect(api.selectFacebookPage).toHaveBeenCalledTimes(1); // no duplicate Page write
  });

  test("already configured server truth renders the honest 'set up' line, no form, no writes", async () => {
    stageBrand({
      brand_id: BRAND_ID,
      facebook_page_id: PAGES[0].id,
      ad_link_url: "https://done.example/",
    });
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={vi.fn()} />);
    expect(await screen.findByTestId("ads-destination-configured")).toBeInTheDocument();
    expect(screen.queryByTestId("ads-destination-save")).not.toBeInTheDocument();
    expect(api.selectFacebookPage).not.toHaveBeenCalled();
    expect(api.updateBrand).not.toHaveBeenCalled();
  });

  test("host 1 without a brand prop resolves the active brand from the server", async () => {
    api.getActiveBrand.mockResolvedValue({ brandId: BRAND_ID });
    render(<AdsDestinationCapture onConfigured={vi.fn()} />);
    await screen.findByTestId(`ads-page-option-${PAGES[0].id}`);
    expect(api.getBrand).toHaveBeenCalledWith(BRAND_ID);
  });
});
