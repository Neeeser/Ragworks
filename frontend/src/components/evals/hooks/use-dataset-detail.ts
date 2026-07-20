"use client";

import { useEffect, useMemo, useState } from "react";

import {
  fetchEvalCollectionDocuments,
  fetchEvalCollections,
  fetchEvalDataset,
  fetchPipelines,
} from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

export const DATASET_DOCS_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

/** One dataset's detail state: the dataset, its provisioned collections
 * (one per ingestion pipeline definition), and the selected collection's
 * paged, searchable document list. */
export function useDatasetDetail(datasetId: string) {
  const { token } = useAuth();

  const dataset = useApiQuery(() => fetchEvalDataset(token!, datasetId), [token, datasetId], {
    enabled: !!token,
  });
  const allCollections = useApiQuery(() => fetchEvalCollections(token!), [token], {
    enabled: !!token,
  });
  const pipelines = useApiQuery(() => fetchPipelines(token!), [token], { enabled: !!token });

  const collections = useMemo(
    () => (allCollections.data ?? []).filter((entry) => entry.dataset_id === datasetId),
    [allCollections.data, datasetId],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Seed the selection once collections arrive; re-find by id on background
  // refetches so a token rotation never resets the user's choice.
  if (selectedId === null && collections.length > 0) {
    setSelectedId(collections[0].id);
  }
  const selected = collections.find((entry) => entry.id === selectedId) ?? null;

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
      setOffset(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  const documents = useApiQuery(
    () =>
      fetchEvalCollectionDocuments(token!, selectedId!, {
        search: debouncedSearch || undefined,
        offset,
        limit: DATASET_DOCS_PAGE_SIZE,
      }),
    [token, selectedId, debouncedSearch, offset],
    { enabled: !!token && !!selectedId },
  );

  const selectCollection = (id: string) => {
    setSelectedId(id);
    setOffset(0);
  };

  return {
    dataset,
    collections,
    collectionsLoading: allCollections.loading,
    pipelines,
    selected,
    selectCollection,
    search,
    setSearch,
    documents,
    offset,
    setOffset,
  };
}
