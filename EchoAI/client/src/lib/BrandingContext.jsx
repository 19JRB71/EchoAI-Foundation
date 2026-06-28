import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api.js";
import {
  DEFAULT_BRANDING,
  normalizeBranding,
  applyBrandingToDocument,
} from "./branding.js";

const BrandingContext = createContext({
  branding: DEFAULT_BRANDING,
  loading: true,
});

/**
 * Fetches the white-label branding for the domain the dashboard is served on
 * (public endpoint, no auth required) and applies it to the document. Wraps the
 * whole app so the login page, sidebar, and headers all theme dynamically.
 */
export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api.getAgencyBranding();
        const next = normalizeBranding(data && data.branding);
        if (active) {
          setBranding(next);
          applyBrandingToDocument(next);
        }
      } catch {
        // No branding available -> keep the EchoAI defaults.
        if (active) applyBrandingToDocument(DEFAULT_BRANDING);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <BrandingContext.Provider value={{ branding, loading, setBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
