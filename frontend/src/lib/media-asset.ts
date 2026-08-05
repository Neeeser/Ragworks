import type { MediaAssetRef } from "@/lib/types";

/**
 * Reserved metadata key carrying a match's stored image asset — the mirror
 * of `IMAGE_ASSET_METADATA_KEY` in `app/pipelines/payloads.py`. Namespaced
 * so a document's own `image` metadata can never collide with it.
 */
export const IMAGE_ASSET_METADATA_KEY = "ragworks.image_asset";

/** Read a match's image asset off its metadata, or null when it has none. */
export function imageAssetOf(
  metadata: Record<string, unknown> | null | undefined,
): MediaAssetRef | null {
  const raw = metadata?.[IMAGE_ASSET_METADATA_KEY];
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.media_type !== "string" || typeof candidate.path !== "string") {
    return null;
  }
  return {
    media_type: candidate.media_type,
    path: candidate.path,
    width: typeof candidate.width === "number" ? candidate.width : null,
    height: typeof candidate.height === "number" ? candidate.height : null,
  };
}
