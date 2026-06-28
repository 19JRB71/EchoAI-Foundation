import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, getToken, setToken, clearToken } from "./api.js";
import Sidebar from "./components/Sidebar.jsx";
import Spinner from "./components/Spinner.jsx";
import Login from "./sections/Login.jsx";
import Overview from "./sections/Overview.jsx";
import Leads from "./sections/Leads.jsx";
import Campaigns from "./sections/Campaigns.jsx";
import AdStudio from "./sections/AdStudio.jsx";
import SocialMedia from "./sections/SocialMedia.jsx";
import VideoContent from "./sections/VideoContent.jsx";
import SalesScripts from "./sections/SalesScripts.jsx";
import EmailMarketing from "./sections/EmailMarketing.jsx";
import ImageStudio from "./sections/ImageStudio.jsx";
import GoogleSeo from "./sections/GoogleSeo.jsx";
import RoiDashboard from "./sections/RoiDashboard.jsx";
import Reputation from "./sections/Reputation.jsx";
import PhoneAgent from "./sections/PhoneAgent.jsx";
import ChatbotSetup from "./sections/ChatbotSetup.jsx";
import Feedback from "./sections/Feedback.jsx";
import ZapierIntegration from "./sections/ZapierIntegration.jsx";
import Settings from "./sections/Settings.jsx";
import OnboardingWizard from "./onboarding/OnboardingWizard.jsx";
import AdminPanel from "./admin/AdminPanel.jsx";
import AgencyPortal from "./sections/AgencyPortal.jsx";
import AffiliateProgram from "./sections/AffiliateProgram.jsx";
import PaymentFailedBanner from "./components/PaymentFailedBanner.jsx";
import { enablePushNotifications } from "./push.js";

export default function App() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [section, setSection] = useState("overview");
  const [brands, setBrands] = useState([]);
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [brandsError, setBrandsError] = useState("");
  // null = unknown (still loading the profile), true/false once known.
  const [onboardingCompleted, setOnboardingCompleted] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAgencyOwner, setIsAgencyOwner] = useState(false);
  // Image handed off from Image Studio to the Social Media generator.
  const [socialPrefillImage, setSocialPrefillImage] = useState(null);
  // Subscription status drives the global payment-failed banner.
  const [billingStatus, setBillingStatus] = useState(null);
  // When the banner's "Update payment method" is clicked, jump to Settings →
  // Billing and auto-open the card form.
  const [billingTab, setBillingTab] = useState("account");
  const [openPaymentModal, setOpenPaymentModal] = useState(false);

  function handleUseImageInSocial(image) {
    setSocialPrefillImage(image);
    setSection("social");
  }

  function handleFixPayment() {
    setBillingTab("billing");
    setOpenPaymentModal(true);
    setSection("settings");
  }

  // Manual navigation (sidebar) resets the billing deep-link flags so Settings
  // opens on its default Account tab without auto-opening the card form.
  function handleSelectSection(next) {
    setBillingTab("account");
    setOpenPaymentModal(false);
    setSection(next);
  }

  const handleLogout = useCallback(() => {
    clearToken();
    setAuthed(false);
    setBrands([]);
    setSelectedBrandId("");
    setOnboardingCompleted(null);
    setIsAdmin(false);
    navigate("/");
  }, [navigate]);

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
        if (active) {
          setOnboardingCompleted(Boolean(profile.onboardingCompleted));
          setIsAdmin(profile.role === "admin");
        }
        // Detect whether this account owns a white-label agency (shows the
        // Agency Portal nav). A 404 simply means "not an agency owner".
        try {
          await api.getAgencySettings();
          if (active) setIsAgencyOwner(true);
        } catch {
          if (active) setIsAgencyOwner(false);
        }
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

  // Poll subscription status so the payment-failed banner stays current across
  // every dashboard page until the issue is resolved.
  const loadBillingStatus = useCallback(async () => {
    try {
      setBillingStatus(await api.getSubscriptionStatus());
    } catch {
      // A missing/unreadable subscription simply means no banner.
      setBillingStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!authed || !onboardingCompleted) return;
    loadBillingStatus();
    const id = setInterval(loadBillingStatus, 60000);
    // Refresh immediately when a billing action (card update / plan change)
    // succeeds, so the payment-failed banner clears without waiting for the poll.
    window.addEventListener("echoai:billing-updated", loadBillingStatus);
    return () => {
      clearInterval(id);
      window.removeEventListener("echoai:billing-updated", loadBillingStatus);
    };
  }, [authed, onboardingCompleted, loadBillingStatus]);

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
    // On first login, ask to enable push so the owner gets instant hot-lead
    // alerts on their phone. Best-effort — never blocks the login flow.
    enablePushNotifications(token).catch(() => {});
  }

  if (!authed) return <Login onLogin={handleLogin} />;

  // Wait until we know the onboarding status before deciding what to render.
  if (onboardingCompleted === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <Spinner label="Loading…" />
      </div>
    );
  }

  // New users go through the setup wizard; it disappears for good once complete.
  if (!onboardingCompleted) {
    return <OnboardingWizard onComplete={() => setOnboardingCompleted(true)} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-black md:flex-row">
      <Sidebar
        section={section}
        onSelect={handleSelectSection}
        onLogout={handleLogout}
        isAdmin={isAdmin}
        isAgencyOwner={isAgencyOwner}
      />
      <main className="flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-6xl">
          {section === "admin" && isAdmin ? (
            <AdminPanel />
          ) : section === "agency" && isAgencyOwner ? (
            <AgencyPortal />
          ) : section === "affiliate" ? (
            <AffiliateProgram />
          ) : (
            <>
              <PaymentFailedBanner status={billingStatus} onFix={handleFixPayment} />
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
              {section === "adstudio" && <AdStudio brandId={selectedBrandId} />}
              {section === "social" && (
                <SocialMedia
                  brandId={selectedBrandId}
                  prefillImage={socialPrefillImage}
                  onPrefillConsumed={() => setSocialPrefillImage(null)}
                />
              )}
              {section === "video" && <VideoContent brandId={selectedBrandId} />}
              {section === "sales" && <SalesScripts brandId={selectedBrandId} />}
              {section === "email" && (
                <EmailMarketing brandId={selectedBrandId} />
              )}
              {section === "image" && (
                <ImageStudio
                  brandId={selectedBrandId}
                  onUseInSocial={handleUseImageInSocial}
                />
              )}
              {section === "googleseo" && (
                <GoogleSeo brandId={selectedBrandId} />
              )}
              {section === "roi" && (
                <RoiDashboard brandId={selectedBrandId} />
              )}
              {section === "reputation" && (
                <Reputation brandId={selectedBrandId} />
              )}
              {section === "phone" && (
                <PhoneAgent brandId={selectedBrandId} />
              )}
              {section === "chatbot" && (
                <ChatbotSetup brandId={selectedBrandId} />
              )}
              {section === "feedback" && (
                <Feedback brandId={selectedBrandId} />
              )}
              {section === "zapier" && (
                <ZapierIntegration brandId={selectedBrandId} />
              )}
              {section === "settings" && (
                <Settings
                  brandId={selectedBrandId}
                  onBrandsChanged={loadBrands}
                  initialTab={billingTab}
                  openPaymentModal={openPaymentModal}
                  key={`${billingTab}-${openPaymentModal}`}
                />
              )}
            </>
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
      <div className="mb-6 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
        No brands yet. Go to Settings to start your brand discovery
        conversation.
      </div>
    );
  if (brands.length === 1) return null;

  return (
    <div className="mb-6 flex items-center gap-2">
      <label className="text-sm font-medium text-gray-400">Brand</label>
      <select
        value={selectedBrandId}
        onChange={(e) => onSelect(e.target.value)}
        className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100"
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
