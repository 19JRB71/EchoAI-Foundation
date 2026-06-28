// Billing tab — current plan, payment method, billing history, and upcoming
// invoice. Used inside Settings and openable directly from the dashboard's
// payment-failed banner.

import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import PlanSelectorModal from "./PlanSelectorModal.jsx";
import UpdatePaymentMethodModal from "./UpdatePaymentMethodModal.jsx";
import { tierName } from "../../lib/tiers.js";

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

// Lets the customer set the number of team seats. Seats beyond the plan's
// included count are billed at the per-seat add-on price; the projected total
// updates live before saving.
function SeatManager({ status, onSave }) {
  const unlimited = status.includedSeats == null;
  const [size, setSize] = useState(status.teamSize || 1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSize(status.teamSize || 1);
  }, [status.teamSize]);

  const extra = unlimited ? 0 : Math.max(0, size - status.includedSeats);
  const projectedTotal = status.monthlyTotal != null
    ? status.monthlyTotal - (status.additionalSeats || 0) * status.additionalSeatPrice +
      extra * status.additionalSeatPrice
    : null;
  const changed = size !== status.teamSize;

  async function submit() {
    if (!changed || size < 1) return;
    setSaving(true);
    try {
      await onSave(size);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Team seats">
      {unlimited ? (
        <p className="text-sm text-gray-400">
          Your plan includes <span className="font-semibold text-gray-200">unlimited</span> seats.
          You have {status.teamSize} team member{status.teamSize === 1 ? "" : "s"}.
        </p>
      ) : (
        <div className="space-y-4 text-sm">
          <p className="text-gray-400">
            Your plan includes{" "}
            <span className="font-semibold text-gray-200">{status.includedSeats}</span> seat
            {status.includedSeats === 1 ? "" : "s"}. Additional seats are{" "}
            <span className="font-semibold text-gray-200">
              {formatMoney(status.additionalSeatPrice)}
            </span>{" "}
            / seat / month.
          </p>
          <div className="flex items-center gap-3">
            <label className="text-gray-400">Total team size</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSize((s) => Math.max(1, s - 1))}
                className="h-8 w-8 rounded-lg border border-gray-700 text-gray-200 hover:bg-gray-800"
              >
                −
              </button>
              <input
                type="number"
                min="1"
                value={size}
                onChange={(e) => setSize(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-16 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-center text-gray-100"
              />
              <button
                type="button"
                onClick={() => setSize((s) => s + 1)}
                className="h-8 w-8 rounded-lg border border-gray-700 text-gray-200 hover:bg-gray-800"
              >
                +
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-gray-800 pt-3">
            <span className="text-gray-400">
              {extra > 0
                ? `${extra} additional seat${extra === 1 ? "" : "s"}`
                : "No additional seats"}
            </span>
            {projectedTotal != null && (
              <span className="font-semibold text-gray-100">
                {formatMoney(projectedTotal)} / month
              </span>
            )}
          </div>
          <button onClick={submit} disabled={!changed || saving} className={primaryBtn}>
            {saving ? "Updating…" : "Update seats"}
          </button>
        </div>
      )}
    </Card>
  );
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

  async function saveSeats(nextSize) {
    setError("");
    try {
      await api.updateTeamSize(nextSize);
      setNotice("Team size updated.");
      window.dispatchEvent(new Event("echoai:billing-updated"));
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

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
            <Row label="Plan" value={currentPlan ? currentPlan.name : tierName(status.subscriptionTier)} />
            <Row
              label="Base price"
              value={
                currentPlan ? `${formatMoney(currentPlan.monthlyPrice)} / month` : undefined
              }
            />
            {status.additionalSeats > 0 && (
              <Row
                label="Additional seats"
                value={`${status.additionalSeats} × ${formatMoney(status.additionalSeatPrice)} / month`}
              />
            )}
            {status.monthlyTotal != null && (
              <Row
                label="Monthly total"
                value={`${formatMoney(status.monthlyTotal)} / month`}
              />
            )}
            <Row label="Next billing date" value={status.renewalDate ? formatDate(status.renewalDate) : undefined} />
            <Row label="Payment status" value={status.paymentStatus} />
            {status.pendingTier && (
              <div className="mt-3 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-300">
                Scheduled downgrade to{" "}
                <span className="font-semibold">{tierName(status.pendingTier)}</span>
                {status.pendingTierEffectiveAt
                  ? ` on ${formatDate(status.pendingTierEffectiveAt)}`
                  : " at your next billing cycle"}
                . You keep your current features until then.
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No active subscription.</p>
        )}
      </Card>

      {/* Team seats */}
      {status && (
        <SeatManager status={status} onSave={saveSeats} />
      )}

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
