import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const CAMPAIGN_GOALS = [
  { value: "lead_generation", label: "Lead Generation" },
  { value: "sales", label: "Sales" },
  { value: "brand_awareness", label: "Brand Awareness" },
  { value: "traffic", label: "Traffic" },
  { value: "engagement", label: "Engagement" },
];

const TABS = [
  { key: "generate", label: "Generate" },
  { key: "library", label: "Creative Library" },
  { key: "performance", label: "Performance" },
];

function goalLabel(value) {
  return CAMPAIGN_GOALS.find((g) => g.value === value)?.label || value || "—";
}

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function money(value) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : "—";
}

export default function AdStudio({ brandId }) {
  const [tab, setTab] = useState("generate");

  if (!brandId) {
    return (
      <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900 p-8 text-center">
        <p className="text-sm text-gray-400">
          Select a brand to start designing AI ad creative.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-100">Ad Creative Studio</h1>
        <p className="mt-1 text-sm text-gray-400">
          Generate complete, on-brand ad creative packages, launch them straight to
          Facebook, and track which concepts perform best.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${
              tab === t.key
                ? "border-amber-500 text-amber-400"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "generate" && <GenerateTab brandId={brandId} onSaved={() => setTab("library")} />}
      {tab === "library" && <LibraryTab brandId={brandId} />}
      {tab === "performance" && <PerformanceTab brandId={brandId} />}
    </div>
  );
}

function GenerateTab({ brandId, onSaved }) {
  const [campaignGoal, setCampaignGoal] = useState("lead_generation");
  const [budgetRange, setBudgetRange] = useState("");
  const [productFocus, setProductFocus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [packages, setPackages] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function generate(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    setPackages(null);
    try {
      const data = await api.generateAdCreatives({
        brandId,
        campaignGoal,
        budgetRange: budgetRange.trim() || undefined,
        productFocus: productFocus.trim() || undefined,
      });
      setPackages(data.packages || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await api.saveAdCreative({
        brandId,
        campaignGoal,
        packages,
        budgetRange: budgetRange.trim() || undefined,
        productFocus: productFocus.trim() || undefined,
      });
      setNotice("Saved to your Creative Library.");
      setPackages(null);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={generate} className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <ErrorBanner message={error} />
        {notice && (
          <div className="mb-4 rounded-lg border border-green-700 bg-green-900/30 px-4 py-2 text-sm text-green-300">
            {notice}
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">Campaign goal</label>
            <select
              value={campaignGoal}
              onChange={(e) => setCampaignGoal(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
            >
              {CAMPAIGN_GOALS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              Budget range (optional)
            </label>
            <input
              value={budgetRange}
              onChange={(e) => setBudgetRange(e.target.value)}
              placeholder="e.g. $500–$1,000 / month"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              Product / offer focus (optional)
            </label>
            <input
              value={productFocus}
              onChange={(e) => setProductFocus(e.target.value)}
              placeholder="e.g. Spring membership promo"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-50"
          >
            {loading ? "Generating…" : "Generate 5 Creative Packages"}
          </button>
        </div>
        {loading && (
          <p className="mt-3 text-xs text-gray-400">
            The AI Ad Creative Director is designing five distinct, on-brand concepts.
            This can take a moment…
          </p>
        )}
      </form>

      {packages && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-100">
              Preview — {packages.length} creative packages
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => setPackages(null)}
                disabled={saving}
                className="rounded-lg border border-gray-800 px-3 py-1.5 text-sm font-medium text-gray-400 hover:bg-gray-800 disabled:opacity-50"
              >
                Discard
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save to Library"}
              </button>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {packages.map((pkg, i) => (
              <PackageCard key={i} pkg={pkg} index={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PackageCard({ pkg, index }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-amber-400">
          {pkg.conceptName || `Concept ${index + 1}`}
        </span>
        {pkg.angle && (
          <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-[11px] font-medium text-gray-300">
            {pkg.angle}
          </span>
        )}
      </div>

      <p className="text-base font-bold text-gray-100">{pkg.headline}</p>

      <Field label="Ad copy">
        <ul className="space-y-1.5">
          {(pkg.bodyCopyVariations || []).map((c, i) => (
            <li key={i} className="rounded-lg bg-gray-800/60 px-3 py-2 text-sm text-gray-200">
              {c}
            </li>
          ))}
        </ul>
      </Field>

      <Field label="Image concept">
        <p className="text-sm text-gray-300">{pkg.imageDescription}</p>
      </Field>

      {pkg.videoScript && (
        <Field label="Video script">
          <div className="space-y-1 text-sm text-gray-300">
            <p>
              <span className="text-gray-500">Hook:</span> {pkg.videoScript.hook}
            </p>
            {Array.isArray(pkg.videoScript.scenes) && (
              <ol className="ml-4 list-decimal space-y-0.5">
                {pkg.videoScript.scenes.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            )}
            {pkg.videoScript.cta && (
              <p>
                <span className="text-gray-500">CTA:</span> {pkg.videoScript.cta}
              </p>
            )}
          </div>
        </Field>
      )}

      {pkg.audienceTargeting && (
        <Field label="Audience">
          <p className="text-sm text-gray-300">{pkg.audienceTargeting.description}</p>
          <p className="mt-1 text-xs text-gray-500">
            {[
              pkg.audienceTargeting.ageMin && pkg.audienceTargeting.ageMax
                ? `Ages ${pkg.audienceTargeting.ageMin}–${pkg.audienceTargeting.ageMax}`
                : null,
              Array.isArray(pkg.audienceTargeting.interests) &&
              pkg.audienceTargeting.interests.length
                ? `Interests: ${pkg.audienceTargeting.interests.join(", ")}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </Field>
      )}

      {Array.isArray(pkg.recommendedPlacements) && pkg.recommendedPlacements.length > 0 && (
        <Field label="Placements">
          <div className="flex flex-wrap gap-1.5">
            {pkg.recommendedPlacements.map((p, i) => (
              <span
                key={i}
                className="rounded-full border border-gray-700 px-2.5 py-0.5 text-[11px] text-gray-300"
              >
                {p}
              </span>
            ))}
          </div>
        </Field>
      )}

      {pkg.callToAction && (
        <div className="mt-3">
          <span className="inline-block rounded-lg bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300">
            CTA: {pkg.callToAction}
          </span>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      {children}
    </div>
  );
}

function LibraryTab({ brandId }) {
  const [creatives, setCreatives] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [launchTarget, setLaunchTarget] = useState(null); // { creative, packageIndex }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getAdCreatives(brandId);
      setCreatives(data.creatives || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Spinner label="Loading creative library…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      {notice && (
        <div className="rounded-lg border border-green-700 bg-green-900/30 px-4 py-2 text-sm text-green-300">
          {notice}
        </div>
      )}

      {creatives.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900 p-8 text-center">
          <p className="text-sm text-gray-400">
            No saved creatives yet. Generate a set on the Generate tab and save it here.
          </p>
        </div>
      ) : (
        creatives.map((c) => (
          <CreativeRow
            key={c.creative_id}
            creative={c}
            onLaunch={(packageIndex) => setLaunchTarget({ creative: c, packageIndex })}
          />
        ))
      )}

      {launchTarget && (
        <LaunchModal
          target={launchTarget}
          onClose={() => setLaunchTarget(null)}
          onLaunched={async () => {
            setLaunchTarget(null);
            setNotice("Creative launched to Facebook (paused for review).");
            await load();
          }}
        />
      )}
    </div>
  );
}

function CreativeRow({ creative, onLaunch }) {
  const [expanded, setExpanded] = useState(false);
  const concept = creative.creative_concept || {};
  const packages = Array.isArray(concept.packages) ? concept.packages : [];
  const launched = creative.status === "launched";

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-100">
            {goalLabel(creative.campaign_goal)}
          </span>
          <span className="text-xs text-gray-500">{packages.length} concepts</span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              launched ? "bg-green-500/15 text-green-400" : "bg-gray-800 text-gray-400"
            }`}
          >
            {creative.status}
          </span>
          {concept.productFocus && (
            <span className="text-xs text-gray-500">Focus: {concept.productFocus}</span>
          )}
        </div>
        <span className="text-xs text-gray-500">{expanded ? "Hide" : "View"}</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-800 p-4">
          {launched && creative.launched_package && (
            <div className="mb-4 rounded-lg border border-green-700/50 bg-green-900/20 px-3 py-2 text-sm text-green-300">
              Launched concept: <strong>{creative.launched_package.headline}</strong>
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {packages.map((pkg, i) => (
              <div key={i}>
                <PackageCard pkg={pkg} index={i} />
                {!launched && (
                  <button
                    onClick={() => onLaunch(i)}
                    className="mt-2 w-full rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-amber-600"
                  >
                    Launch this concept
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LaunchModal({ target, onClose, onLaunched }) {
  const { creative, packageIndex } = target;
  const pkg = (creative.creative_concept?.packages || [])[packageIndex] || {};
  const [budget, setBudget] = useState("25");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");

  async function launch() {
    const amount = Number(budget);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid daily budget.");
      return;
    }
    setLaunching(true);
    setError("");
    try {
      await api.launchAdCreative({
        creativeId: creative.creative_id,
        packageIndex,
        budget: amount,
      });
      onLaunched();
    } catch (err) {
      setError(err.message);
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-xl">
        <h3 className="text-sm font-semibold text-gray-100">Launch creative to Facebook</h3>
        <p className="mt-1 text-xs text-gray-400">
          Launching “{pkg.conceptName || pkg.headline}” as a new {goalLabel(creative.campaign_goal)}{" "}
          campaign. It is created <strong>paused</strong> so you can review it in Ads Manager
          before it spends.
        </p>

        <ErrorBanner message={error} />

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-gray-400">
            Daily budget (USD)
          </label>
          <input
            type="number"
            min="1"
            step="1"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={launching}
            className="rounded-lg border border-gray-800 px-3 py-1.5 text-sm font-medium text-gray-400 hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={launch}
            disabled={launching}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-50"
          >
            {launching ? "Launching…" : "Launch"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PerformanceTab({ brandId }) {
  const [creatives, setCreatives] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getAdCreativePerformance(brandId);
      setCreatives(data.creatives || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  const ranked = useMemo(() => {
    return [...creatives].sort((a, b) => {
      const al = a.performance?.leads ?? -1;
      const bl = b.performance?.leads ?? -1;
      return bl - al;
    });
  }, [creatives]);

  if (loading) return <Spinner label="Loading performance…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          Real Facebook metrics for launched creatives (last 7 days), refreshed weekly.
        </p>
        <button
          onClick={load}
          className="rounded-lg border border-gray-800 px-3 py-1.5 text-sm font-medium text-gray-400 hover:bg-gray-800"
        >
          Refresh
        </button>
      </div>

      <ErrorBanner message={error} />

      {ranked.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900 p-8 text-center">
          <p className="text-sm text-gray-400">
            No launched creatives yet. Launch a concept from your Creative Library to start
            tracking performance.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="min-w-full divide-y divide-gray-800 text-sm">
            <thead className="bg-gray-800 text-left text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-2">Concept</th>
                <th className="px-4 py-2">Goal</th>
                <th className="px-4 py-2 text-right">Spend</th>
                <th className="px-4 py-2 text-right">Impr.</th>
                <th className="px-4 py-2 text-right">Clicks</th>
                <th className="px-4 py-2 text-right">Leads</th>
                <th className="px-4 py-2 text-right">Cost / Lead</th>
                <th className="px-4 py-2 text-right">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {ranked.map((c, i) => {
                const p = c.performance || {};
                const best = i === 0 && (p.leads ?? 0) > 0;
                return (
                  <tr key={c.creativeId} className={best ? "bg-amber-500/5" : ""}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-100">
                        {c.concept?.headline || c.concept?.conceptName || "—"}
                      </div>
                      {c.concept?.angle && (
                        <div className="text-xs text-gray-500">{c.concept.angle}</div>
                      )}
                      {best && (
                        <span className="mt-1 inline-block rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                          Top performer
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-300">{goalLabel(c.campaignGoal)}</td>
                    <td className="px-4 py-3 text-right text-gray-300">{money(p.spend)}</td>
                    <td className="px-4 py-3 text-right text-gray-300">
                      {p.impressions ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">{p.clicks ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-100">
                      {p.leads ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">{money(p.costPerLead)}</td>
                    <td className="px-4 py-3 text-right text-xs text-gray-500">
                      {formatDateTime(c.updatedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
