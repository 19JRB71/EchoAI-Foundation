import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import ErrorBanner from "../components/ErrorBanner.jsx";

// Mirrors config/webhookEvents.js on the server (the dropdown of subscribable
// trigger events). Keep in sync if the server list changes.
const EVENTS = [
  { key: "new_lead_created", label: "New lead created" },
  { key: "lead_temperature_hot", label: "Lead temperature changed to hot" },
  { key: "new_campaign_created", label: "New campaign created" },
  { key: "campaign_performance_updated", label: "Campaign performance updated (weekly)" },
  { key: "new_review_received", label: "New review received" },
  { key: "review_response_posted", label: "Review response posted" },
  { key: "sales_script_generated", label: "Sales script generated" },
  { key: "social_post_published", label: "Social media post published" },
  { key: "weekly_report_generated", label: "Weekly report generated" },
  { key: "inbound_call_received", label: "Inbound call received" },
  { key: "outbound_call_completed", label: "Outbound call completed" },
];

const EVENT_LABELS = Object.fromEntries(EVENTS.map((e) => [e.key, e.label]));

// Placeholder for the (not-yet-published) EchoAI Zapier app listing.
const ZAPIER_DOCS_URL = "https://zapier.com/apps";

export default function ZapierIntegration({ brandId }) {
  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [eventName, setEventName] = useState(EVENTS[0].key);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const [notice, setNotice] = useState("");
  const [testingId, setTestingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.listWebhooks(brandId);
      setWebhooks(data.webhooks || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    setFormError("");
    setNotice("");
    if (!webhookUrl.trim()) {
      setFormError("Enter the webhook URL from Zapier.");
      return;
    }
    setSubmitting(true);
    try {
      await api.createWebhook({
        brandId,
        eventName,
        webhookUrl: webhookUrl.trim(),
      });
      setWebhookUrl("");
      setEventName(EVENTS[0].key);
      setShowForm(false);
      setNotice("Webhook added.");
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTest(id) {
    setNotice("");
    setError("");
    setTestingId(id);
    try {
      await api.testWebhook(id);
      setNotice("Test payload delivered successfully.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setTestingId(null);
    }
  }

  async function handleDelete(id) {
    setNotice("");
    setError("");
    setDeletingId(id);
    try {
      await api.deleteWebhook(id);
      setWebhooks((prev) => prev.filter((w) => w.webhook_id !== id));
      setNotice("Webhook removed.");
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-100">Zapier Integration</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">
            Connect EchoAI to thousands of apps — Google Sheets, Mailchimp,
            Calendly, Slack, QuickBooks and more. Add a Zapier webhook URL for a
            trigger event and EchoAI will POST the event payload to it as it
            happens.
          </p>
          <a
            href={ZAPIER_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-sm font-medium text-amber-400 hover:text-amber-300"
          >
            View EchoAI Zapier documentation →
          </a>
        </div>
        {brandId && (
          <button
            onClick={() => {
              setShowForm((s) => !s);
              setFormError("");
            }}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600"
          >
            {showForm ? "Cancel" : "Add Webhook"}
          </button>
        )}
      </div>

      {!brandId ? (
        <p className="text-sm text-gray-400">
          Select a brand to manage its Zapier webhooks.
        </p>
      ) : (
        <>
          {showForm && (
            <form
              onSubmit={handleCreate}
              className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-300">
                    Trigger event
                  </label>
                  <select
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    {EVENTS.map((ev) => (
                      <option key={ev.key} value={ev.key}>
                        {ev.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-300">
                    Webhook URL
                  </label>
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://hooks.zapier.com/hooks/catch/..."
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              </div>

              <ErrorBanner message={formError} />

              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
              >
                {submitting ? "Adding…" : "Add Webhook"}
              </button>
            </form>
          )}

          {notice && (
            <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-400">
              {notice}
            </p>
          )}
          <ErrorBanner message={error} />

          {loading ? (
            <p className="text-sm text-gray-400">Loading webhooks…</p>
          ) : webhooks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-800 bg-gray-900/40 p-6 text-center text-sm text-gray-400">
              No active webhooks yet. Click{" "}
              <span className="font-medium text-gray-200">Add Webhook</span> to
              connect a Zap.
            </div>
          ) : (
            <ul className="space-y-3">
              {webhooks.map((w) => (
                <li
                  key={w.webhook_id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-sm"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-100">
                      {EVENT_LABELS[w.event_name] || w.event_name}
                    </p>
                    <p className="truncate text-xs text-gray-400" title={w.webhook_url}>
                      {w.webhook_url}
                    </p>
                    {w.last_triggered_at && (
                      <p className="mt-1 text-xs text-gray-500">
                        Last triggered{" "}
                        {new Date(w.last_triggered_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => handleTest(w.webhook_id)}
                      disabled={testingId === w.webhook_id}
                      className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-gray-800 disabled:opacity-60"
                    >
                      {testingId === w.webhook_id ? "Testing…" : "Test"}
                    </button>
                    <button
                      onClick={() => handleDelete(w.webhook_id)}
                      disabled={deletingId === w.webhook_id}
                      className="rounded-lg border border-red-900/60 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-950/40 disabled:opacity-60"
                    >
                      {deletingId === w.webhook_id ? "Removing…" : "Delete"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
