// 026-C3 (I-62) — shared ads-destination capture component contract (§F/§G/§H).
//
// Pins, with the api module fully mocked (no network, no real writes):
//   - zero granted Pages → honest state + reconnect affordance, Save disabled
//   - one granted Page → explicit selection and NO write before Save
//   - many Pages → explicit pick required (nothing preselected, Save errors)
//   - website_url prefill is labeled "suggested" and is never silently saved
//   - Save & continue: consented selectFacebookPage → authoritative
//     reread; onConfigured fires ONLY when the reread shows both values
//   - rejected atomic writes are honest; retry uses the same consented boundary
//   - already-configured server truth renders the honest "set up" line
//
// 026-C3-PM3 mock fidelity (§G): Page candidates are mocked on
// api.getFacebookAccounts in the REAL response shape of
// GET /api/facebook/accounts, bound by the server contract regression
// test/facebookAccountsContract.test.js (PM3-R1/PM3-R12):
//   { configured, connected, connectionStatus, accounts, selectedAccountId,
//     pages: [{ id, name, category }], selectedPageId }
// The previous mock here (verifyFacebookConnection → { pages }) fabricated a
// field the verify endpoint never returns and concealed a live defect — no
// test in this file may mock pages on verifyFacebookConnection again (PM3-R6).
//
// 026-C3-PM4 mock fidelity (§L, second application): api.getBrand is mocked in
// the REAL response shape of GET /api/brands/:brandId — a FLAT brand row (no
// { brand: ... } wrapper) that includes facebook_page_id and ad_link_url —
// bound by the server contract regression test/brandProfileContract.test.js
// (PM4-R1/R2/R15). The previous mock here ({ brand: {...} }) fabricated a
// wrapper the endpoint never returns, and pre-PM4 the real flat row omitted
// both Store-3 fields, which made every successful Save read back as "didn't
// stick" live. No test in this file may wrap getBrand responses again
// (PM4-R3).
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../../api.js", () => ({
  api: {
    getBrand: vi.fn(),
    getBrands: vi.fn(),
    getActiveBrand: vi.fn(),
    updateBrand: vi.fn(),
    setFacebookBrandPage: vi.fn(),
    selectFacebookPage: vi.fn(),
    getFacebookAccounts: vi.fn(),
  },
}));

import { api } from "../../api.js";
import AdsDestinationCapture from "./AdsDestinationCapture.jsx";

const BRAND_ID = "brand-1";
const PAGES = [
  { id: "p-100", name: "Main Street Storage", category: "Storage Facility" },
  { id: "p-200", name: "Second Page", category: null },
];

// Real /api/facebook/accounts contract shape — mirror of the server contract
// bound by test/facebookAccountsContract.test.js (PM3-R6 comment link).
function accountsResponse(pages) {
  return {
    configured: true,
    connected: true,
    connectionStatus: "connected",
    accounts: [{ id: "act_1", name: "Ad Account" }],
    selectedAccountId: "act_1",
    pages,
    selectedPageId: null,
  };
}

// Real flat contract: the row itself is the response (PM4-R3).
function flatBrand(fields) {
  return {
    brand_id: BRAND_ID,
    user_id: "user-1",
    brand_name: "Test Brand",
    brand_type: "small_business",
    website_url: null,
    facebook_page_id: null,
    ad_link_url: null,
    ...fields,
  };
}

function stageBrand(brand) {
  api.getBrand.mockResolvedValue(flatBrand(brand));
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getFacebookAccounts.mockResolvedValue(accountsResponse(PAGES));
  stageBrand({});
  api.selectFacebookPage.mockResolvedValue({ success: true });
  api.updateBrand.mockResolvedValue({ success: true });
});

describe("AdsDestinationCapture", () => {
  test("zero granted Pages: honest state, reconnect affordance, Save disabled, nothing written", async () => {
    api.getFacebookAccounts.mockResolvedValue(accountsResponse([]));
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

  test("single Page: not preselected, NO write until explicit Save", async () => {
    api.getFacebookAccounts.mockResolvedValue(accountsResponse([PAGES[0]]));
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={vi.fn()} />);

    expect(await screen.findByTestId("ads-capture-single-page-note")).toBeInTheDocument();
    expect(screen.getByTestId(`ads-page-option-${PAGES[0].id}`)).not.toBeChecked();
    // Candidate visibility alone writes nothing.
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
    stageBrand({ website_url: "https://mysite.example" });
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={vi.fn()} />);

    expect(await screen.findByTestId("ads-capture-suggestion-note")).toBeInTheDocument();
    expect(screen.getByTestId("ads-destination-input")).toHaveValue("https://mysite.example");
    // Merely rendering the suggestion writes nothing.
    expect(api.updateBrand).not.toHaveBeenCalled();
  });

  test("R-C3a: Save → dedicated consented writer then reread; no generic or Store-2 write", async () => {
    const onConfigured = vi.fn();
    // Reread after save shows both values (server truth).
    api.getBrand
      .mockResolvedValueOnce(flatBrand({}))
      .mockResolvedValueOnce(
        flatBrand({ facebook_page_id: PAGES[1].id, ad_link_url: "https://example.com/offer" }),
      );
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
    expect(api.selectFacebookPage).toHaveBeenCalledWith(PAGES[1].id, BRAND_ID, {
      adLinkUrl: "https://example.com/offer", intent: "confirm_ads_destination",
    });
    expect(api.updateBrand).not.toHaveBeenCalled();
    expect(api.setFacebookBrandPage).not.toHaveBeenCalled();
    // Configuration only — the capture never launches anything and calls no
    // execute/campaign API (it doesn't even import one).
  });

  test("atomic failure is honest: retry repeats the consented writer and requires readback", async () => {
    const onConfigured = vi.fn();
    api.selectFacebookPage.mockRejectedValueOnce(new Error("That link looks malformed."));
    api.getBrand
      // initial load
      .mockResolvedValueOnce(flatBrand({}))
      // Failed writer has no success readback; retry returns both values.
      .mockResolvedValueOnce(
        flatBrand({ facebook_page_id: PAGES[0].id, ad_link_url: "https://ok.example/" }),
      );

    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={onConfigured} />);
    fireEvent.click(await screen.findByTestId(`ads-page-option-${PAGES[0].id}`));
    fireEvent.change(screen.getByTestId("ads-destination-input"), {
      target: { value: "https://ok.example/" },
    });
    fireEvent.click(screen.getByTestId("ads-destination-save"));

    // Rejection: an error shows, success is NOT declared.
    expect(await screen.findByText(/malformed/i)).toBeInTheDocument();
    expect(onConfigured).not.toHaveBeenCalled();
    expect(api.selectFacebookPage).toHaveBeenCalledTimes(1);

    // Second Save confirms both values through the same writer.
    fireEvent.click(screen.getByTestId("ads-destination-save"));
    await waitFor(() => expect(onConfigured).toHaveBeenCalled());
    expect(api.selectFacebookPage).toHaveBeenCalledTimes(2);
    expect(api.updateBrand).not.toHaveBeenCalled();
  });

  test("already configured server truth renders the honest 'set up' line, no form, no writes", async () => {
    stageBrand({ facebook_page_id: PAGES[0].id, ad_link_url: "https://done.example/" });
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

  // ---- 026-C3-PM3 additions -------------------------------------------------

  test("PM3-R5/R12: a genuine zero-page accounts response (pages: []) renders the honest reconnect state — distinguished from the old phantom-undefined defect", async () => {
    // Full real-contract shape with a REAL empty pages array (not a missing
    // field): the reconnect UI must bind to this, and only this.
    api.getFacebookAccounts.mockResolvedValue(accountsResponse([]));
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={vi.fn()} />);
    expect(await screen.findByTestId("ads-capture-zero-pages")).toBeInTheDocument();
    expect(screen.getByTestId("ads-destination-save")).toBeDisabled();
  });

  test("PM3-R2: a stored granted Page returned through the accounts contract is available in the picker", async () => {
    api.getFacebookAccounts.mockResolvedValue(
      accountsResponse([
        { id: "140006069194366", name: "South Dixie Storage", category: "Portable Building Service" },
      ]),
    );
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={vi.fn()} />);
    expect(await screen.findByTestId("ads-page-option-140006069194366")).toBeInTheDocument();
    expect(screen.getByText("South Dixie Storage")).toBeInTheDocument();
    // Candidate availability alone writes nothing (PM3-R3/R9 guard).
    expect(api.selectFacebookPage).not.toHaveBeenCalled();
    expect(api.updateBrand).not.toHaveBeenCalled();
  });

  test("PM3-R8: a stale displayed candidate rejected by Save-time validation renders the failure honestly — no fabricated success, no onConfigured", async () => {
    const onConfigured = vi.fn();
    // The candidate renders (possibly stale snapshot), but the authoritative
    // select-page writer rejects it at Save time.
    api.selectFacebookPage.mockRejectedValue(
      new Error("That Page is no longer available to this account. Reconnect Facebook and try again."),
    );
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={onConfigured} />);
    fireEvent.click(await screen.findByTestId(`ads-page-option-${PAGES[0].id}`));
    fireEvent.change(screen.getByTestId("ads-destination-input"), {
      target: { value: "https://ok.example/" },
    });
    fireEvent.click(screen.getByTestId("ads-destination-save"));

    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
    // Server truth never showed a saved Page → success is never declared.
    expect(onConfigured).not.toHaveBeenCalled();
    expect(screen.queryByTestId("ads-destination-configured")).not.toBeInTheDocument();
  });

  test("PM3-R13/R6: the capture never reads pages from the verify endpoint — verifyFacebookConnection is not even called", async () => {
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={vi.fn()} />);
    await screen.findByTestId(`ads-page-option-${PAGES[0].id}`);
    // The api mock deliberately has NO verifyFacebookConnection — if the
    // component regressed to calling it, this render would throw. The Page
    // list came exclusively from the accounts contract:
    expect(api.getFacebookAccounts).toHaveBeenCalledTimes(1);
  });

  // ---- 026-C3-PM4 additions -------------------------------------------------

  test("PM4-R9: normalized server truth counts as success — raw 'southdixiestorage.com' saved, reread returns 'https://southdixiestorage.com/', onConfigured fires with normalized truth", async () => {
    const onConfigured = vi.fn();
    api.getFacebookAccounts.mockResolvedValue(accountsResponse([PAGES[0]]));
    api.getBrand
      .mockResolvedValueOnce(flatBrand({}))
      .mockResolvedValueOnce(
        flatBrand({ facebook_page_id: PAGES[0].id, ad_link_url: "https://southdixiestorage.com/" }),
      );
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={onConfigured} />);
    fireEvent.click(await screen.findByTestId(`ads-page-option-${PAGES[0].id}`));
    fireEvent.change(screen.getByTestId("ads-destination-input"), {
      target: { value: "southdixiestorage.com" },
    });
    fireEvent.click(screen.getByTestId("ads-destination-save"));
    await waitFor(() =>
      expect(onConfigured).toHaveBeenCalledWith({
        pageId: PAGES[0].id,
        adLinkUrl: "https://southdixiestorage.com/",
      }),
    );
    // No false "didn't stick" from comparing against the owner's raw text.
    expect(screen.queryByText(/didn't stick/i)).not.toBeInTheDocument();
  });

  test("PM4-R6: rejected Page save reports error without attempting a separate destination write", async () => {
    const onConfigured = vi.fn();
    api.selectFacebookPage.mockRejectedValueOnce(new Error("Page save failed"));
    api.getBrand
      .mockResolvedValueOnce(flatBrand({}))
      .mockResolvedValueOnce(flatBrand({ ad_link_url: "https://ok.example/" }));
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={onConfigured} />);
    fireEvent.click(await screen.findByTestId(`ads-page-option-${PAGES[0].id}`));
    fireEvent.change(screen.getByTestId("ads-destination-input"), {
      target: { value: "https://ok.example/" },
    });
    fireEvent.click(screen.getByTestId("ads-destination-save"));

    expect(await screen.findByText(/page save failed/i)).toBeInTheDocument();
    expect(onConfigured).not.toHaveBeenCalled();
    expect(api.getBrand).toHaveBeenCalledTimes(1);
    expect(api.updateBrand).not.toHaveBeenCalled();
    expect(screen.queryByText(/destination didn't stick/i)).not.toBeInTheDocument();
  });

  test("PM4-R7/R8: already-configured flat truth on load renders the honest configured state with ZERO writer calls (live SDS recovery path)", async () => {
    stageBrand({
      facebook_page_id: "140006069194366",
      ad_link_url: "https://southdixiestorage.com/",
    });
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={vi.fn()} />);
    expect(await screen.findByTestId("ads-destination-configured")).toBeInTheDocument();
    expect(screen.queryByTestId("ads-destination-save")).not.toBeInTheDocument();
    // Recovery must never rewrite server truth to progress (PM4-R8).
    expect(api.selectFacebookPage).not.toHaveBeenCalled();
    expect(api.updateBrand).not.toHaveBeenCalled();
  });

  test("PM4-R4: after atomic write, FLAT authoritative reread sees both fields and declares success", async () => {
    const onConfigured = vi.fn();
    api.getBrand
      .mockResolvedValueOnce(flatBrand({}))
      .mockResolvedValueOnce(
        flatBrand({ facebook_page_id: PAGES[1].id, ad_link_url: "https://example.com/offer" }),
      );
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={onConfigured} />);
    fireEvent.click(await screen.findByTestId(`ads-page-option-${PAGES[1].id}`));
    fireEvent.change(screen.getByTestId("ads-destination-input"), {
      target: { value: "https://example.com/offer" },
    });
    fireEvent.click(screen.getByTestId("ads-destination-save"));
    await waitFor(() => expect(onConfigured).toHaveBeenCalled());
    expect(screen.queryByText(/didn't stick/i)).not.toBeInTheDocument();
  });

  test("R-C3b: changing a configured destination confirms Page and URL through the dedicated writer", async () => {
    stageBrand({ facebook_page_id: PAGES[0].id, ad_link_url: "https://old.example/" });
    const onConfigured = vi.fn();
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={onConfigured} />);
    fireEvent.click(await screen.findByRole("button", { name: "Change ads destination" }));
    fireEvent.click(screen.getByTestId(`ads-page-option-${PAGES[1].id}`));
    fireEvent.change(screen.getByTestId("ads-destination-input"), { target: { value: "https://new.example/" } });
    expect(api.selectFacebookPage).not.toHaveBeenCalled();
    stageBrand({ facebook_page_id: PAGES[1].id, ad_link_url: "https://new.example/" });
    fireEvent.click(screen.getByTestId("ads-destination-save"));
    await waitFor(() => expect(onConfigured).toHaveBeenCalledWith({
      pageId: PAGES[1].id, adLinkUrl: "https://new.example/",
    }));
    expect(api.selectFacebookPage).toHaveBeenCalledExactlyOnceWith(PAGES[1].id, BRAND_ID, {
      adLinkUrl: "https://new.example/", intent: "confirm_ads_destination",
    });
    expect(api.updateBrand).not.toHaveBeenCalled();
    expect(api.setFacebookBrandPage).not.toHaveBeenCalled();
  });

  test("R-C3c: removal cancellation writes nothing; confirmation names current Page and rereads cleared values", async () => {
    stageBrand({ facebook_page_id: PAGES[0].id, ad_link_url: "https://old.example/" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onConfigured = vi.fn();
    try {
      render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={onConfigured} />);
      fireEvent.click(await screen.findByRole("button", { name: "Remove ads destination" }));
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining(PAGES[0].id));
      expect(api.selectFacebookPage).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      stageBrand({});
      fireEvent.click(screen.getByRole("button", { name: "Remove ads destination" }));
      await screen.findByTestId("ads-destination-save");
      expect(api.selectFacebookPage).toHaveBeenCalledExactlyOnceWith(PAGES[0].id, BRAND_ID, {
        adLinkUrl: null, intent: "confirm_ads_destination", remove: true,
      });
      expect(api.getBrand).toHaveBeenCalledTimes(2);
      expect(screen.queryByTestId("ads-destination-configured")).not.toBeInTheDocument();
      expect(onConfigured).not.toHaveBeenCalled();
      expect(api.updateBrand).not.toHaveBeenCalled();
      expect(api.setFacebookBrandPage).not.toHaveBeenCalled();
    } finally {
      confirm.mockRestore();
    }
  });

  test.each(["mismatch", "missing", "read failure"])("R-C3d: %s readback never reports successful configuration", async (mode) => {
    const onConfigured = vi.fn();
    render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={onConfigured} />);
    fireEvent.click(await screen.findByTestId(`ads-page-option-${PAGES[0].id}`));
    fireEvent.change(screen.getByTestId("ads-destination-input"), { target: { value: "https://ok.example/" } });
    if (mode === "read failure") api.getBrand.mockRejectedValueOnce(new Error("Readback unavailable"));
    else stageBrand({
      facebook_page_id: mode === "mismatch" ? PAGES[1].id : null,
      ad_link_url: "https://ok.example/",
    });
    fireEvent.click(screen.getByTestId("ads-destination-save"));
    expect(await screen.findByText(mode === "read failure" ? /Readback unavailable/ : /not reflected by the server/)).toBeInTheDocument();
    expect(onConfigured).not.toHaveBeenCalled();
    expect(api.updateBrand).not.toHaveBeenCalled();
    expect(api.setFacebookBrandPage).not.toHaveBeenCalled();
  });

  test("R-C3d: removal readback still populated displays explicit failure, not fabricated removal", async () => {
    stageBrand({ facebook_page_id: PAGES[0].id, ad_link_url: "https://old.example/" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      render(<AdsDestinationCapture brandId={BRAND_ID} onConfigured={vi.fn()} />);
      fireEvent.click(await screen.findByRole("button", { name: "Remove ads destination" }));
      expect(await screen.findByText(/not reflected by the server/)).toBeInTheDocument();
      expect(screen.getByTestId("ads-destination-configured")).toBeInTheDocument();
      expect(api.updateBrand).not.toHaveBeenCalled();
      expect(api.setFacebookBrandPage).not.toHaveBeenCalled();
    } finally {
      confirm.mockRestore();
    }
  });
});
