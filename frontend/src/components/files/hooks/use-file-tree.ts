"use client";

import { useEffect, useMemo } from "react";

import { buildTreeIndex, isProcessing } from "@/components/files/lib/tree";
import { fetchFileTree } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";

import type { TreeIndex } from "@/components/files/lib/tree";
import type { FileNode } from "@/lib/types";

const POLL_INTERVAL_MS = 2000;
const EMPTY_NODES: FileNode[] = [];

export interface FileTreeState {
  nodes: FileNode[];
  index: TreeIndex;
  /** True only before the first tree arrives — background refreshes don't flicker. */
  initialLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Owns the collection's file tree: one full fetch, client-side navigation,
 * and a quiet poll while any file is still pending/processing.
 */
export function useFileTree(token: string, collectionId: string): FileTreeState {
  const { data, loading, error, reload } = useApiQuery(
    () => fetchFileTree(token, collectionId),
    [token, collectionId],
    { enabled: Boolean(token && collectionId) },
  );

  const nodes = data?.nodes ?? EMPTY_NODES;
  const index = useMemo(() => buildTreeIndex(nodes), [nodes]);
  const anyProcessing = nodes.some(isProcessing);

  useEffect(() => {
    if (!anyProcessing) {
      return;
    }
    const timer = window.setInterval(reload, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [anyProcessing, reload]);

  return {
    nodes,
    index,
    initialLoading: loading && data === null,
    error,
    refresh: reload,
  };
}
