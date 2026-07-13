import HeroDemo from "./HeroDemo.jsx";

// Development-only preview route for the new landing hero (/hero-preview).
// Renders ONLY the proposed hero so it can be reviewed and approved without
// touching the live landing page at "/".
export default function HeroPreviewPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="border-b border-white/5 bg-black/80 px-6 py-2 text-center">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Hero preview — not live on the landing page
        </span>
      </div>
      <HeroDemo />
    </div>
  );
}
