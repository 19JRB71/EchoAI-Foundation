import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.js";
import { platformMeta } from "./platformMeta.jsx";

/**
 * "Needs attention" warning shown at the top of the calendar/scheduling views
 * when one or more of the brand's social accounts has connection_status
 * 'error' (expired/revoked login). Warns the owner BEFORE more scheduled
 * posts fail and jumps straight to the Connected Accounts tab via the same
 * onReconnect wiring the failed-post shortcut uses.
 *
 * Best-effort: if the accounts fetch fails, the banner stays hidden rather
 * than adding noise to the calendar.
 */
export default function AccountHealthBanner({ brandId, onReconnect }) {
  const [broken, setBroken] = useState([]);

  const load = useCallback(async () => {
    if (!brandId) return;
    try {
      const data = await api.getSocialAccounts(brandId);
      setBroken(
        (data.accounts || []).filter((a) => a.status === "error"),
      );
    } catch {
      // Silent: the calendar still works without the warning.
      setBroken([]);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  if (broken.length === 0) return null;

  return (
    <div
      data-testid="account-health-banner"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="mt-0.5 text-amber-300">
          ⚠️
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-amber-200">
            {broken.length === 1
              ? `Your ${platformMeta(broken[0].platform).label} account needs attention`
              : `${broken.length} connected accounts need attention`}
          </p>
          <p className="text-xs text-amber-200/80">
            The stored login stopped working, so upcoming scheduled posts to{" "}
            {broken.map((a) => platformMeta(a.platform).label).join(", ")} will
            fail until you reconnect.
          </p>
          {onReconnect && (
            <div className="flex flex-wrap gap-2 pt-1">
              {broken.map((a) => (
                <button
                  key={a.platform}
                  type="button"
                  onClick={() => onReconnect(a.platform)}
                  className="rounded border border-amber-500/50 bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/25"
                >
                  Reconnect {platformMeta(a.platform).label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
