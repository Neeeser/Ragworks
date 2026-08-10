"use client";

import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { fetchChatAssetBlob, fetchCollectionAssetBlob, fetchEvalDatasetAssetBlob } from "@/lib/api";
import { cn } from "@/lib/utils";

import type { MediaAssetRef } from "@/lib/types";

type AssetImageState =
  | { state: "loading" }
  | { state: "loaded"; objectUrl: string }
  | { state: "error" };

/** Where an asset's bytes are fetched from — the scope its route checks. */
export type AssetSource =
  | { collectionId: string }
  | { chatSessionId: string }
  | { evalDatasetId: string };

/** The scope kind and id one source names, as primitives an effect can depend on. */
function scopeOf(source: AssetSource): { kind: "collection" | "chat" | "evalDataset"; id: string } {
  if ("collectionId" in source) return { kind: "collection", id: source.collectionId };
  if ("chatSessionId" in source) return { kind: "chat", id: source.chatSessionId };
  return { kind: "evalDataset", id: source.evalDatasetId };
}

/**
 * The scope a stored asset path belongs to, read off the path itself.
 *
 * Storage paths lead with their owning scope (`collections/{id}/…`,
 * `chat/{id}/…`, `eval_datasets/{id}/…`), which is what lets a renderer deep
 * in a trace — where no collection or dataset is in context — fetch the bytes.
 * A path under no known scope has no route, and answers `null` so the caller
 * renders its placeholder rather than a broken image.
 */
export function assetSourceForPath(path: string): AssetSource | null {
  const [root, id] = path.split("/");
  if (!id) return null;
  if (root === "collections") return { collectionId: id };
  if (root === "chat") return { chatSessionId: id };
  if (root === "eval_datasets") return { evalDatasetId: id };
  return null;
}

/**
 * A stored image, fetched authenticated and rendered from an object URL
 * (media elements can't send an Authorization header). Sized by the asset's
 * recorded dimensions where known, so the skeleton holds the final geometry.
 * An asset that fails to load renders nothing — the row's text and metadata
 * still stand on their own.
 */
export function AssetImage({
  token,
  source,
  asset,
  alt,
  className,
}: {
  token: string;
  source: AssetSource;
  asset: MediaAssetRef;
  alt: string;
  className?: string;
}) {
  const [loaded, setLoaded] = useState<AssetImageState>({ state: "loading" });
  // Primitive deps, because call sites pass `source` as an inline literal —
  // depending on the object identity would re-fetch on every render.
  const { kind: scopeKind, id: scopeId } = scopeOf(source);

  // No state reset when the path changes: consumers render one AssetImage
  // per match row, so a changed asset means a remounted component and the
  // initial loading state stands.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const fetchBlobFor = {
      collection: fetchCollectionAssetBlob,
      chat: fetchChatAssetBlob,
      evalDataset: fetchEvalDatasetAssetBlob,
    }[scopeKind];
    const fetchBlob = fetchBlobFor(token, scopeId, asset.path);
    fetchBlob
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ state: "loaded", objectUrl });
      })
      .catch(() => {
        // The image is an enrichment on a match that already renders its
        // text and metadata; a broken asset degrades to that, not an error
        // banner over the whole result list.
        if (!cancelled) setLoaded({ state: "error" });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, scopeKind, scopeId, asset.path]);

  if (loaded.state === "error") return null;

  const ratio = asset.width && asset.height ? `${asset.width} / ${asset.height}` : undefined;
  if (loaded.state === "loading") {
    return (
      <Skeleton
        className={cn("max-h-40 w-full max-w-60", className)}
        style={ratio ? { aspectRatio: ratio } : { height: "6rem" }}
      />
    );
  }
  return (
    // The source is a local blob: object URL, which next/image cannot accept.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={loaded.objectUrl}
      alt={alt}
      className={cn(
        "max-h-40 w-auto max-w-60 rounded-control border border-hairline object-contain",
        className,
      )}
    />
  );
}
