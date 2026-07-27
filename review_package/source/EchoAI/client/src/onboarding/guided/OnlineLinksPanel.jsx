// Optional "your business online" panel on the Guided Setup business-profile
// step (Sage V2 Phase 4). Lets a new owner drop in their website + social
// links while they're already telling Echo about the business — the same
// brand fields the Sage tab's Business Links card edits (api.updateBrand,
// server-side normalize-or-400). Collapsed by default so the conversational
// step stays the star; entirely optional and safe to skip.
//
// Honesty rules match the Sage card: fields only render after a successful
// prefill (never editable-empty over unknown state), and links save only for
// the owner's first brand — if no brand exists yet (Echo hasn't created it),
// the panel says so instead of pretending to save.

import { useEffect, useState } from "react";
import { api } from "../../api.js";

const LINK_FIELDS = [
  { key: "website_url", body: "websiteUrl", label: "Website", placeholder: "e.g. https://yourbusiness.com" },
  { key: "facebook_page_url", body: "facebookPageUrl", label: "Facebook page", placeholder: "e.g. facebook.com/yourbusiness" },
  { key: "instagram_url", body: "instagramUrl", label: "Instagram", placeholder: "e.g. @yourbusiness" },
  { key: "linkedin_url", body: "linkedinUrl", label: "LinkedIn", placeholder: "e.g. linkedin.com/company/yourbusiness" },
  { key: "youtube_url", body: "youtubeUrl", label: "YouTube", placeholder: "e.g. youtube.com/@yourbusiness" },
  { key: "tiktok_url", body: "tiktokUrl", label: "TikTok", placeholder: "e.g. @yourbusiness" },
  { key: "google_business_url", body: "googleBusinessUrl", label: "Google Business profile", placeholder: "e.g. g.page/yourbusiness" },
];

export default function OnlineLinksPanel() {
  const [open, setOpen] = useState(false);
  const [brandId, setBrandId] = useState(null);
  const [values, setValues] = useState(null); // null until prefilled
  const [status, setStatus] = useState("loading"); // loading | ready | nobrand | error
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!open || values || status === "nobrand") return;
    let cancelled = false;
    setStatus("loading");
    api
      .getBrands()
      .then(async (brands) => {
        const list = Array.isArray(brands) ? brands : brands?.brands || [];
        if (cancelled) return;
        if (!list.length) {
          setStatus("nobrand");
          return;
        }
        const id = list[0].brand_id;
        const brand = await api.getBrand(id);
        if (cancelled) return;
        const next = {};
        for (const f of LINK_FIELDS) next[f.key] = brand[f.key] || "";
        setBrandId(id);
        setValues(next);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open, values, status]);

  const save = async () => {
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      const payload = {};
      for (const f of LINK_FIELDS) payload[f.body] = values[f.key] || "";
      const updated = await api.updateBrand(brandId, payload);
      const next = {};
      for (const f of LINK_FIELDS) next[f.key] = updated[f.key] || "";
      setValues(next);
      setSaved(true);
    } catch (err) {
      setSaveError(err.message || "Failed to save your links.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-semibold text-gray-200">
          Add your website &amp; social links (optional)
        </span>
        <span className="text-xs text-gray-500">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="mt-3">
          <p className="text-sm text-gray-400">
            Your AI team studies your real online presence. Add whatever you
            have — you can always do this later from the Sage tab.
          </p>
          {status === "loading" && <p className="mt-3 text-sm text-gray-500">Loading…</p>}
          {status === "nobrand" && (
            <p className="mt-3 text-sm text-gray-500">
              Finish telling Echo about your business first — once your business
              profile exists, you can add links here.
            </p>
          )}
          {status === "error" && (
            <p className="mt-3 text-sm text-red-400">
              Couldn&apos;t load your saved links right now. You can add them
              later from the Sage tab.
            </p>
          )}
          {status === "ready" && values && (
            <>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {LINK_FIELDS.map((f) => (
                  <label key={f.key} className="block text-sm">
                    <span className="text-gray-400">{f.label}</span>
                    <input
                      value={values[f.key] || ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setValues((prev) => ({ ...prev, [f.key]: v }));
                        setSaved(false);
                      }}
                      placeholder={f.placeholder}
                      className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </label>
                ))}
              </div>
              {saveError && <p className="mt-2 text-sm text-red-400">{saveError}</p>}
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:border-emerald-500 hover:text-emerald-300 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save links"}
                </button>
                {saved && <span className="text-sm text-emerald-400">Saved.</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
