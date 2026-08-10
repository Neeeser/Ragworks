"use client";

import { Image as ImageIcon } from "lucide-react";

import { AssetImage, assetSourceForPath } from "@/components/ui/asset-image";
import { useAuth } from "@/providers/auth-provider";

import type { MediaAssetRef } from "@/lib/types";

/**
 * What a dataset record carries when its content is media rather than text.
 *
 * The picture is the record, so it renders as a thumbnail fetched through the
 * dataset's asset route. The type and pixel size stay beside it; a record
 * whose path belongs to no scope the client can reach keeps that line alone,
 * which states what the record holds instead of leaving the row blank.
 */
export function DatasetMediaNote({ media }: { media: MediaAssetRef }) {
  const { token } = useAuth();
  const source = assetSourceForPath(media.path);
  const dimensions = media.width && media.height ? ` · ${media.width}×${media.height}` : "";
  return (
    <span className="inline-flex flex-col gap-1.5">
      {token && source ? (
        <AssetImage
          token={token}
          source={source}
          asset={media}
          alt="Dataset record image"
          className="max-h-24"
        />
      ) : null}
      <span className="inline-flex items-center gap-1.5 text-instrument text-muted">
        <ImageIcon className="h-3.5 w-3.5" aria-hidden />
        {media.media_type}
        {dimensions}
      </span>
    </span>
  );
}
