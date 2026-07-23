"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { fetchPublicConfig } from "@/lib/api";
import { installClientErrorCapture } from "@/lib/observability";

import type { PublicConfig } from "@/lib/types";

/**
 * Code defaults mirroring the backend's `AppConfig` defaults
 * (`app/schemas/app_config.py`): open registration, generous upload limits,
 * every feature flag on. Used until the real fetch resolves so the UI never
 * flashes features off while loading, and kept if the fetch fails so a
 * config-service outage degrades to "everything open" rather than locking
 * users out.
 */
const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  auth: { allow_registration: true },
  uploads: {
    max_upload_size_mb: 50,
    allowed_content_types: ["text/plain", "text/markdown", "text/csv", "application/pdf"],
  },
  indexing: {
    default_backend: "pgvector",
  },
  features: {
    umap_visualizations: true,
    chat_branching: true,
  },
};

type ConfigContextValue = {
  config: PublicConfig;
  loading: boolean;
};

const ConfigContext = createContext<ConfigContextValue | undefined>(undefined);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig>(DEFAULT_PUBLIC_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Record uncaught client errors into the observability buffer so a user's
    // downloaded report reflects them. Idempotent; correlation only.
    installClientErrorCapture();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      try {
        const data = await fetchPublicConfig();
        if (!cancelled) {
          setConfig(data);
        }
      } catch (error) {
        // Deliberate: config falls back to permissive defaults rather than
        // blocking the app. The failure is still surfaced, just not to the
        // user — there's no error channel appropriate for a background
        // config fetch that every page depends on.
        console.warn("Unable to load app config; using defaults.", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => ({ config, loading }), [config, loading]);

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useAppConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) {
    throw new Error("useAppConfig must be used within a ConfigProvider");
  }
  return ctx;
}
