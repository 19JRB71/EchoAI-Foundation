import { useState, useEffect, useCallback } from "react";
import { api, getToken, setToken, clearToken } from "./api.js";
import Sidebar from "./components/Sidebar.jsx";
import Spinner from "./components/Spinner.jsx";
import Login from "./sections/Login.jsx";
import Overview from "./sections/Overview.jsx";
import Leads from "./sections/Leads.jsx";
import Campaigns from "./sections/Campaigns.jsx";
import Settings from "./sections/Settings.jsx";
import OnboardingWizard from "./onboarding/OnboardingWizard.jsx";

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [section, setSection] = useState("overview");
  const [brands, setBrands] = useState([]);
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [brandsError, setBrandsError] = useState("");
  // null = unknown (still loading the profile), true/false once known.
  const [onboardingCompleted, setOnboardingCompleted] = useState(null);

  const handleLogout = useCallback(() => {
    clearToken();
    setAuthed(false);
    setBrands([]);
    setSelectedBrandId("");
    setOnboardingCompleted(null);
  }, []);

  const loadBrands = useCallback(async () => {
    setLoadingBrands(true);
    setBrandsError("");
    try {
      const data = await api.getBrands();
      const list = data.brands || [];
      setBrands(list);
      setSelectedBrandId((prev) => prev || (list[0] ? list[0].brand_id : ""));
    } catch (err) {
      if (err.status === 401) {
        handleLogout();
        return;
      }
      setBrandsError(err.message);
    } finally {
      setLoadingBrands(false);
    }
  }, [handleLogout]);

  // Once authenticated, find out whether the user still needs onboarding.
  useEffect(() => {
    if (!authed) return;
    let active = true;
    (async () => {
      try {
        const profile = await api.getProfile();
        if (active) setOnboardingCompleted(Boolean(profile.onboardingCompleted));
      } catch (err) {
        if (err.status === 401) {
          handleLogout();
          return;
        }
        // If the profile can't be read, fall back to showing the dashboard
        // rather than trapping the user in onboarding.
        if (active) setOnboardingCompleted(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [authed, handleLogout]);

  // Only load brands once the user has finished onboarding (the dashboard view).
  useEffect(() => {
    if (authed && onboardingCompleted) loadBrands();
  }, [authed, onboardingCompleted, loadBrands]);

  // Return to the login screen whenever any protected request reports an
  // expired or invalid token.
  useEffect(() => {
    window.addEventListener("echoai:unauthorized", handleLogout);
    return () => window.removeEventListener("echoai:unauthorized", handleLogout);
  }, [handleLogout]);

  function handleLogin(token) {
    setToken(token);
    setAuthed(true);
    setSection("overview");
  }

  if (!authed) return <Login onLogin={handleLogin} />;

  // Wait until we know the onboarding status before deciding what to render.
  if (onboardingCompleted === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Spinner label="Loading…" />
      </div>
    );
  }

  // New users go through the setup wizard; it disappears for good once complete.
  if (!onboardingCompleted) {
    return <OnboardingWizard onComplete={() => setOnboardingCompleted(true)} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 md:flex-row">
      <Sidebar section={section} onSelect={setSection} onLogout={handleLogout} />
      <main className="flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-6xl">
          <BrandBar
            brands={brands}
            selectedBrandId={selectedBrandId}
            onSelect={setSelectedBrandId}
            loading={loadingBrands}
            error={brandsError}
          />
          {section === "overview" && <Overview brandId={selectedBrandId} />}
          {section === "leads" && <Leads brandId={selectedBrandId} />}
          {section === "campaigns" && <Campaigns />}
          {section === "settings" && (
            <Settings
              brandId={selectedBrandId}
              onBrandsChanged={loadBrands}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function BrandBar({ brands, selectedBrandId, onSelect, loading, error }) {
  if (loading)
    return (
      <div className="mb-6">
        <Spinner label="Loading brands…" />
      </div>
    );
  if (error)
    return (
      <div className="mb-6 rounded-lg bg-red-50 p-3 text-sm text-red-700">
        {error}
      </div>
    );
  if (brands.length === 0)
    return (
      <div className="mb-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        No brands yet. Go to Settings to start your brand discovery
        conversation.
      </div>
    );
  if (brands.length === 1) return null;

  return (
    <div className="mb-6 flex items-center gap-2">
      <label className="text-sm font-medium text-gray-600">Brand</label>
      <select
        value={selectedBrandId}
        onChange={(e) => onSelect(e.target.value)}
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
      >
        {brands.map((b) => (
          <option key={b.brand_id} value={b.brand_id}>
            {b.brand_name}
          </option>
        ))}
      </select>
    </div>
  );
}
