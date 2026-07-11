"use client";

import { useCallback, useRef, useState } from "react";

import { uploadFile } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { DroppedUpload } from "@/components/files/lib/drop-items";

export type UploadStatus = "uploading" | "done" | "error";

export interface UploadItem {
  id: number;
  name: string;
  status: UploadStatus;
  error?: string;
}

export interface FileUploadsState {
  items: UploadItem[];
  uploading: boolean;
  enqueue: (uploads: DroppedUpload[], parentId: string | null) => void;
  dismiss: () => void;
}

/**
 * Owns the upload tray: a queue of files sent to the collection, each row
 * tracking uploading → done/error. The tree refreshes after every file so
 * new rows appear (with their pending badges) as they land.
 */
export function useFileUploads(
  token: string,
  collectionId: string,
  refresh: () => void,
): FileUploadsState {
  const [items, setItems] = useState<UploadItem[]>([]);
  const nextId = useRef(0);

  const enqueue = useCallback(
    (uploads: DroppedUpload[], parentId: string | null) => {
      if (uploads.length === 0) {
        return;
      }
      const queued = uploads.map((upload) => ({
        id: nextId.current++,
        name: upload.relativePath ?? upload.file.name,
        status: "uploading" as UploadStatus,
      }));
      setItems((previous) => [
        ...previous.filter((item) => item.status === "uploading"),
        ...queued,
      ]);

      uploads.forEach((upload, position) => {
        const itemId = queued[position].id;
        uploadFile(token, collectionId, upload.file, {
          parentId,
          relativePath: upload.relativePath,
        })
          .then(() => {
            setItems((previous) =>
              previous.map((item) =>
                item.id === itemId ? { ...item, status: "done" as UploadStatus } : item,
              ),
            );
            refresh();
          })
          .catch((error: unknown) => {
            setItems((previous) =>
              previous.map((item) =>
                item.id === itemId
                  ? {
                      ...item,
                      status: "error" as UploadStatus,
                      error: getErrorMessage(error, "Upload failed."),
                    }
                  : item,
              ),
            );
          });
      });
    },
    [collectionId, refresh, token],
  );

  const dismiss = useCallback(() => {
    setItems((previous) => previous.filter((item) => item.status === "uploading"));
  }, []);

  return {
    items,
    uploading: items.some((item) => item.status === "uploading"),
    enqueue,
    dismiss,
  };
}
