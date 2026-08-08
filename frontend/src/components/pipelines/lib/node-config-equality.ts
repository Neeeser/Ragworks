import { deepEqual } from "@/lib/deep-equal";

import type { VectorIndex } from "@/lib/types";

const isStoreNodeType = (nodeType: string) =>
  nodeType.startsWith("indexer.") || nodeType.startsWith("retriever.");

/**
 * The `dimension` the index picker would write for the index a config names,
 * or `null` when the registry states none.
 *
 * BM25 nodes are excluded: sparse indexes are text-scored and the picker writes
 * no dimension for them. A variable-bound node names its index through an
 * expression, which matches no registry entry.
 */
export function registryDimension(
  nodeType: string,
  config: Record<string, unknown>,
  indexes: VectorIndex[],
): number | null {
  if (!isStoreNodeType(nodeType) || nodeType.endsWith(".bm25")) return null;
  const name = config.index_name;
  if (typeof name !== "string") return null;
  const backend = config.backend;
  const index = indexes.find(
    (entry) =>
      entry.name === name &&
      entry.vector_type !== "sparse" &&
      (typeof backend === "string" ? entry.backend === backend : true),
  );
  return typeof index?.dimension === "number" ? index.dimension : null;
}

/**
 * Whether a node's draft config differs from the one it was opened on.
 *
 * Structural, so re-writing the same values in a different key order is not a
 * change — the index picker deletes `index_name`/`dimension` and appends them
 * back.
 *
 * The picker also records the chosen index's dimension, which a server-built
 * pipeline never stored, so re-picking the index a node already targets would
 * otherwise read as an edit. The saved side takes that dimension only when the
 * draft carries exactly the value the registry states: filling it
 * unconditionally would make an untouched drawer dirty the moment it opens, and
 * filling the draft as well would make dropping a dimension the node really
 * stored compare equal, losing that edit with no prompt.
 */
export function nodeConfigChanged(
  nodeType: string,
  draft: Record<string, unknown>,
  saved: Record<string, unknown>,
  indexes: VectorIndex[],
): boolean {
  const comparable =
    saved.dimension === undefined &&
    draft.dimension !== undefined &&
    draft.dimension === registryDimension(nodeType, saved, indexes)
      ? { ...saved, dimension: draft.dimension }
      : saved;
  return !deepEqual(draft, comparable);
}
