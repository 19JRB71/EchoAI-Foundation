import { PRIORITY_META, topPriority } from "../lib/notificationPriority";

/**
 * Small colored circular badge shown on a brand switcher tab. Its color is the
 * brand's single highest pending priority (red > yellow > green) and it shows
 * the total pending count. Renders nothing when there is nothing pending.
 *
 * Rendered as a <span> (never a nested <button>) so it can live inside the tab
 * button; clicks bubble to a wrapping element that opens the panel.
 */
export default function NotificationBadge({ counts }) {
  const total = counts && counts.total ? counts.total : 0;
  if (total <= 0) return null;
  const priority = topPriority(counts) || "yellow";
  const meta = PRIORITY_META[priority];
  const label = total > 99 ? "99+" : String(total);
  return (
    <span
      className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[0.65rem] font-bold leading-none text-white shadow ${meta.dot}`}
      title={`${total} pending notification${total === 1 ? "" : "s"}`}
      aria-label={`${total} pending ${meta.label.toLowerCase()} notification${total === 1 ? "" : "s"}`}
      style={{ height: "1.25rem" }}
    >
      {label}
    </span>
  );
}
