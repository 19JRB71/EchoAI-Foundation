import { useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

// Prompt 021 — read-only platform ops dashboard (projection only).
// Every tile shows a source-derived freshness state; stale never masquerades
// as current, empties are honest, and nothing here mutates anything.

const STATE_BADGE = {
  current: { label: "Current", cls: "bg-emerald-900/60 text-emerald-300" },
  stale: { label: "Stale", cls: "bg-amber-900/60 text-amber-300" },
  no_data_yet: { label: "No data yet", cls: "bg-gray-800 text-gray-400" },
  not_instrumented: { label: "Not instrumented", cls: "bg-gray-800 text-gray-400" },
  unavailable: { label: "Unavailable", cls: "bg-red-900/60 text-red-300" },
  probe_failed: { label: "Probe failed", cls: "bg-red-900/60 text-red-300" },
};

function fmtTime(v) {
  return v ? new Date(v).toLocaleString() : "—";
}

function fmtMoney(v) {
  const n = Number(v); // NUMERIC arrives as a string from the API
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : "—";
}

function Badge({ state }) {
  const b = STATE_BADGE[state] || STATE_BADGE.no_data_yet;
  return (
    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${b.cls}`}>{b.label}</span>
  );
}

function Tile({ title, tile, children }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
        <Badge state={tile?.state} />
      </div>
      <div className="mb-2 text-[11px] text-gray-500">As of: {fmtTime(tile?.as_of)}</div>
      {tile?.state === "unavailable" || tile?.state === "no_data_yet" || tile?.state === "not_instrumented" ? (
        <p className="text-sm text-gray-400">{tile?.message || "No data."}</p>
      ) : (
        children
      )}
    </div>
  );
}

function KV({ k, v, accent }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-gray-400">{k}</span>
      <span className={`text-xs font-medium ${accent || "text-gray-100"}`}>{v}</span>
    </div>
  );
}

const INTEGRATION_STATUS_LABEL = {
  connected_live_probe: "Connected — live probe passed",
  not_connected: "Not connected",
  probe_failed: "Probe failed",
};

export default function AdminOpsDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setError("");
      const res = await api.adminGetOpsDashboard();
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <Spinner label="Loading ops dashboard…" />;
  if (error) return <ErrorBanner message={error} />;
  const t = data?.tiles || {};
  const hermes48 = t.hermes?.data?.["48h"];
  const jobCounts = t.job_runs?.data?.counts_24h || {};
  const ttfv = t.customers?.data?.ttfv || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          Read-only projection of authoritative records. Generated {fmtTime(data?.generated_at)}.
          Approvals are resolved only in the Approvals Inbox.
        </p>
        <button
          onClick={() => {
            setLoading(true);
            load();
          }}
          className="rounded border border-gray-700 px-3 py-1 text-xs text-gray-300 hover:bg-gray-800"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Tile title="1 · System health (24h)" tile={t.system_health}>
          <KV k="Brands checked" v={t.system_health?.data?.brands_checked_24h ?? "—"} />
          {Object.entries(t.system_health?.data?.by_status || {}).map(([s, n]) => (
            <KV key={s} k={s} v={n} />
          ))}
        </Tile>

        <Tile title="2 · Job runs" tile={t.job_runs}>
          <KV k="Success (24h)" v={jobCounts.success ?? 0} accent="text-emerald-300" />
          <KV k="Skipped (24h)" v={jobCounts.skipped ?? 0} />
          <KV k="Failed (24h)" v={jobCounts.failed ?? 0} accent={jobCounts.failed ? "text-red-300" : undefined} />
          <KV k="Stuck now" v={t.job_runs?.data?.stuck?.length ?? 0} />
          <KV k="Retries" v="Not applicable (no scheduler retries)" />
        </Tile>

        <Tile title="3 · Approvals inbox" tile={t.approvals}>
          <KV k="Total pending" v={t.approvals?.data?.total_pending ?? "—"} />
          {["spine", "autopilot", "growth", "company_truth", "email_drafts"].map((k) => (
            <KV key={k} k={k.replace("_", " ")} v={t.approvals?.data?.[k]?.pending ?? "—"} />
          ))}
          <p className="mt-2 text-[11px] text-gray-500">
            View only — resolve in the Approvals Inbox (recorded Task Spine transition).
          </p>
        </Tile>

        <Tile title="4 · Integration status" tile={t.integrations}>
          {["facebook", "google", "email"].map((p) => (
            <div key={p} className="mb-1">
              <div className="text-xs font-medium text-gray-300 capitalize">{p}</div>
              {(t.integrations?.data?.[p]?.by_status || []).map((r) => (
                <KV
                  key={r.status}
                  k={`${r.status} — cached state only`}
                  v={`${r.count} (obs. ${fmtTime(r.observed_at)})`}
                />
              ))}
              {p === "google" && <KV k="Token expiry" v="Expiry unknown (not probed)" />}
            </div>
          ))}
        </Tile>

        <Tile title="5 · External actions" tile={t.external_actions}>
          <KV k="Attempts (24h)" v={t.external_actions?.data?.window?.attempts_24h ?? "—"} />
          <KV k="Attempts (7d)" v={t.external_actions?.data?.window?.attempts_7d ?? "—"} />
          <KV k="Failed (24h)" v={t.external_actions?.data?.window?.failed_24h ?? "—"} />
          <KV k="In progress now" v={t.external_actions?.data?.window?.in_progress_now ?? "—"} />
          <KV k="Terminal failures (all time)" v={t.external_actions?.data?.all_time?.terminal_failures ?? "—"} />
          <KV k="Deduplicated" v={t.external_actions?.data?.all_time?.deduplicated_executions ?? "—"} />
        </Tile>

        <Tile title="6 · Manual review queue" tile={t.manual_review}>
          <KV k="In queue" v={t.manual_review?.data?.count ?? "—"} />
          <KV k="Oldest item" v={fmtTime(t.manual_review?.data?.oldest_created_at)} />
          {(t.manual_review?.data?.items || []).slice(0, 5).map((i) => (
            <div key={i.task_id} className="mt-1 truncate text-[11px] text-gray-400">
              {i.brand_name}: {i.title || i.task_type}
            </div>
          ))}
        </Tile>

        <Tile title="7 · AI cost" tile={t.ai_cost}>
          <KV k="Today" v={fmtMoney(t.ai_cost?.data?.totals?.cost_today)} />
          <KV k="Last 7 days" v={fmtMoney(t.ai_cost?.data?.totals?.cost_7d)} />
          <KV k="Calls (7d)" v={t.ai_cost?.data?.totals?.calls_7d ?? "—"} />
          {(t.ai_cost?.data?.top_by_feature_7d || []).slice(0, 5).map((r, i) => (
            <KV key={i} k={`${r.feature || "unknown"} (${r.provider})`} v={fmtMoney(r.cost)} />
          ))}
        </Tile>

        <Tile title="8 · External-proof freshness" tile={t.proof_freshness}>
          <KV k="Proofs (7d)" v={t.proof_freshness?.data?.proofs_7d ?? "—"} />
          {(t.proof_freshness?.data?.latest_by_kind || []).slice(0, 6).map((r, i) => (
            <KV key={i} k={`${r.provider}/${r.action}`} v={fmtTime(r.verified_at)} />
          ))}
        </Tile>

        <Tile title="9 · Deployment" tile={t.version}>
          <KV k="Version" v={t.version?.data?.deploy_version || "unknown"} />
          <KV k="Environment" v={t.version?.data?.environment || "—"} />
          <KV k="Server started" v={fmtTime(t.version?.data?.server_started_at)} />
        </Tile>

        <Tile title="10 · Customers & TTFV" tile={t.customers}>
          <KV k="Users" v={t.customers?.data?.activity?.users_total ?? "—"} />
          <KV k="Signups (7d / 30d)" v={`${t.customers?.data?.activity?.signups_7d ?? "—"} / ${t.customers?.data?.activity?.signups_30d ?? "—"}`} />
          <KV k="Onboarded" v={t.customers?.data?.activity?.onboarded ?? "—"} />
          <KV
            k="TTFV median — verified proof (PRIMARY)"
            v={ttfv.median_ttfv_proof_seconds != null ? `${(Number(ttfv.median_ttfv_proof_seconds) / 3600).toFixed(1)}h` : "No data yet"}
          />
          <KV
            k="TTFV median — first spine task (secondary)"
            v={ttfv.median_ttfv_task_seconds != null ? `${(Number(ttfv.median_ttfv_task_seconds) / 3600).toFixed(1)}h` : "No data yet"}
          />
        </Tile>

        <Tile title="11 · Campaign truth" tile={t.campaigns}>
          {Object.entries(t.campaigns?.data?.by_status || {}).map(([s, n]) => (
            <KV key={s} k={s} v={n} />
          ))}
          <KV k="Live w/ stale verification" v={t.campaigns?.data?.live_verification_stale ?? "—"} />
          <KV k="Last verified" v={fmtTime(t.campaigns?.data?.last_verified_at)} />
        </Tile>

        <Tile title="12 · Hermes usage (48h)" tile={t.hermes}>
          {hermes48 ? (
            <>
              <KV k="Eligible invocations" v={hermes48.eligible_invocations} />
              <KV k="Non-null" v={hermes48.counts.non_null} accent="text-emerald-300" />
              <KV k="Null" v={hermes48.counts.null} />
              <KV k="Errors" v={hermes48.counts.error} />
              <KV k="Timeouts" v={hermes48.counts.timeout} />
              <KV k="Suppressed (excluded from rate)" v={hermes48.counts.suppressed} />
              <KV
                k="Non-null rate"
                v={hermes48.non_null_rate != null ? `${(hermes48.non_null_rate * 100).toFixed(1)}%` : "No eligible invocations"}
              />
            </>
          ) : (
            <p className="text-sm text-gray-400">No Hermes decisions in window.</p>
          )}
        </Tile>
      </div>
    </div>
  );
}
