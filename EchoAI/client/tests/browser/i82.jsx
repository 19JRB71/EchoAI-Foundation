// Local-only browser seam; imported by no production entry. No backend/provider.
import React from "react";
import { createRoot } from "react-dom/client";
import { api } from "../../src/api.js";
import SetupAgent from "../../src/onboarding/SetupAgent.jsx";
import "../../src/index.css";
const params = new URLSearchParams(location.search);
const returned = params.get("returnStep") === "ads_destination";
const step = { key: "create_facebook_campaign", label: "Creating your first Facebook ad campaign" };
const session = { sessionId: "blacor-session", brandId: "blacor", interviewComplete: true,
  consentGranted: true, steps: [step], completedSteps: [] };
const occupied = { id: "sds", name: "SDS Page", unavailable: true, boundBusinessName: "South Dixie Storage" };
const candidate = { id: "blacor-page", name: "BlaCor Page", unavailable: false };
window.__i82Calls = [];
for (const key of Object.keys(api)) api[key] = async () => { throw Error(`Unstubbed test API: ${key}`); };
api.startSetupSession = async () => ({ session });
api.runSetupAction = async (...args) => {
  window.__i82Calls.push(["run", ...args]);
  return { step, status: "owner_action_required", detail: "Choose your ads Page",
    action: { code: "missing_ad_destination", missing: { page: true, destination: true } } };
};
api.getBrand = async () => ({ brand_id: "blacor", facebook_page_id: null, ad_link_url: null });
api.getFacebookAccounts = async () => ({ configured: true, connected: true, connectionStatus: "connected",
  accounts: [], selectedAccountId: null, selectedPageId: null, pages: returned ? [occupied, candidate] : [occupied] });
api.pauseSetupSession = api.pauseSetupSessionBeacon = async () => {};
api.startFacebookOAuth = async (context) => {
  sessionStorage.setItem("i82-oauth-context", JSON.stringify(context));
  return { authUrl: `${location.pathname}?fb=connected&fb_destination=pending&${new URLSearchParams(context)}` };
};
window.fetch = async () => { throw Error("No network API/provider allowed in I-82 browser seam"); };
createRoot(document.getElementById("root")).render(<SetupAgent embedded onClose={() => {}} />);
