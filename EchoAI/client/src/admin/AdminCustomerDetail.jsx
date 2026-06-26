import { useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const TEMPERATURES = ["tire_kicker", "warm", "hot"];

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function money(n) {
  if (n === null || n === undefined) return "—";
  return `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function Card({ title, children }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

export default function AdminCustomerDetail({ userId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const result = await api.adminGetUser(userId);
        if (active) setData(result);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="text-sm font-medium text-amber-700 hover:underline"
      >
        ← Back to customers
      </button>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading customer…" />
      ) : !data ? null : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Profile">
            <dl className="space-y-1 text-sm text-gray-700">
              <div className="flex justify-between">
                <dt className="text-gray-500">Name</dt>
                <dd>{data.user.name || "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Email</dt>
                <dd>{data.user.email}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Industry</dt>
                <dd>{data.user.industry || "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Team size</dt>
                <dd>{data.user.teamSize}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Joined</dt>
                <dd>{formatDate(data.user.joinedAt)}</dd>
              </div>
            </dl>
          </Card>

          <Card title="Subscription">
            {data.subscription ? (
              <dl className="space-y-1 text-sm text-gray-700">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Tier</dt>
                  <dd>{data.subscription.subscription_tier}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Payment status</dt>
                  <dd>{data.subscription.payment_status}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Renewal date</dt>
                  <dd>{formatDate(data.subscription.renewal_date)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Account</dt>
                  <dd>{data.subscription.is_locked ? "Locked" : "Active"}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-gray-400">No subscription on record.</p>
            )}
          </Card>

          <Card title="Lead counts by temperature">
            <div className="grid grid-cols-3 gap-3 text-center">
              {TEMPERATURES.map((t) => (
                <div key={t} className="rounded-lg bg-gray-50 p-3">
                  <p className="text-2xl font-bold text-gray-900">
                    {data.leadsByTemperature[t] || 0}
                  </p>
                  <p className="text-xs capitalize text-gray-500">
                    {t.replace("_", " ")}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <Card title={`Brands (${data.brands.length})`}>
            {data.brands.length === 0 ? (
              <p className="text-sm text-gray-400">No brands yet.</p>
            ) : (
              <ul className="space-y-1 text-sm text-gray-700">
                {data.brands.map((b) => (
                  <li key={b.brand_id} className="flex justify-between">
                    <span>{b.brand_name}</span>
                    <span className="text-xs text-gray-400">
                      {formatDate(b.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Campaigns (${data.campaigns.length})`}>
            {data.campaigns.length === 0 ? (
              <p className="text-sm text-gray-400">No campaigns yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs uppercase text-gray-400">
                    <tr>
                      <th className="py-1 pr-4">Name</th>
                      <th className="py-1 pr-4">Status</th>
                      <th className="py-1 pr-4">Budget</th>
                      <th className="py-1">CPL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.campaigns.map((c) => (
                      <tr key={c.campaign_id} className="border-t border-gray-100">
                        <td className="py-1 pr-4 text-gray-800">
                          {c.campaign_name}
                        </td>
                        <td className="py-1 pr-4 text-gray-600">{c.status}</td>
                        <td className="py-1 pr-4 text-gray-600">
                          {money(c.budget)}
                        </td>
                        <td className="py-1 text-gray-600">
                          {money(c.cost_per_lead)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Recent analytics">
            {data.recentAnalytics.length === 0 ? (
              <p className="text-sm text-gray-400">No analytics recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs uppercase text-gray-400">
                    <tr>
                      <th className="py-1 pr-4">Week</th>
                      <th className="py-1 pr-4">Spend</th>
                      <th className="py-1 pr-4">Leads</th>
                      <th className="py-1 pr-4">Conv.</th>
                      <th className="py-1">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentAnalytics.map((a, i) => (
                      <tr
                        key={`${a.brand_id}-${a.week_date}-${i}`}
                        className="border-t border-gray-100"
                      >
                        <td className="py-1 pr-4 text-gray-800">
                          {formatDate(a.week_date)}
                        </td>
                        <td className="py-1 pr-4 text-gray-600">
                          {money(a.total_spend)}
                        </td>
                        <td className="py-1 pr-4 text-gray-600">
                          {a.total_leads}
                        </td>
                        <td className="py-1 pr-4 text-gray-600">
                          {a.conversions}
                        </td>
                        <td className="py-1 text-gray-600">
                          {a.return_on_ad_spend ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
