const NAV = [
  { key: "overview", label: "Dashboard" },
  { key: "leads", label: "Leads" },
  { key: "campaigns", label: "Campaigns" },
  { key: "settings", label: "Settings" },
];

export default function Sidebar({ section, onSelect, onLogout, isAdmin }) {
  const items = isAdmin ? [...NAV, { key: "admin", label: "Admin" }] : NAV;
  return (
    <aside className="flex w-full flex-row items-center justify-between gap-3 bg-gray-900 px-4 py-3 text-gray-100 md:h-screen md:w-64 md:flex-col md:items-stretch md:justify-start md:py-6">
      <div className="flex items-center md:mb-8">
        <span className="text-xl font-bold tracking-tight text-white">
          Echo<span className="text-indigo-400">AI</span>
        </span>
      </div>

      <nav className="flex flex-row gap-1 md:flex-1 md:flex-col">
        {items.map((item) => (
          <button
            key={item.key}
            onClick={() => onSelect(item.key)}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              section === item.key
                ? "bg-indigo-600 text-white"
                : "text-gray-300 hover:bg-gray-800 hover:text-white"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <button
        onClick={onLogout}
        className="rounded-lg px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white"
      >
        Log out
      </button>
    </aside>
  );
}
