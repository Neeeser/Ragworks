"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { isRunActive } from "@/components/evals/lib/metrics";
import {
  deleteEvalCollection,
  deleteEvalDataset,
  deleteEvalRun,
  fetchCollections,
  fetchEvalBenchmarks,
  fetchEvalCollections,
  fetchEvalDatasets,
  fetchEvalMetricCatalog,
  fetchEvalRuns,
  fetchPipelines,
  generateEvalDataset,
  importEvalBenchmark,
  listChatModels,
  listPrompts,
  uploadEvalDataset,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

import type { EvalDatasetGeneratePayload, EvalDatasetUploadPayload } from "@/lib/types";

const ACTIVE_POLL_MS = 2500;

/** The evals landing page's data domain: datasets, runs, and eval collections. */
export function useEvalsWorkspace() {
  const { token } = useAuth();
  const [actionError, setActionError] = useState<string | null>(null);

  const datasets = useApiQuery(() => fetchEvalDatasets(token!), [token], { enabled: !!token });
  const runs = useApiQuery(() => fetchEvalRuns(token!), [token], { enabled: !!token });
  const collections = useApiQuery(() => fetchEvalCollections(token!), [token], {
    enabled: !!token,
  });
  const benchmarks = useApiQuery(() => fetchEvalBenchmarks(token!), [token], {
    enabled: !!token,
  });
  const metricCatalog = useApiQuery(() => fetchEvalMetricCatalog(token!), [token], {
    enabled: !!token,
  });
  const pipelines = useApiQuery(() => fetchPipelines(token!), [token], { enabled: !!token });
  const userCollections = useApiQuery(() => fetchCollections(token!), [token], {
    enabled: !!token,
  });
  const chatModels = useApiQuery(() => listChatModels(token!), [token], { enabled: !!token });
  // Only to name a prompt-comparison intent arriving from the studio.
  const prompts = useApiQuery(() => listPrompts(token!), [token], { enabled: !!token });

  const hasActiveRun = useMemo(
    () => (runs.data ?? []).some((run) => isRunActive(run.status)),
    [runs.data],
  );
  const hasBusyDataset = useMemo(
    () =>
      (datasets.data ?? []).some(
        (dataset) => dataset.status === "downloading" || dataset.status === "generating",
      ),
    [datasets.data],
  );

  // Poll only while something is in flight; a background reload keeps
  // identities/selection stable because useApiQuery replaces data in place.
  // Depend on the stable reload callbacks, not the query result objects —
  // those are new every render and would tear the interval down each time.
  const reloadRuns = runs.reload;
  const reloadDatasets = datasets.reload;
  useEffect(() => {
    if (!hasActiveRun && !hasBusyDataset) return;
    const timer = window.setInterval(() => {
      if (hasActiveRun) reloadRuns();
      if (hasBusyDataset) reloadDatasets();
    }, ACTIVE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [hasActiveRun, hasBusyDataset, reloadRuns, reloadDatasets]);

  const runAction = useCallback(
    async (action: () => Promise<unknown>, reloads: Array<() => void>) => {
      setActionError(null);
      try {
        await action();
        reloads.forEach((reload) => reload());
        return true;
      } catch (err) {
        setActionError(getErrorMessage(err, "The request failed"));
        return false;
      }
    },
    [],
  );

  const importBenchmark = useCallback(
    (key: string) => runAction(() => importEvalBenchmark(token!, key), [datasets.reload]),
    [runAction, token, datasets.reload],
  );

  // Upload errors report into the dialog (its own error channel), not the
  // page-level actionError banner, which the open modal would cover.
  const uploadDataset = useCallback(
    async (payload: EvalDatasetUploadPayload) => {
      try {
        await uploadEvalDataset(token!, payload);
        reloadDatasets();
        return null;
      } catch (err) {
        return getErrorMessage(err, "The upload failed");
      }
    },
    [token, reloadDatasets],
  );

  const generateDataset = useCallback(
    (payload: EvalDatasetGeneratePayload) =>
      runAction(() => generateEvalDataset(token!, payload), [datasets.reload]),
    [runAction, token, datasets.reload],
  );

  const removeDataset = useCallback(
    (datasetId: string) => runAction(() => deleteEvalDataset(token!, datasetId), [datasets.reload]),
    [runAction, token, datasets.reload],
  );

  const removeRun = useCallback(
    (runId: string) => runAction(() => deleteEvalRun(token!, runId), [runs.reload]),
    [runAction, token, runs.reload],
  );

  const removeCollection = useCallback(
    (collectionId: string) =>
      runAction(() => deleteEvalCollection(token!, collectionId), [collections.reload]),
    [runAction, token, collections.reload],
  );

  return {
    token,
    datasets,
    runs,
    collections,
    benchmarks,
    metricCatalog,
    pipelines,
    actionError,
    clearActionError: () => setActionError(null),
    importBenchmark,
    uploadDataset,
    generateDataset,
    userCollections,
    chatModels,
    prompts,
    removeDataset,
    removeRun,
    removeCollection,
  };
}
