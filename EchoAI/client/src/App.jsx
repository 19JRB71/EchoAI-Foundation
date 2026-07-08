import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api, getToken, setToken, clearToken } from "./api.js";
import { startSessionTracking, wasAwayLong } from "./lib/session.js";
import { MusicProvider } from "./music/MusicContext.jsx";
import Sidebar, { accentTierForSection } from "./components/Sidebar.jsx";
import Spinner from "./components/Spinner.jsx";
import TierBadge from "./components/TierBadge.jsx";
import Login from "./sections/Login.jsx";
import MissionControl from "./sections/MissionControl.jsx";
import AiTeam from "./sections/AiTeam.jsx";
import Overview from "./sections/Overview.jsx";
import Leads from "./sections/Leads.jsx";
import Supporters from "./sections/Supporters.jsx";
import Properties from "./sections/Properties.jsx";
import Campaigns from "./sections/Campaigns.jsx";
import AdStudio from "./sections/AdStudio.jsx";
import SocialMedia from "./sections/SocialMedia.jsx";
import VideoContent from "./sections/VideoContent.jsx";
import SalesScripts from "./sections/SalesScripts.jsx";
import EmailMarketing from "./sections/EmailMarketing.jsx";
import ImageStudio from "./sections/ImageStudio.jsx";
import GoogleSeo from "./sections/GoogleSeo.jsx";
import RoiDashboard from "./sections/RoiDashboard.jsx";
import CustomerIntelligence from "./sections/CustomerIntelligence.jsx";
import CapitalFunding from "./sections/CapitalFunding.jsx";
import Sage from "./sections/Sage.jsx";
import Portfolio from "./sections/Portfolio.jsx";
import Reputation from "./sections/Reputation.jsx";
import PhoneAgent from "./sections/PhoneAgent.jsx";
import Appointments from "./sections/Appointments.jsx";
import FollowUps from "./sections/FollowUps.jsx";
import SmsMarketing from "./sections/SmsMarketing.jsx";
import ChatbotSetup from "./sections/ChatbotSetup.jsx";
import Feedback from "./sections/Feedback.jsx";
import ZapierIntegration from "./sections/ZapierIntegration.jsx";
import Settings from "./sections/Settings.jsx";
import OnboardingWizard from "./onboarding/OnboardingWizard.jsx";
import SetupAgent from "./onboarding/SetupAgent.jsx";
import AdminPanel from "./admin/AdminPanel.jsx";
import AgencyPortal from "./sections/AgencyPortal.jsx";
import AffiliateProgram from "./sections/AffiliateProgram.jsx";
import PaymentFailedBanner from "./components/PaymentFailedBanner.jsx";
import FeatureGate from "./components/FeatureGate.jsx";
import { requiredTierForSection, accentColor, SECTION_TIERS } from "./lib/tiers.js";
import { enablePushNotifications } from "./push.js";
import TourProvider from "./tour/TourProvider.jsx";
import SectionHelp from "./tour/SectionHelp.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import HealthSupportWidget from "./components/HealthSupportWidget.jsx";
import EchoCompanion from "./companion/EchoCompanion.jsx";
import { DemoSuggestionProvider } from "./demo/DemoSuggestionContext.jsx";
import { VoiceProvider, useVoice } from "./voice/VoiceContext.jsx";
import {
  EchoConversationProvider,
  useEchoConversation,
} from "./voice/EchoConversationContext.jsx";
import VoicePlayer from "./voice/VoicePlayer.jsx";
import VoiceSettings from "./sections/VoiceSettings.jsx";
import DepartmentView from "./sections/DepartmentView.jsx";
import GoalSetupWizard from "./components/GoalSetupWizard.jsx";
import SentinelHealth from "./sections/SentinelHealth.jsx";
import SalesRepConsole from "./sections/crm/SalesRepConsole.jsx";
import QueueOverview from "./sections/crm/QueueOverview.jsx";
import CallMonitoring from "./sections/crm/CallMonitoring.jsx";
import { roleLabel, roleBadgeClass, canWrite } from "./lib/roles.js";
import Breadcrumbs from "./components/Breadcrumbs.jsx";
import FacebookWizard from "./components/FacebookWizard.jsx";
import PresenterOverlay from "./components/PresenterOverlay.jsx";
import { AutonomousTab } from "./companion/EchoBrain.jsx";
import EchoMemory from "./sections/EchoMemory.jsx";
import { agentMeta, sectionTitle } from "./lib/departments.js";

export default function App() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(Boolean(getToken()));
  // Captured once at first render (before session tracking stamps "now"): true
  // when we booted already-signed-in after being away >8h — a "new session" that
  // should trigger Echo's morning music + briefing without a fresh login.
  const [wasReturningSession] = useState(() => Boolean(getToken()) && wasAwayLong());
  const morningReturnFired = useRef(false);
  const [section, setSection] = useState("missioncontrol");
  const [brands, setBrands] = useState([]);
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [brandsError, setBrandsError] = useState("");
  // null = unknown (still loading the profile), true/false once known.
  const [onboardingCompleted, setOnboardingCompleted] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAgencyOwner, setIsAgencyOwner] = useState(false);
  // Identity shown in the top bar next to the tier badge.
  const [userEmail, setUserEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  // Image handed off from Image Studio to the Social Media generator.
  const [socialPrefillImage, setSocialPrefillImage] = useState(null);
  // Subscription status drives the global payment-failed banner.
  const [billingStatus, setBillingStatus] = useState(null);
  // When the banner's "Update payment method" is clicked, jump to Settings →
  // Billing and auto-open the card form.
  const [billingTab, setBillingTab] = useState("account");
  const [openPaymentModal, setOpenPaymentModal] = useState(false);
  // Deep-link nonce: when set, Settings scrolls to the Goals + Goal Alert
  // History cards (used by Mission Control's alert feed click-through).
  const [settingsFocusGoals, setSettingsFocusGoals] = useState(null);
  // Workspace context for team members. Defaults to "owner" (acting as
  // themselves) until the profile loads.
  const [workspaceRole, setWorkspaceRole] = useState("owner");
  const [isTeamMember, setIsTeamMember] = useState(false);
  const [ownerBusinessName, setOwnerBusinessName] = useState(null);
  // A pending team invitation token pulled from the ?invite= link, consumed
  // once the user is authenticated.
  const [inviteToken, setInviteToken] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("invite") || null;
    } catch {
      return null;
    }
  });
  const [inviteNotice, setInviteNotice] = useState("");
  // Shown when a deep link (e.g. a goal-alert click) references a brand that is
  // no longer in the account — the fallback keeps the current selection, and
  // this notice explains why the user isn't seeing the alert's business.
  const [brandFallbackNotice, setBrandFallbackNotice] = useState("");
  // AI Setup Agent overlay — auto-launches for brand-new users and resumes any
  // in-progress session; can also be opened manually from Settings.
  const [showSetup, setShowSetup] = useState(false);
  // One-time conversational goal-setup wizard shown right after onboarding.
  const [showGoalWizard, setShowGoalWizard] = useState(false);
  const [goalWizardBrandId, setGoalWizardBrandId] = useState("");
  // True when the user stepped out of the Setup Agent to connect an account (e.g.
  // social) and still has an unfinished session to return to. Drives the floating
  // "Finish setup" button so they can jump back into the flow.
  const [setupPending, setSetupPending] = useState(false);
  // Team-based navigation. The dashboard is organized around the eight AI team
  // members: opening a department (deptAgentId) shows that member's tool grid;
  // a tool card then sets `section` to the underlying feature while deptAgentId
  // stays put so the breadcrumb/back trail reflects the department context.
  const [deptAgentId, setDeptAgentId] = useState(null);
  // Sub-tab handed to a section when a tool card targets a specific tab (e.g.
  // Sentinel's Health tabs).
  const [activeToolTab, setActiveToolTab] = useState(null);
  // App-level Facebook connect wizard (Atlas's "Connect Facebook" tool action).
  const [showFbWizard, setShowFbWizard] = useState(false);
  // When Facebook redirects back after OAuth (?fb=connected), resume the wizard
  // straight at the verify/test step instead of the welcome screen.
  const [fbStartAtVerify, setFbStartAtVerify] = useState(false);
  // Error message surfaced when Facebook redirects back with ?fb=error.
  const [fbOauthError, setFbOauthError] = useState("");
  // Sales Presentation Mode (admin-only): when live, the dashboard points at the
  // demo brand and the presenter toolbar is shown.
  const [demoActive, setDemoActive] = useState(false);

  function handleUseImageInSocial(image) {
    setSocialPrefillImage(image);
    setSection("social");
  }

  function handleFixPayment() {
    setBillingTab("billing");
    setOpenPaymentModal(true);
    setSection("settings");
  }

  // Sends the user to Settings → Billing to upgrade their plan (from a locked
  // feature's upgrade prompt or a sidebar lock).
  function handleUpgrade() {
    setBillingTab("billing");
    setOpenPaymentModal(false);
    setSection("settings");
  }

  // Whether the current user can actually open a given section. Sentinel's health
  // oversight is owner/admin-only (staff never see that department), and the admin
  // console only renders for admins. Used to gate tool CTAs and as a defensive
  // navigation guard.
  const canOpenSection = useCallback(
    (s) => {
      if (!s) return false;
      // Echo's Multi-Business Chief of Staff spans the whole account (owner/admin).
      if (s === "portfolio") return isAdmin || !isTeamMember;
      if (s === "sentinelhealth") return isAdmin || !isTeamMember;
      // Call monitoring lives in Sentinel — same owner/admin-only visibility.
      if (s === "callmonitor") return isAdmin || !isTeamMember;
      // Echo's voice is the owner's personal assistant (owner/admin only).
      if (s === "voicesettings") return isAdmin || !isTeamMember;
      // Echo's Memory is the owner's private knowledge base (owner/admin only).
      if (s === "echomemory") return isAdmin || !isTeamMember;
      if (s === "admin") return isAdmin;
      // The Voter CRM only exists for political-campaign brands.
      if (s === "supporters") {
        const b = brands.find(
          (br) => String(br.brand_id) === String(selectedBrandId),
        );
        return !!b && b.brand_type === "political";
      }
      // The Property CRM only exists for real-estate brands.
      if (s === "properties") {
        const b = brands.find(
          (br) => String(br.brand_id) === String(selectedBrandId),
        );
        return !!b && b.brand_type === "real_estate";
      }
      return true;
    },
    [isTeamMember, isAdmin, brands, selectedBrandId],
  );

  // Sentinel is the only department hidden from staff; every other team member's
  // department is open to owners and staff alike.
  const canOpenDepartment = useCallback(
    (id) => {
      if (id === "sentinel") return isAdmin || !isTeamMember;
      return true;
    },
    [isTeamMember, isAdmin],
  );

  // Mission Control is home. Manual navigation (sidebar) resets the billing
  // deep-link flags and clears any open department so top-level sections open
  // cleanly. Targets the user can't open fall back to home.
  // opts.brandId switches the selected business first (Mission Control's goal
  // alerts span all brands, so their click-through must land on the alert's
  // brand, not whatever brand happened to be selected). opts.focus === "goals"
  // asks Settings to scroll to the Goals + Goal Alert History cards.
  function handleSelectSection(next, opts) {
    setBillingTab("account");
    setOpenPaymentModal(false);
    setDeptAgentId(null);
    setActiveToolTab(null);
    setBrandFallbackNotice("");
    const allowed = canOpenSection(next);
    if (allowed && opts && opts.brandId != null && opts.brandId !== "") {
      // Only switch if the brand actually belongs to this account's list.
      const match = brands.find(
        (b) => String(b.brand_id) === String(opts.brandId),
      );
      if (match) {
        setSelectedBrandId(match.brand_id);
      } else {
        // The alert's business is gone (e.g. deleted after the alert was
        // logged). Keep the current selection but say so — never silently
        // show another business's goals. The goals scroll/focus still runs
        // with the notice visible so the click-through stays useful.
        const current = brands.find(
          (b) => String(b.brand_id) === String(selectedBrandId),
        );
        setBrandFallbackNotice(
          current
            ? `That business is no longer in your account — showing ${current.brand_name} instead.`
            : "That business is no longer in your account.",
        );
      }
    }
    setSettingsFocusGoals(
      allowed && opts && opts.focus === "goals" ? Date.now() : null,
    );
    setSection(allowed ? next : "missioncontrol");
  }

  // Open a team member's Department View (the hub of clickable tool cards).
  function openDepartment(agentId) {
    if (!canOpenDepartment(agentId)) return;
    setBrandFallbackNotice("");
    setDeptAgentId(agentId);
    setActiveToolTab(null);
    setSection("department");
  }

  // Open a specific tool from a Department View. deptAgentId stays set so the
  // breadcrumb/back trail keeps the department context; a tool may request a
  // sub-tab (e.g. Sentinel's Health tabs) or an App-level action.
  function openTool(tool) {
    if (!tool) return;
    if (tool.action) {
      handleToolAction(tool.action);
      return;
    }
    if (!canOpenSection(tool.section)) return;
    setActiveToolTab(tool.tab || null);
    setSettingsFocusGoals(null);
    setSection(tool.section);
  }

  // App-level actions a tool card can trigger instead of navigating to a section.
  function handleToolAction(action) {
    if (action === "facebook") setShowFbWizard(true);
  }

  // Mission Control is home.
  function goHome() {
    setDeptAgentId(null);
    setActiveToolTab(null);
    setSettingsFocusGoals(null);
    setBrandFallbackNotice("");
    setSection("missioncontrol");
  }

  // Back button: from a tool, return to its department; otherwise go home.
  function handleBack() {
    if (section !== "department" && deptAgentId) {
      setActiveToolTab(null);
      setSection("department");
    } else {
      goHome();
    }
  }

  // Breadcrumb trail for the current view (Home > Department > Tool).
  function buildCrumbs() {
    const crumbs = [{ label: "Home", onClick: goHome }];
    const meta = deptAgentId ? agentMeta(deptAgentId) : null;
    if (section === "department" && meta) {
      crumbs.push({ label: meta.name });
      return crumbs;
    }
    if (meta) {
      crumbs.push({
        label: meta.name,
        onClick: () => {
          setActiveToolTab(null);
          setSection("department");
        },
      });
    }
    const title = sectionTitle(section);
    if (title) crumbs.push({ label: title });
    return crumbs;
  }

  const handleLogout = useCallback(() => {
    // Kill ALL audio (Echo's voice, music, sound effects, mic) the instant
    // logout happens — dispatched synchronously BEFORE the providers unmount
    // so every context's kill-switch listener is still attached.
    try {
      window.dispatchEvent(new CustomEvent("echoai:logout"));
    } catch {
      /* noop */
    }
    clearToken();
    setAuthed(false);
    setBrands([]);
    setSelectedBrandId("");
    setOnboardingCompleted(null);
    setIsAdmin(false);
    navigate("/");
  }, [navigate]);

  // The demo dealership ("Premier Auto Group") is a real brand row flagged
  // is_demo. Pick the first NON-demo brand so a fresh login / demo-stop never
  // lands the selector on the demo brand. Falls back to the raw first brand.
  const firstRealBrandId = (list) => {
    const real = (list || []).filter((b) => !b.is_demo);
    if (real[0]) return real[0].brand_id;
    return list && list[0] ? list[0].brand_id : "";
  };

  const loadBrands = useCallback(async () => {
    setLoadingBrands(true);
    setBrandsError("");
    try {
      const data = await api.getBrands();
      const list = data.brands || [];
      setBrands(list);
      setSelectedBrandId((prev) => prev || firstRealBrandId(list));
      return list;
    } catch (err) {
      if (err.status === 401) {
        handleLogout();
        return [];
      }
      setBrandsError(err.message);
      return [];
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
          setWorkspaceRole(profile.workspaceRole || "owner");
          setIsTeamMember(Boolean(profile.isTeamMember));
          setOwnerBusinessName(profile.ownerBusinessName || null);
          setUserEmail(profile.email || "");
          setBusinessName(profile.businessName || profile.ownerBusinessName || "");
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

  // Decide whether to auto-launch the AI Setup Agent: resume any in-progress
  // session (e.g. returning from Google OAuth), otherwise offer it to a brand-new
  // user who hasn't created any brands yet. Team members never see it (they join
  // an existing workspace). Also listens for a manual open from Settings.
  useEffect(() => {
    if (!authed || !onboardingCompleted || isTeamMember) return;
    let active = true;
    (async () => {
      try {
        const { session } = await api.getSetupLatest();
        if (!active) return;
        // Auto-resume an unfinished session — either actively in progress (e.g.
        // returning from Google OAuth) or paused because the user navigated away
        // mid-interview (SetupAgent pauses on unmount).
        if (session && (session.status === "in_progress" || session.status === "paused")) {
          setShowSetup(true);
          return;
        }
        if (!session) {
          const data = await api.getBrands();
          if (active && (data.brands || []).length === 0) setShowSetup(true);
        }
      } catch {
        /* If we can't read setup status, just don't auto-launch. */
      }
    })();
    const openHandler = () => setShowSetup(true);
    window.addEventListener("echoai:open-setup-agent", openHandler);
    return () => {
      active = false;
      window.removeEventListener("echoai:open-setup-agent", openHandler);
    };
  }, [authed, onboardingCompleted, isTeamMember]);

  // Poll subscription status so the payment-failed banner stays current across
  // every dashboard page until the issue is resolved. Defined before any callback
  // that depends on it to avoid a temporal-dead-zone reference during render.
  const loadBillingStatus = useCallback(async () => {
    try {
      setBillingStatus(await api.getSubscriptionStatus());
    } catch {
      // A missing/unreadable subscription simply means no banner.
      setBillingStatus(null);
    }
  }, []);

  const handleSetupClosed = useCallback(async () => {
    setShowSetup(false);
    setSetupPending(false);
    const list = await loadBrands();
    loadBillingStatus();
    // After onboarding, offer a one-time goal-setup wizard when the brand has
    // no goals yet. Failures here are non-fatal — never block the dashboard.
    const bid = firstRealBrandId(list) || selectedBrandId;
    if (bid) {
      try {
        const g = await api.getGoals(bid);
        if (!g.goalCount) {
          setGoalWizardBrandId(bid);
          setShowGoalWizard(true);
        }
      } catch {
        /* ignore — goal wizard is optional */
      }
    }
  }, [loadBrands, loadBillingStatus, selectedBrandId]);

  // Step out of the Setup Agent to a dashboard section (e.g. Social Accounts) to
  // connect something, keeping the unfinished session so the user can return via
  // the floating "Finish setup" button.
  const handleSetupExitToSection = useCallback((sec) => {
    setShowSetup(false);
    setSetupPending(true);
    if (sec) setSection(sec);
  }, []);

  // Consume a pending team invitation once authenticated. Accepting joins the
  // owner's workspace; we then re-read the profile so the remapped role/context
  // takes effect, and strip the token from the URL.
  useEffect(() => {
    if (!authed || !inviteToken) return;
    let active = true;
    (async () => {
      try {
        const res = await api.acceptTeamInvite(inviteToken);
        if (!active) return;
        setInviteNotice(
          `You've joined ${res.businessName || "the workspace"} as ${
            res.role || "a team member"
          }.`
        );
        const profile = await api.getProfile();
        if (!active) return;
        setOnboardingCompleted(Boolean(profile.onboardingCompleted));
        setWorkspaceRole(profile.workspaceRole || "owner");
        setIsTeamMember(Boolean(profile.isTeamMember));
        setOwnerBusinessName(profile.ownerBusinessName || null);
      } catch (err) {
        if (active)
          setInviteNotice(err.message || "Could not accept the invitation.");
      } finally {
        if (active) {
          setInviteToken(null);
          try {
            const url = new URL(window.location.href);
            url.searchParams.delete("invite");
            window.history.replaceState({}, "", url.pathname + url.search);
          } catch {
            /* no-op */
          }
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [authed, inviteToken]);

  // Handle Facebook's post-OAuth redirect (?fb=connected|error). On success we
  // reopen the Setup Wizard at the verify/test step so the owner sees their
  // connection confirmed; either way we strip the query params from the URL.
  useEffect(() => {
    if (!authed) return;
    let fb;
    let fbMessage = "";
    try {
      const params = new URLSearchParams(window.location.search);
      fb = params.get("fb");
      fbMessage = params.get("fb_message") || "";
    } catch {
      return;
    }
    if (!fb) return;
    if (fb === "connected") {
      setFbStartAtVerify(true);
      setShowFbWizard(true);
    } else if (fb === "error") {
      setFbOauthError(
        fbMessage ||
          "Facebook couldn't complete the connection. Please try again.",
      );
      setShowFbWizard(true);
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("fb");
      url.searchParams.delete("fb_message");
      window.history.replaceState({}, "", url.pathname + url.search);
    } catch {
      /* no-op */
    }
  }, [authed]);

  // Deep link from a push notification (e.g. "post failed to publish") straight
  // to a dashboard section: /dashboard?section=social. The param is stripped
  // immediately so refreshes don't re-navigate, and only known, permitted
  // sections are honored — anything else is ignored (never a blank view).
  useEffect(() => {
    if (!authed || !onboardingCompleted) return;
    let target;
    try {
      target = new URLSearchParams(window.location.search).get("section");
    } catch {
      return;
    }
    if (!target) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("section");
      window.history.replaceState({}, "", url.pathname + url.search);
    } catch {
      /* no-op */
    }
    if (SECTION_TIERS[target] && canOpenSection(target)) {
      setDeptAgentId(null);
      setActiveToolTab(null);
      setSection(target);
    }
  }, [authed, onboardingCompleted, canOpenSection]);

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

  // Echo's proactive suggestions ("Set it up") ask the app to jump to a tool's
  // section. handleSelectSection already gates by tier via canOpenSection. Route
  // through a ref so the listener always uses the latest tier-aware handler.
  const selectSectionRef = useRef(handleSelectSection);
  selectSectionRef.current = handleSelectSection;
  const openDepartmentRef = useRef(openDepartment);
  openDepartmentRef.current = openDepartment;
  useEffect(() => {
    const onNavSection = (e) => {
      const next = e && e.detail;
      if (typeof next !== "string" || !next) return;
      // "action:facebook" opens the Facebook connect wizard (an App-level
      // action, not a section). "dept:<agentId>" opens a team member's
      // Department View; anything else is a plain top-level section id.
      if (next === "action:facebook") {
        // eslint-disable-next-line no-console
        console.log(
          "[Echo nav] echoai:navigate-section received → opening Facebook setup wizard",
        );
        setShowFbWizard(true);
      } else if (next.startsWith("dept:")) {
        // eslint-disable-next-line no-console
        console.log(
          `[Echo nav] echoai:navigate-section received → opening department "${next.slice(5)}"`,
        );
        openDepartmentRef.current(next.slice(5));
      } else {
        // eslint-disable-next-line no-console
        console.log(
          `[Echo nav] echoai:navigate-section received → opening section "${next}"`,
        );
        selectSectionRef.current(next);
      }
    };
    window.addEventListener("echoai:navigate-section", onNavSection);
    return () =>
      window.removeEventListener("echoai:navigate-section", onNavSection);
  }, []);

  // Rehydrate Presentation Mode after a page refresh: if an admin left it live,
  // re-point the dashboard at the demo brand and re-show the presenter toolbar.
  useEffect(() => {
    if (!authed || !onboardingCompleted || !isAdmin) return;
    let alive = true;
    (async () => {
      try {
        const status = await api.demoGetStatus();
        if (!alive || !status || !status.active) return;
        if (status.demoBrandId) setSelectedBrandId(status.demoBrandId);
        setDemoActive(true);
      } catch {
        /* not seeded / not admin — nothing to rehydrate */
      }
    })();
    return () => {
      alive = false;
    };
  }, [authed, onboardingCompleted, isAdmin]);

  // Sales Presentation Mode start/stop (dispatched from the admin Demo tab).
  // Starting reloads brands (so the just-seeded demo brand is present), points
  // the dashboard at it, and lands on Mission Control for the briefing.
  useEffect(() => {
    const onStart = async (e) => {
      const brandId = e.detail && e.detail.demoBrandId;
      await loadBrands();
      if (brandId) setSelectedBrandId(brandId);
      setDeptAgentId(null);
      setActiveToolTab(null);
      setSection("missioncontrol");
      setDemoActive(true);
    };
    const onStop = async () => {
      // Reload real brands and move the selector off the demo brand so the admin
      // is never left "stuck" showing Premier Auto Group after a demo.
      const list = await loadBrands();
      setSelectedBrandId(firstRealBrandId(list));
      setDemoActive(false);
    };
    window.addEventListener("echoai:demo-start", onStart);
    window.addEventListener("echoai:demo-stop", onStop);
    return () => {
      window.removeEventListener("echoai:demo-start", onStart);
      window.removeEventListener("echoai:demo-stop", onStop);
    };
  }, [loadBrands]);

  // Keep the last-active timestamp fresh while signed in, so a later return can
  // be classified as a new session (>8h away).
  useEffect(() => {
    if (!authed) return undefined;
    return startSessionTracking();
  }, [authed]);

  // Returning after >8h without a fresh login → announce a new session so the
  // voice layer plays the morning wake-up music and delivers the briefing.
  useEffect(() => {
    if (!authed || !onboardingCompleted || !wasReturningSession) return;
    if (morningReturnFired.current) return;
    morningReturnFired.current = true;
    window.dispatchEvent(new CustomEvent("echoai:morning-return"));
  }, [authed, onboardingCompleted, wasReturningSession]);

  function handleLogin(token, rememberDevice = true) {
    setToken(token, rememberDevice);
    setAuthed(true);
    setSection("missioncontrol");
    // On first login, ask to enable push so the owner gets instant hot-lead
    // alerts on their phone. Best-effort — never blocks the login flow.
    enablePushNotifications(token).catch(() => {});
  }

  if (!authed)
    return <Login onLogin={handleLogin} invitePending={Boolean(inviteToken)} />;

  // Wait until we know the onboarding status before deciding what to render.
  if (onboardingCompleted === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <Spinner label="Loading…" />
      </div>
    );
  }

  // Sales reps get a dedicated, focused console instead of the full dashboard:
  // one assigned lead at a time, masked phone numbers, bridge calling. They never
  // see the sidebar, other reps' work, or any other section.
  if (workspaceRole === "sales_rep") {
    return (
      <SalesRepConsole
        email={userEmail}
        ownerBusinessName={ownerBusinessName}
        onLogout={handleLogout}
      />
    );
  }

  // New users go through the setup wizard; it disappears for good once complete.
  if (!onboardingCompleted) {
    return <OnboardingWizard onComplete={() => setOnboardingCompleted(true)} />;
  }

  // The AI Setup Agent takes over the screen while active (auto-launched for new
  // users / resumed sessions, or opened manually from Settings).
  if (showSetup) {
    return (
      <SetupAgent onClose={handleSetupClosed} onExitToSection={handleSetupExitToSection} />
    );
  }

  // Effective tier for client-side gating. Admins bypass every gate (treated as
  // top tier). Otherwise the tier comes from the subscription status; null until
  // it loads so FeatureGate shows a spinner rather than flashing a prompt.
  const currentTier = isAdmin
    ? "enterprise"
    : billingStatus
      ? billingStatus.subscriptionTier
      : null;

  // Managers (and legacy viewers) are read-only everywhere: they can view every
  // section but must not see write controls. Owner, workspace-admin and the
  // platform admin can write. Passed down to sections that expose mutations.
  const readOnly = !canWrite({ isAdmin, workspaceRole });

  // Accent color for the section currently being viewed — reinforces the tier
  // association on the content cards (blue/purple/gold, teal for core sections).
  const sectionAccent = accentColor(accentTierForSection(section));

  // Wraps a section node in a FeatureGate when that section requires a tier.
  function gate(key, node) {
    const req = requiredTierForSection(key);
    if (!req) return node;
    return (
      <FeatureGate
        feature={key}
        requiredTier={req}
        currentTier={currentTier}
        onUpgrade={handleUpgrade}
      >
        {node}
      </FeatureGate>
    );
  }

  return (
    <MusicProvider>
    <VoiceProvider active={!isTeamMember}>
    <DemoSuggestionProvider>
    <EchoConversationProvider active={!isTeamMember}>
    <div className="flex min-h-screen flex-col bg-black md:flex-row">
      <Sidebar
        section={section}
        deptAgentId={deptAgentId}
        onSelectSection={handleSelectSection}
        onOpenDepartment={openDepartment}
        onLogout={handleLogout}
        isAdmin={isAdmin}
        isTeamMember={isTeamMember}
        canOpenDepartment={canOpenDepartment}
        workspaceRole={workspaceRole}
        ownerBusinessName={ownerBusinessName}
      />
      {setupPending ? (
        <button
          onClick={() => setShowSetup(true)}
          className="fixed bottom-6 right-6 z-40 rounded-full bg-teal-500 px-5 py-3 font-semibold text-black shadow-lg shadow-teal-500/30 hover:bg-teal-400"
        >
          Finish your setup →
        </button>
      ) : null}
      <main
        className="flex-1 p-4 pb-24 md:p-8 md:pb-8"
        style={{ "--tier-accent": sectionAccent }}
      >
        <div className="mx-auto max-w-6xl">
          <TopBar
            businessName={businessName}
            email={userEmail}
            tier={currentTier}
            isAdmin={isAdmin}
            workspaceRole={workspaceRole}
            isTeamMember={isTeamMember}
            section={section}
            brandId={selectedBrandId}
          />
          {section !== "missioncontrol" && (
            <div className="mb-5 flex items-center gap-3">
              <button
                onClick={handleBack}
                className="flex items-center gap-1.5 rounded-lg border border-gray-800 bg-gray-900 px-2.5 py-1.5 text-sm font-medium text-gray-300 hover:bg-gray-800"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                Back
              </button>
              <Breadcrumbs crumbs={buildCrumbs()} />
            </div>
          )}
          <div
            className="border-l-2 pl-3 md:pl-4"
            style={{ borderLeftColor: "var(--tier-accent)" }}
          >
          <ErrorBoundary key={`${section}:${deptAgentId || ""}`}>
          {section === "department" ? (
            <DepartmentView
              agentId={deptAgentId}
              selectedBrandId={selectedBrandId}
              onOpenTool={openTool}
              onAction={handleToolAction}
              canOpenSection={canOpenSection}
            />
          ) : section === "admin" && isAdmin ? (
            <AdminPanel />
          ) : section === "agency" ? (
            isAgencyOwner ? (
              <AgencyPortal />
            ) : (
              <FeatureGate
                feature="agency"
                requiredTier="enterprise"
                currentTier={currentTier}
                onUpgrade={handleUpgrade}
              >
                {/* Enterprise users who are not provisioned as an agency owner
                    still don't have a portal — show an informational note. */}
                <div className="mx-auto max-w-xl rounded-2xl border border-gray-700 bg-gray-900/60 p-8 text-center">
                  <h2 className="text-xl font-bold text-gray-100">White Label</h2>
                  <p className="mt-3 text-sm leading-relaxed text-gray-300">
                    White-label agency accounts are provisioned by the EchoAI team.
                    Contact support to have your agency enabled and start reselling
                    EchoAI under your own brand.
                  </p>
                </div>
              </FeatureGate>
            )
          ) : section === "affiliate" ? (
            <FeatureGate
              feature="affiliate"
              requiredTier="enterprise"
              currentTier={currentTier}
              onUpgrade={handleUpgrade}
            >
              <AffiliateProgram />
            </FeatureGate>
          ) : (
            <>
              <PaymentFailedBanner status={billingStatus} onFix={handleFixPayment} />
              {inviteNotice && (
                <div className="mb-6 flex items-start justify-between gap-3 rounded-lg bg-green-500/10 p-3 text-sm text-green-300">
                  <span>{inviteNotice}</span>
                  <button
                    onClick={() => setInviteNotice("")}
                    className="shrink-0 text-green-400 hover:text-green-200"
                    aria-label="Dismiss"
                  >
                    ✕
                  </button>
                </div>
              )}
              {brandFallbackNotice && (
                <div
                  role="alert"
                  className="mb-6 flex items-start justify-between gap-3 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300"
                >
                  <span>{brandFallbackNotice}</span>
                  <button
                    onClick={() => setBrandFallbackNotice("")}
                    className="shrink-0 text-amber-400 hover:text-amber-200"
                    aria-label="Dismiss"
                  >
                    ✕
                  </button>
                </div>
              )}
              <BrandBar
                brands={demoActive ? brands : brands.filter((b) => !b.is_demo)}
                selectedBrandId={selectedBrandId}
                onSelect={setSelectedBrandId}
                loading={loadingBrands}
                error={brandsError}
              />
              {section === "portfolio" &&
                (canOpenSection("portfolio") ? <Portfolio /> : null)}
              {section === "missioncontrol" && (
                <MissionControl onNavigate={handleSelectSection} onOpenDepartment={openDepartment} />
              )}
              {section === "aiteam" && (
                <AiTeam onOpenDepartment={openDepartment} />
              )}
              {section === "echomemory" &&
                (canOpenSection("echomemory") ? <EchoMemory /> : null)}
              {section === "echogrowth" && (
                <div className="mx-auto max-w-3xl">
                  <AutonomousTab readOnly={isTeamMember || workspaceRole !== "owner"} />
                </div>
              )}
              {section === "voicesettings" &&
                (canOpenSection("voicesettings") ? <VoiceSettings /> : null)}
              {section === "sentinelhealth" &&
                (canOpenSection("sentinelhealth") ? (
                  <SentinelHealth brandId={selectedBrandId} initialTab={activeToolTab || "monitor"} isAdmin={isAdmin} />
                ) : null)}
              {section === "callmonitor" &&
                (canOpenSection("callmonitor") ? <CallMonitoring /> : null)}
              {section === "queueoverview" && (
                <QueueOverview readOnly={readOnly} />
              )}
              {section === "overview" && <Overview brandId={selectedBrandId} />}
              {section === "leads" && <Leads brandId={selectedBrandId} />}
              {section === "supporters" &&
                (canOpenSection("supporters") ? <Supporters brandId={selectedBrandId} /> : null)}
              {section === "properties" &&
                (canOpenSection("properties") ? <Properties brandId={selectedBrandId} /> : null)}
              {section === "campaigns" && <Campaigns />}
              {section === "adstudio" && gate("adstudio", <AdStudio brandId={selectedBrandId} />)}
              {section === "social" && (
                <SocialMedia
                  brandId={selectedBrandId}
                  tier={currentTier}
                  prefillImage={socialPrefillImage}
                  onPrefillConsumed={() => setSocialPrefillImage(null)}
                />
              )}
              {section === "contentcalendar" &&
                gate(
                  "contentcalendar",
                  <SocialMedia
                    brandId={selectedBrandId}
                    initialTab="ai-calendar"
                    prefillImage={socialPrefillImage}
                    onPrefillConsumed={() => setSocialPrefillImage(null)}
                  />,
                )}
              {section === "video" && gate("video", <VideoContent brandId={selectedBrandId} />)}
              {section === "sales" && gate("sales", <SalesScripts brandId={selectedBrandId} />)}
              {section === "email" &&
                gate("email", <EmailMarketing brandId={selectedBrandId} />)}
              {section === "image" &&
                gate(
                  "image",
                  <ImageStudio
                    brandId={selectedBrandId}
                    onUseInSocial={handleUseImageInSocial}
                  />,
                )}
              {section === "googleseo" && (
                <GoogleSeo brandId={selectedBrandId} />
              )}
              {section === "roi" && (
                <RoiDashboard
                  brandId={selectedBrandId}
                  currentTier={currentTier}
                  onUpgrade={handleUpgrade}
                />
              )}
              {section === "intelligence" &&
                gate(
                  "intelligence",
                  <CustomerIntelligence brandId={selectedBrandId} />,
                )}
              {section === "capitalfunding" &&
                gate(
                  "capitalfunding",
                  <CapitalFunding brandId={selectedBrandId} />,
                )}
              {section === "sage" && (
                <Sage
                  brandId={selectedBrandId}
                  initialTab={activeToolTab || "brief"}
                />
              )}
              {section === "reputation" &&
                gate("reputation", <Reputation brandId={selectedBrandId} />)}
              {section === "phone" &&
                gate("phone", <PhoneAgent brandId={selectedBrandId} />)}
              {section === "appointments" &&
                gate(
                  "appointments",
                  <Appointments brandId={selectedBrandId} />,
                )}
              {section === "followups" &&
                gate("followups", <FollowUps brandId={selectedBrandId} />)}
              {section === "sms" &&
                gate("sms", <SmsMarketing brandId={selectedBrandId} />)}
              {section === "chatbot" && (
                <ChatbotSetup brandId={selectedBrandId} />
              )}
              {section === "feedback" &&
                gate("feedback", <Feedback brandId={selectedBrandId} />)}
              {section === "zapier" &&
                gate("zapier", <ZapierIntegration brandId={selectedBrandId} />)}
              {section === "settings" && (
                <Settings
                  brandId={selectedBrandId}
                  onBrandsChanged={loadBrands}
                  initialTab={billingTab}
                  focusGoals={settingsFocusGoals}
                  openPaymentModal={openPaymentModal}
                  workspaceRole={workspaceRole}
                  isTeamMember={isTeamMember}
                  isAdmin={isAdmin}
                  tier={currentTier}
                  key={`${billingTab}-${openPaymentModal}`}
                />
              )}
            </>
          )}
          </ErrorBoundary>
          </div>
        </div>
      </main>
      <ErrorBoundary silent>
        <TourProvider
          tier={currentTier}
          isAdmin={isAdmin}
          businessName={businessName}
          onNavigate={setSection}
        />
      </ErrorBoundary>
      <ErrorBoundary silent>
        <HealthSupportWidget brandId={selectedBrandId} />
      </ErrorBoundary>
      {showGoalWizard && goalWizardBrandId && (
        <ErrorBoundary silent>
          <GoalSetupWizard
            brandId={goalWizardBrandId}
            onClose={() => setShowGoalWizard(false)}
            onComplete={() => setSection("missioncontrol")}
          />
        </ErrorBoundary>
      )}
      {!isTeamMember ? (
        <ErrorBoundary silent>
          <EchoCompanion />
        </ErrorBoundary>
      ) : null}
      {!isTeamMember ? (
        <ErrorBoundary silent>
          <EchoConversationOverlay />
        </ErrorBoundary>
      ) : null}
      {!isTeamMember ? (
        <ErrorBoundary silent>
          <GlobalStopButton />
        </ErrorBoundary>
      ) : null}
      {showFbWizard && (
        <ErrorBoundary silent>
          <FacebookWizard
            onClose={() => {
              setShowFbWizard(false);
              setFbStartAtVerify(false);
              setFbOauthError("");
            }}
            brandId={selectedBrandId}
            startAtVerify={fbStartAtVerify}
            oauthError={fbOauthError}
          />
        </ErrorBoundary>
      )}
      {isAdmin && demoActive ? (
        <ErrorBoundary silent>
          <PresenterOverlay
            onNavigate={handleSelectSection}
            onOpenDepartment={openDepartment}
            onEnd={() =>
              window.dispatchEvent(new CustomEvent("echoai:demo-stop"))
            }
          />
        </ErrorBoundary>
      ) : null}
    </div>
    </EchoConversationProvider>
    </DemoSuggestionProvider>
    </VoiceProvider>
    </MusicProvider>
  );
}

// Top bar shown above every dashboard view: the business name / email on the
// left and the tier badge on the right so the current plan is always visible.
function TopBar({
  businessName,
  email,
  tier,
  isAdmin,
  workspaceRole,
  isTeamMember,
  section,
  brandId,
}) {
  const primary = businessName || email || "Your account";
  const secondary = businessName && email ? email : "";
  // Show a workspace-role badge for team members (owners don't need one).
  const showRole = isTeamMember && workspaceRole && workspaceRole !== "owner";
  return (
    <div className="mb-6 flex items-center justify-between gap-3 border-b border-gray-800 pb-4">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-gray-100">
          {primary}
        </div>
        {secondary && (
          <div className="truncate text-xs text-gray-500">{secondary}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {showRole && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${roleBadgeClass(
              workspaceRole,
            )}`}
            title={`Your workspace role: ${roleLabel(workspaceRole)}`}
          >
            {roleLabel(workspaceRole)}
          </span>
        )}
        {!isTeamMember && <VoiceMicButton />}
        {!isTeamMember && <VoiceSpeakerButton />}
        {!isTeamMember && (
          <ErrorBoundary silent>
            <VoicePlayer />
          </ErrorBoundary>
        )}
        <HealthIndicator brandId={brandId} />
        <SectionHelp sectionKey={section} tourAnchor />
        <TierBadge tier={tier} isAdmin={isAdmin} />
      </div>
    </div>
  );
}

// Top-bar mute toggle for Echo's spoken voice. A quick, always-reachable way to
// silence briefings/reminders/alerts without opening Voice Settings.
function VoiceSpeakerButton() {
  const voice = useVoice();
  if (!voice || !voice.active) return null;
  const { muted, playing } = voice;
  return (
    <button
      onClick={voice.toggleMute}
      title={muted ? "Unmute Echo's voice" : "Mute Echo's voice"}
      aria-label={muted ? "Unmute Echo's voice" : "Mute Echo's voice"}
      aria-pressed={muted}
      className={`relative flex h-7 w-7 items-center justify-center rounded-full transition ${
        muted ? "text-gray-500 hover:text-gray-300" : "text-teal-300 hover:text-teal-200"
      }`}
    >
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 9v6h3l4.5 4.5V4.5L9 9H6z" />
        {muted ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 9l4 4m0-4l-4 4" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 8.5a5 5 0 010 7" />
        )}
      </svg>
      {!muted && playing && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-teal-400" />
      )}
    </button>
  );
}

// Top-bar hands-free mic toggle for Echo's always-on voice conversation. The
// colour/animation encodes state: passive = steady green ("listening for Hey
// Echo"), active/processing/speaking = pulsing green ring (in conversation),
// muted/off = grey with a slash. Click toggles mute; if the user hasn't opted in
// yet (or was denied), it opens the warm permission prompt.
function VoiceMicButton() {
  const conv = useEchoConversation();
  if (!conv || !conv.supported) return null; // fall back to push-to-talk silently
  const s = conv.micState; // unsupported|denied|off|muted|passive|active|processing|speaking
  const conversing = s === "active" || s === "processing" || s === "speaking";
  const silenced = s === "muted" || s === "off" || s === "denied";
  // Amber = hands-free is ON but the mic engine is momentarily paused
  // (restarting between recognition sessions) — Echo can't hear right now.
  const paused = conv.handsFreeOn && !conv.micLive;
  const title = silenced
    ? "Turn on hands-free voice (Hey Echo)"
    : paused
      ? "Mic is reconnecting — one moment"
      : conversing
        ? "Echo is listening — click to mute"
        : "Listening for “Hey Echo” — click to mute";
  const color = silenced
    ? "text-gray-500 hover:text-gray-300"
    : paused
      ? "text-amber-400 hover:text-amber-300"
      : "text-green-400 hover:text-green-300";
  return (
    <button
      onClick={conv.toggleMic}
      title={title}
      aria-label={title}
      aria-pressed={!silenced}
      className={`relative flex h-7 w-7 items-center justify-center rounded-full transition ${color}`}
    >
      {conversing && (
        <span className="absolute inset-0 animate-ping rounded-full bg-green-500/30" />
      )}
      <svg className="relative h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19 10v2a7 7 0 01-14 0v-2M12 19v3"
        />
        {silenced && (
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l16 16" />
        )}
      </svg>
    </button>
  );
}

// Big, always-visible Stop button shown ANY time Echo audio is playing —
// morning briefings, alerts, conversation replies, everything. One click cuts
// the audio instantly (voice.stopAll clears the queue too), and the
// conversation engine resolves its in-flight speech via the
// "echoai:speech-stopped" event so nothing hangs afterwards.
function GlobalStopButton() {
  const voice = useVoice();
  if (!voice || !voice.active || !voice.playing) return null;
  return (
    <button
      onClick={voice.stopAll}
      aria-label="Stop Echo"
      className="fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-red-500 px-6 py-3 text-base font-bold text-white shadow-xl shadow-red-900/50 transition hover:bg-red-400 active:scale-95"
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-[3px] bg-white"
        aria-hidden="true"
      />
      Stop
    </button>
  );
}

// Simple animated bars for the "Echo is listening / speaking" indicator.
function Waveform({ color }) {
  return (
    <span className="flex items-end gap-0.5" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="w-0.5 rounded-full"
          style={{
            height: 14,
            background: color,
            transformOrigin: "bottom",
            animation: `echoWave 900ms ease-in-out ${i * 120}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

// Bottom-of-screen conversation overlay: the warm mic-permission prompt, a live
// "listening / thinking / speaking" pill with a waveform and follow-up
// countdown, and a mid-session "mic disconnected" notice. All owner-only.
function EchoConversationOverlay() {
  const conv = useEchoConversation();
  if (!conv) return null;
  const {
    showPermission,
    enableHandsFree,
    declineHandsFree,
    supported,
    micState,
    micLive,
    listeningText,
    followupSeconds,
    micLost,
    convState,
    isConversing,
    handsFreeOn,
  } = conv;

  // Persistent listening chip — ALWAYS visible so the owner never has to guess
  // whether Echo can hear them. Green = mic live and listening; amber = mic
  // restarting for a beat; grey = not listening (muted / off / denied /
  // unsupported). During an active conversation the richer pill below replaces
  // it, so we hide the chip only then to avoid stacking two indicators.
  const silenced =
    !supported ||
    micState === "denied" ||
    micState === "off" ||
    micState === "muted";
  const stateLabel =
    micState === "active"
      ? "Listening…"
      : micState === "processing"
        ? "Thinking…"
        : micState === "speaking"
          ? "Echo is speaking…"
          : "";

  const showListenChip = !(isConversing && stateLabel);
  const chipLive = !silenced && micLive;

  return (
    <>
      <style>{`@keyframes echoWave{0%,100%{transform:scaleY(0.35)}50%{transform:scaleY(1)}}`}</style>

      {showPermission && supported ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-green-500/30 bg-gray-950 p-6 shadow-2xl">
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/15 text-green-400">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v3" />
                </svg>
              </span>
              <h3 className="text-lg font-semibold text-white">Go hands-free with Echo</h3>
            </div>
            <p className="mb-2 text-sm text-gray-300">
              Turn on always-on voice and just say <b className="text-green-400">“Hey Echo”</b> any
              time — no clicking. Echo will listen, answer out loud, and keep the
              conversation going naturally.
            </p>
            <p className="mb-5 text-xs text-gray-500">
              Your browser will ask to use the microphone. Wake-word listening stays
              on your device. You can mute the mic any time from the top bar, and the
              push-to-talk button in the chat always works instead.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={declineHandsFree}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-400 hover:text-gray-200"
              >
                Not now
              </button>
              <button
                onClick={enableHandsFree}
                className="rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-black hover:bg-green-400"
              >
                Enable “Hey Echo”
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showListenChip ? (
        <div
          className={`fixed bottom-24 right-6 z-40 flex items-center gap-2 rounded-full border px-3 py-1.5 shadow-lg ${
            chipLive
              ? "border-green-500/25 bg-gray-950/90 shadow-green-500/10"
              : silenced
                ? "border-gray-700 bg-gray-950/90"
                : "border-amber-500/30 bg-gray-950/90 shadow-amber-500/10"
          }`}
        >
          <span className="relative flex h-2 w-2">
            {chipLive ? (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400/60" />
            ) : null}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                chipLive
                  ? "bg-green-400"
                  : silenced
                    ? "bg-gray-500"
                    : "bg-amber-400"
              }`}
            />
          </span>
          <span
            className={`text-[11px] font-medium ${
              chipLive
                ? "text-green-300"
                : silenced
                  ? "text-gray-400"
                  : "text-amber-300"
            }`}
          >
            {chipLive
              ? "Listening — say “Hey Echo”"
              : silenced
                ? "Not listening"
                : "Mic reconnecting…"}
          </span>
        </div>
      ) : null}

      {isConversing && stateLabel ? (
        <div className="fixed bottom-24 right-6 z-40 flex items-center gap-3 rounded-full border border-green-500/30 bg-gray-950/95 px-4 py-2 shadow-lg shadow-green-500/10">
          <Waveform color={convState === "speaking" ? "#5eead4" : "#4ade80"} />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-green-300">{stateLabel}</div>
            {micState === "active" && listeningText ? (
              <div className="max-w-[220px] truncate text-[11px] text-gray-400">
                {listeningText}
              </div>
            ) : null}
          </div>
          {micState === "active" && followupSeconds != null ? (
            <span className="ml-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[11px] font-semibold text-green-300">
              {followupSeconds}s
            </span>
          ) : null}
        </div>
      ) : null}

      {micLost ? (
        <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-amber-500/40 bg-amber-950/90 px-4 py-2 text-xs text-amber-200 shadow-lg">
          Microphone disconnected — reconnect it, or use the push-to-talk button in the chat.
        </div>
      ) : null}
    </>
  );
}

// Small colored dot in the top nav reflecting the brand's latest health check.
// Polls the status endpoint periodically so it stays fresh without a reload.
function HealthIndicator({ brandId }) {
  const [status, setStatus] = useState("unknown");

  useEffect(() => {
    if (!brandId) {
      setStatus("unknown");
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const data = await api.healthGetStatus(brandId);
        if (active) setStatus(data.overallStatus || "unknown");
      } catch {
        if (active) setStatus("unknown");
      }
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [brandId]);

  const colors = {
    critical: "#ef4444",
    warning: "#f59e0b",
    healthy: "#22c55e",
    unknown: "#6b7280",
  };
  const labels = {
    critical: "Action needed on your account",
    warning: "Minor issues detected",
    healthy: "All systems healthy",
    unknown: "Health not checked yet",
  };
  return (
    <span
      className="flex items-center"
      title={labels[status] || labels.unknown}
      aria-label={labels[status] || labels.unknown}
    >
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: colors[status] || colors.unknown }}
      />
    </span>
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
    <div className="mb-6 flex items-center gap-2" data-tour="brand-selector">
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
