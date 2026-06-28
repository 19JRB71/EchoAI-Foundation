import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App.jsx";
import LandingPage from "./landing/LandingPage.jsx";
import VoiceLandingPage from "./voice/VoiceLandingPage.jsx";
import { BrandingProvider } from "./lib/BrandingContext.jsx";
import { registerServiceWorker } from "./push.js";
import "./index.css";

// Register the service worker on startup so the app shell is cached (instant
// loads, offline support) and the app can receive push notifications.
registerServiceWorker();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrandingProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          {/* Public marketing site at the root URL. */}
          <Route path="/" element={<LandingPage />} />
          {/* Per-brand public voice lead-capture page (Facebook ad landing). */}
          <Route path="/voice/:brandId" element={<VoiceLandingPage />} />
          {/* Authenticated customer dashboard (handles its own login). */}
          <Route path="/dashboard" element={<App />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </BrandingProvider>
  </React.StrictMode>
);
