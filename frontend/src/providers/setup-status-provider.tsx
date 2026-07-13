"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { fetchSetupStatus } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

import type { SetupStatus } from "@/lib/types";
import type { ReactNode } from "react";

interface SetupStatusContextValue {
  /** Null until the first status fetch resolves (or if it failed). */
  status: SetupStatus | null;
  /** Re-derive status from the backend (e.g. after creating an index). */
  refresh: () => void;
  /** Optimistically mark setup done (the wizard just bootstrapped). */
  markComplete: () => void;
}

const SetupStatusContext = createContext<SetupStatusContextValue | null>(null);

/** Console routes reachable while setup is incomplete. */
const EXEMPT_PREFIXES = ["/setup", "/settings"];

const COMPLETE: SetupStatus = {
  has_embedding_provider: true,
  has_chat_provider: true,
  has_vector_store: true,
  has_index: true,
  has_collection: true,
  setup_complete: true,
};

/**
 * Fetches first-run readiness once per session and redirects an
 * incomplete-setup user to `/setup` (UX only — the API stays the enforcement).
 * A failed status fetch leaves `status` null and never blocks the console.
 */
export function SetupStatusProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [completedLocally, setCompletedLocally] = useState(false);

  const query = useApiQuery(() => fetchSetupStatus(token ?? ""), [token], {
    enabled: Boolean(token) && Boolean(user),
  });
  const status = completedLocally ? COMPLETE : query.data;

  useEffect(() => {
    if (!status || !pathname) return;
    const exempt = EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
    if (!status.setup_complete && !exempt) {
      router.replace("/setup");
    }
  }, [status, pathname, router]);

  const markComplete = useCallback(() => setCompletedLocally(true), []);

  const value = useMemo(
    () => ({ status, refresh: query.reload, markComplete }),
    [status, query.reload, markComplete],
  );

  return <SetupStatusContext.Provider value={value}>{children}</SetupStatusContext.Provider>;
}

export function useSetupStatus(): SetupStatusContextValue {
  const context = useContext(SetupStatusContext);
  if (!context) {
    throw new Error("useSetupStatus must be used within SetupStatusProvider");
  }
  return context;
}
