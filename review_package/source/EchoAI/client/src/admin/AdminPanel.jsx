import { useState } from "react";
import AdminOverview from "./AdminOverview.jsx";
import AdminCustomers from "./AdminCustomers.jsx";
import AdminCustomerDetail from "./AdminCustomerDetail.jsx";
import AdminHealth from "./AdminHealth.jsx";
import AdminWhiteLabel from "./AdminWhiteLabel.jsx";
import AdminAffiliates from "./AdminAffiliates.jsx";
import AdminSalesAgent from "./AdminSalesAgent.jsx";
import AdminDemo from "./AdminDemo.jsx";
import AdminDiagnostics from "./AdminDiagnostics.jsx";
import AdminBeta from "./AdminBeta.jsx";
import AdminFeatureSuggestions from "./AdminFeatureSuggestions.jsx";
import AdminSelfReview from "./AdminSelfReview.jsx";
import AdminEconomics from "./AdminEconomics.jsx";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "customers", label: "Customers" },
  { key: "economics", label: "AI Economics" },
  { key: "beta", label: "Beta Program" },
  { key: "suggestions", label: "Feature Suggestions" },
  { key: "selfreview", label: "Self-Review" },
  { key: "sales", label: "Sales Agent" },
  { key: "demo", label: "Demo Mode" },
  { key: "whitelabel", label: "White Label" },
  { key: "affiliates", label: "Affiliates" },
  { key: "health", label: "Platform health" },
  { key: "diagnostics", label: "Diagnostics" },
];

export default function AdminPanel() {
  const [tab, setTab] = useState("overview");
  const [selectedUserId, setSelectedUserId] = useState(null);

  function viewCustomer(userId) {
    setSelectedUserId(userId);
    setTab("detail");
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-100">Admin</h2>
        <p className="text-sm text-gray-400">
          Manage customers, billing, and platform health.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map((t) => {
          const active = tab === t.key || (t.key === "customers" && tab === "detail");
          return (
            <button
              key={t.key}
              data-tour={`admin-${t.key}`}
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

      {tab === "overview" && <AdminOverview />}
      {tab === "customers" && <AdminCustomers onView={viewCustomer} />}
      {tab === "detail" && (
        <AdminCustomerDetail
          userId={selectedUserId}
          onBack={() => setTab("customers")}
        />
      )}
      {tab === "economics" && <AdminEconomics />}
      {tab === "beta" && <AdminBeta />}
      {tab === "suggestions" && <AdminFeatureSuggestions />}
      {tab === "selfreview" && <AdminSelfReview />}
      {tab === "sales" && <AdminSalesAgent />}
      {tab === "demo" && <AdminDemo />}
      {tab === "whitelabel" && <AdminWhiteLabel />}
      {tab === "affiliates" && <AdminAffiliates />}
      {tab === "health" && <AdminHealth />}
      {tab === "diagnostics" && <AdminDiagnostics />}
    </div>
  );
}
