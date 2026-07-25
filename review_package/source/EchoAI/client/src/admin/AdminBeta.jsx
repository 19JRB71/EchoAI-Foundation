import { useEffect, useState } from "react";
import { api } from "../api.js";
import ErrorBanner from "../components/ErrorBanner.jsx";

const TIER_OPTIONS = [
  { value: "starter", label: "Starter — $100/mo" },
  { value: "pro", label: "Professional — $350/mo" },
  { value: "enterprise", label: "Enterprise — $550/mo" },
];

const inputClass =
  "w-24 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 focus:border-amber-500 focus:outline-none";

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function featureLabel(feature) {
  return feature
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function AdminBeta() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState(null);
  const [busyUserId, setBusyUserId] = useState(null);
  const [convertUserId, setConvertUserId] = useState(null);
  const [convertTier, setConvertTier] = useState("starter");

  async function load({ initial = false } = {}) {
    if (initial) setLoading(true);
    try {
      const result = await api.adminGetBetaOverview();
      setData(result);
      setSettingsForm((prev) =>
        prev || {
          maxSlots: result.settings.maxSlots,
          activeThresholdDays: result.settings.activeThresholdDays,
          warningAfterDays: result.settings.warningAfterDays,
        }
      );
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      if (initial) setLoading(false);
    }
  }

  useEffect(() => {
    load({ initial: true });
  }, []);

  async function saveSettings(e) {
    e.preventDefault();
    setSavingSettings(true);
    setNotice("");
    setError("");
    try {
      await api.adminUpdateBetaSettings({
        maxSlots: Number(settingsForm.maxSlots),
        activeThresholdDays: Number(settingsForm.activeThresholdDays),
        warningAfterDays: Number(settingsForm.warningAfterDays),
      });
      setNotice("Settings saved.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function toggleLock(user) {
    setBusyUserId(user.userId);
    setNotice("");
    setError("");
    try {
      if (user.isLocked) {
        await api.adminUnlockUser(user.userId);
        setNotice(`${user.email} unlocked — they can sign in again.`);
      } else {
        await api.adminLockUser(user.userId);
        setNotice(`${user.email} locked — their beta spot is now free.`);
      }
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyUserId(null);
    }
  }

  async function convert(user) {
    setBusyUserId(user.userId);
    setNotice("");
    setError("");
    try {
      await api.adminConvertBetaUser(user.userId, convertTier);
      setNotice(`${user.email} converted to a paid ${convertTier} plan.`);
      setConvertUserId(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyUserId(null);
    }
  }

  async function removeWaitlist(entry) {
    setNotice("");
    setError("");
    try {
      await api.adminRemoveBetaWaitlist(entry.waitlistId);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-400">Loading beta program…</p>;
  }

  if (!data) {
    return <ErrorBanner message={error || "Failed to load beta program"} />;
  }

  const { slots, users, waitlist } = data;

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} />
      {notice && (
        <div className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {/* Slot counter + settings */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-gray-900 p-5">
          <h3 className="text-sm font-semibold text-gray-300">Beta slots</h3>
          <p className="mt-2 text-3xl font-bold text-gray-100">
            {slots.used}{" "}
            <span className="text-base font-normal text-gray-400">
              of {slots.max} used
            </span>
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-800">
            <div
              className={`h-full rounded-full ${
                slots.remaining === 0 ? "bg-red-500" : "bg-amber-500"
              }`}
              style={{
                width: `${slots.max ? Math.min((slots.used / slots.max) * 100, 100) : 100}%`,
              }}
            />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {slots.remaining === 0
              ? "The beta is full — new signups are offered the waitlist."
              : `${slots.remaining} spot${slots.remaining === 1 ? "" : "s"} still open.`}
          </p>
        </div>

        <form onSubmit={saveSettings} className="rounded-xl bg-gray-900 p-5">
          <h3 className="text-sm font-semibold text-gray-300">Program settings</h3>
          <div className="mt-3 space-y-3 text-sm text-gray-300">
            <label className="flex items-center justify-between gap-3">
              <span>Maximum beta users</span>
              <input
                type="number"
                min="0"
                required
                value={settingsForm.maxSlots}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, maxSlots: e.target.value })
                }
                className={inputClass}
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>Counts as inactive after (days)</span>
              <input
                type="number"
                min="1"
                required
                value={settingsForm.activeThresholdDays}
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    activeThresholdDays: e.target.value,
                  })
                }
                className={inputClass}
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>Warning email after (days)</span>
              <input
                type="number"
                min="1"
                required
                value={settingsForm.warningAfterDays}
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    warningAfterDays: e.target.value,
                  })
                }
                className={inputClass}
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={savingSettings}
            className="mt-4 rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-gray-900 transition hover:bg-amber-400 disabled:opacity-60"
          >
            {savingSettings ? "Saving…" : "Save settings"}
          </button>
        </form>
      </div>

      {/* Beta users table */}
      <div className="rounded-xl bg-gray-900 p-5">
        <h3 className="text-sm font-semibold text-gray-300">
          Beta users ({users.length})
        </h3>
        {users.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No beta users yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs uppercase text-gray-500">
                  <th className="py-2 pr-4">User</th>
                  <th className="py-2 pr-4">Business type</th>
                  <th className="py-2 pr-4">Signed up</th>
                  <th className="py-2 pr-4">Last login</th>
                  <th className="py-2 pr-4">Logins</th>
                  <th className="py-2 pr-4">Features used</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.userId} className="border-b border-gray-800/60 align-top">
                    <td className="py-3 pr-4">
                      <p className="font-medium text-gray-200">{u.name || "—"}</p>
                      <p className="text-xs text-gray-500">{u.email}</p>
                    </td>
                    <td className="py-3 pr-4 text-gray-300">{u.businessType || "—"}</td>
                    <td className="py-3 pr-4 text-gray-300">{formatDate(u.signupDate)}</td>
                    <td className="py-3 pr-4 text-gray-300">{formatDate(u.lastLoginAt)}</td>
                    <td className="py-3 pr-4 text-gray-300">{u.totalLogins}</td>
                    <td className="py-3 pr-4">
                      {u.featuresUsed.length === 0 ? (
                        <span className="text-xs text-gray-500">None yet</span>
                      ) : (
                        <div className="flex max-w-56 flex-wrap gap-1">
                          {u.featuresUsed.slice(0, 6).map((f) => (
                            <span
                              key={f.feature}
                              title={`Used ${f.uses} time${f.uses === 1 ? "" : "s"}`}
                              className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-300"
                            >
                              {featureLabel(f.feature)}
                            </span>
                          ))}
                          {u.featuresUsed.length > 6 && (
                            <span className="text-xs text-gray-500">
                              +{u.featuresUsed.length - 6} more
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {u.isLocked ? (
                        <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs font-semibold text-gray-300">
                          Locked
                        </span>
                      ) : u.isActive ? (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                          Active
                        </span>
                      ) : (
                        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-400">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => toggleLock(u)}
                          disabled={busyUserId === u.userId}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition disabled:opacity-60 ${
                            u.isLocked
                              ? "bg-emerald-600 text-white hover:bg-emerald-500"
                              : "bg-gray-700 text-gray-200 hover:bg-gray-600"
                          }`}
                        >
                          {u.isLocked ? "Unlock" : "Lock"}
                        </button>
                        {convertUserId === u.userId ? (
                          <span className="flex items-center gap-1">
                            <select
                              value={convertTier}
                              onChange={(e) => setConvertTier(e.target.value)}
                              className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100"
                            >
                              {TIER_OPTIONS.map((t) => (
                                <option key={t.value} value={t.value}>
                                  {t.label}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => convert(u)}
                              disabled={busyUserId === u.userId}
                              className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-semibold text-gray-900 hover:bg-amber-400 disabled:opacity-60"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConvertUserId(null)}
                              className="rounded-lg px-1.5 py-1 text-xs text-gray-400 hover:text-gray-200"
                            >
                              ✕
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setConvertUserId(u.userId);
                              setConvertTier("starter");
                            }}
                            disabled={busyUserId === u.userId}
                            className="rounded-lg bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 disabled:opacity-60"
                          >
                            Convert to paid
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Waitlist */}
      <div className="rounded-xl bg-gray-900 p-5">
        <h3 className="text-sm font-semibold text-gray-300">
          Waitlist ({waitlist.length})
        </h3>
        {waitlist.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            Nobody is waiting right now. When the beta is full, new signups are
            invited to join this list.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-800/60 text-sm">
            {waitlist.map((w) => (
              <li key={w.waitlistId} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-gray-200">{w.email}</p>
                  <p className="text-xs text-gray-500">
                    Joined {formatDate(w.joinedAt)}
                    {w.notifiedAt ? ` · notified ${formatDate(w.notifiedAt)}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => removeWaitlist(w)}
                  className="rounded-lg px-2.5 py-1 text-xs font-semibold text-gray-400 hover:text-red-400"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
