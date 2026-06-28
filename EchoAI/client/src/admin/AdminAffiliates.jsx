import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

function currency(value) {
  return `$${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function AdminAffiliates() {
  const [affiliates, setAffiliates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.adminListAffiliates();
      setAffiliates(data.affiliates || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(fn, id) {
    setBusyId(id);
    setError("");
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  if (loading) return <Spinner label="Loading affiliates…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">Affiliate</th>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Referrals</th>
              <th className="px-4 py-3 font-medium">Pending</th>
              <th className="px-4 py-3 font-medium">Approved</th>
              <th className="px-4 py-3 font-medium">Paid</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 bg-gray-950 text-gray-200">
            {affiliates.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                  No affiliates yet.
                </td>
              </tr>
            ) : (
              affiliates.map((a) => {
                const busy = busyId === a.affiliateId;
                return (
                  <tr key={a.affiliateId}>
                    <td className="px-4 py-3">
                      <div>{a.email}</div>
                      {a.paypalEmail && (
                        <div className="text-xs text-gray-500">
                          PayPal: {a.paypalEmail}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-300">
                      {a.referralCode}
                    </td>
                    <td className="px-4 py-3">
                      {a.convertedCount}/{a.referralCount}
                    </td>
                    <td className="px-4 py-3">{currency(a.pendingAmount)}</td>
                    <td className="px-4 py-3">{currency(a.approvedAmount)}</td>
                    <td className="px-4 py-3">{currency(a.paidAmount)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          a.status === "active"
                            ? "bg-green-500/10 text-green-300"
                            : "bg-red-500/10 text-red-300"
                        }`}
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          disabled={busy || a.pendingAmount <= 0}
                          onClick={() =>
                            act(
                              () =>
                                api.adminUpdateAffiliateCommissions({
                                  affiliateId: a.affiliateId,
                                  action: "approve",
                                }),
                              a.affiliateId
                            )
                          }
                          className="rounded-lg bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-300 transition hover:bg-blue-500/20 disabled:opacity-40"
                        >
                          Approve
                        </button>
                        <button
                          disabled={busy || a.approvedAmount <= 0}
                          onClick={() =>
                            act(
                              () =>
                                api.adminUpdateAffiliateCommissions({
                                  affiliateId: a.affiliateId,
                                  action: "pay",
                                }),
                              a.affiliateId
                            )
                          }
                          className="rounded-lg bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-300 transition hover:bg-green-500/20 disabled:opacity-40"
                        >
                          Mark paid
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            act(
                              () =>
                                api.adminSetAffiliateStatus({
                                  affiliateId: a.affiliateId,
                                  status:
                                    a.status === "active"
                                      ? "suspended"
                                      : "active",
                                }),
                              a.affiliateId
                            )
                          }
                          className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 transition hover:bg-gray-600 disabled:opacity-40"
                        >
                          {a.status === "active" ? "Suspend" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
