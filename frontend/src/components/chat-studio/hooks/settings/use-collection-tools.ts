"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { areArraysEqual, parseCollectionIdsParam } from "@/components/chat-studio/lib/chat-helpers";
import { fetchCollections, fetchDocuments } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { ChatSession, Collection } from "@/lib/types";

interface UseCollectionToolsParams {
  authToken: string;
  authLoading: boolean;
  selectedSessionId: string | null;
  urlCollectionsValue: string | null;
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
}

interface UseCollectionToolsResult {
  collections: Collection[];
  setCollections: React.Dispatch<React.SetStateAction<Collection[]>>;
  collectionsLoading: boolean;
  collectionsError: string | null;
  selectedToolCollectionIds: string[];
  setSelectedToolCollectionIds: React.Dispatch<React.SetStateAction<string[]>>;
  historyFilterCollectionIds: string[];
  historyFilterIncludeUnassigned: boolean;
  historyFilterActive: boolean;
  handleHistoryFilterChange: (collectionIds: string[], includeUnassigned: boolean) => void;
  documentCount: number;
  contextWindow: number;
  setContextWindow: React.Dispatch<React.SetStateAction<number>>;
  collectionMap: Map<string, Collection>;
  resolveValidToolCollectionIds: (collectionIds: string[]) => string[];
  selectedToolCollections: Collection[];
  primaryCollection: Collection | null;
  collectionLabel: string;
  collectionMetaLabel: string;
  toggleToolCollection: (collectionId: string) => void;
  clearToolCollections: () => void;
  toolCollectionsDirtyRef: React.MutableRefObject<boolean>;
}

/**
 * Owns collection tool selection, the collection catalog fetch, history filters, and
 * the derived document-count/context-window vitals for the active collection. Exposes
 * setters and the "dirty" ref consumed by the orchestrator's mutation flow.
 */
export function useCollectionTools({
  authToken,
  authLoading,
  selectedSessionId,
  urlCollectionsValue,
  setSessions,
}: UseCollectionToolsParams): UseCollectionToolsResult {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [selectedToolCollectionIds, setSelectedToolCollectionIds] = useState<string[]>(() =>
    parseCollectionIdsParam(urlCollectionsValue),
  );
  const [historyFilterCollectionIds, setHistoryFilterCollectionIds] = useState<string[]>([]);
  const [historyFilterIncludeUnassigned, setHistoryFilterIncludeUnassigned] = useState(false);
  const [documentCount, setDocumentCount] = useState(0);
  const [contextWindow, setContextWindow] = useState<number>(0);
  const toolCollectionsDirtyRef = useRef(false);
  const historyFilterTouchedRef = useRef(false);

  const historyFilterActive =
    historyFilterCollectionIds.length > 0 || historyFilterIncludeUnassigned;

  const collectionMap = useMemo(() => {
    return new Map(collections.map((collection) => [collection.id, collection]));
  }, [collections]);

  const resolveValidToolCollectionIds = useCallback(
    (collectionIds: string[]) => {
      if (collectionIds.length === 0) {
        return [];
      }
      if (collectionMap.size === 0) {
        return collectionIds;
      }
      return collectionIds.filter((collectionId) => collectionMap.has(collectionId));
    },
    [collectionMap],
  );

  const selectedToolCollections = useMemo(() => {
    return selectedToolCollectionIds
      .map((collectionId) => collectionMap.get(collectionId))
      .filter(Boolean) as Collection[];
  }, [collectionMap, selectedToolCollectionIds]);

  const primaryCollection = selectedToolCollections[0] ?? null;

  const collectionLabel = useMemo(() => {
    if (selectedToolCollections.length === 0) {
      return "No collections selected";
    }
    if (selectedToolCollections.length === 1) {
      return selectedToolCollections[0].name;
    }
    return `${selectedToolCollections.length} collections selected`;
  }, [selectedToolCollections]);

  const collectionMetaLabel = useMemo(() => {
    if (selectedToolCollections.length === 0) {
      return "No collection tools enabled";
    }
    if (selectedToolCollections.length === 1) {
      return `${documentCount} documents`;
    }
    return `${selectedToolCollections.length} tools enabled`;
  }, [documentCount, selectedToolCollections]);

  useEffect(() => {
    toolCollectionsDirtyRef.current = false;
  }, [selectedSessionId]);

  useEffect(() => {
    if (selectedSessionId) {
      return;
    }
    if (urlCollectionsValue === null) {
      return;
    }
    const parsed = parseCollectionIdsParam(urlCollectionsValue);
    const resolved = resolveValidToolCollectionIds(parsed);
    setSelectedToolCollectionIds((prev) => (areArraysEqual(prev, resolved) ? prev : resolved));
  }, [resolveValidToolCollectionIds, selectedSessionId, urlCollectionsValue]);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!authToken) {
      setCollections([]);
      setCollectionsLoading(false);
      setCollectionsError(null);
      return;
    }
    let cancelled = false;
    setCollectionsLoading(true);
    setCollectionsError(null);
    fetchCollections(authToken)
      .then((items) => {
        if (!cancelled) {
          setCollections(items);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCollectionsError(getErrorMessage(error, "Unable to load collections."));
          setCollections([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCollectionsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, authToken]);

  useEffect(() => {
    if (collections.length === 0) {
      return;
    }
    const validIds = new Set(collections.map((collection) => collection.id));
    setSelectedToolCollectionIds((prev) => prev.filter((id) => validIds.has(id)));
    setHistoryFilterCollectionIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [collections]);

  useEffect(() => {
    if (!authToken || !primaryCollection) {
      setDocumentCount(0);
      return;
    }
    let cancelled = false;
    fetchDocuments(authToken, primaryCollection.id)
      .then((docs) => {
        if (!cancelled) {
          setDocumentCount(docs.length);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDocumentCount(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authToken, primaryCollection]);

  // The context window comes from each chat response (the provider's model
  // catalog is the source of truth); reset it when the collection changes so
  // a stale window from another collection's model never lingers.
  useEffect(() => {
    setContextWindow(0);
  }, [primaryCollection?.id]);

  const toggleToolCollection = useCallback(
    (collectionId: string) => {
      toolCollectionsDirtyRef.current = true;
      setSelectedToolCollectionIds((prev) => {
        const next = prev.includes(collectionId)
          ? prev.filter((id) => id !== collectionId)
          : [...prev, collectionId];
        if (selectedSessionId) {
          setSessions((sessionsPrev) =>
            sessionsPrev.map((session) =>
              session.id === selectedSessionId
                ? { ...session, tool_collection_ids: next }
                : session,
            ),
          );
        }
        return next;
      });
    },
    [selectedSessionId, setSessions],
  );

  const clearToolCollections = useCallback(() => {
    toolCollectionsDirtyRef.current = true;
    setSelectedToolCollectionIds([]);
    if (selectedSessionId) {
      setSessions((sessionsPrev) =>
        sessionsPrev.map((session) =>
          session.id === selectedSessionId ? { ...session, tool_collection_ids: [] } : session,
        ),
      );
    }
  }, [selectedSessionId, setSessions]);

  const handleHistoryFilterChange = useCallback(
    (collectionIds: string[], includeUnassigned: boolean) => {
      historyFilterTouchedRef.current = true;
      setHistoryFilterCollectionIds(collectionIds);
      setHistoryFilterIncludeUnassigned(includeUnassigned);
    },
    [],
  );

  return {
    collections,
    setCollections,
    collectionsLoading,
    collectionsError,
    selectedToolCollectionIds,
    setSelectedToolCollectionIds,
    historyFilterCollectionIds,
    historyFilterIncludeUnassigned,
    historyFilterActive,
    handleHistoryFilterChange,
    documentCount,
    contextWindow,
    setContextWindow,
    collectionMap,
    resolveValidToolCollectionIds,
    selectedToolCollections,
    primaryCollection,
    collectionLabel,
    collectionMetaLabel,
    toggleToolCollection,
    clearToolCollections,
    toolCollectionsDirtyRef,
  };
}
