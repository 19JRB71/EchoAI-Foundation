import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import BrandDiscovery from "./BrandDiscovery.jsx";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const primaryBtn =
  "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60";
const secondaryBtn =
  "rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60";

export default function Settings({ brandId, onBrandsChanged }) {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-900">Settings</h2>
      <ProfileCard />
      <SubscriptionCard />
      <FacebookCard />
      <BrandCard brandId={brandId} onBrandsChanged={onBrandsChanged} />
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold text-gray-700">{title}</h3>
      {children}
    </div>
  );
}

function Labeled({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </label>
      {children}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800">{value || "—"}</span>
    </div>
  );
}

function ProfileCard() {
  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getProfile();
        setProfile(data);
        setEmail(data.email || "");
        setTeamSize(data.teamSize != null ? String(data.teamSize) : "");
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {};
      if (email && profile && email !== profile.email) payload.email = email;
      if (teamSize !== "") payload.teamSize = Number(teamSize);
      if (Object.keys(payload).length === 0) {
        setNotice("Nothing to update.");
        return;
      }
      const updated = await api.updateProfile(payload);
      setProfile(updated);
      setNotice("Profile updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <Card title="Profile">
        <Spinner label="Loading…" />
      </Card>
    );

  return (
    <Card title="Profile">
      <form onSubmit={save} className="space-y-3">
        <Labeled label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Labeled>
        <Labeled label="Team size">
          <input
            type="number"
            min="1"
            value={teamSize}
            onChange={(e) => setTeamSize(e.target.value)}
            className={inputClass}
          />
        </Labeled>
        {notice && <p className="text-sm text-green-600">{notice}</p>}
        <ErrorBanner message={error} />
        <button disabled={saving} className={primaryBtn}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>
    </Card>
  );
}

function SubscriptionCard() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [canceling, setCanceling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStatus(await api.getSubscriptionStatus());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function cancel() {
    if (
      !window.confirm(
        "Cancel your subscription? Your account will move to the free tier."
      )
    )
      return;
    setCanceling(true);
    setError("");
    setNotice("");
    try {
      await api.cancelSubscription();
      setNotice("Subscription canceled.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCanceling(false);
    }
  }

  if (loading)
    return (
      <Card title="Subscription">
        <Spinner label="Loading…" />
      </Card>
    );

  return (
    <Card title="Subscription">
      {status ? (
        <div className="space-y-2 text-sm">
          <Row label="Plan" value={status.subscriptionTier} />
          <Row label="Payment status" value={status.paymentStatus} />
          {status.renewalDate && (
            <Row label="Renews" value={formatDate(status.renewalDate)} />
          )}
          {status.isLocked && (
            <p className="text-sm text-red-600">
              Account locked for non-payment.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500">No subscription found.</p>
      )}
      {notice && <p className="mt-3 text-sm text-green-600">{notice}</p>}
      <ErrorBanner message={error} />
      <button onClick={cancel} disabled={canceling} className={`${secondaryBtn} mt-4`}>
        {canceling ? "Canceling…" : "Cancel subscription"}
      </button>
    </Card>
  );
}

function FacebookCard() {
  const [adAccountId, setAdAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function connect(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.connectFacebook(adAccountId);
      setNotice("Facebook account connected.");
      setAdAccountId("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Facebook connection">
      <form onSubmit={connect} className="space-y-3">
        <Labeled label="Ad account ID">
          <input
            value={adAccountId}
            onChange={(e) => setAdAccountId(e.target.value)}
            placeholder="act_123456789"
            required
            className={inputClass}
          />
        </Labeled>
        {notice && <p className="text-sm text-green-600">{notice}</p>}
        <ErrorBanner message={error} />
        <button disabled={saving} className={primaryBtn}>
          {saving ? "Connecting…" : "Connect Facebook"}
        </button>
      </form>
    </Card>
  );
}

function BrandCard({ brandId, onBrandsChanged }) {
  const [brand, setBrand] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDiscovery, setShowDiscovery] = useState(false);

  const load = useCallback(async () => {
    if (!brandId) {
      setBrand(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setBrand(await api.getBrand(brandId));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card title="Brand profile">
      {loading ? (
        <Spinner label="Loading…" />
      ) : brand ? (
        <div className="space-y-2 text-sm">
          <Row label="Name" value={brand.brand_name} />
          <Row label="Personality" value={brand.brand_personality} />
          <Row label="Voice" value={brand.voice_description} />
          <Row label="Audience" value={brand.target_audience} />
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          No brand profile yet. Start a discovery conversation to create one.
        </p>
      )}
      <ErrorBanner message={error} />
      <button
        onClick={() => setShowDiscovery(true)}
        className={`${primaryBtn} mt-4`}
      >
        {brand ? "Restart brand discovery" : "Start brand discovery"}
      </button>

      {showDiscovery && (
        <BrandDiscovery
          brandId={brandId || undefined}
          onClose={() => setShowDiscovery(false)}
          onComplete={() => {
            setShowDiscovery(false);
            load();
            if (onBrandsChanged) onBrandsChanged();
          }}
        />
      )}
    </Card>
  );
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
}
