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
  { key: "dashboard", label: "Dashboard" },
  { key: "commissions", label: "Commissions" },
  { key: "payouts", label: "Payouts" },
];

const STATUS_STYLES = {
  pending: "bg-amber-500/10 text-amber-300",
  approved: "bg-blue-500/10 text-blue-300",
  paid: "bg-green-500/10 text-green-300",
};

function Header() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-100">Affiliate Program</h2>
      <p className="text-sm text-gray-400">
        Earn 20% commission on the first month for every customer you refer.
      </p>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-gray-100">{value}</p>
    </div>
  );
}

export default function AffiliateProgram() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState(null);
  const [joining, setJoining] = useState(false);
  const [tab, setTab] = useState("dashboard");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getAffiliateProfile();
      setProfile(data);
    } catch (err) {
      if (err.status === 404) {
        setProfile(null); // not yet enrolled
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleJoin() {
    setJoining(true);
    setError("");
    try {
      await api.joinAffiliate();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setJoining(false);
    }
  }

  if (loading) return <Spinner label="Loading affiliate program…" />;

  if (!profile) {
    return (
      <div className="space-y-6">
        <Header />
        <ErrorBanner message={error} />
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-8 text-center">
          <h3 className="text-lg font-semibold text-gray-100">
            Earn 20% commission
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-400">
            Join the affiliate program and earn 20% of the first month's payment
            for every new customer you refer. Share your unique link and start
            earning.
          </p>
          <button
            onClick={handleJoin}
            disabled={joining}
            className="mt-5 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-gray-900 transition hover:bg-amber-600 disabled:opacity-60"
          >
            {joining ? "Joining…" : "Join the affiliate program"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header />
      <ErrorBanner message={error} />

      {profile.affiliate.status === "suspended" && (
        <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Your affiliate account is suspended. New referrals won't be attributed
          while suspended. Contact support for help.
        </div>
      )}

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

      {tab === "dashboard" && <DashboardTab profile={profile} />}
      {tab === "commissions" && <CommissionsTab />}
      {tab === "payouts" && <PayoutsTab profile={profile} onDone={load} />}
    </div>
  );
}

function DashboardTab({ profile }) {
  const { affiliate, referralLink, stats } = profile;
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable; the link is still selectable in the input.
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total referrals" value={stats.totalReferrals} />
        <StatCard label="Paying customers" value={stats.convertedReferrals} />
        <StatCard label="Pending" value={currency(stats.pendingAmount)} />
        <StatCard label="Approved" value={currency(stats.approvedAmount)} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Lifetime earned" value={currency(affiliate.totalEarned)} />
        <StatCard label="Paid out" value={currency(affiliate.totalPaid)} />
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="mb-1 text-sm font-semibold text-gray-200">
          Your referral link
        </h3>
        <p className="mb-3 text-xs text-gray-500">
          Share this link. You'll earn {Math.round(stats.commissionRate * 100)}%
          of the first month for every customer who signs up and pays.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            readOnly
            value={referralLink}
            onFocus={(e) => e.target.select()}
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
          />
          <button
            onClick={copyLink}
            className="shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-amber-600"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Referral code:{" "}
          <span className="font-mono text-gray-300">{affiliate.referralCode}</span>
        </p>
      </div>
    </div>
  );
}

function CommissionsTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commissions, setCommissions] = useState([]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api.getAffiliateCommissions();
        if (active) setCommissions(data.commissions || []);
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

  if (loading) return <Spinner label="Loading commissions…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">Referred user</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Commission</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 bg-gray-950 text-gray-200">
            {commissions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  No referrals yet. Share your link to start earning.
                </td>
              </tr>
            ) : (
              commissions.map((c) => (
                <tr key={c.referralId}>
                  <td className="px-4 py-3">{c.referredEmail}</td>
                  <td className="px-4 py-3 capitalize">{c.subscriptionTier}</td>
                  <td className="px-4 py-3">
                    {c.commissionAmount > 0 ? currency(c.commissionAmount) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[c.status] || "bg-gray-700 text-gray-300"
                      }`}
                    >
                      {c.commissionAmount > 0 ? c.status : "signed up"}
                    </span>
                  </td>
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

function PayoutsTab({ profile, onDone }) {
  const available = profile.stats.approvedAmount;
  const [paypalEmail, setPaypalEmail] = useState(
    profile.affiliate.paypalEmail || ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const res = await api.requestAffiliatePayout(paypalEmail.trim());
      setSuccess(res.message || "Payout requested.");
      if (onDone) onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Approved & available" value={currency(available)} />
        <StatCard label="Paid out" value={currency(profile.affiliate.totalPaid)} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5"
      >
        <p className="text-sm text-gray-400">
          Request a payout of your approved commissions. We send payouts to your
          PayPal email; commissions are marked paid once the transfer completes.
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">
            PayPal email
          </label>
          <input
            type="email"
            required
            value={paypalEmail}
            onChange={(e) => setPaypalEmail(e.target.value)}
            placeholder="you@paypal.com"
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>
        <ErrorBanner message={error} />
        {success && (
          <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-300">
            {success}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting || available <= 0}
          className="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-gray-900 transition hover:bg-amber-600 disabled:opacity-60"
        >
          {submitting
            ? "Requesting…"
            : available > 0
              ? `Request payout of ${currency(available)}`
              : "No approved commissions yet"}
        </button>
      </form>
    </div>
  );
}
