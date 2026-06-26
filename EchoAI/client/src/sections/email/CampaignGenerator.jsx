import { useState } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import EmailSequenceView from "./EmailSequenceView.jsx";

const GOAL_PRESETS = [
  "Nurture leads",
  "Promote a product",
  "Re-engage cold leads",
];

export default function CampaignGenerator({ brandId, onSaved }) {
  const [campaignName, setCampaignName] = useState("");
  const [goal, setGoal] = useState("Nurture leads");
  const [targetAudience, setTargetAudience] = useState("");
  const [numEmails, setNumEmails] = useState(5);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emails, setEmails] = useState(null);

  const [savedId, setSavedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  async function handleGenerate(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setActionError("");
    if (!goal.trim()) {
      setError("Enter a campaign goal to generate a sequence.");
      return;
    }

    setLoading(true);
    setEmails(null);
    setSavedId(null);
    try {
      const data = await api.generateEmailSequence({
        brandId,
        goal: goal.trim(),
        targetAudience: targetAudience.trim() || undefined,
        numEmails: Number(numEmails),
      });
      setEmails(data.emails);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function ensureSaved() {
    if (savedId) return savedId;
    const name =
      campaignName.trim() || `${goal.trim()} — ${new Date().toLocaleDateString()}`;
    const data = await api.saveEmailCampaign({
      brandId,
      campaignName: name,
      goal: goal.trim(),
      emailSequence: emails,
    });
    const id = data.campaign.campaign_id;
    setSavedId(id);
    return id;
  }

  async function handleSave() {
    if (!emails) return;
    setSaving(true);
    setActionError("");
    setNotice("");
    try {
      await ensureSaved();
      setNotice("Campaign saved.");
      if (onSaved) onSaved();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSend() {
    if (!emails) return;
    setSending(true);
    setActionError("");
    setNotice("");
    try {
      const id = await ensureSaved();
      const res = await api.sendEmailCampaign(id);
      setNotice(
        `Sent email ${res.step} of ${res.totalEmails} to ${res.sent} lead${
          res.sent === 1 ? "" : "s"
        }${res.failed ? ` (${res.failed} failed)` : ""}.`
      );
      if (onSaved) onSaved();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleGenerate}
        className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">
              Campaign name
            </label>
            <input
              type="text"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="e.g. Spring nurture sequence"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">
              Campaign goal
            </label>
            <input
              type="text"
              list="email-goal-presets"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Nurture leads"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <datalist id="email-goal-presets">
              {GOAL_PRESETS.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">
            Target audience
          </label>
          <textarea
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            rows={2}
            placeholder="e.g. Small business owners who downloaded our free guide but haven't bought yet"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">
            Number of emails: {numEmails}
          </label>
          <input
            type="range"
            min={3}
            max={10}
            value={numEmails}
            onChange={(e) => setNumEmails(Number(e.target.value))}
            className="w-full accent-amber-500"
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>3</span>
            <span>10</span>
          </div>
        </div>

        <ErrorBanner message={error} />

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
        >
          {loading ? "Generating…" : "Generate"}
        </button>
      </form>

      {loading && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400 shadow-sm">
          Writing your email sequence…
        </div>
      )}

      {emails && !loading && (
        <div className="space-y-4 rounded-xl border border-gray-800 bg-gray-900/60 p-5 shadow-sm">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
            >
              {saving ? "Saving…" : savedId ? "Saved" : "Save Campaign"}
            </button>
            <button
              onClick={handleSend}
              disabled={sending}
              className="rounded-lg border border-amber-500/50 px-4 py-2 text-sm font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-60"
            >
              {sending ? "Sending…" : "Send to CRM Leads"}
            </button>
          </div>

          {notice && (
            <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-400">
              {notice}
            </p>
          )}
          <ErrorBanner message={actionError} />

          <EmailSequenceView emails={emails} />
        </div>
      )}
    </div>
  );
}
