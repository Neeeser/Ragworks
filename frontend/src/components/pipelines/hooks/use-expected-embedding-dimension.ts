"use client";

import { useMemo } from "react";

import { resolveExpectedDimension, upstreamEmbedderIdentity } from "../lib/embedding-width";

import { useResolvedEmbeddingDimension } from "./use-resolved-embedding-dimension";

import type { TypedEdgeType } from "../flow/TypedEdge";
import type { PipelineNodeData } from "../PipelineNode";
import type { CatalogModel } from "@/lib/types";
import type { Node } from "@xyflow/react";

interface UseExpectedEmbeddingDimensionParams {
  /** The node the editor drawer currently shows, or null while it's closed. */
  inspectedNode: Node<PipelineNodeData> | null;
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
  /** The slice of `usePipelineModelCatalogs`' result this hook needs -- the
   * caller's existing `modelCatalogs` object already satisfies this. */
  modelCatalogs: { token: string | null; embeddingModels: CatalogModel[] };
}

/**
 * The vector width a store-bound node (indexer/retriever) actually receives,
 * walked back from the `embedder.text` node feeding it on the live canvas
 * graph. A library preview node isn't part of `nodes`/`edges`, so it
 * naturally resolves to `null` here rather than needing a special case.
 *
 * The graph walk and catalog lookup stay in the pure, synchronous
 * `resolveExpectedDimension` (`lib/embedding-width.ts`); this hook only adds
 * the async fallback for providers whose catalog publishes no width at all
 * (OpenRouter, for every embedding model) -- `useResolvedEmbeddingDimension`
 * resolves it via a single memoised endpoint lookup, never a per-render
 * refetch.
 */
export function useExpectedEmbeddingDimension({
  inspectedNode,
  nodes,
  edges,
  modelCatalogs,
}: UseExpectedEmbeddingDimensionParams): number | null {
  const { token, embeddingModels } = modelCatalogs;
  const graphNodes = useMemo(
    () =>
      nodes.map((node) => ({
        id: node.id,
        nodeType: node.data.nodeType,
        config: node.data.config,
      })),
    [nodes],
  );
  const graphEdges = useMemo(
    () => edges.map((edge) => ({ source: edge.source, target: edge.target })),
    [edges],
  );

  const catalogWidth = useMemo(() => {
    if (!inspectedNode) return null;
    return resolveExpectedDimension(inspectedNode.id, graphNodes, graphEdges, embeddingModels);
  }, [inspectedNode, graphNodes, graphEdges, embeddingModels]);

  const upstreamIdentity = useMemo(() => {
    if (!inspectedNode) return null;
    return upstreamEmbedderIdentity(inspectedNode.id, graphNodes, graphEdges);
  }, [inspectedNode, graphNodes, graphEdges]);

  return useResolvedEmbeddingDimension(
    token,
    upstreamIdentity?.connectionId ?? null,
    upstreamIdentity?.modelId ?? null,
    catalogWidth,
  );
}
