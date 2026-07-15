import { useEffect, useState } from "react";
import { api } from "../api.js";
import MetricCard from "../components/MetricCard.jsx";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

function money(n) {
  const v = Number(n || 0);
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pct(n) {
  return n == null ? "—" : `${Number(n).toFixed(1)}%`;
}

function Table({ title, columns, rows, renderRow, empty }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
      <h4 className="mb-3 text-sm font-semibold text-gray-200">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-500">
                {columns.map((c) => (
                  <th key={c} className="pb-2 pr-4 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-gray-300">{rows.map(renderRow)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminEconomics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [workflow, setWorkflow] = useState(null);
  const [workflowError, setWorkflowError] = useState("");
  const [workflowLoading, setWorkflowLoading] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await api.adminGetEconomics();
        if (active) setData(d);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function lookupWorkflow(e) {
    e.preventDefault();
    const id = workflowId.trim();
    if (!id) return;
    setWorkflowLoading(true);
    setWorkflowError("");
    setWorkflow(null);
    try {
      setWorkflow(await api.adminGetEconomicsWorkflow(id));
    } catch (err) {
      setWorkflowError(err.message);
    } finally {
      setWorkflowLoading(false);
    }
  }

  if (loading) return <Spinner label="Computing AI economics…" />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  const m = data.margin || {};
  const c = data.cost || {};
  const r = data.revenue || {};
  const p = data.projection || {};

  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-500">{data.basis}</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Monthly revenue (run-rate)"
          value={money(r.totalMonthly)}
          hint={`${r.payingCustomers ?? 0} paying customers`}
        />
        <MetricCard
          label="AI cost month-to-date"
          value={money(c.totalMonthToDate)}
          hint={`${(c.callsMonthToDate ?? 0).toLocaleString()} operations`}
        />
        <MetricCard
          label="Gross profit"
          value={money(m.grossProfit)}
          hint={`Margin ${pct(m.grossMarginPct)}`}
        />
        <MetricCard
          label="Projected AI bill"
          value={money(p.projectedMonthlyAiBill)}
          hint={`Projected margin ${pct(p.projectedGrossMarginPct)}`}
        />
        <MetricCard
          label="AI cost / customer"
          value={m.aiCostPerCustomer == null ? "—" : money(m.aiCostPerCustomer)}
        />
        <MetricCard
          label="AI cost / business"
          value={m.aiCostPerBusiness == null ? "—" : money(m.aiCostPerBusiness)}
        />
        <MetricCard
          label="Background automation"
          value={money(c.backgroundAutomation)}
          hint="Scheduled + autonomous work"
        />
        <MetricCard
          label="Echo orchestrator"
          value={money(c.echoOrchestrator)}
          hint="Hermes decisions + Echo"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
          <h4 className="mb-2 text-sm font-semibold text-gray-200">
            Most expensive customer
          </h4>
          {data.mostExpensiveCustomer ? (
            <p className="text-sm text-gray-300">
              {data.mostExpensiveCustomer.email || data.mostExpensiveCustomer.userId}
              {" — "}
              {money(data.mostExpensiveCustomer.cost)} AI cost,{" "}
              {money(data.mostExpensiveCustomer.monthlyRevenue)} revenue (
              {money(data.mostExpensiveCustomer.monthlyProfit)} profit)
            </p>
          ) : (
            <p className="text-sm text-gray-500">No usage recorded yet.</p>
          )}
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
          <h4 className="mb-2 text-sm font-semibold text-gray-200">
            Most profitable customer
          </h4>
          {data.mostProfitableCustomer ? (
            <p className="text-sm text-gray-300">
              {data.mostProfitableCustomer.email || data.mostProfitableCustomer.userId}
              {" — "}
              {money(data.mostProfitableCustomer.monthlyProfit)} profit (
              {money(data.mostProfitableCustomer.monthlyRevenue)} revenue,{" "}
              {money(data.mostProfitableCustomer.cost)} AI cost)
            </p>
          ) : (
            <p className="text-sm text-gray-500">No paying customers with usage yet.</p>
          )}
        </div>
      </div>

      <Table
        title="Top customers by AI cost (month-to-date)"
        columns={["Customer", "AI cost", "Revenue", "Profit", "Operations"]}
        rows={data.topCustomers || []}
        empty="No customer usage this month."
        renderRow={(u) => (
          <tr key={u.userId} className="border-t border-gray-800/60">
            <td className="py-2 pr-4">{u.email || u.userId}</td>
            <td className="py-2 pr-4">{money(u.cost)}</td>
            <td className="py-2 pr-4">{money(u.monthlyRevenue)}</td>
            <td className={`py-2 pr-4 ${u.monthlyProfit < 0 ? "text-red-400" : "text-emerald-400"}`}>
              {money(u.monthlyProfit)}
            </td>
            <td className="py-2 pr-4">{u.calls.toLocaleString()}</td>
          </tr>
        )}
      />

      <Table
        title="Top businesses (brands) by AI cost"
        columns={["Business", "AI cost", "Operations"]}
        rows={data.topBusinesses || []}
        empty="No brand-attributed usage this month."
        renderRow={(b) => (
          <tr key={b.brandId} className="border-t border-gray-800/60">
            <td className="py-2 pr-4">
              {b.brandName || b.brandId}
              {b.isDemo && (
                <span className="ml-2 rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
                  demo
                </span>
              )}
            </td>
            <td className="py-2 pr-4">{money(b.cost)}</td>
            <td className="py-2 pr-4">{b.calls.toLocaleString()}</td>
          </tr>
        )}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Table
          title="Cost by AI agent"
          columns={["Agent", "Cost", "Operations"]}
          rows={data.byAgent || []}
          empty="No usage this month."
          renderRow={(a) => (
            <tr key={a.agent} className="border-t border-gray-800/60">
              <td className="py-2 pr-4 capitalize">{a.agent}</td>
              <td className="py-2 pr-4">{money(a.cost)}</td>
              <td className="py-2 pr-4">{a.calls.toLocaleString()}</td>
            </tr>
          )}
        />
        <Table
          title="Cost by feature"
          columns={["Feature", "Cost", "Operations"]}
          rows={data.byFeature || []}
          empty="No usage this month."
          renderRow={(f) => (
            <tr key={f.feature} className="border-t border-gray-800/60">
              <td className="py-2 pr-4">{f.feature}</td>
              <td className="py-2 pr-4">{money(f.cost)}</td>
              <td className="py-2 pr-4">{f.calls.toLocaleString()}</td>
            </tr>
          )}
        />
      </div>

      <Table
        title="Cost by provider & unit"
        columns={["Provider", "Unit", "Units", "Cost", "Operations"]}
        rows={data.byProviderUnit || []}
        empty="No usage this month."
        renderRow={(pr) => (
          <tr key={`${pr.provider}:${pr.unitType}`} className="border-t border-gray-800/60">
            <td className="py-2 pr-4 capitalize">{pr.provider}</td>
            <td className="py-2 pr-4">{pr.unitType}</td>
            <td className="py-2 pr-4">{Number(pr.units).toLocaleString()}</td>
            <td className="py-2 pr-4">{money(pr.cost)}</td>
            <td className="py-2 pr-4">{pr.calls.toLocaleString()}</td>
          </tr>
        )}
      />

      <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
        <h4 className="mb-3 text-sm font-semibold text-gray-200">
          Workflow cost drill-down
        </h4>
        <form onSubmit={lookupWorkflow} className="mb-3 flex gap-2">
          <input
            value={workflowId}
            onChange={(e) => setWorkflowId(e.target.value)}
            placeholder="Paste a workflow id…"
            className="w-full max-w-md rounded border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:border-amber-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={workflowLoading || !workflowId.trim()}
            className="rounded bg-amber-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-amber-500 disabled:opacity-50"
          >
            {workflowLoading ? "Loading…" : "Look up"}
          </button>
        </form>
        {workflowError && <ErrorBanner message={workflowError} />}
        {workflow && (
          <div className="space-y-2">
            <p className="text-sm text-gray-300">
              {workflow.calls} steps — total {money(workflow.totalCostUsd)}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-gray-500">
                    <th className="pb-2 pr-4 font-medium">When</th>
                    <th className="pb-2 pr-4 font-medium">Provider</th>
                    <th className="pb-2 pr-4 font-medium">Feature</th>
                    <th className="pb-2 pr-4 font-medium">Units</th>
                    <th className="pb-2 pr-4 font-medium">Cost</th>
                    <th className="pb-2 pr-4 font-medium">OK</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {workflow.steps.map((s, i) => (
                    <tr key={s.request_id || i} className="border-t border-gray-800/60">
                      <td className="py-1.5 pr-4 whitespace-nowrap">
                        {new Date(s.at).toLocaleTimeString()}
                      </td>
                      <td className="py-1.5 pr-4">
                        {s.provider}
                        {s.model ? ` (${s.model})` : ""}
                      </td>
                      <td className="py-1.5 pr-4">{s.feature}</td>
                      <td className="py-1.5 pr-4">
                        {s.unit_type
                          ? `${Number(s.unit_quantity || 0).toLocaleString()} ${s.unit_type}`
                          : `${Number(s.input_tokens || 0).toLocaleString()} in / ${Number(s.output_tokens || 0).toLocaleString()} out`}
                      </td>
                      <td className="py-1.5 pr-4">{money(s.estimated_cost_usd)}</td>
                      <td className="py-1.5 pr-4">{s.success ? "✓" : "✗"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
