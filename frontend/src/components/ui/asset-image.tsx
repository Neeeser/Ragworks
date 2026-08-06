"use client";

import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { fetchChatAssetBlob, fetchCollectionAssetBlob } from "@/lib/api";
import { cn } from "@/lib/utils";

import type { MediaAssetRef } from "@/lib/types";

type AssetImageState =
  | { state: "loading" }
  | { state: "loaded"; objectUrl: string }
  | { state: "error" };

/**
 * A retrieval match's stored image, fetched authenticated and rendered from
 * an object URL (media elements can't send an Authorization header). Sized
 * by the asset's recorded dimensions where known, so the skeleton holds the
 * final geometry. An asset that fails to load renders nothing — the match's
 * text and metadata still stand on their own.
 */
/** Where an asset's bytes are fetched from — the scope its route checks. */
export type AssetSource = { collectionId: string } | { chatSessionId: string };

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
  const scopeKind = "collectionId" in source ? ("collection" as const) : ("chat" as const);
  const scopeId = "collectionId" in source ? source.collectionId : source.chatSessionId;

  // No state reset when the path changes: consumers render one AssetImage
  // per match row, so a changed asset means a remounted component and the
  // initial loading state stands.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const fetchBlob =
      scopeKind === "collection"
        ? fetchCollectionAssetBlob(token, scopeId, asset.path)
        : fetchChatAssetBlob(token, scopeId, asset.path);
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
