import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

/**
 * Sage V2 Phase 5 — Opportunities tab + "What Sage knows" tab.
 * Flag-gated server-side; when the endpoints answer { enabled:false } the
 * parent hides these tabs entirely (byte-identical dark behavior).
 *
 * Executive lifecycle (CEO refinement): internal statuses map to the
 * owner-facing labels below. reviewed_at is stamped server-side on first
 * detail open ("Reviewed").
 */

export const LIFECYCLE_LABELS = {
  proposed: "New",
  approved: "Approved",
  declined: "Rejected",
  expired: "Archived (expired)",
  directed: "Assigned",
  in_progress: "In Progress",
  executed: "In Progress",
  measuring: "In Progress",
  succeeded: "Completed",
  failed: "Completed",
  inconclusive: "Completed",
  archived: "Archived",
};

export function lifecycleLabel(opp) {
  if (opp.status === "proposed" && opp.reviewed_at) return "Reviewed";
  return LIFECYCLE_LABELS[opp.status] || opp.status;
}

const LIFECYCLE_STYLES = {
  New: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Reviewed: "bg-sky-500/15 text-sky-200 border-sky-500/30",
  Approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Rejected: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  Assigned: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  "In Progress": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Completed: "bg-gray-500/15 text-gray-300 border-gray-500/30",
};

const CONF_STYLES = {
  verified: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  reported: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  inferred: "bg-gray-500/15 text-gray-300 border-gray-500/30",
};

const DEPT_NAMES = {
  nova: "Nova (social)",
  atlas: "Atlas (ads)",
  forge: "Forge (creative)",
  pulse: "Pulse (leads)",
  voice: "Voice (phone)",
  owner: "You (owner action)",
};

function money(cents) {
  if (cents == null) return null;
  return `$${(Number(cents) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return String(d);
  }
}

function Pill({ children, className }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${className || "bg-gray-500/15 text-gray-300 border-gray-500/30"}`}>
      {children}
    </span>
  );
}

/** "Confidence: <tier> — because: …" — deterministic, no fabricated %. */
function ConfidenceExplanation({ opportunity }) {
  const exp = opportunity.rationale?.confidence_explanation;
  const tier = opportunity.confidence;
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-300">Confidence:</span>
        <Pill className={CONF_STYLES[tier]}>{exp?.label || tier}</Pill>
      </div>
      {exp && Array.isArray(exp.reasons) && exp.reasons.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-gray-400">
          {exp.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-gray-500">
        Confidence is computed from the evidence itself — Sage never invents a percentage.
      </p>
    </div>
  );
}

function OpportunityDetail({ brandId, id, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    setError(null);
    api
      .getSageOpportunity(brandId, id)
      .then((d) => setData(d))
      .catch((e) => setError(e.message));
  }, [brandId, id]);

  useEffect(load, [load]);

  const decide = async (decision) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.decideSageOpportunity(brandId, id, decision, note.trim() || undefined);
      if (r.directiveError) setError(r.directiveError);
      load();
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doAction = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <Spinner />;
  const opp = data.opportunity;
  if (!opp) return <ErrorBanner message={error || "Opportunity not found."} />;
  const label = lifecycleLabel(opp);
  const flags = Array.isArray(opp.constraint_flags) ? opp.constraint_flags : [];
  const canArchive = ["declined", "expired", "succeeded", "failed", "inconclusive"].includes(opp.status);

  return (
    <div className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5">
      {error && <ErrorBanner message={error} />}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill className={LIFECYCLE_STYLES[label]}>{label}</Pill>
            <Pill>{opp.category}</Pill>
            <Pill>{DEPT_NAMES[opp.recommended_department] || opp.recommended_department}</Pill>
          </div>
          <h3 className="mt-2 text-base font-semibold text-gray-100">{opp.title}</h3>
          <p className="mt-1 text-sm text-gray-400">{opp.thesis}</p>
        </div>
        <button type="button" onClick={onClose} className="text-sm text-gray-400 hover:text-gray-200">
          Back
        </button>
      </div>

      <div className="grid gap-2 text-xs text-gray-400 sm:grid-cols-2">
        {opp.expected_impact_cents != null ? (
          <p>
            <span className="text-gray-300">Expected impact:</span> {money(opp.expected_impact_cents)}
            {opp.impact_basis ? ` — ${opp.impact_basis}` : ""}
          </p>
        ) : (
          <p>
            <span className="text-gray-300">Expected impact:</span> not estimated — Sage doesn&apos;t have
            enough recorded outcomes to put an honest number on this yet.
          </p>
        )}
        {opp.cost_estimate_cents != null && (
          <p>
            <span className="text-gray-300">Estimated cost:</span> {money(opp.cost_estimate_cents)}
          </p>
        )}
        {opp.effort && (
          <p>
            <span className="text-gray-300">Effort:</span>{" "}
            {{ s: "Small", m: "Medium", l: "Large" }[opp.effort] || opp.effort}
          </p>
        )}
        {opp.risk && (
          <p>
            <span className="text-gray-300">Risk:</span> {opp.risk}
          </p>
        )}
        <p>
          <span className="text-gray-300">Proposed:</span> {fmtDate(opp.created_at)}
          {opp.expires_at ? ` · expires ${fmtDate(opp.expires_at)}` : ""}
        </p>
      </div>

      {flags.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          <p className="font-semibold">Things to know before deciding:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <ConfidenceExplanation opportunity={opp} />

      {Array.isArray(opp.evidence) && opp.evidence.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Evidence</h4>
          <ul className="mt-2 space-y-2">
            {opp.evidence.map((e) => (
              <li key={e.item_id} className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 text-xs text-gray-300">
                <div className="flex items-center gap-2">
                  <Pill className={CONF_STYLES[e.confidence]}>{e.confidence}</Pill>
                  <span className="text-gray-500">
                    {e.source} · {fmtDate(e.created_at)}
                  </span>
                </div>
                <p className="mt-1">{e.claim || e.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {Array.isArray(data.directives) && data.directives.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Team handoff</h4>
          <ul className="mt-2 space-y-2">
            {data.directives.map((d) => (
              <li key={d.directive_id} className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 text-xs text-gray-300">
                <div className="flex items-center gap-2">
                  <Pill>{DEPT_NAMES[d.department] || d.department}</Pill>
                  <Pill>{d.status}</Pill>
                  <span className="text-gray-500">issued {fmtDate(d.issued_at)}</span>
                </div>
                {d.clamp_applied && <p className="mt-1 text-amber-300">Budget was clamped to respect your limits.</p>}
                {d.error && <p className="mt-1 text-rose-300">{d.error}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {opp.measured_result && (
        <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 text-xs text-gray-300">
          <p className="font-semibold text-gray-200">Measured result</p>
          <pre className="mt-1 whitespace-pre-wrap text-gray-400">{JSON.stringify(opp.measured_result, null, 2)}</pre>
          {opp.lesson && <p className="mt-2 text-gray-300">Lesson: {opp.lesson}</p>}
        </div>
      )}

      {opp.status === "proposed" && (
        <div className="space-y-2 border-t border-gray-800 pt-4">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional: why? (helps Sage learn your judgment)"
            rows={2}
            className="w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-sm text-gray-200 placeholder-gray-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => decide("approved")}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide("declined")}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      )}
      {opp.status === "approved" && opp.recommended_department !== "owner" && (
        <div className="border-t border-gray-800 pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => doAction(() => api.assignSageOpportunity(brandId, id))}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            Assign to {DEPT_NAMES[opp.recommended_department] || opp.recommended_department}
          </button>
        </div>
      )}
      {canArchive && (
        <div className="border-t border-gray-800 pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => doAction(() => api.archiveSageOpportunity(brandId, id))}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Archive
          </button>
        </div>
      )}
    </div>
  );
}

export function OpportunitiesTab({ brandId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [whatChanged, setWhatChanged] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api
      .listSageOpportunities(brandId, includeArchived)
      .then((d) => setData(d))
      .catch((e) => setError(e.message));
    api
      .getSageChangeDiagnostics(brandId)
      .then((d) => setWhatChanged(d?.enabled && d.diagnostics ? d.diagnostics : null))
      .catch(() => setWhatChanged(null));
  }, [brandId, includeArchived]);

  useEffect(() => {
    setData(null);
    setOpenId(null);
    load();
  }, [load]);

  if (error && !data) return <ErrorBanner message={error} />;
  if (!data) return <Spinner />;
  if (data.enabled === false) {
    return <p className="text-sm text-gray-400">This feature isn&apos;t enabled yet.</p>;
  }

  if (openId) {
    return <OpportunityDetail brandId={brandId} id={openId} onClose={() => setOpenId(null)} onChanged={load} />;
  }

  const opps = data.opportunities || [];
  return (
    <div className="space-y-4">
      {whatChanged?.narrative && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h3 className="text-sm font-semibold text-gray-100">What changed last week</h3>
          <p className="mt-1 text-sm text-gray-400">{whatChanged.narrative}</p>
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          Opportunities Sage found in your business data and industry intelligence. Nothing runs without your
          approval.
        </p>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>
      {opps.length === 0 ? (
        <p className="text-sm text-gray-500">
          No opportunities yet. Sage proposes new ones each Monday when it has enough real evidence.
        </p>
      ) : (
        <ul className="space-y-2">
          {opps.map((o) => {
            const label = lifecycleLabel(o);
            return (
              <li key={o.opportunity_id}>
                <button
                  type="button"
                  onClick={() => setOpenId(o.opportunity_id)}
                  className="w-full rounded-xl border border-gray-800 bg-gray-900 p-4 text-left hover:border-gray-700"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill className={LIFECYCLE_STYLES[label]}>{label}</Pill>
                    <Pill className={CONF_STYLES[o.confidence]}>{o.confidence}</Pill>
                    <Pill>{DEPT_NAMES[o.recommended_department] || o.recommended_department}</Pill>
                    {o.expected_impact_cents != null && (
                      <span className="text-xs text-emerald-300">~{money(o.expected_impact_cents)}</span>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-gray-100">{o.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-gray-400">{o.thesis}</p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function KnowledgeTab({ brandId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .getSageKnowledge(brandId)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [brandId]);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <Spinner />;
  if (data.enabled === false) {
    return <p className="text-sm text-gray-400">This feature isn&apos;t enabled yet.</p>;
  }

  const k = data.knowledge;
  const intel = Array.isArray(k.intelByConfidence) ? k.intelByConfidence : [];
  const totalIntel = intel.reduce((s, r) => s + Number(r.n || 0), 0);
  const oppCounts = Array.isArray(k.opportunitiesByStatus) ? k.opportunitiesByStatus : [];
  const cov = k.outcomeCoverage;

  const Card = ({ title, children }) => (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <h3 className="text-sm font-semibold text-gray-100">{title}</h3>
      <div className="mt-2 text-sm text-gray-400">{children}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          Everything Sage currently knows about this business — and where each piece came from.
        </p>
        <button
          type="button"
          onClick={() => api.downloadSageKnowledge(brandId).catch(() => {})}
          className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-800"
        >
          Download my data (JSON)
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Company Truth">
          {k.companyTruth?.approved ? (
            <p>
              Approved — version {k.companyTruth.version}, {fmtDate(k.companyTruth.approvedAt)}.
            </p>
          ) : (
            <p>Not approved yet — Sage is working without vetted business facts.</p>
          )}
        </Card>
        <Card title="Industry intelligence">
          {totalIntel === 0 ? (
            <p>No intelligence items yet.</p>
          ) : (
            <ul className="space-y-1">
              {intel.map((r) => (
                <li key={r.confidence}>
                  {r.n} {r.confidence} item{Number(r.n) === 1 ? "" : "s"} (newest {fmtDate(r.newest)})
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Offers & constraints">
          <p>{k.activeOffers} active offer{k.activeOffers === 1 ? "" : "s"}.</p>
          {k.constraints ? (
            <ul className="mt-1 space-y-1">
              {k.constraints.monthlyBudgetCents != null && (
                <li>Monthly budget: {money(k.constraints.monthlyBudgetCents)}</li>
              )}
              {k.constraints.weeklyCapacity != null && <li>Weekly capacity: {k.constraints.weeklyCapacity} jobs</li>}
              {Array.isArray(k.constraints.blackoutDates) && k.constraints.blackoutDates.length > 0 && (
                <li>{k.constraints.blackoutDates.length} blackout window{k.constraints.blackoutDates.length === 1 ? "" : "s"}</li>
              )}
            </ul>
          ) : (
            <p className="mt-1">No business constraints recorded — Sage assumes nothing.</p>
          )}
        </Card>
        <Card title="Executive memory">
          {Array.isArray(k.memoryByKind) && k.memoryByKind.length > 0 ? (
            <ul className="space-y-1">
              {k.memoryByKind.map((m) => (
                <li key={m.kind}>
                  {m.n} {m.kind} note{Number(m.n) === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          ) : (
            <p>No memory notes yet.</p>
          )}
        </Card>
        <Card title="Lead outcome coverage">
          {cov && cov.totalLeads > 0 ? (
            <p>
              {cov.withOutcome} of {cov.totalLeads} recent leads have a recorded outcome ({Math.round(cov.coveragePct)}
              %). {cov.sufficient ? "Enough to estimate impact honestly." : "Below 30% — Sage won't estimate dollar impact yet."}
            </p>
          ) : (
            <p>No recent leads to measure yet.</p>
          )}
        </Card>
        <Card title="Opportunities">
          {oppCounts.length === 0 ? (
            <p>None proposed yet.</p>
          ) : (
            <ul className="space-y-1">
              {oppCounts.map((r) => (
                <li key={r.status}>
                  {r.n} {LIFECYCLE_LABELS[r.status] || r.status}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {k.latestDiagnostics?.narrative && (
        <Card title="Latest weekly diagnosis">
          <p>{k.latestDiagnostics.narrative}</p>
        </Card>
      )}
    </div>
  );
}
