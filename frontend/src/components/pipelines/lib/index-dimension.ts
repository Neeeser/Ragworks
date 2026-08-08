import type { VectorIndex } from "@/lib/types";

const isStoreNodeType = (nodeType: string) =>
  nodeType.startsWith("indexer.") || nodeType.startsWith("retriever.");

/**
 * Fills in the `dimension` the index picker writes for a dense store node,
 * so a config that names a registry index compares the same whether or not
 * the dimension was ever written down.
 *
 * The picker records the registry's dimension whenever an index is chosen,
 * while a pipeline built server-side names the index alone — so re-choosing
 * the index a node already targets produces a config that differs from the
 * saved one by a value the registry supplies either way. An explicit
 * dimension is left alone: one that disagrees with the registry is the user's,
 * and hiding that difference would hide a real edit. BM25 nodes are skipped —
 * sparse indexes are text-scored and carry no dimension.
 */
export function withRegistryDimension(
  nodeType: string,
  config: Record<string, unknown>,
  indexes: VectorIndex[],
): Record<string, unknown> {
  if (!isStoreNodeType(nodeType) || nodeType.endsWith(".bm25")) return config;
  if (config.dimension !== undefined) return config;
  const name = config.index_name;
  if (typeof name !== "string") return config;
  const backend = config.backend;
  const index = indexes.find(
    (entry) =>
      entry.name === name &&
      entry.vector_type !== "sparse" &&
      (typeof backend === "string" ? entry.backend === backend : true),
  );
  if (typeof index?.dimension !== "number") return config;
  return { ...config, dimension: index.dimension };
}
