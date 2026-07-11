"use client";

import { useEffect, useMemo, useState } from "react";

import { searchFiles } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { FileContentMatch, FileNode, FileSearchMode } from "@/lib/types";

const CONTENT_DEBOUNCE_MS = 400;
const MIN_CONTENT_QUERY_LENGTH = 2;

export interface FileSearchState {
  folders: FileNode[];
  files: FileNode[];
  content: FileContentMatch[];
  contentLoading: boolean;
  contentError: string | null;
  hasQuery: boolean;
}

/**
 * Search over the loaded tree: name/folder matches resolve instantly and
 * locally; content matches debounce into the retrieval pipeline endpoint.
 */
export function useFileSearch(
  token: string,
  collectionId: string,
  nodes: FileNode[],
  query: string,
  modes: Set<FileSearchMode>,
): FileSearchState {
  const needle = query.trim().toLowerCase();
  const hasQuery = needle.length > 0;

  const { folders, files } = useMemo(() => {
    if (!needle) {
      return { folders: [], files: [] };
    }
    const matchedFolders: FileNode[] = [];
    const matchedFiles: FileNode[] = [];
    for (const node of nodes) {
      if (!node.name.toLowerCase().includes(needle)) {
        continue;
      }
      if (node.kind === "folder" && modes.has("folder")) {
        matchedFolders.push(node);
      } else if (node.kind === "file" && modes.has("name")) {
        matchedFiles.push(node);
      }
    }
    return { folders: matchedFolders, files: matchedFiles };
  }, [modes, needle, nodes]);

  type ContentResult = {
    matches: FileContentMatch[];
    loading: boolean;
    error: string | null;
    forQuery: string;
  };
  const [contentResult, setContentResult] = useState<ContentResult>({
    matches: [],
    loading: false,
    error: null,
    forQuery: "",
  });

  const contentEnabled = modes.has("content") && needle.length >= MIN_CONTENT_QUERY_LENGTH;

  useEffect(() => {
    if (!contentEnabled) {
      return;
    }
    let cancelled = false;
    // All setState here runs from the debounce timer / promise callbacks,
    // never synchronously in the effect body (react-hooks/set-state-in-effect).
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setContentResult((previous) => ({ ...previous, loading: true, error: null }));
      searchFiles(token, collectionId, query, ["content"])
        .then((response) => {
          if (cancelled) return;
          setContentResult({
            matches: response.content,
            loading: false,
            error: null,
            forQuery: query,
          });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setContentResult({
            matches: [],
            loading: false,
            error: getErrorMessage(error, "Content search failed."),
            forQuery: query,
          });
        });
    }, CONTENT_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [collectionId, contentEnabled, query, token]);

  // Stale results (from a previous query, or content mode toggled off) are
  // derived away rather than cleared with a reset effect.
  const contentFresh = contentEnabled && contentResult.forQuery === query;
  return {
    folders,
    files,
    content: contentFresh ? contentResult.matches : [],
    contentLoading: contentEnabled && contentResult.loading,
    contentError: contentFresh ? contentResult.error : null,
    hasQuery,
  };
}
