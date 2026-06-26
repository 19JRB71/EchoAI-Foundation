const STYLES = {
  tire_kicker: "bg-red-100 text-red-700",
  warm: "bg-yellow-100 text-yellow-800",
  hot: "bg-green-100 text-green-700",
};

const LABELS = {
  tire_kicker: "Tire kicker",
  warm: "Warm",
  hot: "Hot",
};

export default function Badge({ temperature }) {
  const style = STYLES[temperature] || "bg-gray-800 text-gray-400";
  const label = LABELS[temperature] || temperature || "Unknown";
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${style}`}
    >
      {label}
    </span>
  );
}
