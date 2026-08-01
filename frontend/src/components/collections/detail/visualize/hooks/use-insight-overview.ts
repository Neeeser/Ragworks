"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchInsightOverview, refreshInsights } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { getErrorMessage } from "@/lib/errors";

import type { InsightOverview } from "@/lib/types";

const POLL_INTERVAL_MS = 2500;

type UseInsightOverviewResult = {
  overview: InsightOverview | null;
  loading: boolean;
  errorMessage: string | null;
  /** Changes whenever the served snapshot's contents may have changed. */
  dataVersion: string;
  computing: boolean;
  refresh: () => Promise<void>;
};

/**
 * The page's freshness spine: loads the overview, kicks off the first build
 * when the collection has chunks but no snapshot yet, and polls while a
 * computation is in flight so the views repaint the moment it lands.
 */
export function useInsightOverview(token: string, collectionId: string): UseInsightOverviewResult {
  const [overview, setOverview] = useState<InsightOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // The first build is triggered at most once per mount: retriggering on
  // every poll would hammer the refresh endpoint while a failed compute is
  // being investigated.
  const autoStartedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchInsightOverview(token, collectionId);
      setOverview(data);
      setErrorMessage(null);
      return data;
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        setErrorMessage(getErrorMessage(error, "Unable to load insights."));
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [collectionId, token]);

  const refresh = useCallback(async () => {
    setErrorMessage(null);
    try {
      setOverview(await refreshInsights(token, collectionId));
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Unable to start a refresh."));
    }
  }, [collectionId, token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await load();
      if (cancelled || data === null) {
        return;
      }
      if (!data.snapshot && !data.active && data.can_compute && !autoStartedRef.current) {
        autoStartedRef.current = true;
        await refresh();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, refresh]);

  const computing = overview?.active?.status === "computing";

  useEffect(() => {
    if (!computing) {
      return;
    }
    const timer = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [computing, load]);

  const snapshot = overview?.snapshot ?? null;
  const dataVersion = snapshot ? `${snapshot.id}:${snapshot.updated_at}` : "none";

  return {
    overview,
    loading,
    errorMessage,
    dataVersion,
    computing: computing === true,
    refresh,
  };
}
