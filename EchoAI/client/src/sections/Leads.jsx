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
  const [coverage, setCoverage] = useState(null);
  const [jobberConnected, setJobberConnected] = useState(false);

  // Jobber connection (best-effort probe — never blocks the lead list).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api.getJobberStatus();
        if (active) setJobberConnected(data?.connected === true);
      } catch {
        if (active) setJobberConnected(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Sage V2 P3 coverage display (flag-gated server-side; {enabled:false} when
  // dark → renders nothing). Best-effort — never blocks the lead list.
  useEffect(() => {
    let active = true;
    if (!brandId) return undefined;
    (async () => {
      try {
        const data = await api.getOutcomeCoverage(brandId);
        if (active) setCoverage(data && data.enabled ? data.coverage : null);
      } catch {
        if (active) setCoverage(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [brandId]);

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

      {jobberConnected && <JobberBar brandId={brandId} onImported={load} />}

      {coverage && coverage.totalLeads > 0 && (
        <div
          className={`rounded-xl border p-3 text-sm ${
            coverage.sufficient
              ? "border-gray-800 bg-gray-900/60 text-gray-300"
              : "border-amber-800/60 bg-amber-950/30 text-amber-200"
          }`}
        >
          <span className="font-semibold">
            Outcome coverage: {coverage.coveragePct}%
          </span>{" "}
          ({coverage.withOutcome} of {coverage.totalLeads} leads have a recorded
          outcome{coverage.wonValueMissing > 0
            ? `; ${coverage.wonValueMissing} won ${coverage.wonValueMissing === 1 ? "deal is" : "deals are"} missing a value`
            : ""}
          ).
          {!coverage.sufficient && (
            <span className="ml-1">
              Below 30%, financial reports show this prompt instead of numbers —
              record outcomes on your leads to unlock real figures.
            </span>
          )}
        </div>
      )}

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
          jobberConnected={jobberConnected}
          onClose={() => setActiveLeadId(null)}
        />
      )}
    </div>
  );
}

/**
 * Jobber toolbar — shown only when the owner's Jobber account is connected.
 * Import pulls Jobber clients into this brand's CRM (deduped server-side);
 * the schedule toggle shows the next 14 days of booked Jobber visits.
 */
function JobberBar({ brandId, onImported }) {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [schedule, setSchedule] = useState(null);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleLoading, setScheduleLoading] = useState(false);

  async function runImport() {
    setImporting(true);
    setImportError("");
    setImportResult(null);
    try {
      const data = await api.importJobberClients(brandId);
      setImportResult(data);
      if (data.imported > 0) onImported();
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImporting(false);
    }
  }

  async function toggleSchedule() {
    if (showSchedule) {
      setShowSchedule(false);
      return;
    }
    setShowSchedule(true);
    if (schedule) return;
    setScheduleLoading(true);
    setScheduleError("");
    try {
      const data = await api.getJobberSchedule();
      setSchedule(data);
    } catch (err) {
      setScheduleError(err.message);
    } finally {
      setScheduleLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-300">Jobber</span>
        <button
          onClick={runImport}
          disabled={importing}
          className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          {importing ? "Importing…" : "Import clients as leads"}
        </button>
        <button
          onClick={toggleSchedule}
          className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-700"
        >
          {showSchedule ? "Hide upcoming visits" : "Show upcoming visits"}
        </button>
        {importResult && (
          <span className="text-xs text-emerald-300">
            Imported {importResult.imported} new lead
            {importResult.imported === 1 ? "" : "s"}
            {importResult.skipped > 0
              ? ` (${importResult.skipped} already in your CRM)`
              : ""}
            {importResult.complete === false
              ? " — more remain, run the import again"
              : ""}
          </span>
        )}
        {importError && <span className="text-xs text-red-400">{importError}</span>}
      </div>

      {showSchedule && (
        <div className="mt-3 border-t border-gray-800 pt-3">
          {scheduleLoading ? (
            <Spinner label="Loading Jobber schedule…" />
          ) : scheduleError ? (
            <p className="text-xs text-red-400">{scheduleError}</p>
          ) : !schedule || schedule.visits.length === 0 ? (
            <p className="text-xs text-gray-400">
              No booked Jobber visits in the next 14 days.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {schedule.visits.map((v) => (
                <li key={v.id} className="flex flex-wrap justify-between gap-2">
                  <span className="text-gray-200">
                    {v.title || "Visit"}
                    {v.clientName ? (
                      <span className="text-gray-400"> — {v.clientName}</span>
                    ) : null}
                  </span>
                  <span className="text-gray-400">{formatDateTime(v.startAt)}</span>
                </li>
              ))}
              {schedule.hasMore && (
                <li className="text-xs text-gray-500">
                  Showing the first 50 visits.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
}
