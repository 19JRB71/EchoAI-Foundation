import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App.jsx";
import LandingPage from "./landing/LandingPage.jsx";
import VoiceLandingPage from "./voice/VoiceLandingPage.jsx";
import DesignPreview from "./design/DesignPreview.jsx";
import HeroPreviewPage from "./landing/HeroPreviewPage.jsx";
import { BrandingProvider } from "./lib/BrandingContext.jsx";
import { registerServiceWorker } from "./push.js";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import EnvironmentBanner from "./components/EnvironmentBanner.jsx";
// Zorecho design language: self-hosted Inter (no external font requests).
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "./index.css";

// Register the service worker on startup so the app shell is cached (instant
// loads, offline support) and the app can receive push notifications.
registerServiceWorker();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
    <BrandingProvider>
      <EnvironmentBanner />
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          {/* Public marketing site at the root URL. */}
          <Route path="/" element={<LandingPage />} />
          {/* Per-brand public voice lead-capture page (Facebook ad landing). */}
          <Route path="/voice/:brandId" element={<VoiceLandingPage />} />
          {/* Authenticated customer dashboard (handles its own login). */}
          <Route path="/dashboard" element={<App />} />
          {/* Internal, unlinked, admin-only design reference (Zorecho Phase 1). */}
          <Route path="/design-preview" element={<DesignPreview />} />
          {/* Unlinked preview of the proposed landing hero (Echo demo). */}
          <Route path="/hero-preview" element={<HeroPreviewPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </BrandingProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
