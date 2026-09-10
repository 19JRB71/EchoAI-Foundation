// 026-C3 (I-62) — shared ads-destination capture.
//
// ONE component, used by BOTH hosts:
//   HOST 1: ConnectionsStep (guided wizard) — right after Facebook connects,
//           or whenever Facebook is connected but the ads config is missing.
//   HOST 2: SetupAgent's Step-6 owner_action_required / missing_ad_destination
//           pause panel.
//
// Page candidates (026-C3-PM3): read from the EXISTING accounts endpoint,
//   api.getFacebookAccounts() → GET /api/facebook/accounts,
// which exposes the Store-1 (api_integrations.facebook_pages) granted-page
// authority. /api/facebook/verify stays a health/status contract ({ok,checks})
// and is NOT read here. Reconnect is the owner's refresh mechanism; a stale
// candidate is allowed to render and is rejected honestly at Save time by the
// existing select-page validation.
//
// It configures STORE 3 ONLY (brands.facebook_page_id + brands.ad_link_url),
// through the EXISTING product writers:
//   Page:        api.selectFacebookPage(pageId, brandId)  → POST /api/facebook/select-page
//   Destination: api.updateBrand(brandId, { adLinkUrl })  → PUT  /api/brands/:brandId
// No direct DB writes, no new route, no new store. It never touches
// social_accounts (STORE 2) and never reads page_ref as truth.
//
// Owner-authority contract (§F/§G):
//   - zero granted Pages  → honest state + reconnect affordance, never fabricate;
//   - one granted Page    → visibly preselected, NO write until explicit Save;
//   - many granted Pages  → explicit choice required;
//   - website_url         → visible "suggested" prefill only, never silently
//                           copied into ad_link_url;
//   - nothing is written until the single explicit "Save & continue".
//
// Save semantics (§H): Page write → destination write → authoritative server
// reread → onConfigured ONLY when server truth shows both values. Partial
// failure is honest: a saved Page stays saved (no rollback theater), the
// missing half is reported exactly, and the next Save skips the write that
// server truth already shows (no duplicate Page writes).

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api.js";

export default function AdsDestinationCapture({
  brandId: brandIdProp,
  onConfigured,
  onReconnectFacebook,
  compact = false,
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [brandId, setBrandId] = useState(brandIdProp || null);
  const [pages, setPages] = useState([]);
  const [savedPageId, setSavedPageId] = useState(null); // server truth
  const [savedLink, setSavedLink] = useState(null); // server truth
  const [websiteSuggestion, setWebsiteSuggestion] = useState("");
  const [pageChoice, setPageChoice] = useState(null);
  const [link, setLink] = useState("");
  const [linkTouched, setLinkTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState("");
  const [linkError, setLinkError] = useState("");
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  // ---- Load current server truth (brand + granted Pages) -------------------
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      let bid = brandIdProp || null;
      if (!bid) {
        // Host 1 (guided wizard) has no session-bound brand prop — resolve the
        // owner's active brand from the server (ownership enforced there).
        const active = await api.getActiveBrand().catch(() => null);
        bid = active && (active.brandId || (active.brand && active.brand.brand_id));
        if (!bid) {
          const list = await api.getBrands();
          const brands = Array.isArray(list) ? list : list.brands || [];
          bid = brands[0] && (brands[0].brand_id || brands[0].brandId);
        }
      }
      if (!bid) {
        if (activeRef.current) {
          setLoadError("No business profile exists yet — finish the earlier setup steps first.");
          setLoading(false);
        }
        return;
      }
      // 026-C3-PM3: Page candidates come from GET /api/facebook/accounts
      // (facebookOAuthController.getConnectedAccounts) — the Store-1
      // granted-page authority. Its real response shape is bound by the server
      // contract regression in test/facebookAccountsContract.test.js:
      //   { configured, connected, connectionStatus, accounts,
      //     selectedAccountId, pages: [{ id, name, category }], selectedPageId }
      // The previous read (verify.pages from /api/facebook/verify) was a
      // phantom field — that endpoint returns only { ok, checks } and never a
      // Page list, so the picker was unconditionally empty.
      const [brandRes, accountsRes] = await Promise.all([
        api.getBrand(bid),
        api.getFacebookAccounts().catch(() => null),
      ]);
      if (!activeRef.current) return;
      const brand = brandRes && (brandRes.brand || brandRes);
      const granted =
        (accountsRes && Array.isArray(accountsRes.pages) && accountsRes.pages) || [];
      setBrandId(bid);
      setPages(granted);
      const curPage = brand && brand.facebook_page_id ? brand.facebook_page_id : null;
      const curLink = brand && brand.ad_link_url ? brand.ad_link_url : null;
      const website = brand && brand.website_url ? brand.website_url : "";
      setSavedPageId(curPage);
      setSavedLink(curLink);
      setWebsiteSuggestion(website);
      // Preselect ONLY from saved truth, or (visibly) when exactly one Page is
      // granted. Never auto-select among many, never from page_ref/history.
      setPageChoice(curPage || (granted.length === 1 ? granted[0].id : null));
      setLink((prev) => (linkTouched ? prev : curLink || website || ""));
      setLoading(false);
    } catch (err) {
      if (!activeRef.current) return;
      setLoadError(err.message || "Couldn't load your Facebook Pages right now.");
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandIdProp]);

  useEffect(() => {
    load();
  }, [load]);

  // ---- Explicit Save & continue --------------------------------------------
  async function save() {
    if (saving || loading) return;
    setPageError("");
    setLinkError("");
    const trimmed = (link || "").trim();
    let ok = true;
    if (!pageChoice) {
      setPageError("Choose the Facebook Page your ads will run from.");
      ok = false;
    }
    if (!trimmed || !/^(https?:\/\/)?[^\s]+\.[^\s]{2,}/i.test(trimmed)) {
      setLinkError("Enter the web address customers should land on (e.g. https://yourbusiness.com).");
      ok = false;
    }
    if (!ok) return;
    setSaving(true);
    let pageSaved = savedPageId === pageChoice; // §H: never duplicate a write server truth already shows
    try {
      if (!pageSaved) {
        try {
          await api.selectFacebookPage(pageChoice, brandId);
          pageSaved = true;
        } catch (err) {
          setPageError(err.message || "Couldn't save that Page choice. Try again.");
        }
      }
      let linkSaved = false;
      try {
        await api.updateBrand(brandId, { adLinkUrl: trimmed });
        linkSaved = true;
      } catch (err) {
        setLinkError(err.message || "That web address couldn't be saved. Check it and try again.");
      }
      // Authoritative reread — success is only ever declared from server truth.
      // 026-C3-PM4: GET /api/brands/:brandId returns a FLAT brand row (no
      // { brand } wrapper) that now includes facebook_page_id and ad_link_url;
      // shape bound by the real-contract regression in
      // test/brandProfileContract.test.js. The server may return a NORMALIZED
      // destination (e.g. "southdixiestorage.com" → "https://southdixiestorage.com/");
      // normalized truth counts as success — never compare against raw input.
      const brandRes = await api.getBrand(brandId).catch(() => null);
      const brand = brandRes && (brandRes.brand || brandRes);
      const truthPage = brand && brand.facebook_page_id ? brand.facebook_page_id : null;
      const truthLink = brand && brand.ad_link_url ? brand.ad_link_url : null;
      if (!activeRef.current) return;
      setSavedPageId(truthPage);
      setSavedLink(truthLink);
      if (truthPage && truthLink) {
        if (typeof onConfigured === "function") onConfigured({ pageId: truthPage, adLinkUrl: truthLink });
      } else {
        // Honest partial state: say exactly what remains, keep what saved.
        if (!truthPage && pageSaved) setPageError("The Page choice didn't stick — please try again.");
        if (!truthLink && linkSaved) setLinkError("The destination didn't stick — please try again.");
      }
    } finally {
      if (activeRef.current) setSaving(false);
    }
  }

  // ---- Render ---------------------------------------------------------------
  const box = compact
    ? "mt-4 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4"
    : "mt-6 rounded-2xl border border-sky-500/30 bg-sky-500/5 p-6";

  if (loading) {
    return (
      <div className={box} data-testid="ads-destination-capture">
        <p className="text-sm text-white/60">Checking your Facebook Pages…</p>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className={box} data-testid="ads-destination-capture">
        <p className="text-sm text-red-300">{loadError}</p>
        <button
          type="button"
          onClick={load}
          className="mt-3 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"
        >
          Try again
        </button>
      </div>
    );
  }
  if (savedPageId && savedLink) {
    return (
      <div className={box} data-testid="ads-destination-capture">
        <p className="text-sm text-emerald-200" data-testid="ads-destination-configured">
          Ads are set up: Page selected and clicks go to{" "}
          <span className="font-semibold break-all">{savedLink}</span>.
        </p>
      </div>
    );
  }

  return (
    <div className={box} data-testid="ads-destination-capture">
      <h3 className="font-semibold text-sky-200">Set up where your ads run</h3>
      <p className="mt-1 text-sm text-white/70">
        Two quick choices so your ads can ever go live: the Facebook Page they run from, and
        where a click should take people. Nothing is saved until you press Save.
      </p>

      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.15em] text-white/50">
        Facebook Page for ads
      </p>
      {pages.length === 0 ? (
        <div className="mt-2" data-testid="ads-capture-zero-pages">
          <p className="text-sm text-amber-200">
            Your connected Facebook account has no Pages Echo can use. Create a Page on
            Facebook, or reconnect and grant access to the Page you want.
          </p>
          {typeof onReconnectFacebook === "function" ? (
            <button
              type="button"
              onClick={onReconnectFacebook}
              className="mt-3 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"
            >
              Reconnect Facebook
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 space-y-2" role="radiogroup" aria-label="Facebook Page for ads">
          {pages.length === 1 ? (
            <p className="text-xs text-white/50" data-testid="ads-capture-single-page-note">
              This is the only Page on your account — confirm it below.
            </p>
          ) : null}
          {pages.map((p) => (
            <label
              key={p.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm"
            >
              <input
                type="radio"
                name="ads-page"
                checked={pageChoice === p.id}
                onChange={() => setPageChoice(p.id)}
                data-testid={`ads-page-option-${p.id}`}
              />
              <span className="font-medium">{p.name || p.id}</span>
            </label>
          ))}
        </div>
      )}
      {pageError ? <p className="mt-2 text-sm text-red-300">{pageError}</p> : null}

      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.15em] text-white/50">
        Where should a click take people?
      </p>
      {websiteSuggestion && !savedLink ? (
        <p className="mt-1 text-xs text-white/50" data-testid="ads-capture-suggestion-note">
          Suggested from your website — confirm it or change it. It isn&apos;t saved until you
          press Save.
        </p>
      ) : null}
      <input
        type="url"
        value={link}
        onChange={(e) => {
          setLink(e.target.value);
          setLinkTouched(true);
        }}
        placeholder="https://yourbusiness.com"
        className="mt-2 w-full rounded-lg border border-white/10 bg-white/[0.05] p-3 text-sm text-white placeholder-white/30"
        data-testid="ads-destination-input"
      />
      {linkError ? <p className="mt-2 text-sm text-red-300">{linkError}</p> : null}

      <div className="mt-4">
        <button
          type="button"
          onClick={save}
          disabled={saving || pages.length === 0}
          className="rounded-lg bg-teal-500 px-5 py-2.5 font-semibold text-black hover:bg-teal-400 disabled:opacity-50"
          data-testid="ads-destination-save"
        >
          {saving ? "Saving…" : "Save & continue"}
        </button>
      </div>
    </div>
  );
}
