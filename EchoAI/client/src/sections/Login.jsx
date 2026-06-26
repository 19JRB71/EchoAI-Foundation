import { useState } from "react";
import { api } from "../api.js";
import ErrorBanner from "../components/ErrorBanner.jsx";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

export default function Login({ onLogin }) {
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
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900">
            Echo<span className="text-amber-700">AI</span>
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {mode === "login"
              ? "Sign in to your dashboard"
              : "Create your account"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
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
            <label className="mb-1 block text-sm font-medium text-gray-700">
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
              <label className="mb-1 block text-sm font-medium text-gray-700">
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
            className="w-full rounded-lg bg-amber-500 py-2.5 text-sm font-semibold text-gray-900 transition hover:bg-amber-600 disabled:opacity-60"
          >
            {loading
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          {mode === "login" ? "New to EchoAI?" : "Already have an account?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
            }}
            className="font-semibold text-amber-700 hover:underline"
          >
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
