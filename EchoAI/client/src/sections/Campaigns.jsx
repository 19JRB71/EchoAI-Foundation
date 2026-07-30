import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

export default function Campaigns({ brandId }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const [notice, setNotice] = useState("");
  // Prompt 015: spending cap + per-campaign delivery controls.
  const [cap, setCap] = useState(null); // { brandCapDollars, platformCapDollars, committedDollars }
  const [capInput, setCapInput] = useState("");
  const [capSaving, setCapSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    // Full-page spinner only on first load (background refreshes must not
    // unmount the inline panels).
    if (!loaded) setLoading(true);
    setError("");
    try {
      const data = await api.getCampaigns(brandId);
      setCampaigns(data.campaigns || []);
      if (brandId) {
        try {
          const capData = await api.getSpendCap(brandId);
          setCap(capData);
          if (capData.brandCapDollars != null) setCapInput(String(capData.brandCapDollars));
        } catch {
          setCap(null); // non-owner roles get 403 — hide the cap editor
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [brandId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoaded(false);
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleOptimize() {
    setOptimizing(true);
    setNotice("");
    setError("");
    try {
      const data = await api.optimizeCampaigns();
      setNotice(
        `Optimization complete — ${data.optimized || 0} campaign(s) adjusted.`
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setOptimizing(false);
    }
  }

  async function handleSaveCap() {
    setCapSaving(true);
    setNotice("");
    setError("");
    try {
      await api.setSpendCap(brandId, Number(capInput));
      setNotice(`Daily spending cap saved: $${Number(capInput).toFixed(2)}/day.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCapSaving(false);
    }
  }

  async function runAction(campaignId, fn, doneMessage) {
    setBusyId(campaignId);
    setNotice("");
    setError("");
    try {
      const data = await fn(campaignId);
      setNotice(data.message || doneMessage(data));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const handleUnpause = (id) =>
    runAction(id, api.unpauseCampaign, (d) =>
      d.state === "live"
        ? "Verified live — Facebook confirmed the whole chain is delivering."
        : "Facebook accepted the activation; awaiting verification."
    );
  const handlePause = (id) =>
    runAction(id, api.pauseCampaign, () => "Paused at Facebook — nothing is spending.");
  const handleRefresh = (id) =>
    runAction(id, api.refreshCampaignStatus, (d) =>
      d.verified
        ? `Status verified against Facebook: ${d.state === "live" ? "live" : "not delivering"}.`
        : `Could not verify right now${d.error ? ` — ${d.error}` : ""}.`
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-100">Campaigns</h2>
        <button
          onClick={handleOptimize}
          disabled={optimizing}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
        >
          {optimizing ? "Optimizing…" : "Optimize campaigns"}
        </button>
      </div>

      {brandId && cap !== null && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-100">Daily spending cap</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Campaigns cannot be enabled without a cap. Committed today:{" "}
                <span className="text-gray-300">${Number(cap.committedDollars || 0).toFixed(2)}/day</span>
                {cap.brandCapDollars != null && (
                  <> of your ${Number(cap.brandCapDollars).toFixed(2)}/day cap</>
                )}
                {cap.platformCapDollars != null && (
                  <> · platform ceiling ${Number(cap.platformCapDollars).toFixed(2)}/day</>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-lg border border-gray-700 bg-gray-800 px-2">
                <span className="text-sm text-gray-400">$</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={capInput}
                  onChange={(e) => setCapInput(e.target.value)}
                  placeholder="5"
                  className="w-20 bg-transparent px-1 py-1.5 text-sm text-gray-100 outline-none"
                />
                <span className="text-xs text-gray-500">/day</span>
              </div>
              <button
                onClick={handleSaveCap}
                disabled={capSaving || !capInput || Number(capInput) <= 0}
                className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm font-semibold text-gray-100 hover:bg-gray-600 disabled:opacity-60"
              >
                {capSaving ? "Saving…" : cap.brandCapDollars != null ? "Update cap" : "Set cap"}
              </button>
            </div>
          </div>
          {cap.brandCapDollars == null && (
            <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
              No cap set for this business yet — the $5/day pilot default is a suggestion, not
              automatic. Until you set a cap, every campaign stays paused.
            </p>
          )}
        </div>
      )}

      {notice && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {notice}
        </div>
      )}
      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading campaigns…" />
      ) : campaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 bg-gray-900/50 p-8 text-center">
          <p className="text-sm font-medium text-gray-300">No active campaigns yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
            Launch a campaign from the Ad Studio, or connect your Facebook ad
            account to sync existing campaigns here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900 shadow-sm">
          <table className="min-w-full divide-y divide-gray-800 text-sm">
            <thead className="bg-gray-800 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Budget</th>
                <th className="px-4 py-3">Cost / lead</th>
                <th className="px-4 py-3">Conversion rate</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Delivery</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {campaigns.map((c) => (
                <tr key={c.campaignId}>
                  <td className="px-4 py-3 font-medium text-gray-100">
                    {c.name || "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {formatMoney(c.budget)}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {c.costPerLead != null ? formatMoney(c.costPerLead) : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {c.conversionRate != null ? `${c.conversionRate}%` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={c.status} activationPending={c.activationPending} />
                  </td>
                  <td className="px-4 py-3">
                    <DeliveryControls
                      campaign={c}
                      busy={busyId === c.campaignId}
                      onUnpause={handleUnpause}
                      onPause={handlePause}
                      onRefresh={handleRefresh}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DeliveryControls({ campaign: c, busy, onUnpause, onPause, onRefresh }) {
  if (c.status !== "created_paused" && c.status !== "live") {
    return <span className="text-xs text-gray-600">—</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {c.status === "created_paused" && !c.activationPending && (
        <button
          onClick={() => onUnpause(c.campaignId)}
          disabled={busy}
          className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
        >
          {busy ? "Working…" : "Enable"}
        </button>
      )}
      {(c.status === "live" || c.activationPending) && (
        <button
          onClick={() => onPause(c.campaignId)}
          disabled={busy}
          className="rounded-md bg-gray-700 px-2.5 py-1 text-xs font-semibold text-gray-100 hover:bg-gray-600 disabled:opacity-60"
        >
          {busy ? "Working…" : "Pause"}
        </button>
      )}
      <button
        onClick={() => onRefresh(c.campaignId)}
        disabled={busy}
        title="Ask Facebook for the real delivery state (read-only check)"
        className="rounded-md border border-gray-700 px-2.5 py-1 text-xs font-semibold text-gray-400 hover:bg-gray-800 disabled:opacity-60"
      >
        Refresh status
      </button>
    </div>
  );
}

function StatusPill({ status, activationPending }) {
  // Honest lifecycle states (Prompt 005): a campaign is only ever "Live" after
  // a Facebook read-back confirmed the whole chain is ACTIVE. Prompt 015 adds
  // the activation-pending distinction: Facebook ACCEPTED our activation
  // request but the read-back has not verified delivery yet — that is NOT the
  // same as "intentionally paused", and never conflated with it.
  if (status === "created_paused" && activationPending) {
    return (
      <span className="inline-block rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
        Activation pending — Facebook accepted, not verified live yet
      </span>
    );
  }
  const LABELS = {
    live: "Live",
    created_paused: "Created (paused at Facebook — will not spend until enabled)",
    launch_failed: "Launch failed",
    draft: "Draft",
    approved: "Approved",
    completed: "Completed",
    failed: "Failed",
  };
  const styles =
    status === "live"
      ? "bg-green-100 text-green-700"
      : status === "created_paused"
        ? "bg-amber-100 text-amber-700"
        : status === "launch_failed" || status === "failed"
          ? "bg-red-100 text-red-700"
          : "bg-gray-800 text-gray-400";
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles}`}>
      {LABELS[status] || status || "unknown"}
    </span>
  );
}

function formatMoney(value) {
  if (value == null) return "—";
  const n = Number(value);
  return Number.isNaN(n) ? String(value) : `$${n.toFixed(2)}`;
}
