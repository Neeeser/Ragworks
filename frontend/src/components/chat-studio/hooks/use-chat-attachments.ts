"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { deriveCapabilities } from "@/lib/model-capabilities";
import { useAppConfig } from "@/providers/config-provider";

import type { CatalogModel } from "@/lib/types";

/** Image types the backend's chat attachment contract accepts. */
export const CHAT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** Attachments allowed per message — mirrors `ChatMessageCreate.attachments`. */
export const MAX_CHAT_ATTACHMENTS = 4;

export interface DraftAttachment {
  id: string;
  name: string;
  mediaType: string;
  /** Base64 payload, ready for the request body. */
  data: string;
  /** Local preview URL; the hook owns revocation. */
  previewUrl: string;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Draft images for the send bar. Files are validated against the same
 * contract the backend enforces (supported image types, the configured
 * image size cap, at most four per message) so a refusal happens at pick
 * time with a named reason instead of a 400 after typing a message.
 */
export function useChatAttachments({
  currentModelInfo,
}: {
  currentModelInfo: CatalogModel | null;
}) {
  const { config } = useAppConfig();
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // Revoke every preview URL on unmount; removals revoke individually.
  useEffect(
    () => () => {
      attachmentsRef.current.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
    },
    [],
  );

  // Side effects (error reporting, object-URL revocation) happen in the
  // handlers, never inside a setState updater — React re-invokes updaters
  // during render, so an impure one fires more than once.
  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      setAttachmentError(null);
      const limitBytes = config.uploads.max_image_upload_size_mb * 1024 * 1024;
      const additions: DraftAttachment[] = [];
      for (const file of Array.from(files)) {
        if (!CHAT_IMAGE_TYPES.has(file.type)) {
          setAttachmentError(`'${file.name}' is not a supported image type.`);
          continue;
        }
        if (file.size > limitBytes) {
          setAttachmentError(
            `'${file.name}' exceeds the ${config.uploads.max_image_upload_size_mb}MB image limit.`,
          );
          continue;
        }
        try {
          additions.push({
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name,
            mediaType: file.type,
            data: await readAsBase64(file),
            previewUrl: URL.createObjectURL(file),
          });
        } catch {
          setAttachmentError(`'${file.name}' could not be read.`);
        }
      }
      if (additions.length === 0) return;
      const room = MAX_CHAT_ATTACHMENTS - attachmentsRef.current.length;
      const kept = additions.slice(0, Math.max(0, room));
      if (kept.length < additions.length) {
        setAttachmentError(`A message carries at most ${MAX_CHAT_ATTACHMENTS} images.`);
        additions.slice(kept.length).forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
      }
      if (kept.length === 0) return;
      setAttachments((prev) => [...prev, ...kept]);
    },
    [config.uploads.max_image_upload_size_mb],
  );

  const removeAttachment = useCallback((id: string) => {
    attachmentsRef.current
      .filter((entry) => entry.id === id)
      .forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
    setAttachments((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    attachmentsRef.current.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
    setAttachments([]);
  }, []);

  // Attach is offered only when the selected model states image input —
  // the backend withholds image bytes from any model that does not, so an
  // enabled control would send a message whose image is silently ignored.
  const attachDisabledReason = !currentModelInfo
    ? "Select a chat model to attach images."
    : deriveCapabilities(currentModelInfo).includes("image_in")
      ? null
      : "The selected model does not state image input.";

  return {
    attachments,
    attachmentError,
    attachDisabledReason,
    addFiles,
    removeAttachment,
    clearAttachments,
  };
}
