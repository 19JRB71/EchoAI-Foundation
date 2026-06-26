export default function Spinner({ label }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-700 border-t-amber-500" />
      {label && <span>{label}</span>}
    </div>
  );
}
