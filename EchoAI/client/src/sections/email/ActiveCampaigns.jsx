import { useEffect, useState, useCallback } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import EmailSequenceView from "./EmailSequenceView.jsx";

const STATUS_STYLES = {
  draft: "bg-gray-500/15 text-gray-300",
  active: "bg-amber-500/15 text-amber-300",
  completed: "bg-green-500/15 text-green-400",
};

function StatusBadge({ status }) {
  const cls = STATUS_STYLES[status] || STATUS_STYLES.draft;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls}`}
    >
      {status}
    </span>
  );
}

export default function ActiveCampaigns({ brandId, refreshKey }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getEmailCampaigns(brandId);
      setCampaigns(data.campaigns || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function handleSend(campaign) {
    setSendingId(campaign.campaignId);
    setError("");
    setNotice("");
    try {
      const res = await api.sendEmailCampaign(campaign.campaignId);
      setNotice(
        `Sent email ${res.step} of ${res.totalEmails} to ${res.sent} lead${
          res.sent === 1 ? "" : "s"
        }${res.failed ? ` (${res.failed} failed)` : ""}.`
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingId(null);
    }
  }

  if (selected) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelected(null)}
          className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-gray-800"
        >
          ← Back to campaigns
        </button>
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-100">
              {selected.campaignName}
            </h3>
            <StatusBadge status={selected.status} />
          </div>
          <EmailSequenceView emails={selected.emailSequence} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      {notice && (
        <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-400">
          {notice}
        </p>
      )}

      {loading ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400 shadow-sm">
          Loading campaigns…
        </div>
      ) : campaigns.length === 0 ? (
        <p className="text-sm text-gray-400">
          No campaigns yet. Create one in the Campaign Generator and click Save
          Campaign.
        </p>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => {
            const pct = c.emailCount
              ? Math.round((c.sentCount / c.emailCount) * 100)
              : 0;
            const done = c.sentCount >= c.emailCount;
            return (
              <div
                key={c.campaignId}
                className="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button
                    onClick={() => setSelected(c)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-gray-100">
                        {c.campaignName}
                      </p>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-gray-400">
                      {c.goal} · {c.emailCount} email
                      {c.emailCount === 1 ? "" : "s"}
                    </p>
                  </button>
                  <button
                    onClick={() => handleSend(c)}
                    disabled={done || sendingId === c.campaignId}
                    className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-50"
                  >
                    {done
                      ? "Sequence complete"
                      : sendingId === c.campaignId
                        ? "Sending…"
                        : "Send Next Email"}
                  </button>
                </div>

                <div>
                  <div className="mb-1 flex justify-between text-xs text-gray-400">
                    <span>
                      {c.sentCount} of {c.emailCount} sent
                    </span>
                    <span>{pct}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                    <div
                      className="h-full rounded-full bg-amber-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
