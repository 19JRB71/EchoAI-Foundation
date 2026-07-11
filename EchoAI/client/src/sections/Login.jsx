import { useEffect, useState } from "react";
import { api } from "../api.js";
import ErrorBanner from "../components/ErrorBanner.jsx";
import { useBranding } from "../lib/BrandingContext.jsx";
import { isDefaultBrand as isDefaultBranding } from "../lib/branding.js";
import { getReferralCode, clearReferralCode } from "../lib/referral.js";
import HealthSupportWidget from "../components/HealthSupportWidget.jsx";
import { unlockAudio } from "../voice/audioUnlock.js";

const inputClass =
  "w-full rounded-lg border border-gray-700 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

export default function Login({ onLogin, invitePending = false }) {
  const { branding } = useBranding();
  const isDefaultBrand = isDefaultBranding(branding);
  const [mode, setMode] = useState(invitePending ? "register" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [betaFull, setBetaFull] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistDone, setWaitlistDone] = useState("");
  const [waitlistBusy, setWaitlistBusy] = useState(false);

  // When the signup form is shown, ask the server whether the beta program is
  // at capacity so we can offer the waitlist instead of a doomed signup.
  useEffect(() => {
    if (mode !== "register") return;
    let cancelled = false;
    api
      .getSignupMode()
      .then((data) => {
        if (!cancelled) setBetaFull(Boolean(data && data.betaFull));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode]);

  async function handleWaitlist(e) {
    e.preventDefault();
    setWaitlistBusy(true);
    setError("");
    try {
      const data = await api.joinBetaWaitlist(waitlistEmail.trim());
      setWaitlistDone(data.message || "You're on the list!");
    } catch (err) {
      setError(err.message);
    } finally {
      setWaitlistBusy(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    // This submit is a genuine user gesture: prime audio now so Echo's morning
    // briefing can auto-play right after login without a further click.
    unlockAudio();
    setError("");
    setLoading(true);
    try {
      const data =
        mode === "login"
          ? await api.login(email, password, rememberDevice)
          : await api.register(
              email,
              password,
              teamSize ? Number(teamSize) : undefined,
              getReferralCode() || undefined,
              rememberDevice
            );
      if (!data || !data.token) throw new Error("No token returned");
      // The referral code has been attributed server-side; clear it so it isn't
      // reused for a future signup on this browser.
      if (mode === "register") clearReferralCode();
      onLogin(data.token, rememberDevice);
    } catch (err) {
      // The beta filled up between page load and submit: switch to the
      // waitlist form instead of showing a dead-end error.
      if (mode === "register" && err.data && err.data.waitlistOpen) {
        setBetaFull(true);
        setWaitlistEmail(email);
      }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const showWaitlist = mode === "register" && betaFull;

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
            <img
              src="/zorecho-wordmark.png"
              alt="Zorecho"
              className="mx-auto h-8 w-auto object-contain"
            />
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

        {invitePending && (
          <div className="mb-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
            You've been invited to join a team. Sign in or create an account with
            the email your invitation was sent to, and you'll join automatically.
          </div>
        )}

        {showWaitlist ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
              Our beta program is currently full. Leave your email and we'll let
              you know the moment a spot opens up.
            </div>
            {waitlistDone ? (
              <div className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">
                {waitlistDone}
              </div>
            ) : (
              <form onSubmit={handleWaitlist} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-300">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={waitlistEmail}
                    onChange={(e) => setWaitlistEmail(e.target.value)}
                    className={inputClass}
                    placeholder="you@business.com"
                  />
                </div>
                <ErrorBanner message={error} />
                <button
                  type="submit"
                  disabled={waitlistBusy}
                  style={{ backgroundColor: branding.primaryColor }}
                  className="w-full rounded-lg py-2.5 text-sm font-semibold text-gray-900 transition hover:opacity-90 disabled:opacity-60"
                >
                  {waitlistBusy ? "Please wait…" : "Join the waitlist"}
                </button>
              </form>
            )}
          </div>
        ) : (
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

          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={(e) => setRememberDevice(e.target.checked)}
              className="h-4 w-4 rounded border-gray-600 bg-gray-800 accent-amber-500"
            />
            Remember this device for 30 days
          </label>

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
        )}

        <p className="mt-6 text-center text-sm text-gray-400">
          {mode === "login"
            ? `New to ${branding.agencyName}?`
            : "Already have an account?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
              setWaitlistDone("");
            }}
            className="font-semibold text-amber-300 hover:underline"
          >
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
      <HealthSupportWidget isPublic />
    </div>
  );
}
