import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import Badge from "../components/Badge.jsx";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import LeadDetail from "./LeadDetail.jsx";

const FILTERS = [
  { value: "", label: "All" },
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "tire_kicker", label: "Tire kicker" },
];

export default function Leads({ brandId }) {
  const [leads, setLeads] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeLeadId, setActiveLeadId] = useState(null);

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.getLeads(brandId, filter || undefined);
      setLeads(data.leads || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId, filter]);

  useEffect(() => {
    load();
  }, [load]);

  if (!brandId)
    return (
      <p className="text-sm text-gray-400">
        Select or create a brand to view leads.
      </p>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-100">Leads</h2>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                filter === f.value
                  ? "bg-amber-500 text-gray-900"
                  : "bg-gray-900 text-gray-400 hover:bg-gray-800"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading leads…" />
      ) : leads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 bg-gray-900/50 p-8 text-center">
          <p className="text-sm font-medium text-gray-300">No leads yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
            Leads appear here automatically as your chatbot, phone agent, and ad
            campaigns capture them. Connect a source to start filling your pipeline.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900 shadow-sm">
          <table className="min-w-full divide-y divide-gray-800 text-sm">
            <thead className="bg-gray-800 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Temperature</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {leads.map((l) => (
                <tr
                  key={l.lead_id}
                  onClick={() => setActiveLeadId(l.lead_id)}
                  className="cursor-pointer hover:bg-gray-800"
                >
                  <td className="px-4 py-3 font-medium text-gray-100">
                    {l.lead_name || "—"}
                    {l.geo_status === "excluded" && (
                      <span
                        className="ml-2 rounded-full border border-red-700/60 bg-red-950/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300"
                        title={`From ${[l.lead_city, l.lead_state, l.lead_zip].filter(Boolean).join(", ") || "an excluded area"} — an area you've marked off-limits`}
                      >
                        Excluded area
                      </span>
                    )}
                    {l.geo_status === "out_of_area" && (
                      <span
                        className="ml-2 rounded-full border border-amber-700/60 bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300"
                        title={`From ${[l.lead_city, l.lead_state, l.lead_zip].filter(Boolean).join(", ") || "outside your service area"}`}
                      >
                        Out of area
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{l.email || "—"}</td>
                  <td className="px-4 py-3 text-gray-400">{l.phone || "—"}</td>
                  <td className="px-4 py-3">
                    <Badge temperature={l.temperature} />
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {l.conversion_status}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {formatDate(l.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeLeadId && (
        <LeadDetail
          leadId={activeLeadId}
          onClose={() => setActiveLeadId(null)}
        />
      )}
    </div>
  );
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
}
