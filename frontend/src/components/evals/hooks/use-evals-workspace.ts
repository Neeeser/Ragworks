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

import type {
  EvalDataset,
  EvalDatasetGeneratePayload,
  EvalDatasetUploadPayload,
} from "@/lib/types";

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

  // Mutations apply their own outcome to the loaded lists rather than firing a
  // refetch: the backend's request session commits after the response is sent,
  // so a GET issued the instant a mutation resolves can read the pre-write
  // state — the counts in the crumb bar then lag a render behind the action.
  const setDatasets = datasets.setData;
  const setRuns = runs.setData;
  const setCollections = collections.setData;

  const runAction = useCallback(async <T>(action: () => Promise<T>, apply: (result: T) => void) => {
    setActionError(null);
    try {
      apply(await action());
      return true;
    } catch (err) {
      setActionError(getErrorMessage(err, "The request failed"));
      return false;
    }
  }, []);

  /** Fold a created or updated dataset into the list, newest first. */
  const applyDataset = useCallback(
    (dataset: EvalDataset) => {
      setDatasets((current) => {
        const list = current ?? [];
        return list.some((entry) => entry.id === dataset.id)
          ? list.map((entry) => (entry.id === dataset.id ? dataset : entry))
          : [dataset, ...list];
      });
    },
    [setDatasets],
  );

  const importBenchmark = useCallback(
    (key: string) => runAction(() => importEvalBenchmark(token!, key), applyDataset),
    [runAction, token, applyDataset],
  );

  // Upload errors report into the dialog (its own error channel), not the
  // page-level actionError banner, which the open modal would cover.
  const uploadDataset = useCallback(
    async (payload: EvalDatasetUploadPayload) => {
      try {
        applyDataset(await uploadEvalDataset(token!, payload));
        return null;
      } catch (err) {
        return getErrorMessage(err, "The upload failed");
      }
    },
    [token, applyDataset],
  );

  const generateDataset = useCallback(
    (payload: EvalDatasetGeneratePayload) =>
      runAction(() => generateEvalDataset(token!, payload), applyDataset),
    [runAction, token, applyDataset],
  );

  const removeDataset = useCallback(
    (datasetId: string) =>
      runAction(
        () => deleteEvalDataset(token!, datasetId),
        () => setDatasets((current) => (current ?? []).filter((entry) => entry.id !== datasetId)),
      ),
    [runAction, token, setDatasets],
  );

  const removeRun = useCallback(
    (runId: string) =>
      runAction(
        () => deleteEvalRun(token!, runId),
        () => setRuns((current) => (current ?? []).filter((entry) => entry.id !== runId)),
      ),
    [runAction, token, setRuns],
  );

  const removeCollection = useCallback(
    (collectionId: string) =>
      runAction(
        () => deleteEvalCollection(token!, collectionId),
        () =>
          setCollections((current) => (current ?? []).filter((entry) => entry.id !== collectionId)),
      ),
    [runAction, token, setCollections],
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
