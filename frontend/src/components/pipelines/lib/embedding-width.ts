/**
 * Resolves the vector width a store-bound node (an indexer or retriever)
 * actually receives, by walking the graph back to the `embedder.text` node
 * feeding it. Decoupled from `@xyflow/react`'s node/edge shapes (like
 * `facet-inference.ts`) so it stays a pure, independently testable module —
 * callers adapt real canvas nodes/edges into the plain shapes below.
 *
 * This is what lets the index picker warn before a save: an indexer or
 * retriever names an index directly, with no reference back to the embedder
 * that feeds it, so nothing today notices when a model swap changes the
 * vector width the index actually receives.
 */

import type { CatalogModel } from "@/lib/types";

const EMBEDDER_NODE_TYPE = "embedder.text";

export type EmbeddingWidthNode = {
  id: string;
  nodeType: string;
  config: Record<string, unknown>;
};

export type EmbeddingWidthEdge = {
  source: string;
  target: string;
};

/**
 * Breadth-first walk backward from `nodeId` along inbound edges to the
 * nearest `embedder.text` node. Cycles and disconnected graphs terminate the
 * walk rather than looping; a node with no upstream embedder (or not present
 * in the graph at all, e.g. a library preview) resolves to `null`.
 */
function findUpstreamEmbedder(
  nodeId: string,
  nodes: readonly EmbeddingWidthNode[],
  edges: readonly EmbeddingWidthEdge[],
): EmbeddingWidthNode | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>([nodeId]);
  const queue: string[] = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of edges) {
      if (edge.target !== current || visited.has(edge.source)) continue;
      visited.add(edge.source);
      const sourceNode = nodeById.get(edge.source);
      if (!sourceNode) continue;
      if (sourceNode.nodeType === EMBEDDER_NODE_TYPE) return sourceNode;
      queue.push(edge.source);
    }
  }
  return null;
}

/** The `(connection_id, model_name)` pair an `embedder.text` node names, or
 * `null` while either field is still unset. */
function embedderConnectionAndModel(
  embedder: EmbeddingWidthNode,
): { connectionId: string; modelId: string } | null {
  const connectionId =
    typeof embedder.config.connection_id === "string" ? embedder.config.connection_id : null;
  const modelId =
    typeof embedder.config.model_name === "string" ? embedder.config.model_name : null;
  if (!connectionId || !modelId) return null;
  return { connectionId, modelId };
}

/**
 * The vector width an `embedder.text` node produces: its own explicit
 * `dimension` override when set (the same field the node's config carries,
 * and the same one that survives a model swap only if the author set it
 * deliberately), else the catalog's published width for its
 * `(connection_id, model_name)` pair. `null` when neither states one — the
 * catalog omits published widths for some providers entirely (OpenRouter
 * publishes none for any embedding model), which is exactly the gap the
 * async lookup in `use-expected-embedding-dimension.ts` fills; this module
 * stays synchronous and never reaches for that endpoint itself.
 */
function resolveEmbedderDimension(
  embedder: EmbeddingWidthNode,
  embeddingModels: readonly CatalogModel[],
): number | null {
  const explicit = embedder.config.dimension;
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return explicit;
  }
  const identity = embedderConnectionAndModel(embedder);
  if (!identity) return null;
  const match = embeddingModels.find(
    (model) => model.connection_id === identity.connectionId && model.id === identity.modelId,
  );
  return typeof match?.dimension === "number" ? match.dimension : null;
}

/**
 * The vector width a store-bound node (indexer/retriever) will actually
 * read or write, derived from the `embedder.text` node feeding it. Returns
 * `null` when no embedder is upstream, or its model's width isn't known
 * (unresolved catalog entry, or the model states none) — callers treat
 * `null` as "unknown", never as a mismatch.
 */
export function resolveExpectedDimension(
  nodeId: string,
  nodes: readonly EmbeddingWidthNode[],
  edges: readonly EmbeddingWidthEdge[],
  embeddingModels: readonly CatalogModel[],
): number | null {
  const embedder = findUpstreamEmbedder(nodeId, nodes, edges);
  if (!embedder) return null;
  return resolveEmbedderDimension(embedder, embeddingModels);
}

/** The `(connection_id, model_name)` pair of the `embedder.text` node
 * feeding `nodeId`, or `null` when no embedder is upstream, it isn't
 * configured yet, or it carries an explicit `dimension` override (nothing
 * left to look up). Lets a caller resolve a width the catalog doesn't
 * publish — an async lookup that belongs in a hook, not here — without
 * walking the graph a second time. */
export function upstreamEmbedderIdentity(
  nodeId: string,
  nodes: readonly EmbeddingWidthNode[],
  edges: readonly EmbeddingWidthEdge[],
): { connectionId: string; modelId: string } | null {
  const embedder = findUpstreamEmbedder(nodeId, nodes, edges);
  if (!embedder) return null;
  const explicit = embedder.config.dimension;
  if (typeof explicit === "number" && Number.isFinite(explicit)) return null;
  return embedderConnectionAndModel(embedder);
}
