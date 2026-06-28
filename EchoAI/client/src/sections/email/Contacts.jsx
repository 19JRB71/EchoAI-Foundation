import { useEffect, useState } from "react";
import { api } from "../../api.js";

export default function Contacts({ brandId, refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!brandId) return;
    let active = true;
    setLoading(true);
    setError("");
    api
      .getEmailContacts(brandId)
      .then((d) => active && setData(d))
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [brandId, refreshKey]);

  if (loading) return <p className="text-sm text-gray-400">Loading contacts…</p>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">
        {data.count} contacts with an email · {data.subscribed} subscribed
      </p>
      {data.contacts.length === 0 ? (
        <p className="text-sm text-gray-400">
          No contacts with an email address yet. Capture leads to build your list.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-900/80 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Temperature</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Subscribed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {data.contacts.map((c) => (
                <tr key={c.leadId} className="text-gray-200">
                  <td className="px-4 py-2">{c.name || "—"}</td>
                  <td className="px-4 py-2">{c.email}</td>
                  <td className="px-4 py-2 capitalize">{(c.temperature || "").replace("_", " ")}</td>
                  <td className="px-4 py-2 capitalize">{(c.conversionStatus || "").replace("_", " ")}</td>
                  <td className="px-4 py-2">
                    {c.subscribed ? (
                      <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-300">
                        Subscribed
                      </span>
                    ) : (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-300">
                        Unsubscribed
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
