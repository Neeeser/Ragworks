"use client";

import { useRef, useState } from "react";

import { isFileNodeDrag } from "@/components/files/hooks/use-file-dnd";
import { collectDroppedUploads } from "@/components/files/lib/drop-items";

import type { DroppedUpload } from "@/components/files/lib/drop-items";
import type { DragEvent } from "react";

export interface DragUploadHandlers {
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}

/**
 * Page-level drag-and-drop for OS files and folder trees. Tracks enter/leave
 * depth so nested drag targets don't flicker the overlay. Internal tree-node
 * drags (rearranging files) are ignored entirely — those belong to
 * `useFileDnd`.
 */
export function useDragUploads(onUploads: (uploads: DroppedUpload[]) => void): {
  dragActive: boolean;
  handlers: DragUploadHandlers;
} {
  const [dragActive, setDragActive] = useState(false);
  const depth = useRef(0);

  const handlers: DragUploadHandlers = {
    onDragEnter: (event) => {
      if (isFileNodeDrag(event.dataTransfer)) return;
      event.preventDefault();
      depth.current += 1;
      setDragActive(true);
    },
    onDragOver: (event) => {
      if (isFileNodeDrag(event.dataTransfer)) return;
      event.preventDefault();
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) {
        setDragActive(false);
      }
    },
    onDrop: (event) => {
      if (isFileNodeDrag(event.dataTransfer)) return;
      event.preventDefault();
      depth.current = 0;
      setDragActive(false);
      void collectDroppedUploads(event.dataTransfer).then(onUploads);
    },
  };

  return { dragActive, handlers };
}
