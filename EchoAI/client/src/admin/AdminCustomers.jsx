import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const TIERS = ["free", "starter", "growth", "pro", "enterprise"];

const COLUMNS = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "subscriptionTier", label: "Tier" },
  { key: "paymentStatus", label: "Payment" },
  { key: "isLocked", label: "Account" },
];

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

export default function AdminCustomers({ onView }) {
  const [users, setUsers] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.adminGetUsers({ page });
      setUsers(data.users || []);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? users.filter(
          (u) =>
            (u.name || "").toLowerCase().includes(term) ||
            (u.email || "").toLowerCase().includes(term)
        )
      : users;

    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return av > bv ? 1 : -1;
    });
    if (sortDir === "desc") sorted.reverse();
    return sorted;
  }, [users, search, sortKey, sortDir]);

  async function runAction(fn, userId) {
    setBusyId(userId);
    setError("");
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function handleDelete(user) {
    if (
      !window.confirm(
        `Permanently delete ${user.email} and all of their data? This cannot be undone.`
      )
    )
      return;
    runAction(() => api.adminDeleteUser(user.userId), user.userId);
  }

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or email…"
        className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading customers…" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className="cursor-pointer select-none px-4 py-3 hover:text-gray-800"
                  >
                    {c.label}
                    {sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                    No customers found.
                  </td>
                </tr>
              ) : (
                visible.map((u) => (
                  <tr key={u.userId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {u.name || "—"}
                      <div className="text-xs text-gray-400">
                        Joined {formatDate(u.joinedAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{u.email}</td>
                    <td className="px-4 py-3">
                      <select
                        value={u.subscriptionTier}
                        disabled={busyId === u.userId}
                        onChange={(e) =>
                          runAction(
                            () =>
                              api.adminUpdateUserTier(u.userId, e.target.value),
                            u.userId
                          )
                        }
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                      >
                        {TIERS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {u.paymentStatus || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          u.isLocked
                            ? "bg-red-100 text-red-700"
                            : "bg-green-100 text-green-700"
                        }`}
                      >
                        {u.isLocked ? "Locked" : "Active"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <button
                          onClick={() => onView(u.userId)}
                          className="font-medium text-indigo-600 hover:underline"
                        >
                          View
                        </button>
                        {u.isLocked ? (
                          <button
                            disabled={busyId === u.userId}
                            onClick={() =>
                              runAction(
                                () => api.adminUnlockUser(u.userId),
                                u.userId
                              )
                            }
                            className="font-medium text-green-600 hover:underline disabled:opacity-50"
                          >
                            Unlock
                          </button>
                        ) : (
                          <button
                            disabled={busyId === u.userId}
                            onClick={() =>
                              runAction(
                                () => api.adminLockUser(u.userId),
                                u.userId
                              )
                            }
                            className="font-medium text-amber-600 hover:underline disabled:opacity-50"
                          >
                            Lock
                          </button>
                        )}
                        <button
                          disabled={busyId === u.userId}
                          onClick={() => handleDelete(u)}
                          className="font-medium text-red-600 hover:underline disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-gray-600">
        <button
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(p - 1, 1))}
          className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-50"
        >
          Previous
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button
          disabled={page >= totalPages || loading}
          onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
          className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
