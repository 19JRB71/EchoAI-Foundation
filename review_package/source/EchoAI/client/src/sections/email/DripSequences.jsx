import { useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { SEGMENTS, segmentLabel, pct, statusBadgeClass } from "./emailShared.js";

export default function DripSequences({ brandId, refreshKey, onChange }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const loadedOnce = useRef(false);

  async function load() {
    // Only show the full-page loading state on the first load. Background
    // refreshes (e.g. after retrying a failed recipient) must NOT swap the list
    // for a spinner, or they unmount the failed-recipient panel and instantly
    // wipe its "Queued for retry" confirmation before the owner can see it.
    if (!loadedOnce.current) setLoading(true);
    setError("");
    try {
      const data = await api.getEmailCampaigns(brandId);
      setCampaigns((data.campaigns || []).filter((c) => c.campaignType === "drip"));
    } catch (err) {
      setError(err.message);
    } finally {
      loadedOnce.current = true;
      setLoading(false);
    }
  }

  useEffect(() => {
    if (brandId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, refreshKey]);

  return (
    <div className="space-y-6">
      {creating ? (
        <DripForm
          brandId={brandId}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
            onChange && onChange();
          }}
        />
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400"
        >
          + New Drip Sequence
        </button>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading ? (
        <p className="text-sm text-gray-400">Loading sequences…</p>
      ) : campaigns.length === 0 ? (
        <p className="text-sm text-gray-400">No drip sequences yet.</p>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <DripRow
              key={c.campaignId}
              campaign={c}
              onChanged={() => {
                load();
                onChange && onChange();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DripRow({ campaign, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showFailed, setShowFailed] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);

  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn(campaign.campaignId);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function retryAllFailed() {
    setRetryingAll(true);
    setError("");
    try {
      await api.retryAllFailedEmailDripRecipients(campaign.campaignId);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setRetryingAll(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-gray-100">{campaign.campaignName}</h4>
            <span className={`rounded-full px-2 py-0.5 text-xs ${statusBadgeClass(campaign.status)}`}>
              {campaign.status === "sending" ? "active" : campaign.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            {segmentLabel(campaign.segment)} · {campaign.recipientCount} enrolled
          </p>
        </div>
        <div className="flex gap-2">
          {campaign.status === "sending" && (
            <button
              onClick={() => act(api.pauseEmailCampaign)}
              disabled={busy}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              Pause
            </button>
          )}
          {campaign.status === "paused" && (
            <button
              onClick={() => act(api.resumeEmailCampaign)}
              disabled={busy}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
            >
              Resume
            </button>
          )}
          <button
            onClick={() => act(api.cancelEmailCampaign)}
            disabled={busy}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-center text-sm">
        <Stat label="Sent" value={campaign.sentCount} />
        <Stat label="Opens" value={`${campaign.openCount} (${pct(campaign.openRate)})`} />
        <Stat label="Clicks" value={`${campaign.clickCount} (${pct(campaign.clickRate)})`} />
      </div>
      {campaign.failedCount > 0 && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowFailed((v) => !v)}
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20"
            >
              {showFailed
                ? "Hide failed recipients"
                : `${campaign.failedCount} failed recipient${campaign.failedCount === 1 ? "" : "s"} — view & retry`}
            </button>
            <button
              onClick={retryAllFailed}
              disabled={retryingAll}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
            >
              {retryingAll ? "Retrying all…" : "Retry all failed"}
            </button>
          </div>
          {showFailed && (
            <FailedRecipients campaignId={campaign.campaignId} onRetried={onChanged} />
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

/**
 * Lists a drip sequence's failed recipients with a one-tap Retry that flips
 * each back to pending so the next hourly drip run re-attempts delivery.
 */
function FailedRecipients({ campaignId, onRetried }) {
  const [recipients, setRecipients] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [retriedIds, setRetriedIds] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getEmailCampaignDetail(campaignId);
        if (!cancelled) {
          setRecipients(
            (data.recipients || []).filter((r) => r.delivery_status === "failed")
          );
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  async function retry(recipientId) {
    setBusyId(recipientId);
    setError("");
    try {
      await api.retryEmailDripRecipient(campaignId, recipientId);
      setRetriedIds((ids) => [...ids, recipientId]);
      onRetried && onRetried();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (error && !recipients) {
    return <p className="mt-2 text-xs text-red-400">{error}</p>;
  }
  if (!recipients) {
    return <p className="mt-2 text-xs text-gray-400">Loading failed recipients…</p>;
  }
  if (recipients.length === 0) {
    return (
      <p className="mt-2 text-xs text-gray-400">
        No failed recipients right now — they may have already been retried.
      </p>
    );
  }

  // Split hard bounces / invalid addresses (retrying won't help — fix the
  // contact first) from transient failures (SMTP outage / blip — safe to
  // retry). Unclassified rows (send_error_permanent null) fall in with the
  // safe-to-retry group so owners aren't discouraged from retrying them.
  const permanent = recipients.filter((r) => r.send_error_permanent === true);
  const transient = recipients.filter((r) => r.send_error_permanent !== true);

  const renderRow = (r) => {
    const retried = retriedIds.includes(r.recipient_id);
    const isPermanent = r.send_error_permanent === true;
    return (
      <div
        key={r.recipient_id}
        className={[
          "flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
          isPermanent
            ? "border-red-500/30 bg-red-500/5"
            : "border-amber-500/30 bg-amber-500/5",
        ].join(" ")}
      >
        <div className="min-w-0">
          <p className="truncate text-xs text-gray-200">{r.email_address}</p>
          <p className="text-[11px] text-gray-500">
            Stopped at email {(r.current_step || 0) + 1}
          </p>
          <p
            className={[
              "mt-0.5 truncate text-[11px]",
              isPermanent ? "text-red-300" : "text-amber-300",
            ].join(" ")}
          >
            {r.send_error ? `Reason: ${r.send_error}` : "Reason unavailable"}
          </p>
        </div>
        {retried ? (
          <span className="shrink-0 text-xs font-medium text-emerald-400">
            Queued for retry
          </span>
        ) : (
          <button
            onClick={() => retry(r.recipient_id)}
            disabled={busyId === r.recipient_id}
            className="shrink-0 rounded-lg bg-amber-500 px-3 py-1 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
          >
            {busyId === r.recipient_id ? "Retrying…" : "Retry"}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="mt-2 space-y-4">
      {permanent.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-300">
            Won't send on retry — fix these first ({permanent.length})
          </p>
          <p className="mb-2 text-[11px] text-gray-500">
            These bounced for a permanent reason (invalid or non-existent
            address). Retrying will fail again until you fix or remove the
            contact.
          </p>
          <div className="space-y-1.5">{permanent.map(renderRow)}</div>
        </div>
      )}
      {transient.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
            Temporary problem — safe to retry ({transient.length})
          </p>
          <p className="mb-2 text-[11px] text-gray-500">
            These hit a temporary issue (mail-server outage or a network blip).
            Retrying should deliver them.
          </p>
          <div className="space-y-1.5">{transient.map(renderRow)}</div>
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-gray-800/50 px-2 py-2">
      <div className="text-gray-100">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function DripForm({ brandId, onCancel, onCreated }) {
  const [campaignName, setCampaignName] = useState("");
  const [goal, setGoal] = useState("");
  const [segment, setSegment] = useState("all");
  const [numEmails, setNumEmails] = useState(5);
  const [emails, setEmails] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    if (!goal.trim()) {
      setError("Describe the sequence goal first.");
      return;
    }
    setGenerating(true);
    setError("");
    try {
      const data = await api.generateDripSequence({
        brandId,
        goal,
        audienceSegment: segmentLabel(segment),
        numEmails: Number(numEmails),
      });
      setEmails(data.emails);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function activate() {
    if (!campaignName.trim()) {
      setError("Give the sequence a name.");
      return;
    }
    if (!emails || emails.length < 2) {
      setError("Generate the sequence first.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.createDripCampaign({
        brandId,
        campaignName,
        goal,
        segment,
        emails: emails.map((e) => ({
          ...e,
          subjectLine: e.subjectVariations[0],
        })),
      });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-gray-800 bg-gray-900/60 p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Sequence name">
          <input
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            placeholder="New lead nurture"
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
          />
        </Field>
        <Field label="Enroll">
          <select
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
          >
            {SEGMENTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Number of emails">
          <input
            type="number"
            min={3}
            max={7}
            value={numEmails}
            onChange={(e) => setNumEmails(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
          />
        </Field>
      </div>
      <Field label="Goal">
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Convert new leads into a booked demo"
          className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
        />
      </Field>

      <div className="flex gap-2">
        <button
          onClick={generate}
          disabled={generating}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
        >
          {generating ? "Designing…" : emails ? "Regenerate" : "Generate sequence"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
        >
          Cancel
        </button>
      </div>

      {emails && (
        <div className="space-y-3">
          {emails.map((e, i) => (
            <div key={i} className="rounded-lg border border-gray-800 bg-gray-950/60 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-300">
                  Email {i + 1} · Day {e.sendDelayDays}
                </span>
              </div>
              <p className="text-sm font-medium text-gray-100">{e.subjectVariations[0]}</p>
              {e.previewText && <p className="text-xs text-gray-400">{e.previewText}</p>}
              <div
                className="mt-2 max-h-44 overflow-auto rounded bg-white p-3 text-xs text-gray-900"
                dangerouslySetInnerHTML={{ __html: e.bodyHtml }}
              />
            </div>
          ))}
          <button
            onClick={activate}
            disabled={saving}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
          >
            {saving ? "Activating…" : "Activate sequence"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-400">{label}</span>
      {children}
    </label>
  );
}
