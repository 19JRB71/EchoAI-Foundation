import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During development the frontend runs on its own port and proxies API calls
// to the EchoAI backend (port 5000). In production the built files can be served
// by any static host that also proxies /api to the backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
