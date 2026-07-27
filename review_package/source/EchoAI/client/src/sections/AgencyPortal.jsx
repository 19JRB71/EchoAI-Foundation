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

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

const TABS = [
  { key: "customers", label: "Customers" },
  { key: "branding", label: "White Label" },
];

export default function AgencyPortal() {
  const [tab, setTab] = useState("customers");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-100">Agency Portal</h2>
        <p className="text-sm text-gray-400">
          Manage the customers you resell to and your white-label branding.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                active
                  ? "border-amber-500 text-amber-300"
                  : "border-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "customers" && <CustomersTab />}
      {tab === "branding" && <BrandingTab />}
    </div>
  );
}

function CustomersTab() {
  const [customers, setCustomers] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [email, setEmail] = useState("");
  const [price, setPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [c, r] = await Promise.all([
        api.getAgencyCustomers(),
        api.getAgencyRevenue(),
      ]);
      setCustomers(c.customers || []);
      setReport(r.report || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    setFormError("");
    setAdding(true);
    try {
      await api.addAgencyCustomer({
        customerEmail: email.trim(),
        monthlyPrice: Number(price),
      });
      setEmail("");
      setPrice("");
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setAdding(false);
    }
  }

  if (loading) return <Spinner label="Loading customers…" />;

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Customers" value={report ? report.customerCount : 0} />
        <StatCard
          label="Monthly revenue"
          value={currency(report ? report.monthlyRevenue : 0)}
        />
        <StatCard
          label="Annual revenue"
          value={currency(report ? report.annualRevenue : 0)}
        />
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="mb-3 text-sm font-semibold text-gray-200">
          Add a customer
        </h3>
        <form
          onSubmit={handleAdd}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-400">
              Customer email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@business.com"
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div className="w-full sm:w-40">
            <label className="mb-1 block text-xs font-medium text-gray-400">
              Monthly price ($)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={adding}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-amber-600 disabled:opacity-60"
          >
            {adding ? "Adding…" : "Add customer"}
          </button>
        </form>
        <ErrorBanner message={formError} />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Monthly price</th>
              <th className="px-4 py-3 font-medium">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 bg-gray-950 text-gray-200">
            {customers.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                  No customers yet. Add your first customer above.
                </td>
              </tr>
            ) : (
              customers.map((c) => (
                <tr key={c.agencyCustomerId}>
                  <td className="px-4 py-3">{c.email}</td>
                  <td className="px-4 py-3">{currency(c.monthlyPrice)}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {formatDate(c.createdAt)}
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

const EMPTY_FORM = {
  agencyName: "",
  logoUrl: "",
  primaryColor: "#f59e0b",
  secondaryColor: "#111827",
  customDomain: "",
  supportEmail: "",
};

function BrandingTab() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api.getAgencySettings();
        const a = data.agency || {};
        if (active) {
          setForm({
            agencyName: a.agencyName || "",
            logoUrl: a.logoUrl || "",
            primaryColor: a.primaryColor || "#f59e0b",
            secondaryColor: a.secondaryColor || "#111827",
            customDomain: a.customDomain || "",
            supportEmail: a.supportEmail || "",
          });
        }
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

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      await api.updateAgencySettings({
        agencyName: form.agencyName.trim(),
        logoUrl: form.logoUrl.trim() || null,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        customDomain: form.customDomain.trim() || null,
        supportEmail: form.supportEmail.trim() || null,
      });
      setSuccess("Branding saved. Customers on your domain will see it.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label="Loading branding…" />;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <form
        onSubmit={handleSave}
        className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5"
      >
        <Field label="Agency name">
          <input
            type="text"
            required
            value={form.agencyName}
            onChange={(e) => update("agencyName", e.target.value)}
            className={inputClass}
            placeholder="Acme Marketing"
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
        <div className="grid grid-cols-2 gap-4">
          <Field label="Primary color">
            <ColorInput
              value={form.primaryColor}
              onChange={(v) => update("primaryColor", v)}
            />
          </Field>
          <Field label="Secondary color">
            <ColorInput
              value={form.secondaryColor}
              onChange={(v) => update("secondaryColor", v)}
            />
          </Field>
        </div>
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

        <ErrorBanner message={error} />
        {success && (
          <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-300">
            {success}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-amber-600 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save branding"}
        </button>
      </form>

      <BrandingPreview form={form} />
    </div>
  );
}

function BrandingPreview({ form }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
        Live preview
      </p>
      <div className="overflow-hidden rounded-lg border border-gray-800">
        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{ backgroundColor: form.secondaryColor }}
        >
          {form.logoUrl ? (
            <img
              src={form.logoUrl}
              alt={form.agencyName}
              className="max-h-8 w-auto object-contain"
            />
          ) : (
            <span className="text-lg font-bold text-white">
              {form.agencyName || "Your Agency"}
            </span>
          )}
        </div>
        <div className="space-y-3 bg-gray-950 p-4">
          <div
            className="inline-block rounded-md px-3 py-1.5 text-sm font-semibold text-gray-900"
            style={{ backgroundColor: form.primaryColor }}
          >
            Sign in
          </div>
          <p className="text-sm text-gray-400">
            This is how the dashboard accent and logo appear to your customers.
          </p>
          {form.supportEmail && (
            <p className="text-xs text-gray-500">Support: {form.supportEmail}</p>
          )}
        </div>
      </div>
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
