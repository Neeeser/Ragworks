"use client";

import { useCallback, useState } from "react";

import {
  createFolder as apiCreateFolder,
  deleteFileNode,
  ingestFile,
  updateFileNode,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { FileNode } from "@/lib/types";

export interface FileActions {
  error: string | null;
  clearError: () => void;
  createFolder: (name: string, parentId: string | null) => Promise<FileNode | null>;
  renameNode: (node: FileNode, name: string) => Promise<boolean>;
  moveNode: (node: FileNode, parentId: string | null) => Promise<boolean>;
  deleteNode: (node: FileNode) => Promise<boolean>;
  retryIngestion: (node: FileNode) => Promise<boolean>;
}

/** Tree mutations with a single error channel; every success refreshes the tree. */
export function useFileActions(
  token: string,
  collectionId: string,
  refresh: () => void,
): FileActions {
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async <T>(action: () => Promise<T>, fallback: string): Promise<T | null> => {
      setError(null);
      try {
        const result = await action();
        refresh();
        return result;
      } catch (err) {
        setError(getErrorMessage(err, fallback));
        return null;
      }
    },
    [refresh],
  );

  const createFolder = useCallback(
    (name: string, parentId: string | null) =>
      run(() => apiCreateFolder(token, collectionId, name, parentId), "Unable to create folder."),
    [collectionId, run, token],
  );

  const renameNode = useCallback(
    async (node: FileNode, name: string) =>
      (await run(() => updateFileNode(token, node.id, { name }), "Unable to rename.")) !== null,
    [run, token],
  );

  const moveNode = useCallback(
    async (node: FileNode, parentId: string | null) =>
      (await run(
        () => updateFileNode(token, node.id, { parent_id: parentId }),
        "Unable to move.",
      )) !== null,
    [run, token],
  );

  const deleteNode = useCallback(
    async (node: FileNode) =>
      (await run(() => deleteFileNode(token, node.id), "Unable to delete.")) !== null,
    [run, token],
  );

  const retryIngestion = useCallback(
    async (node: FileNode) =>
      (await run(() => ingestFile(token, node.id), "Unable to queue ingestion.")) !== null,
    [run, token],
  );

  return { error, clearError, createFolder, renameNode, moveNode, deleteNode, retryIngestion };
}
