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

const EMPTY_FORM = {
  agencyName: "",
  ownerEmail: "",
  logoUrl: "",
  primaryColor: "#f59e0b",
  secondaryColor: "#111827",
  customDomain: "",
  supportEmail: "",
};

export default function AdminWhiteLabel() {
  const [agencies, setAgencies] = useState([]);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.listAllAgencies();
      setAgencies(data.agencies || []);
      setTotals(data.totals || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setFormError("");
    setSuccess("");
    setCreating(true);
    try {
      await api.createAgency({
        agencyName: form.agencyName.trim(),
        ownerEmail: form.ownerEmail.trim() || undefined,
        logoUrl: form.logoUrl.trim() || undefined,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        customDomain: form.customDomain.trim() || undefined,
        supportEmail: form.supportEmail.trim() || undefined,
      });
      setForm(EMPTY_FORM);
      setSuccess("Agency created.");
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <Spinner label="Loading agencies…" />;

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Agencies" value={totals ? totals.agencies : 0} />
        <StatCard label="Total customers" value={totals ? totals.customers : 0} />
        <StatCard
          label="Total monthly revenue"
          value={currency(totals ? totals.monthlyRevenue : 0)}
        />
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="mb-3 text-sm font-semibold text-gray-200">
          Create an agency
        </h3>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Agency name *">
              <input
                type="text"
                required
                value={form.agencyName}
                onChange={(e) => update("agencyName", e.target.value)}
                className={inputClass}
                placeholder="Acme Marketing"
              />
            </Field>
            <Field label="Owner email (defaults to you)">
              <input
                type="email"
                value={form.ownerEmail}
                onChange={(e) => update("ownerEmail", e.target.value)}
                className={inputClass}
                placeholder="owner@acme.com"
              />
            </Field>
            <Field label="Logo URL (https)">
              <input
                type="url"
                value={form.logoUrl}
                onChange={(e) => update("logoUrl", e.target.value)}
                className={inputClass}
                placeholder="https://cdn.acme.com/logo.png"
              />
            </Field>
            <Field label="Custom domain">
              <input
                type="text"
                value={form.customDomain}
                onChange={(e) => update("customDomain", e.target.value)}
                className={inputClass}
                placeholder="app.acme.com"
              />
            </Field>
            <Field label="Support email">
              <input
                type="email"
                value={form.supportEmail}
                onChange={(e) => update("supportEmail", e.target.value)}
                className={inputClass}
                placeholder="support@acme.com"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Primary">
                <ColorInput
                  value={form.primaryColor}
                  onChange={(v) => update("primaryColor", v)}
                />
              </Field>
              <Field label="Secondary">
                <ColorInput
                  value={form.secondaryColor}
                  onChange={(v) => update("secondaryColor", v)}
                />
              </Field>
            </div>
          </div>

          <ErrorBanner message={formError} />
          {success && (
            <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-300">
              {success}
            </p>
          )}

          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-amber-600 disabled:opacity-60"
          >
            {creating ? "Creating…" : "Create agency"}
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">Agency</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium">Domain</th>
              <th className="px-4 py-3 font-medium">Customers</th>
              <th className="px-4 py-3 font-medium">Monthly revenue</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 bg-gray-950 text-gray-200">
            {agencies.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  No agencies yet. Create your first agency above.
                </td>
              </tr>
            ) : (
              agencies.map((a) => (
                <tr key={a.agencyId}>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: a.primaryColor || "#f59e0b" }}
                      />
                      {a.agencyName}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{a.ownerEmail}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {a.customDomain || "—"}
                  </td>
                  <td className="px-4 py-3">{a.customerCount}</td>
                  <td className="px-4 py-3">{currency(a.monthlyRevenue)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        a.isActive
                          ? "bg-green-500/10 text-green-300"
                          : "bg-gray-700 text-gray-400"
                      }`}
                    >
                      {a.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-gray-100">{value}</p>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none";

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-400">
        {label}
      </label>
      {children}
    </div>
  );
}

function ColorInput({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-10 cursor-pointer rounded border border-gray-700 bg-gray-950"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
        placeholder="#f59e0b"
      />
    </div>
  );
}
