import { Image as ImageIcon } from "lucide-react";

import type { MediaAssetRef } from "@/lib/types";

/**
 * What a dataset record carries when its content is media rather than text.
 *
 * Dataset media is stored under `eval_datasets/{id}/`, outside any
 * collection, so the collection asset route cannot serve it and there is
 * nothing to render inline yet. Naming the type and pixel size states what
 * the record holds instead of leaving the row blank, which reads as a
 * dataset that imported nothing.
 */
export function DatasetMediaNote({ media }: { media: MediaAssetRef }) {
  const dimensions = media.width && media.height ? ` · ${media.width}×${media.height}` : "";
  return (
    <span className="inline-flex items-center gap-1.5 text-instrument text-muted">
      <ImageIcon className="h-3.5 w-3.5" aria-hidden />
      {media.media_type}
      {dimensions}
    </span>
  );
}
