/**
 * Connections & Setup — the ONE place to see and manage everything the
 * platform can connect to. Statuses come from the server's LIVE probes
 * (/api/guided-setup/checklist — "unknown" when a probe fails, never
 * guessed). Facebook and Google connect right here (direct OAuth); the
 * rest jump straight to the screen where that setup lives.
 *
 * Owner-only: the checklist endpoint 403s for team members — we show a
 * friendly note instead of an error.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { openAuthUrl } from "../lib/oauthNav.js";
import Spinner from "../components/Spinner.jsx";

// Extra copy + behavior per checklist key. Keys the server doesn't send are
// simply not rendered; keys it sends without meta fall back to plain defaults.
const ITEM_META = {
  profile: {
    benefit: "Your business name, industry, and goals — this is what your whole AI team works from.",
    cta: "Set up profile",
  },
  facebook: {
    benefit: "Lets Nova publish posts, run ads, and manage your Facebook page automatically.",
    oauth: "facebook",
    cta: "Connect Facebook",
  },
  instagram: {
    benefit: "Comes along automatically when you connect Facebook — no separate login needed.",
    oauth: "facebook",
    cta: "Connect via Facebook",
  },
  google: {
    benefit: "Lets Echo read your Google data, manage your calendar, and power SEO insights.",
    oauth: "google",
    cta: "Connect Google",
  },
  calendar: {
    benefit: "Appointment booking uses your Google calendar — included with your Google connection.",
    oauth: "google",
    cta: "Connect via Google",
  },
  jobber: {
    benefit:
      "Pulls your Jobber clients in as leads, shows your booked visits, and sends converted leads back to Jobber automatically.",
    oauth: "jobber",
    cta: "Connect Jobber",
  },
  phone: {
    benefit: "Your AI receptionist answers calls and texts on a business phone number.",
    cta: "Set up phone agent",
  },
  chatbot: {
    benefit: "A chat widget on your website that qualifies visitors and captures leads for you.",
    cta: "Set up chatbot",
  },
  email: {
    benefit: "Echo watches your inbox, flags what matters, and drafts replies for your approval.",
    cta: "Connect mailbox",
  },
  crm: {
    benefit: "Every lead the platform captures lands here — browse and manage them any time.",
    cta: "Open CRM",
  },
  gbp: {
    benefit: "Manage how your business shows up on Google Search and Maps.",
    cta: "Open Google & SEO",
  },
};

function StatusBadge({ status }) {
  if (status === "connected") {
    return (
      <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
        ✓ Connected
      </span>
    );
  }
  if (status === "not_connected") {
    return (
      <span className="rounded-full bg-gray-700/60 px-2.5 py-0.5 text-xs font-semibold text-gray-300">
        Not connected
      </span>
    );
  }
  if (status === "link") {
    return (
      <span className="rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-xs font-semibold text-cyan-300">
        Always on
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
      Can&apos;t check right now
    </span>
  );
}

export default function Connections({ onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");
  const [checklist, setChecklist] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [oauthError, setOauthError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await api.getSetupChecklist();
      setChecklist(data);
      setForbidden(false);
    } catch (err) {
      if (err.status === 403) setForbidden(true);
      else setError(err.message || "Couldn't load your connections right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function startOAuth(provider, key) {
    setBusyKey(key);
    setOauthError("");
    try {
      const { authUrl } =
        provider === "facebook"
          ? await api.startFacebookOAuth()
          : provider === "jobber"
            ? await api.startJobberOAuth()
            : await api.startGoogleOAuth();
      const navigatedAway = openAuthUrl(authUrl);
      if (!navigatedAway) setBusyKey(null); // opened in a new tab (embedded preview)
    } catch (err) {
      setBusyKey(null);
      setOauthError(err.message || `Couldn't start the ${provider} connection.`);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-gray-800 bg-gray-900/60 p-8 text-center">
        <p className="text-lg text-white">Connections are managed by the account owner</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-400">
          Ask the owner of this workspace to connect accounts — everything they connect works for
          the whole team automatically.
        </p>
      </div>
    );
  }

  const items = Array.isArray(checklist?.items) ? checklist.items : [];
  const probed = items.filter((i) => i.status !== "link");
  const completedCount = probed.filter((i) => i.status === "connected").length;
  const percent = probed.length > 0 ? Math.round((completedCount / probed.length) * 100) : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Connections &amp; Setup</h2>
          <p className="text-sm text-gray-400">
            Everything your AI team can connect to, all in one place. Each connection unlocks more
            of what they can do for you.
          </p>
        </div>
        <button
          onClick={() => {
            setLoading(true);
            load();
          }}
          className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800"
        >
          Refresh statuses
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-700/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {oauthError && (
        <div className="rounded-lg border border-amber-700/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {oauthError}
        </div>
      )}

      {probed.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-white">
              {completedCount} of {probed.length} connected
            </p>
            <p className="text-sm text-gray-400">{percent}%</p>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-700"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => {
          const meta = ITEM_META[item.key] || {};
          const connected = item.status === "connected";
          const busy = busyKey === item.key;
          const readinessMap = checklist?.providerReadiness;
          // Gate by the OAuth provider when the card connects via OAuth
          // (e.g. the calendar card connects through Google), else the key.
          const readinessKey = meta.oauth || item.key;
          const ready = readinessMap ? readinessMap[readinessKey] !== false : undefined;
          const verificationMap = checklist?.providerVerification;
          const verified = verificationMap
            ? verificationMap[readinessKey] !== false
            : undefined;
          // Configured, but no full authorization round trip has ever
          // succeeded on this system — say so honestly (Connect stays live
          // so verification can actually happen).
          const awaitingVerification =
            !connected && meta.oauth && ready !== false && verified === false;
          return (
            <div
              key={item.key}
              className="flex flex-col rounded-xl border border-gray-800 bg-gray-900/60 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium text-white">{item.label}</h3>
                <StatusBadge status={item.status} />
              </div>
              <p className="mt-1 flex-1 text-sm leading-relaxed text-gray-400">
                {meta.benefit || item.note || ""}
              </p>
              {item.note && meta.benefit && (
                <p className="mt-1 text-xs text-gray-500">{item.note}</p>
              )}
              {awaitingVerification && (
                <p className="mt-1 text-xs font-semibold text-amber-300">
                  Configured but awaiting verification — this connection hasn&apos;t
                  been proven end-to-end on this system yet.
                </p>
              )}
              <div className="mt-3">
                {connected ? (
                  <button
                    onClick={() => onNavigate && onNavigate(item.section)}
                    className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
                  >
                    Manage
                  </button>
                ) : meta.oauth && ready === false ? (
                  // "No green button without a green backend": the server
                  // says this provider's credentials aren't configured, so a
                  // Connect attempt cannot succeed — say so instead.
                  <span className="inline-block rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-1.5 text-xs font-medium text-gray-400">
                    Setup required — not configured on this system yet
                  </span>
                ) : meta.oauth ? (
                  <button
                    onClick={() => startOAuth(meta.oauth, item.key)}
                    disabled={busy}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    {busy ? "Opening…" : meta.cta || `Connect ${item.label}`}
                  </button>
                ) : (
                  <button
                    onClick={() => onNavigate && onNavigate(item.section)}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                  >
                    {meta.cta || "Set up"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-500">
        Statuses are checked live every time you open this page — if something says
        &ldquo;Can&apos;t check right now&rdquo;, it just means the check didn&apos;t go through;
        nothing is assumed.
      </p>
    </div>
  );
}
