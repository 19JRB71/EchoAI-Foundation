import { useState } from "react";
import { api } from "../api.js";
import ErrorBanner from "../components/ErrorBanner.jsx";
import { useBranding } from "../lib/BrandingContext.jsx";

const inputClass =
  "w-full rounded-lg border border-gray-700 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

export default function Login({ onLogin }) {
  const { branding } = useBranding();
  const isDefaultBrand = branding.agencyName === "EchoAI";
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data =
        mode === "login"
          ? await api.login(email, password)
          : await api.register(
              email,
              password,
              teamSize ? Number(teamSize) : undefined
            );
      if (!data || !data.token) throw new Error("No token returned");
      onLogin(data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4">
      <div className="w-full max-w-md rounded-2xl bg-gray-900 p-8 shadow-xl">
        <div className="mb-6 text-center">
          {branding.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={branding.agencyName}
              className="mx-auto max-h-12 w-auto object-contain"
            />
          ) : isDefaultBrand ? (
            <h1 className="text-2xl font-bold text-gray-100">
              Echo<span style={{ color: branding.primaryColor }}>AI</span>
            </h1>
          ) : (
            <h1 className="text-2xl font-bold text-gray-100">
              {branding.agencyName}
            </h1>
          )}
          <p className="mt-1 text-sm text-gray-400">
            {mode === "login"
              ? "Sign in to your dashboard"
              : "Create your account"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="you@business.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="••••••••"
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">
                Team size (optional)
              </label>
              <input
                type="number"
                min="1"
                value={teamSize}
                onChange={(e) => setTeamSize(e.target.value)}
                className={inputClass}
                placeholder="1"
              />
            </div>
          )}

          <ErrorBanner message={error} />

          <button
            type="submit"
            disabled={loading}
            style={{ backgroundColor: branding.primaryColor }}
            className="w-full rounded-lg py-2.5 text-sm font-semibold text-gray-900 transition hover:opacity-90 disabled:opacity-60"
          >
            {loading
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-400">
          {mode === "login"
            ? `New to ${branding.agencyName}?`
            : "Already have an account?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
            }}
            className="font-semibold text-amber-300 hover:underline"
          >
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
