import { Fragment, useEffect, useState } from "react";
import { api } from "../api.js";
import ErrorBanner from "../components/ErrorBanner.jsx";

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "in_development", label: "In development" },
  { value: "completed", label: "Completed" },
];

const STATUS_BADGE = {
  pending: "bg-gray-800 text-gray-300 border border-gray-700",
  in_development: "bg-amber-500/10 text-amber-300 border border-amber-500/30",
  completed: "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30",
};

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AdminFeatureSuggestions() {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [requestsById, setRequestsById] = useState({});
  const [requestsError, setRequestsError] = useState("");

  async function load({ initial = false } = {}) {
    if (initial) setLoading(true);
    try {
      const result = await api.adminGetFeatureSuggestions();
      setSuggestions(result.suggestions || []);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      if (initial) setLoading(false);
    }
  }

  useEffect(() => {
    load({ initial: true });
  }, []);

  async function changeStatus(suggestionId, status) {
    setBusyId(suggestionId);
    try {
      await api.adminUpdateFeatureSuggestionStatus(suggestionId, status);
      setSuggestions((prev) =>
        prev.map((s) => (s.suggestionId === suggestionId ? { ...s, status } : s)),
      );
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleRequests(suggestionId) {
    if (expandedId === suggestionId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(suggestionId);
    setRequestsError("");
    if (!requestsById[suggestionId]) {
      try {
        const result = await api.adminGetFeatureSuggestionRequests(suggestionId);
        setRequestsById((prev) => ({ ...prev, [suggestionId]: result.requests || [] }));
      } catch (err) {
        setRequestsError(err.message);
      }
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-400">Loading feature suggestions…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-100">Feature Suggestions</h3>
        <p className="text-sm text-gray-400">
          Everything users have asked Echo for that it can't do yet — most requested
          first. Logged automatically whenever Echo hits a limitation.
        </p>
      </div>

      <ErrorBanner message={error} />

      {suggestions.length === 0 ? (
        <p className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm text-gray-400">
          No suggestions logged yet. When a customer asks Echo for something it can't
          do, it shows up here automatically.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-900 text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-3">Requested feature</th>
                <th className="px-4 py-3">Times asked</th>
                <th className="px-4 py-3">Customers</th>
                <th className="px-4 py-3">First requested</th>
                <th className="px-4 py-3">Last requested</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {suggestions.map((s) => (
                <Fragment key={s.suggestionId}>
                  <tr className="bg-gray-950">
                    <td className="max-w-xs px-4 py-3">
                      <button
                        onClick={() => toggleRequests(s.suggestionId)}
                        className="text-left font-medium text-gray-100 hover:text-amber-300"
                        title="Show what users actually said"
                      >
                        {s.title}
                      </button>
                      <p className="mt-0.5 truncate text-xs text-gray-500">{s.description}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-sm font-semibold text-amber-300">
                        {s.requestCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{s.distinctUsers}</td>
                    <td className="px-4 py-3 text-gray-400">{formatDate(s.firstRequestedAt)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatDate(s.lastRequestedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[s.status] || STATUS_BADGE.pending}`}
                        >
                          {(STATUS_OPTIONS.find((o) => o.value === s.status) || STATUS_OPTIONS[0]).label}
                        </span>
                        <select
                          value={s.status}
                          disabled={busyId === s.suggestionId}
                          onChange={(e) => changeStatus(s.suggestionId, e.target.value)}
                          className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100 focus:border-amber-500 focus:outline-none"
                        >
                          {STATUS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                  {expandedId === s.suggestionId && (
                    <tr className="bg-gray-900/60">
                      <td colSpan={6} className="px-6 py-3">
                        {requestsError ? (
                          <p className="text-xs text-red-400">{requestsError}</p>
                        ) : !requestsById[s.suggestionId] ? (
                          <p className="text-xs text-gray-500">Loading requests…</p>
                        ) : requestsById[s.suggestionId].length === 0 ? (
                          <p className="text-xs text-gray-500">No individual requests recorded.</p>
                        ) : (
                          <ul className="space-y-1.5">
                            {requestsById[s.suggestionId].map((r) => (
                              <li key={r.requestId} className="text-xs text-gray-300">
                                <span className="text-gray-500">
                                  {formatDate(r.createdAt)}
                                  {r.email ? ` · ${r.email}` : ""} —{" "}
                                </span>
                                “{r.requestText}”
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
