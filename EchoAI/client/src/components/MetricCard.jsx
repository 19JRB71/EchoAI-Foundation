export default function MetricCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-400">{label}</p>
      <p className="mt-2 text-3xl font-bold text-gray-100">{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
