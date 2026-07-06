import { useState } from "react";
import { api } from "../api.js";

const EMPTY = { name: "", businessType: "", phone: "", email: "" };

export default function DemoForm() {
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState("idle"); // idle | submitting | done
  const [error, setError] = useState("");

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setStatus("submitting");
    try {
      await api.requestDemo(form);
      setForm(EMPTY);
      setStatus("done");
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
      setStatus("idle");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-2xl border border-teal-400/30 bg-slate-900/70 p-10 text-center shadow-2xl">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-teal-400/15 text-3xl">
          ✓
        </div>
        <h3 className="text-2xl font-bold text-white">You're booked in.</h3>
        <p className="mt-3 text-slate-300">
          Thanks for reaching out. We'll call you within{" "}
          <span className="font-semibold text-teal-400">24 hours</span> to set up
          your free demo and onboarding.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-white/10 bg-slate-900/70 p-6 shadow-2xl sm:p-8"
    >
      <div className="space-y-4">
        <Field
          label="Your name"
          value={form.name}
          onChange={(v) => update("name", v)}
          placeholder="Jane Smith"
          autoComplete="name"
        />
        <Field
          label="Business type"
          value={form.businessType}
          onChange={(v) => update("businessType", v)}
          placeholder="e.g. Dental clinic, Gym, Law firm"
        />
        <Field
          label="Phone number"
          type="tel"
          value={form.phone}
          onChange={(v) => update("phone", v)}
          placeholder="(555) 123-4567"
          autoComplete="tel"
        />
        <Field
          label="Email"
          type="email"
          value={form.email}
          onChange={(v) => update("email", v)}
          placeholder="you@business.com"
          autoComplete="email"
        />
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="mt-6 w-full rounded-xl bg-gradient-to-r from-teal-400 to-cyan-500 px-6 py-4 text-lg font-bold text-black shadow-lg shadow-teal-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "submitting" ? "Booking your demo…" : "Book Your Free Demo"}
      </button>
      <p className="mt-3 text-center text-xs text-slate-400">
        No credit card. No commitment. We'll call you within 24 hours.
      </p>
    </form>
  );
}

function Field({ label, value, onChange, type = "text", placeholder, autoComplete }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-300">
        {label}
      </span>
      <input
        type={type}
        required
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-white placeholder-slate-500 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-400/30"
      />
    </label>
  );
}
