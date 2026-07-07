import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { SEGMENTS, segmentLabel, pct, statusBadgeClass } from "./emailShared.js";

export default function Campaigns({ brandId, refreshKey, onChange }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api.getEmailCampaigns(brandId);
      setCampaigns((data.campaigns || []).filter((c) => c.campaignType === "one-time"));
    } catch (err) {
      setError(err.message);
    } finally {
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
        <CampaignForm
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
          + New Email Campaign
        </button>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading ? (
        <p className="text-sm text-gray-400">Loading campaigns…</p>
      ) : campaigns.length === 0 ? (
        <p className="text-sm text-gray-400">No one-time campaigns yet.</p>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <CampaignRow
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

function CampaignRow({ campaign, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");

  async function run(action) {
    setBusy(true);
    setError("");
    try {
      await action();
      setScheduling(false);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const send = () => run(() => api.sendEmailCampaign(campaign.campaignId));
  const remove = () => run(() => api.cancelEmailCampaign(campaign.campaignId));
  const unschedule = () => run(() => api.unscheduleEmailCampaign(campaign.campaignId));

  function schedule() {
    if (!scheduleAt) {
      setError("Pick a date and time first.");
      return;
    }
    const when = new Date(scheduleAt);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      setError("The scheduled time must be in the future.");
      return;
    }
    run(() => api.scheduleEmailCampaign(campaign.campaignId, when.toISOString()));
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-gray-100">{campaign.campaignName}</h4>
            <span className={`rounded-full px-2 py-0.5 text-xs ${statusBadgeClass(campaign.status)}`}>
              {campaign.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            {segmentLabel(campaign.segment)} · {campaign.recipientCount} recipients
          </p>
          {campaign.status === "scheduled" && campaign.scheduledAt && (
            <p className="mt-1 text-xs text-blue-300">
              Sends {new Date(campaign.scheduledAt).toLocaleString()}
            </p>
          )}
          {campaign.status === "failed" && (
            <p className="mt-1 text-xs text-red-400">
              This blast couldn't be sent. Check your email settings, then use
              Send now to retry.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(campaign.status === "draft" || campaign.status === "failed") && (
            <button
              onClick={send}
              disabled={busy}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send now"}
            </button>
          )}
          {campaign.status === "draft" && !scheduling && (
            <button
              onClick={() => setScheduling(true)}
              disabled={busy}
              className="rounded-lg border border-blue-500/40 px-3 py-1.5 text-xs text-blue-300 hover:bg-blue-500/10 disabled:opacity-50"
            >
              Schedule
            </button>
          )}
          {campaign.status === "scheduled" && (
            <button
              onClick={unschedule}
              disabled={busy}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              Cancel schedule
            </button>
          )}
          <button
            onClick={remove}
            disabled={busy}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
      {scheduling && campaign.status === "draft" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-xs text-gray-100"
          />
          <button
            onClick={schedule}
            disabled={busy}
            className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-blue-400 disabled:opacity-50"
          >
            {busy ? "Scheduling…" : "Confirm schedule"}
          </button>
          <button
            onClick={() => setScheduling(false)}
            disabled={busy}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}
      <div className="mt-3 grid grid-cols-3 gap-3 text-center text-sm">
        <Stat label="Sent" value={campaign.sentCount} />
        <Stat label="Opens" value={`${campaign.openCount} (${pct(campaign.openRate)})`} />
        <Stat label="Clicks" value={`${campaign.clickCount} (${pct(campaign.clickRate)})`} />
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
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

function CampaignForm({ brandId, onCancel, onCreated }) {
  const [campaignName, setCampaignName] = useState("");
  const [goal, setGoal] = useState("");
  const [topic, setTopic] = useState("");
  const [segment, setSegment] = useState("all");
  const [email, setEmail] = useState(null);
  const [chosenSubject, setChosenSubject] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    if (!goal.trim()) {
      setError("Describe the campaign goal first.");
      return;
    }
    setGenerating(true);
    setError("");
    try {
      const data = await api.generateCampaignEmail({
        brandId,
        goal,
        audienceSegment: segmentLabel(segment),
        topic,
      });
      setEmail(data.email);
      setChosenSubject(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function create() {
    if (!campaignName.trim()) {
      setError("Give the campaign a name.");
      return;
    }
    if (!email) {
      setError("Generate the email first.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.createEmailCampaign({
        brandId,
        campaignName,
        goal,
        segment,
        email: {
          ...email,
          subjectLine: email.subjectVariations[chosenSubject] || email.subjectVariations[0],
        },
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Campaign name">
          <input
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            placeholder="Spring promo blast"
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
          />
        </Field>
        <Field label="Send to">
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
      </div>
      <Field label="Goal">
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Drive sign-ups for our spring discount"
          className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
        />
      </Field>
      <Field label="Topic / offer (optional)">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="20% off all annual plans this week"
          className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
        />
      </Field>

      <div className="flex gap-2">
        <button
          onClick={generate}
          disabled={generating}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
        >
          {generating ? "Writing…" : email ? "Regenerate" : "Generate with AI"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
        >
          Cancel
        </button>
      </div>

      {email && (
        <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-950/60 p-4">
          <div>
            <p className="mb-1 text-xs font-medium text-gray-400">Subject line (pick one to split-test)</p>
            <div className="space-y-1">
              {email.subjectVariations.map((s, i) => (
                <label key={i} className="flex items-center gap-2 text-sm text-gray-200">
                  <input
                    type="radio"
                    checked={chosenSubject === i}
                    onChange={() => setChosenSubject(i)}
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>
          {email.previewText && (
            <p className="text-xs text-gray-400">Preview: {email.previewText}</p>
          )}
          <div
            className="max-h-72 overflow-auto rounded-lg bg-white p-4 text-sm text-gray-900"
            dangerouslySetInnerHTML={{ __html: email.bodyHtml }}
          />
          <button
            onClick={create}
            disabled={saving}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create campaign"}
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
