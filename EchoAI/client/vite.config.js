import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During development the frontend runs on its own port and proxies API calls
// to the EchoAI backend (port 5000). In production the built files can be served
// by any static host that also proxies /api to the backend.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // The Replit preview proxies the app through an iframe on a different
    // origin, so all hosts must be allowed for the dev server to respond.
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
