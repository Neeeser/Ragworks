"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { readImageAsBase64, SUPPORTED_IMAGE_TYPES } from "@/lib/image-files";
import { useAppConfig } from "@/providers/config-provider";

import type { QueryMediaPayload } from "@/lib/types";

/** The image a query will be run with, before it is submitted. */
export interface DraftQueryImage {
  name: string;
  mediaType: string;
  /** Base64 payload, ready for the request body. */
  data: string;
  /** Local preview URL; the hook owns revocation. */
  previewUrl: string;
}

export interface QueryImageState {
  image: DraftQueryImage | null;
  /** Why the last pick was refused, for the composer to state. */
  error: string | null;
  attach: (file: File) => Promise<void>;
  clear: () => void;
  /** The request body's `query_media`, or undefined when nothing is attached. */
  payload: QueryMediaPayload | undefined;
}

/**
 * The draft image for a collection search. One image per query — the
 * retrieval contract takes a single `query_media` — validated against the
 * same rules the API enforces (a supported image type, the configured image
 * size cap) so a refusal names its reason at pick time instead of arriving
 * as a 400 after the run.
 */
export function useQueryImage(): QueryImageState {
  const { config } = useAppConfig();
  const [image, setImage] = useState<DraftQueryImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imageRef = useRef(image);
  useEffect(() => {
    imageRef.current = image;
  }, [image]);

  // Revoke the preview URL on unmount; replacing or removing revokes in the
  // handler that supersedes it.
  useEffect(
    () => () => {
      if (imageRef.current) URL.revokeObjectURL(imageRef.current.previewUrl);
    },
    [],
  );

  const limitMb = config.uploads.max_image_upload_size_mb;

  const attach = useCallback(
    async (file: File) => {
      setError(null);
      if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
        setError(`'${file.name}' is not a supported image type.`);
        return;
      }
      if (file.size > limitMb * 1024 * 1024) {
        setError(`'${file.name}' exceeds the ${limitMb}MB image limit.`);
        return;
      }
      let data: string;
      try {
        data = await readImageAsBase64(file);
      } catch {
        setError(`'${file.name}' could not be read.`);
        return;
      }
      const previous = imageRef.current;
      setImage({
        name: file.name,
        mediaType: file.type,
        data,
        previewUrl: URL.createObjectURL(file),
      });
      if (previous) URL.revokeObjectURL(previous.previewUrl);
    },
    [limitMb],
  );

  const clear = useCallback(() => {
    if (imageRef.current) URL.revokeObjectURL(imageRef.current.previewUrl);
    setImage(null);
    setError(null);
  }, []);

  return {
    image,
    error,
    attach,
    clear,
    payload: image ? { media_type: image.mediaType, data: image.data } : undefined,
  };
}
