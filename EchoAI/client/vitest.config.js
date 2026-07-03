import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Component test harness for the client. The dev server / proxy config lives in
// vite.config.js; here we only need jsdom + the React plugin so we can render
// components (e.g. the onboarding SetupAgent) and assert their visible output.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.js"],
    include: ["src/**/*.test.{js,jsx}"],
  },
});
