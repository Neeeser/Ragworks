"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isRunActive } from "@/components/evals/lib/metrics";
import {
  cancelEvalRun,
  fetchEvalDataset,
  fetchEvalMetricCatalog,
  fetchEvalRun,
  fetchEvalRunItems,
  fetchPipelines,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

const ACTIVE_POLL_MS = 2000;
// The items payload carries every per-query result (potentially megabytes on a
// large run) — refresh it far less often than the small run summary.
const ITEMS_POLL_MS = 10_000;

/** One eval run's live state: the run, its items, naming context, and cancel. */
export function useRunDetail(runId: string) {
  const { token } = useAuth();
  const [actionError, setActionError] = useState<string | null>(null);

  const run = useApiQuery(() => fetchEvalRun(token!, runId), [token, runId], {
    enabled: !!token,
  });
  const items = useApiQuery(() => fetchEvalRunItems(token!, runId), [token, runId], {
    enabled: !!token,
  });
  const metricCatalog = useApiQuery(() => fetchEvalMetricCatalog(token!), [token], {
    enabled: !!token,
  });
  const datasetId = run.data?.dataset_id ?? null;
  const dataset = useApiQuery(() => fetchEvalDataset(token!, datasetId!), [token, datasetId], {
    enabled: !!token && !!datasetId,
  });
  const pipelines = useApiQuery(() => fetchPipelines(token!), [token], { enabled: !!token });

  const active = run.data ? isRunActive(run.data.status) : false;

  // Depend on the stable reload callbacks, not the query result objects —
  // those are new every render and would tear the intervals down each time.
  const reloadRun = run.reload;
  const reloadItems = items.reload;
  useEffect(() => {
    if (!active) return;
    const runTimer = window.setInterval(reloadRun, ACTIVE_POLL_MS);
    const itemsTimer = window.setInterval(reloadItems, ITEMS_POLL_MS);
    return () => {
      window.clearInterval(runTimer);
      window.clearInterval(itemsTimer);
    };
  }, [active, reloadRun, reloadItems]);

  // When the run leaves its active state, fetch the final items once.
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active) reloadItems();
    wasActive.current = active;
  }, [active, reloadItems]);

  const cancel = useCallback(async () => {
    setActionError(null);
    try {
      await cancelEvalRun(token!, runId);
      reloadRun();
    } catch (err) {
      setActionError(getErrorMessage(err, "Could not cancel the run"));
    }
  }, [token, runId, reloadRun]);

  return { run, items, metricCatalog, dataset, pipelines, active, cancel, actionError };
}
