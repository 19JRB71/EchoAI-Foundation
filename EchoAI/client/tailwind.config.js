/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // ZORECHO design tokens (mirrors the CSS variables in src/index.css).
      // Additive — existing utility classes across the app are unaffected.
      colors: {
        ink: "#05070C",
        abyss: "#030509",
        "z-surface": "#0B111E",
        "z-raised": "#101828",
        "z-blue": "#3B82F6",
        "z-cyan": "#22D3EE",
        "z-sky": "#60A5FA",
        "z-text": "#F1F5F9",
        "z-dim": "#94A3B8",
        "z-faint": "#64748B",
      },
      borderColor: {
        "z-line": "rgba(148,163,184,0.12)",
        "z-line-bright": "rgba(148,163,184,0.26)",
      },
      fontFamily: {
        inter: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
      },
      boxShadow: {
        "z-card": "0 8px 32px rgba(2, 6, 18, 0.55)",
        "z-glow": "0 0 24px rgba(59, 130, 246, 0.35)",
        "z-glow-cyan": "0 0 20px rgba(34, 211, 238, 0.30)",
        "z-glow-red": "0 0 24px rgba(239, 68, 68, 0.28)",
      },
      borderRadius: {
        "z-card": "1rem",
        "z-ctrl": "0.625rem",
      },
      animation: {
        "z-breathe": "z-breathe 4s ease-in-out infinite",
        "z-fade-up": "z-fade-up 0.35s ease-out both",
        "z-presence": "z-presence 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
