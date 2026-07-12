"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { ROOT_PARENT, canDropInto } from "@/components/files/lib/tree";

import type { TreeIndex } from "@/components/files/lib/tree";
import type { FileNode } from "@/lib/types";
import type { DragEvent } from "react";

/** Custom dataTransfer type marking an internal tree-node drag (vs OS files). */
export const FILE_NODE_DRAG_TYPE = "application/x-ragworks-file-node";

export function isFileNodeDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(FILE_NODE_DRAG_TYPE);
}

export interface FileDnd {
  draggingId: string | null;
  /** Folder currently hovered as a valid drop target (ROOT_PARENT for root). */
  dropKey: string | null;
  dragProps: (node: FileNode) => {
    draggable: boolean;
    onDragStart: (event: DragEvent) => void;
    onDragEnd: () => void;
  };
  dropProps: (folderId: string | null) => {
    onDragOver: (event: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (event: DragEvent) => void;
  };
}

/**
 * Internal drag-and-drop moves within the file tree. Rows/tiles spread
 * `dragProps(node)`; folder targets (tiles, rows, breadcrumb links) spread
 * `dropProps(folderId)`. OS-file drags are untouched — they carry no
 * `FILE_NODE_DRAG_TYPE` entry and fall through to the upload overlay.
 */
export function useFileDnd(
  index: TreeIndex,
  onMove: (node: FileNode, parentId: string | null) => void,
): FileDnd {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  // The browser can fire dragover on a target before React commits the
  // dragstart state update (its handler would then close over a stale null
  // draggingId and reject the drop) — so validity checks read this ref,
  // which dragstart sets synchronously; the state only drives styling.
  const draggingRef = useRef<string | null>(null);

  const dragProps = useCallback(
    (node: FileNode) => ({
      draggable: true,
      onDragStart: (event: DragEvent) => {
        event.dataTransfer.setData(FILE_NODE_DRAG_TYPE, node.id);
        event.dataTransfer.effectAllowed = "move";
        draggingRef.current = node.id;
        setDraggingId(node.id);
      },
      onDragEnd: () => {
        draggingRef.current = null;
        setDraggingId(null);
        setDropKey(null);
      },
    }),
    [],
  );

  const dropProps = useCallback(
    (folderId: string | null) => {
      const key = folderId ?? ROOT_PARENT;
      // `getData` is sealed during dragover, so validity checks use the
      // dragging node tracked in the ref (drags never cross pages anyway).
      const accepts = () => {
        const source = draggingRef.current ? index.byId.get(draggingRef.current) : null;
        return source ? canDropInto(index, source, folderId) : false;
      };
      return {
        onDragOver: (event: DragEvent) => {
          if (!isFileNodeDrag(event.dataTransfer) || !accepts()) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setDropKey(key);
        },
        onDragLeave: () => {
          setDropKey((current) => (current === key ? null : current));
        },
        onDrop: (event: DragEvent) => {
          if (!isFileNodeDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          setDropKey(null);
          setDraggingId(null);
          draggingRef.current = null;
          const source = index.byId.get(event.dataTransfer.getData(FILE_NODE_DRAG_TYPE));
          if (source && canDropInto(index, source, folderId)) {
            onMove(source, folderId);
          }
        },
      };
    },
    [index, onMove],
  );

  return useMemo(
    () => ({ draggingId, dropKey, dragProps, dropProps }),
    [draggingId, dropKey, dragProps, dropProps],
  );
}
