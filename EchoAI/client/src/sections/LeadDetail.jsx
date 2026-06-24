import { useEffect, useState } from "react";
import { api } from "../api.js";
import Badge from "../components/Badge.jsx";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

export default function LeadDetail({ leadId, onClose }) {
  const [lead, setLead] = useState(null);
  const [interactions, setInteractions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api.getLead(leadId);
        if (!active) return;
        setLead(data.lead || null);
        setInteractions(data.interactions || []);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [leadId]);

  const conversation = Array.isArray(lead?.conversation_history)
    ? lead.conversation_history
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-lg font-bold text-gray-900">Lead profile</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <Spinner label="Loading lead…" />
        ) : error ? (
          <ErrorBanner message={error} />
        ) : lead ? (
          <div className="space-y-5">
            <div className="space-y-1">
              <p className="text-xl font-semibold text-gray-900">
                {lead.lead_name || "Unnamed lead"}
              </p>
              <div className="flex items-center gap-2">
                <Badge temperature={lead.temperature} />
                <span className="text-xs text-gray-500">
                  {lead.conversion_status}
                </span>
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <Field label="Email" value={lead.email} />
              <Field label="Phone" value={lead.phone} />
            </dl>

            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-700">
                Conversation history
              </h4>
              {conversation.length === 0 ? (
                <p className="text-sm text-gray-400">No conversation recorded.</p>
              ) : (
                <div className="space-y-2">
                  {conversation.map((m, i) => (
                    <div
                      key={i}
                      className={`rounded-lg p-2 text-sm ${
                        m.role === "user"
                          ? "bg-gray-100 text-gray-800"
                          : "bg-indigo-50 text-indigo-900"
                      }`}
                    >
                      <span className="mb-0.5 block text-xs font-semibold uppercase text-gray-400">
                        {m.role}
                      </span>
                      {m.content}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {interactions.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold text-gray-700">
                  Interactions
                </h4>
                <ul className="space-y-1 text-sm text-gray-600">
                  {interactions.map((it) => (
                    <li
                      key={it.interaction_id}
                      className="flex justify-between gap-2"
                    >
                      <span>{it.interaction_type}</span>
                      <span className="text-gray-400">
                        {formatDate(it.occurred_at || it.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-gray-400">{label}</dt>
      <dd className="text-gray-800">{value || "—"}</dd>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}
