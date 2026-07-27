export default function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{message}</div>
  );
}
