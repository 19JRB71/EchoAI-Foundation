// Global dashboard banner shown only when the customer's payment has failed.
// Appears on every page until the payment issue is resolved.

export default function PaymentFailedBanner({ status, onFix }) {
  if (!status) return null;
  const failed = status.paymentStatus === "failed" || status.paymentStatus === "past_due";
  if (!failed && !status.isLocked) return null;

  const days = status.daysUntilLock;

  let message;
  if (status.isLocked) {
    message =
      "Your payment failed and your account is now locked. Update your payment method to restore access.";
  } else if (days != null) {
    message =
      days <= 0
        ? "Your payment failed and your account will be locked today. Update your payment method to keep access."
        : `Your payment failed. Your account will be locked in ${days} day${days === 1 ? "" : "s"}. Update your payment method to keep access.`;
  } else {
    message =
      "Your payment failed. Update your payment method to keep access to your account.";
  }

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-lg border border-red-500/40 bg-red-600 p-4 text-sm text-white shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2">
        <span aria-hidden className="text-lg leading-none">⚠</span>
        <p className="font-medium">{message}</p>
      </div>
      <button
        onClick={onFix}
        className="shrink-0 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
      >
        Update payment method
      </button>
    </div>
  );
}
