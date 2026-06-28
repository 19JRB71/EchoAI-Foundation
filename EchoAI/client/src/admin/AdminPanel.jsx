import { useState } from "react";
import AdminOverview from "./AdminOverview.jsx";
import AdminCustomers from "./AdminCustomers.jsx";
import AdminCustomerDetail from "./AdminCustomerDetail.jsx";
import AdminHealth from "./AdminHealth.jsx";
import AdminWhiteLabel from "./AdminWhiteLabel.jsx";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "customers", label: "Customers" },
  { key: "whitelabel", label: "White Label" },
  { key: "health", label: "Platform health" },
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
      {tab === "whitelabel" && <AdminWhiteLabel />}
      {tab === "health" && <AdminHealth />}
    </div>
  );
}
