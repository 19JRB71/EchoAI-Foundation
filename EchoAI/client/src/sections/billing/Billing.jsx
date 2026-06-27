// Billing tab — current plan, payment method, billing history, and upcoming
// invoice. Used inside Settings and openable directly from the dashboard's
// payment-failed banner.

import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import PlanSelectorModal from "./PlanSelectorModal.jsx";
import UpdatePaymentMethodModal from "./UpdatePaymentMethodModal.jsx";

const primaryBtn =
  "rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60";
const secondaryBtn =
  "rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-60";

function Card({ title, children, action }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-300">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium text-gray-200">{value || "—"}</span>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
}

function formatMoney(amount, currency = "usd") {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `$${Number(amount).toFixed(2)}`;
  }
}

export default function Billing({ openPaymentModal = false }) {
  const [status, setStatus] = useState(null);
  const [profile, setProfile] = useState(null);
  const [plans, setPlans] = useState([]);
  const [card, setCard] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [upcoming, setUpcoming] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showPlans, setShowPlans] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    // Critical pieces (plan + payment + invoices) come first; each optional
    // piece degrades to a sane default instead of failing the whole tab.
    try {
      const [statusRes, plansRes] = await Promise.all([
        api.getSubscriptionStatus().catch(() => null),
        api.getPlans().catch(() => ({ plans: [] })),
      ]);
      setStatus(statusRes);
      setPlans(plansRes.plans || []);

      const [profileRes, cardRes, invoicesRes, upcomingRes] = await Promise.all([
        api.getProfile().catch(() => null),
        api.getPaymentMethod().catch(() => ({ card: null })),
        api.getBillingHistory().catch(() => ({ invoices: [] })),
        api.getUpcomingInvoice().catch(() => ({ upcoming: null })),
      ]);
      setProfile(profileRes);
      setCard(cardRes.card);
      setInvoices(invoicesRes.invoices || []);
      setUpcoming(upcomingRes.upcoming);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (openPaymentModal) setShowPayment(true);
  }, [openPaymentModal]);

  const currentPlan = plans.find((p) => p.tier === status?.subscriptionTier) || null;
  const seatsUsed = profile?.teamSize;

  if (loading) {
    return (
      <Card title="Billing">
        <Spinner label="Loading billing…" />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {notice && <p className="text-sm text-green-500">{notice}</p>}
      <ErrorBanner message={error} />

      {/* Current plan */}
      <Card
        title="Current plan"
        action={
          <button onClick={() => setShowPlans(true)} className={secondaryBtn}>
            Upgrade / downgrade
          </button>
        }
      >
        {status ? (
          <div className="space-y-2 text-sm">
            <Row label="Plan" value={currentPlan ? currentPlan.name : status.subscriptionTier} />
            <Row
              label="Price"
              value={
                currentPlan ? `${formatMoney(currentPlan.monthlyPrice)} / month` : undefined
              }
            />
            <Row label="Next billing date" value={status.renewalDate ? formatDate(status.renewalDate) : undefined} />
            <Row label="Seats used" value={seatsUsed != null ? String(seatsUsed) : undefined} />
            <Row label="Payment status" value={status.paymentStatus} />
          </div>
        ) : (
          <p className="text-sm text-gray-400">No active subscription.</p>
        )}
      </Card>

      {/* Payment method */}
      <Card
        title="Payment method"
        action={
          <button onClick={() => setShowPayment(true)} className={secondaryBtn}>
            Update payment method
          </button>
        }
      >
        {card ? (
          <div className="space-y-2 text-sm">
            <Row
              label="Card"
              value={`${card.brand ? card.brand.toUpperCase() : "Card"} •••• ${card.last4}`}
            />
            <Row
              label="Expires"
              value={`${String(card.expMonth).padStart(2, "0")} / ${card.expYear}`}
            />
          </div>
        ) : (
          <p className="text-sm text-gray-400">No card on file.</p>
        )}
      </Card>

      {/* Upcoming invoice */}
      <Card title="Upcoming invoice">
        {upcoming ? (
          <div className="space-y-2 text-sm">
            <Row label="Amount due" value={formatMoney(upcoming.amount, upcoming.currency)} />
            <Row label="Billing date" value={upcoming.date ? formatDate(upcoming.date) : undefined} />
            {upcoming.lineItems && upcoming.lineItems.length > 0 && (
              <div className="mt-3 border-t border-gray-800 pt-3">
                {upcoming.lineItems.map((line, i) => (
                  <div key={i} className="flex justify-between text-xs text-gray-400">
                    <span>{line.description}</span>
                    <span>{formatMoney(line.amount, upcoming.currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No upcoming invoice.</p>
        )}
      </Card>

      {/* Billing history */}
      <Card title="Billing history">
        {invoices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Amount</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-gray-800/60">
                    <td className="py-2 pr-4 text-gray-300">{formatDate(inv.date)}</td>
                    <td className="py-2 pr-4 text-gray-300">
                      {formatMoney(inv.amount, inv.currency)}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          inv.paid
                            ? "bg-green-500/15 text-green-400"
                            : inv.status === "open"
                              ? "bg-amber-500/15 text-amber-300"
                              : "bg-red-500/15 text-red-400",
                        ].join(" ")}
                      >
                        {inv.paid ? "Paid" : inv.status === "open" ? "Open" : "Failed"}
                      </span>
                    </td>
                    <td className="py-2">
                      {inv.pdfUrl || inv.hostedUrl ? (
                        <a
                          href={inv.pdfUrl || inv.hostedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-amber-400 hover:text-amber-300"
                        >
                          Download
                        </a>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No invoices yet.</p>
        )}
      </Card>

      {showPlans && (
        <PlanSelectorModal
          plans={plans}
          currentTier={status?.subscriptionTier}
          onClose={() => setShowPlans(false)}
          onChanged={(tier) => {
            setShowPlans(false);
            const plan = plans.find((p) => p.tier === tier);
            setNotice(`Plan updated to ${plan ? plan.name : tier}.`);
            window.dispatchEvent(new Event("echoai:billing-updated"));
            load();
          }}
        />
      )}

      {showPayment && (
        <UpdatePaymentMethodModal
          onClose={() => setShowPayment(false)}
          onSaved={() => {
            setShowPayment(false);
            setNotice("Payment method updated.");
            window.dispatchEvent(new Event("echoai:billing-updated"));
            load();
          }}
        />
      )}
    </div>
  );
}
