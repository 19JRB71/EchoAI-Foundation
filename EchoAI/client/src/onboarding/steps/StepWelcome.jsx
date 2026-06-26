// Step 1 — Welcome & account setup.
// Warmly introduces EchoAI and confirms the customer's business name,
// industry/niche, and team size, saving them to the user profile.

import { useEffect, useState } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const primaryBtn =
  "rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60";

export default function StepWelcome({ onNext }) {
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [teamSize, setTeamSize] = useState("1");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const profile = await api.getProfile();
        if (!active) return;
        if (profile.businessName) setBusinessName(profile.businessName);
        if (profile.industry) setIndustry(profile.industry);
        if (profile.teamSize != null) setTeamSize(String(profile.teamSize));
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

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.updateProfile({
        businessName: businessName.trim(),
        industry: industry.trim(),
        teamSize: Number(teamSize) || 1,
      });
      onNext();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <Spinner label="Loading…" />
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-2xl font-bold text-gray-900">Welcome to EchoAI 👋</h1>
      <p className="mt-3 text-sm leading-relaxed text-gray-600">
        EchoAI is your always-on AI marketing team. We learn your brand inside
        and out, then design, launch, and continuously optimize Facebook ad
        campaigns that bring you qualified leads — automatically. Let's spend a
        couple of minutes getting your account ready.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Business name">
          <input
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Acme Co."
            required
            className={inputClass}
          />
        </Field>
        <Field label="Industry or niche">
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="e.g. Home services, SaaS, fitness coaching"
            required
            className={inputClass}
          />
        </Field>
        <Field label="How many team members will use EchoAI?">
          <input
            type="number"
            min="1"
            value={teamSize}
            onChange={(e) => setTeamSize(e.target.value)}
            required
            className={inputClass}
          />
        </Field>

        <ErrorBanner message={error} />
        <div className="flex justify-end">
          <button disabled={saving} className={primaryBtn}>
            {saving ? "Saving…" : "Continue"}
          </button>
        </div>
      </form>
    </Card>
  );
}

function Card({ children }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </label>
      {children}
    </div>
  );
}
